pub mod capability_gateway;
pub mod dsh_sidecar;
pub mod dsh_version;
pub mod llm_config;
pub mod project;
pub mod runtime_contract;

use std::path::PathBuf;

use tauri::Manager;

use llm_config::{GenerateAiResult, LlmConfig, LlmConfigSummary};
use project::{ContentTree, CreateProjectParams, ProjectLocks, ProjectOpenResult};

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::llm_config::{GenerateAiErrorCode, GenerateAiResult};

    #[tokio::test]
    async fn command_boundary_rejects_malformed_raw_requests_with_safe_results() {
        let cases = [
            serde_json::json!({
                "kind": "unknown",
                "selected_text": "选区"
            }),
            serde_json::json!({
                "kind": "first"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": "not-an-array"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant"}
                ]
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应"},
                    {"role": "system", "content": "不能进入请求"}
                ]
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应"},
                    {"role": "tool", "content": "不能进入请求"}
                ]
            }),
        ];

        for request in cases {
            let result =
                super::generate_ai_result_for_request(Path::new("unused"), None, request).await;
            assert!(!result.ok);
            let error = result.error.expect("malformed request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
            assert!(!error.message.contains("选区"));
            assert!(!error.message.contains("not-an-array"));
            assert!(!error.message.contains("不能进入请求"));
        }
    }

    #[tokio::test]
    async fn command_boundary_validates_semantics_before_loading_configuration() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let cases = [
            serde_json::json!({
                "kind": "first",
                "selected_text": "   \n"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "user", "content": "不能缺少首次回应"}
                ]
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request(temp.path(), None, request).await;
            assert!(!result.ok);
            let error = result.error.expect("invalid request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }
    }

    /// 2.7 生成命令协议白名单：注入 `draft_content`/`main_content`/`project_path`
    /// 等未声明字段（含嵌套消息内），必须稳定拒绝，且作品文件字节不变。
    #[tokio::test]
    async fn generate_command_rejects_unknown_fields_without_touching_project_files() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root =
            super::project::create_new_project(super::project::CreateProjectParams {
                name: "白名单作品".to_string(),
                save_location: temp.path().to_string_lossy().to_string(),
            })
            .expect("create project");

        let paths = super::project::ProjectPaths::new(project_root);
        // 版本 3 布局：内容树元数据 + 根级文档正文 + 作品元信息。
        let tree: super::project::ContentTree = serde_json::from_str(
            &std::fs::read_to_string(&paths.content_tree_file).expect("read content tree"),
        )
        .expect("parse content tree");
        let doc_ids: Vec<String> = tree.root_children.clone();
        let mut files = vec![paths.content_tree_file.clone(), paths.metadata_file.clone()];
        for id in &doc_ids {
            files.push(paths.document_file(id));
        }
        let before: Vec<Vec<u8>> = files
            .iter()
            .map(|path| std::fs::read(path).expect("read project file before"))
            .collect();

        let cases = [
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "draft_content": "注入草稿",
            }),
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "main_content": "注入正文",
            }),
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "project_path": "注入路径",
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应", "draft_content": "嵌套注入"}
                ],
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request(temp.path(), None, request).await;
            assert!(!result.ok, "未知字段请求必须被拒绝");
            let error = result.error.expect("rejected request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }

        for (path, before_bytes) in files.iter().zip(before.iter()) {
            let after = std::fs::read(path).expect("read project file after");
            assert_eq!(
                &after,
                before_bytes,
                "生成命令拒绝未知字段时不得改动作品文件: {}",
                path.display()
            );
        }
    }

    fn _assert_result_type_is_stable(_: GenerateAiResult) {}
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
        project::open_content_tree(&project_root)
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

/// 使用唯一保存配置，围绕选区原文生成一次真实 AI 思考材料
#[tauri::command]
async fn generate_ai_thinking(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();

    Ok(generate_ai_result_for_request(&dir, resource_dir.as_deref(), request).await)
}

async fn generate_ai_result_for_request(
    base_dir: &std::path::Path,
    resource_dir: Option<&std::path::Path>,
    request: serde_json::Value,
) -> GenerateAiResult {
    let request = match llm_config::parse_generate_ai_request(request) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    llm_config::generate_ai_result_in_with_resource(base_dir, resource_dir, request).await
}

// ========== Application Entry Point ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 进程内作品锁注册表：同一作品的操作串行化。
        .manage(ProjectLocks::default())
        // 关闭 WebView2 的浏览器快捷键拦截（默认会吞掉 Ctrl+U/Ctrl+F 等，前端 keydown 收不到）。
        .setup(|app| {
            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                        use windows_core::Interface;
                        let controller = webview.controller();
                        if let Ok(core) = unsafe { controller.CoreWebView2() } {
                            if let Ok(settings) = unsafe { core.Settings() } {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
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
            open_url,
            save_llm_config,
            load_llm_config,
            test_llm_connection,
            generate_ai_thinking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
