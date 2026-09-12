pub mod capability_gateway;
pub mod conversation_store;
pub mod dsh_driver;
pub mod dsh_sidecar;
pub mod dsh_version;
pub mod llm_config;
pub mod project;
pub mod runtime_contract;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use llm_config::{GenerateAiResult, LlmConfig, LlmConfigSummary};
use project::{
    ContentTree, CreateProjectParams, ExportWordResult, ProjectLocks, ProjectOpenResult,
};

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::llm_config::{GenerateAiErrorCode, GenerateAiResult};

    /// 测试专用：按生产 `project::story_material::compute_version`（私有）的 FNV-1a
    /// 64-bit 算法复现内容派生版本，输出 16 位小写十六进制，格式与生产完全一致。
    /// 不放入生产 API，不放宽校验。
    fn compute_version_for_test(content: &str) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in content.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{hash:016x}")
    }

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
            serde_json::json!({
                "kind": "direct_question",
                "question": "   \n"
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request_with_material(
                Path::new("unused"),
                None,
                request,
                None,
            )
            .await;
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
            let result = super::generate_ai_result_for_request_with_material(
                temp.path(),
                None,
                request,
                None,
            )
            .await;
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
                "document_id": "文档",
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
            let result = super::generate_ai_result_for_request_with_material(
                temp.path(),
                None,
                request,
                None,
            )
            .await;
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

        let tree = super::project::open_content_tree(&root).expect("open tree");
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

    #[test]
    fn selected_material_requires_complete_source_identity() {
        let error =
            super::selection_identity_error(Some("冻结选区"), None, None, Some("doc"), None)
                .expect_err("裸选区必须拒绝");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
    }

    #[test]
    fn snapshot_without_identity_is_rejected() {
        let error = super::selection_identity_error(
            None,
            Some(
                "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\"}}",
            ),
            Some("D:\\作品"),
            None,
            None,
        )
        .expect_err("仅快照缺文档/版本身份必须拒绝");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
    }

    /// controlled-story-read-visibility：合法快照经授权后返回受控材料，
    /// 生成层据此使用授权内容；错误快照失败关闭。
    #[test]
    fn valid_snapshot_is_authorized_and_wrong_snapshot_is_rejected() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "快照授权测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = super::project::open_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        // 合法快照：单段落正文，选区即整段纯文本，快照为规范化 Tiptap JSON。
        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");
        assert_eq!(material.document_id, doc_id);
        assert_eq!(material.version, version);
        assert!(material.content.contains("林站在天台边。"));

        // 错误快照：不是合法 Tiptap JSON → 失败关闭，不返回正文。
        let invalid_json = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some("不是合法本子 JSON"),
            None,
        )
        .expect_err("非法快照必须拒绝");
        assert_eq!(invalid_json.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(invalid_json.message, "AI 请求内容无效，请重试");

        // 快照正文不包含选区文本 → 裸选区文本不能绕过授权。
        let mismatch = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("完全不相干的一段话"),
            Some(snapshot),
            None,
        )
        .expect_err("选区不落在快照正文内必须拒绝");
        assert_eq!(mismatch.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(mismatch.message, "AI 请求内容无效，请重试");
    }

    /// 授权通过的快照材料进入生成提示词；原始 selected_text 不得绕过授权。
    #[test]
    fn authorized_snapshot_material_enters_prompt() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "授权材料进提示词".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = super::project::open_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        // 生成层使用授权材料 content，而非原始 selected_text 字段。
        // 授权通过后，选区文本已被确认落在授权材料正文内，提示词只能携带该授权选区。
        assert!(
            material.content.contains("林站在天台边。"),
            "选区文本必须落在授权材料正文内"
        );
        let request = super::llm_config::GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            document_id: Some(doc_id),
            project_path: Some(project_path),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        let task = super::llm_config::generate::build_task_string(&request).expect("build task");
        assert!(
            task.contains("林站在天台边。"),
            "授权选区内容必须进入提示词"
        );

        let selected = super::authorized_selection_from_material(&material, "林站在天台边。")
            .expect("授权材料应能提取已验证选区");
        assert_eq!(selected, "林站在天台边。");
        assert!(
            super::authorized_selection_from_material(&material, "伪造材料").is_none(),
            "不在受控材料中的原始选区不得进入提示词"
        );
    }

    /// `authorized_selection_text` 必须从已授权材料提取选区，绝不直接复用原始
    /// `selected_text` 字段；伪造选区或缺少授权材料时失败关闭，无选区返回 `None`。
    #[test]
    fn authorized_selection_text_extracts_material_and_fails_closed() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "授权提取测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = super::project::open_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        // 有授权材料 + 匹配选区 → 从材料正文提取。
        let extracted = super::authorized_selection_text(Some(&material), Some("林站在天台边。"))
            .expect("授权材料应能提取选区")
            .expect("应返回选区内容");
        assert_eq!(extracted, "林站在天台边。");

        // 伪造选区（不落在授权材料正文内）→ 失败关闭，绝不进入提示词。
        assert!(
            super::authorized_selection_text(Some(&material), Some("完全不相干的一段话")).is_err(),
            "伪造选区必须失败关闭"
        );

        // 有选区却无授权材料 → 失败关闭（绝不静默回退到原始 selected_text）。
        assert!(
            super::authorized_selection_text(None, Some("林站在天台边。")).is_err(),
            "有选区却无授权材料必须失败关闭"
        );

        // 无选区（直接提问 / 追问）与空白选区 → None。
        assert_eq!(
            super::authorized_selection_text(None, None).expect("无选区应成功"),
            None
        );
        assert_eq!(
            super::authorized_selection_text(Some(&material), Some("   \n"))
                .expect("空白选区应成功"),
            None
        );
    }

    /// 生产命令路径：`apply_authorized_selection` 用授权材料重写请求中声明的选区，
    /// 使提示词组装只看到受控材料内容，原始 `selected_text` 不直接进入 DSH prompt。
    #[test]
    fn apply_authorized_selection_rewrites_request_selection_from_material() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "重写选区测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = super::project::open_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        let request = super::llm_config::GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            document_id: Some(doc_id),
            project_path: Some(project_path),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        let rewritten = super::apply_authorized_selection(request, Some(&material))
            .expect("授权材料应能重写选区");
        match &rewritten {
            super::llm_config::GenerateAiRequest::First { selected_text, .. } => {
                assert_eq!(selected_text, "林站在天台边。");
            }
            other => panic!("应为 First 变体，实际: {other:?}"),
        }

        // 伪造选区重写失败关闭：原始 selected_text 不会直接进入 DSH prompt。
        let forged = super::llm_config::GenerateAiRequest::First {
            selected_text: "伪造材料".to_string(),
            document_id: Some("doc".to_string()),
            project_path: Some("project".to_string()),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        assert!(
            super::apply_authorized_selection(forged, Some(&material)).is_err(),
            "伪造选区必须失败关闭，不得进入提示词"
        );
    }
}

