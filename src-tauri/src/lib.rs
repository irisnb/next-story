pub mod ai_host;
pub mod ai_orchestration;
pub mod capability_gateway;
pub mod conversation_store;
pub mod dsh_driver;
pub mod dsh_sidecar;
pub mod dsh_version;
pub mod llm_config;
pub mod project;
pub mod recent_works;
pub mod runtime_contract;
pub mod story_tool_channel;
pub mod story_tools;

use std::path::PathBuf;

use tauri::Manager;

use llm_config::{LlmConfig, LlmConfigSummary};
use project::{
    ContentTree, CreateProjectParams, ExportWordResult, ProjectLocks, ProjectOpenResult,
};

#[cfg(test)]
mod tests {
    /// controlled-story-read-visibility：受控读取与文档可见性命令都是受控前端服务，
    /// 绝不注册为 AI 可调用工具；AI 路径不获得任何写入能力，读取与目录投影命令
    /// 也不含写入语义。未知工具名一律拒绝（fail closed）。
    #[test]
    fn read_and_visibility_commands_are_not_ai_callable_tools() {
        use super::capability_gateway::{authorize_tool, ToolAuthorization};

        for name in [
            "read_material",
            "set_document_ai_visibility",
            "ai_directory_projection",
        ] {
            assert!(
                !super::capability_gateway::READ_ONLY_STORY_TOOLS.contains(&name),
                "受控读取/可见性命令不应出现在只读作品工具集合: {name}"
            );
            assert_eq!(
                authorize_tool(name),
                ToolAuthorization::Unknown,
                "受控读取/可见性命令作为工具名应被拒绝: {name}"
            );
        }
    }

    /// controlled-story-read-visibility：受控只读拒绝必须失败关闭，映射为固定中文
    /// 文案，绝不携带正文、文档名、ID 或路径等可推断身份的任何细节。
    #[test]
    fn read_material_denial_messages_are_fixed_and_never_leak_details() {
        use super::project::{MaterialDenial, MaterialDenialReason};

        let cases = [
            (MaterialDenialReason::WorkMismatch, "作品身份无效"),
            (MaterialDenialReason::DocumentMissing, "文档不可用"),
            (MaterialDenialReason::DocumentNotVisible, "文档当前不可查看"),
            (MaterialDenialReason::DocumentRecycled, "文档已删除"),
            (MaterialDenialReason::NotADocument, "目标不是文档"),
            (MaterialDenialReason::VersionUnavailable, "文档版本不可用"),
            (MaterialDenialReason::InvalidRange, "读取范围无效"),
            (MaterialDenialReason::InvalidSnapshot, "未保存快照无效"),
            (
                MaterialDenialReason::RecoveryRequired,
                "作品有未完成的保存，请重新打开作品完成恢复后再试",
            ),
        ];

        for (reason, expected) in cases {
            let message = super::read_material_denial_message(&MaterialDenial::new(reason));
            assert_eq!(message, expected, "拒绝原因 {reason:?} 的文案不匹配");
            for sensitive in ["doc-", "作品文本", "documents", "林站", "绝密"] {
                assert!(
                    !message.contains(sensitive),
                    "固定文案不得含敏感痕迹 {sensitive:?}: {message}"
                );
            }
        }
    }

    /// controlled-story-read-visibility：隐藏文档的读取拒绝走真实链路，错误文案不
    /// 泄露被拒文档的名称、ID 或路径，正文也绝不被返回。
    #[test]
    fn read_material_denial_hides_hidden_document_identity() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "隐藏读取测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");

        let tree = super::project::recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let secret_name = "绝密角色档案";
        super::project::rename_node(&root, &doc_id, secret_name).expect("rename");
        super::project::set_document_ai_visibility(&root, &doc_id, false).expect("hide");

        let request = super::project::ReadMaterialRequest {
            work_id: root.canonicalize().unwrap().to_string_lossy().to_string(),
            document_id: doc_id.clone(),
            range: None,
            expected_version: None,
            snapshot: None,
        };

        let denial =
            super::project::read_material(&root, &request).expect_err("隐藏文档必须被拒绝");
        let message = super::read_material_denial_message(&denial);

        assert_eq!(message, "文档当前不可查看");
        assert!(!message.contains(secret_name), "错误文案不得泄露文档名称");
        assert!(!message.contains(&doc_id), "错误文案不得泄露文档 ID");
        assert!(!message.contains("作品文本"), "错误文案不得泄露路径");
    }
}

