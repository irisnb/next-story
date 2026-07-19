pub mod llm_config;
pub mod project;

use std::path::PathBuf;

use tauri::Manager;

use llm_config::{GenerateAiResult, LlmConfig};
use project::{CreateProjectParams, ProjectOpenResult};

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
            assert_eq!(result.ok, false);
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
            assert_eq!(result.ok, false);
            let error = result.error.expect("invalid request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }
    }

    fn _assert_result_type_is_stable(_: GenerateAiResult) {}
}

// ========== Tauri Commands ==========

/// 创建新作品
#[tauri::command]
async fn create_project(params: CreateProjectParams) -> Result<String, String> {
    let project_root = project::create_new_project(params).map_err(|e| e.to_string())?;

    Ok(project_root.to_string_lossy().to_string())
}

/// 打开作品
#[tauri::command]
async fn open_project(project_path: String) -> Result<ProjectOpenResult, String> {
    let project_root = PathBuf::from(&project_path);
    let result = project::open_existing_project(&project_root).map_err(|e| e.to_string())?;

    Ok(result)
}

/// 保存作品
#[tauri::command]
async fn save_project(
    project_path: String,
    draft_content: String,
    main_content: String,
) -> Result<(), String> {
    let project_root = PathBuf::from(&project_path);

    project::save_existing_project(&project_root, draft_content, main_content)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ========== LLM 配置命令 ==========

/// 保存 LLM 配置
#[tauri::command]
async fn save_llm_config(app: tauri::AppHandle, config: LlmConfig) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    llm_config::save_llm_config(&dir, &config).map_err(|e| e.to_string())
}

/// 加载已保存的 LLM 配置
#[tauri::command]
async fn load_llm_config(app: tauri::AppHandle) -> Result<Option<LlmConfig>, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    llm_config::load_llm_config(&dir).map_err(|e| e.to_string())
}

/// 测试 LLM 配置连接
#[tauri::command]
async fn test_llm_connection(config: LlmConfig) -> Result<(), String> {
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project,
            save_llm_config,
            load_llm_config,
            test_llm_connection,
            generate_ai_thinking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