fn selection_identity_error(
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    project_path: Option<&str>,
    document_id: Option<&str>,
    document_version: Option<&str>,
) -> Result<(), llm_config::GenerateAiError> {
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    let has_snapshot = snapshot
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    // 无选区且无快照（无选区直接提问）不要求来源身份。
    if !has_selection && !has_snapshot {
        return Ok(());
    }
    // 有选区或有快照时必须携带完整来源身份（作品 / 文档 / 版本），裸材料拒绝。
    if [project_path, document_id, document_version]
        .iter()
        .any(|value| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        })
    {
        return Err(llm_config::GenerateAiError::new(
            llm_config::GenerateAiErrorCode::InvalidResponse,
            "AI 请求内容无效，请重试",
        ));
    }
    Ok(())
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
    .map_err(|e| format!("恢复讨论任务执行失败: {e}"))?
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

    let locks = app.state::<ProjectLocks>().inner().clone();
    let authorized = match authorize_request_selection(&request, locks).await {
        Ok(material) => material,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };

    Ok(generate_ai_result_for_request_with_material(
        &dir,
        resource_dir.as_deref(),
        request,
        authorized.as_ref(),
    )
    .await)
}

/// 从原始 JSON 请求提取选区身份字段并执行授权，返回受控材料；失败关闭。
async fn authorize_request_selection(
    request: &serde_json::Value,
    locks: ProjectLocks,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    let selected_text = request
        .get("selected_text")
        .and_then(serde_json::Value::as_str);
    let snapshot = request.get("snapshot").and_then(serde_json::Value::as_str);
    let project_path = request
        .get("project_path")
        .and_then(serde_json::Value::as_str);
    let document_id = request
        .get("document_id")
        .and_then(serde_json::Value::as_str);
    let document_version = request
        .get("document_version")
        .and_then(serde_json::Value::as_str);
    authorize_selection(
        project_path,
        document_id,
        document_version,
        selected_text,
        snapshot,
        Some(locks),
    )
    .await
}