// ========== Tauri Commands ==========

/// 创建新作品。同步目录创建放在阻塞线程；新目录创建本身互斥（同名已存在即拒绝），
/// 无需作品锁（作品根尚不存在，无法规范化取锁）。
#[tauri::command]
async fn create_project(params: CreateProjectParams) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || project::create_new_project(params))
        .await
        .map_err(|e| format!("创建作品任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
        .map(|root| root.to_string_lossy().to_string())
}

/// 打开作品：在阻塞线程内取作品锁并覆盖整个「迁移 + 校验 + 读取」流程，
/// 返回整棵内容树结构；同一作品的打开/保存/迁移在进程内串行化。
#[tauri::command]
async fn open_project(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<ProjectOpenResult, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::open_existing_project(&project_root)
    })
    .await
    .map_err(|e| format!("打开作品任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

// ========== 内容树命令（前端文件管理） ==========

/// 读取整棵内容树结构：在阻塞线程内取作品锁后读取并校验。
#[tauri::command]
async fn open_content_tree(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<ContentTree, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::recover_then_read_content_tree(&project_root)
    })
    .await
    .map_err(|e| format!("读取内容树任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 按文档 ID 读取单篇文档正文：在阻塞线程内取作品锁后读取并校验。
#[tauri::command]
async fn read_document(
    app: tauri::AppHandle,
    project_path: String,
    document_id: String,
) -> Result<String, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::read_document(&project_root, &document_id)
    })
    .await
    .map_err(|e| format!("读取文档任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 按文档 ID 保存单篇文档正文：在阻塞线程内取作品锁后覆盖整个保存事务。
#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    project_path: String,
    document_id: String,
    content: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::save_document(&project_root, &document_id, &content)
    })
    .await
    .map_err(|e| format!("保存文档任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 在指定父级（含根级）下创建文件夹，返回新节点 ID。
#[tauri::command]
async fn create_folder(
    app: tauri::AppHandle,
    project_path: String,
    parent: Option<String>,
) -> Result<String, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::create_folder(&project_root, parent.as_deref())
    })
    .await
    .map_err(|e| format!("创建文件夹任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 在指定父级（含根级）下创建文档，返回新节点 ID。
#[tauri::command]
async fn create_document(
    app: tauri::AppHandle,
    project_path: String,
    parent: Option<String>,
) -> Result<String, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::create_document(&project_root, parent.as_deref())
    })
    .await
    .map_err(|e| format!("创建文档任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 重命名节点：校验新名称合法性后事务提交，失败保持原名。
#[tauri::command]
async fn rename_node(
    app: tauri::AppHandle,
    project_path: String,
    id: String,
    name: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::rename_node(&project_root, &id, &name)
    })
    .await
    .map_err(|e| format!("重命名节点任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 移动节点到另一父级（含根级）：禁止循环，事务提交。
#[tauri::command]
async fn move_node(
    app: tauri::AppHandle,
    project_path: String,
    id: String,
    new_parent: Option<String>,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::move_node(&project_root, &id, new_parent.as_deref())
    })
    .await
    .map_err(|e| format!("移动节点任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 重排父级内子节点顺序：顺序列表须完整覆盖且不重复，事务提交。
#[tauri::command]
async fn reorder_children(
    app: tauri::AppHandle,
    project_path: String,
    parent: Option<String>,
    order: Vec<String>,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::reorder_children(&project_root, parent.as_deref(), order)
    })
    .await
    .map_err(|e| format!("重排子节点任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 删除节点（含完整子树）进回收站：正文文件保持原位，事务提交。
#[tauri::command]
async fn delete_node(
    app: tauri::AppHandle,
    project_path: String,
    id: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::delete_node(&project_root, &id)
    })
    .await
    .map_err(|e| format!("删除节点任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 从回收站恢复被删除的子树：层级、顺序与名称保持删除前状态，事务提交。
#[tauri::command]
async fn restore_node(
    app: tauri::AppHandle,
    project_path: String,
    id: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::restore_node(&project_root, &id)
    })
    .await
    .map_err(|e| format!("恢复节点任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

// ========== 文档 AI 可见性命令（controlled-story-read-visibility） ==========

/// 设置单篇文档的 AI 可见性（二元开关）。只作用于文档，文件夹无此状态；
/// 正文文件绝不触碰。这是受控应用服务的前端命令，绝不注册为 AI 可调用工具。
#[tauri::command]
async fn set_document_ai_visibility(
    app: tauri::AppHandle,
    project_path: String,
    document_id: String,
    ai_visible: bool,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::set_document_ai_visibility(&project_root, &document_id, ai_visible)
    })
    .await
    .map_err(|e| format!("设置文档可见性任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 查询提供给 AI 路径的作品目录投影：只含允许查看的文档与必要文件夹路径，
/// 并返回匿名隐藏文件数量。不泄露隐藏文档的名称、ID、路径或正文。
#[tauri::command]
async fn ai_directory_projection(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<project::DirectoryProjection, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::read_directory_projection(&project_root)
    })
    .await
    .map_err(|e| format!("读取目录投影任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

// ========== 受控只读作品材料命令（controlled-story-read-visibility） ==========

/// 把受控只读拒绝映射为安全的中文错误：固定文案，绝不携带正文、文档名、ID 或路径。
/// 失败关闭原则：任何被拒材料都只返回稳定文案，不泄露可推断身份的任何细节。
fn read_material_denial_message(denial: &project::MaterialDenial) -> String {
    use project::MaterialDenialReason::*;
    match denial.reason {
        WorkMismatch => "作品身份无效",
        DocumentMissing => "文档不可用",
        DocumentNotVisible => "文档当前不可查看",
        DocumentRecycled => "文档已删除",
        NotADocument => "目标不是文档",
        VersionUnavailable => "文档版本不可用",
        InvalidRange => "读取范围无效",
        InvalidSnapshot => "未保存快照无效",
        RecoveryRequired => "作品有未完成的保存，请重新打开作品完成恢复后再试",
    }
    .to_string()
}

/// 受控只读读取单篇作品材料（供未来 AI 读取路径使用）：在作品锁保护下校验作品、
/// 文档、回收站、AI 可见性、版本、范围与未保存快照身份后返回结构化材料。
/// 任何拒绝都失败关闭，返回固定中文文案且不泄露被拒材料内容或身份；
/// 绝不注册为 AI 可调用工具，也不具备任何写入能力。
#[tauri::command]
async fn read_material(
    app: tauri::AppHandle,
    project_path: String,
    request: project::ReadMaterialRequest,
) -> Result<project::StoryMaterial, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<project::StoryMaterial, String> {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        project::read_material(&project_root, &request)
            .map_err(|denial| read_material_denial_message(&denial))
    })
    .await
    .map_err(|e| format!("读取作品材料任务执行失败: {e}"))?
}

// ========== 讨论档案命令（conversation-persistence 任务 2.2） ==========

/// 列出当前作品的已保存讨论（摘要视图）。损坏/超限档案被跳过并如实返回提示。
#[tauri::command]
async fn conversation_list(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<conversation_store::ListResult, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::list_conversations(&project_root).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("读取讨论列表任务执行失败: {e}"))?
}

/// 保存（原子写入）一份讨论档案到作品系统目录，与作品正文分开存放。
#[tauri::command]
async fn conversation_save(
    app: tauri::AppHandle,
    project_path: String,
    record: conversation_store::ConversationRecord,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::save_conversation(&project_root, &record).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("保存讨论任务执行失败: {e}"))?
}

/// 删除一份讨论档案（幂等：不存在视为成功）。
#[tauri::command]
async fn conversation_delete(
    app: tauri::AppHandle,
    project_path: String,
    conversation_id: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::delete_conversation(&project_root, &conversation_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("删除讨论任务执行失败: {e}"))?
}

/// 撤销删除：清除该讨论的删除墓碑（供前端在撤销期内恢复档案）。
#[tauri::command]
async fn conversation_restore(
    app: tauri::AppHandle,
    project_path: String,
    conversation_id: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::restore_conversation(&project_root, &conversation_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("撤销删除讨论任务执行失败: {e}"))?
}

// ========== 按需补读授权命令（add-agent-on-demand-reading 任务 7；最小命令面） ==========

/// 开启 / 关闭指定讨论的按需补读授权（讨论内授权开关，任务 7.2）。
/// 关闭立即阻止后续补读工具调用（宿主逐次从档案校验授权）；
/// 关闭不清除已读内容（补读出处原样保留在档案）。
/// 受控应用服务命令，绝不注册为 AI 可调用工具。
#[tauri::command]
async fn conversation_set_on_demand_reading(
    app: tauri::AppHandle,
    project_path: String,
    conversation_id: String,
    granted: bool,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::set_on_demand_reading(&project_root, &conversation_id, granted)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("设置按需补读授权任务执行失败: {e}"))?
}

/// 查询使用过指定文档的讨论（任务 7.5：关闭文档 AI 可见性前的影响提示数据）。
/// 只读；覆盖常规材料出处与按需补读出处两类来源。
#[tauri::command]
async fn conversations_using_document(
    app: tauri::AppHandle,
    project_path: String,
    document_id: String,
) -> Result<Vec<conversation_store::ConversationUsage>, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::conversations_using_document(&project_root, &document_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("查询受影响讨论任务执行失败: {e}"))?
}

/// 读取指定讨论的按需补读状态（授权 + 补读出处；任务 7.4「本次参考了什么」刷新用）。
/// 只读。
#[tauri::command]
async fn conversation_on_demand_reading(
    app: tauri::AppHandle,
    project_path: String,
    conversation_id: String,
) -> Result<conversation_store::OnDemandReadingState, String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root).map_err(|e| e.to_string())?;
        conversation_store::on_demand_reading_state(&project_root, &conversation_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("读取按需补读状态任务执行失败: {e}"))?
}

/// 导出当前作品为 Word 文档：只读取已保存内容，生成真正的 `.docx` 并写入
/// 用户选择的目标路径。命令始终返回稳定的 `ExportWordResult`（成功 / 失败
/// 都带中文说明），前端据此区分结果，不依赖 Tauri 错误序列化细节。
#[tauri::command]
async fn export_project_to_word(
    app: tauri::AppHandle,
    project_path: String,
    target_path: String,
) -> Result<ExportWordResult, String> {
    let project_root = PathBuf::from(&project_path);
    let target = PathBuf::from(&target_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::export_project_to_word(&project_root, &target)
    })
    .await
    .map_err(|e| format!("导出作品任务执行失败: {e}"))?;

    Ok(match result {
        Ok(success) => success,
        Err(error) => ExportWordResult::failure(error.to_string()),
    })
}

/// 导出等待计时 JSON 的稳定返回结果（与 `ExportWordResult` 同形契约）：命令始终
/// 成功返回该结构，前端据此区分成功 / 失败，不依赖 Tauri 错误序列化细节。
#[derive(Debug, serde::Serialize)]
struct ExportTimingResult {
    ok: bool,
    path: Option<String>,
    message: Option<String>,
}

/// 导出等待计时数据：把前端传来的计时 JSON 字符串写入用户经系统保存对话框选择的
/// 目标路径。只写该目标文件，不读取也不触碰任何作品目录
/// （app-real-chain-validation design D2：落盘位置永远由用户主动选择）。
#[tauri::command]
async fn export_wait_timing_json(
    target_path: String,
    content: String,
) -> Result<ExportTimingResult, String> {
    let target = PathBuf::from(&target_path);
    let written =
        tauri::async_runtime::spawn_blocking(move || std::fs::write(&target, content.as_bytes()))
            .await
            .map_err(|e| format!("导出等待计时任务执行失败: {e}"))?;
    Ok(match written {
        Ok(()) => ExportTimingResult {
            ok: true,
            path: Some(target_path),
            message: None,
        },
        Err(e) => ExportTimingResult {
            ok: false,
            path: None,
            message: Some(format!("无法写入文件: {e}")),
        },
    })
}

// ========== LLM 配置命令 ==========

/// 在系统默认浏览器中打开 http/https 链接；其它地址拒绝。
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("不是 http/https 地址".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || open::that(&url))
        .await
        .map_err(|e| format!("打开链接任务执行失败: {e}"))?
        .map_err(|e| format!("无法打开链接: {e}"))
}

