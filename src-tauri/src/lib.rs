pub mod project;

use std::path::PathBuf;

use project::{CreateProjectParams, ProjectOpenResult};

// ========== Tauri Commands ==========

/// 创建新作品
#[tauri::command]
async fn create_project(params: CreateProjectParams) -> Result<String, String> {
    let project_root = project::create_new_project(params)
        .map_err(|e| e.to_string())?;

    Ok(project_root.to_string_lossy().to_string())
}

/// 打开作品
#[tauri::command]
async fn open_project(project_path: String) -> Result<ProjectOpenResult, String> {
    let project_root = PathBuf::from(&project_path);
    let result = project::open_existing_project(&project_root)
        .map_err(|e| e.to_string())?;

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

// ========== Application Entry Point ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
