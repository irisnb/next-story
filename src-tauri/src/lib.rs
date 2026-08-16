pub mod llm_config;
pub mod project;

use std::path::PathBuf;

use tauri::Manager;

use llm_config::{GenerateAiResult, LlmConfig, LlmConfigSummary};
use project::{CreateProjectParams, ProjectLocks, ProjectOpenResult};

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
            let result = super::generate_ai_result_for_request(Path::new("unused"), request).await;
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
            let result = super::generate_ai_result_for_request(temp.path(), request).await;
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
        let project_root = super::project::create_new_project(super::project::CreateProjectParams {
            name: "白名单作品".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");

        let paths = super::project::ProjectPaths::new(project_root);
        let files = [
            paths.draft_file.clone(),
            paths.main_file.clone(),
            paths.metadata_file.clone(),
        ];
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
            let result = super::generate_ai_result_for_request(temp.path(), request).await;
            assert!(!result.ok, "未知字段请求必须被拒绝");
            let error = result.error.expect("rejected request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }

        for (path, before_bytes) in files.iter().zip(before.iter()) {
            let after = std::fs::read(path).expect("read project file after");
            assert_eq!(
                &after, before_bytes,
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
/// 同一作品的打开/保存/迁移在进程内串行化。
#[tauri::command]
async fn open_project(app: tauri::AppHandle, project_path: String) -> Result<ProjectOpenResult, String> {
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

/// 保存作品：在阻塞线程内取作品锁并覆盖整个保存事务，
/// 同一作品的并发保存被串行化，杜绝混合世代。
#[tauri::command]
async fn save_project(
    app: tauri::AppHandle,
    project_path: String,
    draft_content: String,
    main_content: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);
    let locks = app.state::<ProjectLocks>().inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locks.acquire(&project_root)?;
        project::save_existing_project(&project_root, draft_content, main_content)
    })
    .await
    .map_err(|e| format!("保存作品任务执行失败: {e}"))?
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

    Ok(generate_ai_result_for_request(&dir, request).await)
}

async fn generate_ai_result_for_request(
    base_dir: &std::path::Path,
    request: serde_json::Value,
) -> GenerateAiResult {
    let request = match llm_config::parse_generate_ai_request(request) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    llm_config::generate_ai_result_in(base_dir, request).await
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
                                    let _ = unsafe { settings3.SetAreBrowserAcceleratorKeysEnabled(false) };
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
            save_project,
            open_url,
            save_llm_config,
            load_llm_config,
            test_llm_connection,
            generate_ai_thinking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