/// 保存 LLM 配置：同步目录/文件/钥匙串操作放在阻塞线程，事务化保存由
/// `llm_config::save_llm_config` 内部的进程内互斥串行化。
#[tauri::command]
async fn save_llm_config(app: tauri::AppHandle, config: LlmConfig) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || llm_config::save_llm_config(&dir, &config))
        .await
        .map_err(|e| format!("保存配置任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 加载已保存的 LLM 配置摘要：不含明文 API Key，只含非敏感字段与 `has_api_key`。
#[tauri::command]
async fn load_llm_config(app: tauri::AppHandle) -> Result<Option<LlmConfigSummary>, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || llm_config::load_llm_config_summary(&dir))
        .await
        .map_err(|e| format!("读取配置任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 测试 LLM 配置连接：未输入新密钥时由后端复用钥匙串中的旧密钥。
#[tauri::command]
async fn test_llm_connection(config: LlmConfig) -> Result<(), String> {
    let config = llm_config::resolve_effective_config(&config).map_err(|e| e.to_string())?;
    llm_config::test_llm_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

// ========== 最近作品命令（batch-improvement-candidates 任务组 3④） ==========

/// 读取最近作品列表：后端完成有效性检查与自愈（失效条目顺手从存储移除）；
/// 文件缺失或损坏失败开放为空列表，不影响启动。同步文件操作放在阻塞线程。
#[tauri::command]
async fn load_recent_works(
    app: tauri::AppHandle,
) -> Result<Vec<recent_works::RecentWorkEntry>, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || recent_works::load_recent_works(&dir))
        .await
        .map_err(|e| format!("读取最近作品任务执行失败: {e}"))
}

/// 记录一次成功的打开/新建：按路径去重移顶、至多保留 8 条、原子写回。
#[tauri::command]
async fn record_recent_work(
    app: tauri::AppHandle,
    name: String,
    path: String,
) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        recent_works::record_recent_work(&dir, &name, &path)
    })
    .await
    .map_err(|e| format!("记录最近作品任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

// ========== Application Entry Point ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 进程内作品锁注册表：同一作品的操作串行化。
        .manage(ProjectLocks::default())
        // 关闭 WebView2 的浏览器快捷键拦截（默认会吞掉 Ctrl+U/Ctrl+F 等，前端 keydown 收不到）。
        .setup(|app| {
            // 常驻驱动生命周期接线：流式增量与驱动丢失事件转发前端（ai_host，
            // resident-ai-session 任务 3.4 / 4.4）。
            ai_host::install_driver_event_bridge(app.handle());

            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                        use windows_core::Interface;
                        let controller = webview.controller();
                        // SAFETY: 窗口附加完成后 controller 已初始化非空；
                        // CoreWebView2() 是同步 COM getter，调用期间对象存活。
                        if let Ok(core) = unsafe { controller.CoreWebView2() } {
                            // SAFETY: core 在上一步 getter 成功后存活；Settings()
                            // 是同步 COM getter，返回指针仅在当前块内解引用。
                            if let Ok(settings) = unsafe { core.Settings() } {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    // SAFETY: settings3 由 Settings() cast 而来，
                                    // 仅在 WebView2 环境下触达该路径（非 WebView2
                                    // 平台不进入此分支）。
                                    let _ = unsafe {
                                        settings3.SetAreBrowserAcceleratorKeysEnabled(false)
                                    };
                                }
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            open_content_tree,
            read_document,
            save_document,
            create_folder,
            create_document,
            rename_node,
            move_node,
            reorder_children,
            delete_node,
            restore_node,
            set_document_ai_visibility,
            ai_directory_projection,
            read_material,
            export_project_to_word,
            export_wait_timing_json,
            open_url,
            save_llm_config,
            load_llm_config,
            test_llm_connection,
            load_recent_works,
            record_recent_work,
            ai_orchestration::generate_ai_thinking,
            ai_host::ai_start_session,
            ai_orchestration::ai_send_message,
            ai_host::ai_cancel_message,
            ai_host::ai_end_session,
            ai_host::ai_resolve_reading_request,
            ai_host::ai_replay_history,
            ai_host::ai_replay_done,
            conversation_list,
            conversation_save,
            conversation_delete,
            conversation_restore,
            conversation_set_on_demand_reading,
            conversations_using_document,
            conversation_on_demand_reading
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 运行应用：退出时经 ai_host 优雅关停常驻驱动进程（design.md D3 生命周期表）。
    ai_host::run_app_with_driver_shutdown(app);
}