/// 异步授权入口：在阻塞线程内完成「作品锁 + 受控只读读取」（见 [`authorize_selection_sync`]）。
/// 返回授权后的受控材料；无选区且无快照时返回 `None`（无选区直接提问不携带材料）。
async fn authorize_selection(
    project_path: Option<&str>,
    document_id: Option<&str>,
    document_version: Option<&str>,
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    locks: Option<ProjectLocks>,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    selection_identity_error(
        selected_text,
        snapshot,
        project_path,
        document_id,
        document_version,
    )?;
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    let has_snapshot = snapshot
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    if !has_selection && !has_snapshot {
        return Ok(None);
    }
    let project_path = project_path
        .expect("selection identity checked")
        .to_string();
    let document_id = document_id.expect("selection identity checked").to_string();
    let document_version = document_version
        .expect("selection identity checked")
        .to_string();
    let selected_text = selected_text.map(str::to_string);
    let snapshot = snapshot.map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        authorize_selection_sync(
            &project_path,
            &document_id,
            &document_version,
            selected_text.as_deref(),
            snapshot.as_deref(),
            locks.as_ref(),
        )
    })
    .await
    .map_err(|_| invalid_selection_error())?
}

/// 同步授权核心：把选区材料身份映射为 `ReadMaterialRequest`，在作品锁保护下调用
/// `read_material` 校验作品 / 文档 / 可见性 / 版本 / 快照身份，并确认选区文本落在
/// 授权材料正文内。返回授权后的受控材料；失败关闭，绝不返回正文。
///
/// `snapshot`（前端规范化 Tiptap JSON 字符串）被映射为 [`project::MaterialSnapshot`]，
/// 其 work_id / document_id / version 与请求身份一致，由 `read_material` 统一校验；
/// 生成层只能使用授权后的材料内容，不得回读原始 `selected_text` 字段。
/// `locks` 为 `None` 时跳过取锁（测试路径，单线程无并发）。
fn authorize_selection_sync(
    project_path: &str,
    document_id: &str,
    document_version: &str,
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    locks: Option<&ProjectLocks>,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    let canonical = std::path::Path::new(project_path)
        .canonicalize()
        .map_err(|_| invalid_selection_error())?;
    let work_id = canonical.to_string_lossy().to_string();
    let request = project::ReadMaterialRequest {
        work_id: work_id.clone(),
        document_id: document_id.to_string(),
        range: None,
        expected_version: Some(document_version.to_string()),
        snapshot: snapshot.map(|content| project::MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: document_id.to_string(),
            version: document_version.to_string(),
            content: content.to_string(),
        }),
    };
    let root = PathBuf::from(project_path);
    let _guard = locks
        .map(|locks| locks.acquire(&root))
        .transpose()
        .map_err(|_| invalid_selection_error())?;
    let material =
        project::read_material(&root, &request).map_err(|_| invalid_selection_error())?;
    if let Some(selection) = selected_text.map(str::trim).filter(|text| !text.is_empty()) {
        if !material.content.contains(selection) {
            return Err(invalid_selection_error());
        }
    }
    Ok(Some(material))
}

fn invalid_selection_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::InvalidResponse,
        "AI 请求内容无效，请重试",
    )
}

/// 从已授权的结构化材料中提取请求声明的选区。返回值来自受控材料，
/// 而不是直接复用请求中的原始字符串；未找到时失败关闭。
fn authorized_selection_from_material(
    material: &project::StoryMaterial,
    requested_selection: &str,
) -> Option<String> {
    let selection = requested_selection.trim();
    if selection.is_empty() {
        return None;
    }
    let start = material.content.find(selection)?;
    let end = start.checked_add(selection.len())?;
    material.content.get(start..end).map(str::to_string)
}

