pub mod llm_config;
pub mod project;

use std::path::PathBuf;

use tauri::Manager;

use llm_config::{GenerateAiResult, LlmConfig};
use project::{CreateProjectParams, ProjectOpenResult};

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
    selected_text: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };

    Ok(llm_config::generate_ai_result_in(&dir, &selected_text).await)
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