/// 由已授权材料提取请求声明的选区内容；返回值必须来自受控材料的正文子串，
/// 绝不直接复用原始 `selected_text` 字段。无选区（直接提问 / 追问）时返回
/// `Ok(None)`；有选区但无授权材料、或选区未落在授权材料正文内时失败关闭。
fn authorized_selection_text(
    material: Option<&project::StoryMaterial>,
    selected_text: Option<&str>,
) -> Result<Option<String>, llm_config::GenerateAiError> {
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    if !has_selection {
        return Ok(None);
    }
    let selection = selected_text.expect("has_selection checked above");
    match material {
        Some(material) => authorized_selection_from_material(material, selection)
            .map(Some)
            .ok_or_else(invalid_selection_error),
        None => Err(invalid_selection_error()),
    }
}

/// 用已授权材料替换请求中声明的选区文本：`First` / `FollowUp` / `DirectQuestion`
/// 的 `selected_text` 都由 `authorized_selection_text` 重写为受控材料提取值，
/// 提示词组装只看到授权后的内容。无选区（直接提问 / 追问）保持原样。
fn apply_authorized_selection(
    request: llm_config::GenerateAiRequest,
    material: Option<&project::StoryMaterial>,
) -> Result<llm_config::GenerateAiRequest, llm_config::GenerateAiError> {
    match request {
        llm_config::GenerateAiRequest::First {
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
            thinking_direction,
        } => {
            let authorized = authorized_selection_text(material, Some(&selected_text))?;
            Ok(llm_config::GenerateAiRequest::First {
                selected_text: authorized.unwrap_or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
                thinking_direction,
            })
        }
        llm_config::GenerateAiRequest::FollowUp {
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
            thinking_direction,
            origin,
            messages,
        } => {
            let authorized = authorized_selection_text(material, Some(&selected_text))?;
            Ok(llm_config::GenerateAiRequest::FollowUp {
                selected_text: authorized.unwrap_or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
                thinking_direction,
                origin,
                messages,
            })
        }
        llm_config::GenerateAiRequest::DirectQuestion {
            question,
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
        } => {
            let authorized = authorized_selection_text(material, selected_text.as_deref())?;
            Ok(llm_config::GenerateAiRequest::DirectQuestion {
                question,
                selected_text: authorized.or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
            })
        }
    }
}

/// 生产命令入口：解析请求、校验来源身份，并用已授权材料替换请求中声明的选区
/// 文本，确保提示词只使用受控材料内容，绝不直接使用原始 `selected_text` 字段。
async fn generate_ai_result_for_request_with_material(
    base_dir: &std::path::Path,
    resource_dir: Option<&std::path::Path>,
    request: serde_json::Value,
    material: Option<&project::StoryMaterial>,
) -> GenerateAiResult {
    let request = match llm_config::parse_generate_ai_request(request) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    if let Err(error) = validate_parsed_selection_identity(&request) {
        return GenerateAiResult::failure(error);
    }

    let request = match apply_authorized_selection(request, material) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    llm_config::generate_ai_result_in_with_resource(base_dir, resource_dir, request).await
}

fn validate_parsed_selection_identity(
    request: &llm_config::GenerateAiRequest,
) -> Result<(), llm_config::GenerateAiError> {
    let (selected_text, snapshot, project_path, document_id, document_version) = match request {
        llm_config::GenerateAiRequest::First {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            Some(selected_text.as_str()),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
        llm_config::GenerateAiRequest::FollowUp {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            Some(selected_text.as_str()),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
        llm_config::GenerateAiRequest::DirectQuestion {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            selected_text.as_deref(),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
    };
    selection_identity_error(
        selected_text,
        snapshot,
        project_path,
        document_id,
        document_version,
    )
}

// ========== 常驻 AI 会话命令（resident-ai-session 任务 3.4） ==========

/// 常驻会话：启动会话（同时懒启动驱动进程）。
#[tauri::command]
async fn ai_start_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_start_session_in_dir(&dir, resource_dir.as_deref(), session_id).await)
}

/// 常驻会话：发送消息并等待终态；流式增量经 `ai-delta` 事件转发前端。
#[tauri::command]
async fn ai_send_message(
    app: tauri::AppHandle,
    session_id: String,
    message_id: String,
    kind: llm_config::AiMessageKind,
    question: String,
    selected_text: Option<String>,
    document_id: Option<String>,
    project_path: Option<String>,
    document_version: Option<String>,
    snapshot: Option<String>,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    let authorized = match authorize_selection(
        project_path.as_deref(),
        document_id.as_deref(),
        document_version.as_deref(),
        selected_text.as_deref(),
        snapshot.as_deref(),
        Some(app.state::<ProjectLocks>().inner().clone()),
    )
    .await
    {
        Ok(material) => material,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };
    // 生成层只使用授权通过后的选区材料内容：由已授权的 StoryMaterial 提取实际
    // 材料（受控读取的正文子串），绝不回读原始 selected_text 字段；无选区
    // （直接提问 / 追问）时为 None。有选区却提取失败时失败关闭。
    let authorized_selection =
        match authorized_selection_text(authorized.as_ref(), selected_text.as_deref()) {
            Ok(selection) => selection,
            Err(error) => return Ok(GenerateAiResult::failure(error)),
        };
    Ok(llm_config::ai_send_message_in_dir(
        &dir,
        resource_dir.as_deref(),
        session_id,
        message_id,
        kind,
        question,
        authorized_selection,
    )
    .await)
}

/// 常驻会话：取消进行中的生成（幂等）。
#[tauri::command]
async fn ai_cancel_message(
    session_id: String,
    message_id: String,
) -> Result<GenerateAiResult, String> {
    Ok(llm_config::ai_cancel_message_in_dir(session_id, message_id).await)
}

/// 常驻会话：结束会话（新建对话 / 切换作品；幂等）。
#[tauri::command]
async fn ai_end_session(session_id: String) -> Result<GenerateAiResult, String> {
    Ok(llm_config::ai_end_session_in_dir(session_id).await)
}

/// 常驻会话：注入崩溃恢复历史（前端显示历史的增量投影，不触发再生成）。
/// `origin` 为会话来源（直接提问 / 召唤），决定重放首轮按哪种入口语义组装提示词。
#[tauri::command]
async fn ai_replay_history(
    app: tauri::AppHandle,
    session_id: String,
    origin: llm_config::ReplayOrigin,
    turns: Vec<crate::dsh_driver::DriverReplayTurn>,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_replay_history_in_dir(
        &dir,
        resource_dir.as_deref(),
        session_id,
        origin,
        turns,
    )
    .await)
}

/// 常驻会话：历史注入完成确认。
#[tauri::command]
async fn ai_replay_done(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_replay_done_in_dir(&dir, resource_dir.as_deref(), session_id).await)
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
            // 常驻驱动流式增量 → 前端事件（resident-ai-session 任务 3.4）。
            let handle = app.handle().clone();
            crate::dsh_driver::global_driver_manager().set_sink(std::sync::Arc::new(
                move |payload| {
                    let _ = handle.emit("ai-delta", &payload);
                },
            ));
            // 驱动进程丢失（崩溃/重启）→ 前端恢复流程触发器（任务 4.4）。
            let loss_handle = app.handle().clone();
            crate::dsh_driver::global_driver_manager().set_loss_sink(std::sync::Arc::new(
                move || {
                    let _ = loss_handle.emit("ai-driver-lost", ());
                },
            ));

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
            set_document_ai_visibility,
            ai_directory_projection,
            read_material,
            export_project_to_word,
            open_url,
            save_llm_config,
            load_llm_config,
            test_llm_connection,
            generate_ai_thinking,
            ai_start_session,
            ai_send_message,
            ai_cancel_message,
            ai_end_session,
            ai_replay_history,
            ai_replay_done,
            conversation_list,
            conversation_save,
            conversation_delete,
            conversation_restore
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 应用退出时优雅关闭常驻驱动进程（design.md D3 生命周期表）。
    let driver_manager = crate::dsh_driver::global_driver_manager().clone();
    app.run(move |_app, event| {
        if let tauri::RunEvent::Exit = event {
            driver_manager.shutdown_best_effort();
        }
    });
}
