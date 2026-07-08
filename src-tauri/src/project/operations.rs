use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::{ProjectError, ProjectMetadata, ProjectOpenResult, ProjectPaths};

/// 创建新作品
pub fn create_project(name: String, save_location: PathBuf) -> Result<PathBuf, ProjectError> {
    let project_root = save_location.join(&name);
    let paths = ProjectPaths::new(project_root.clone());

    let create_result = (|| -> Result<(), ProjectError> {
        fs::create_dir(&project_root)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        fs::create_dir(&paths.user_text_dir)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        fs::create_dir(&paths.system_dir)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;

        // 创建空的文本文件
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&paths.draft_file)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&paths.main_file)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;

        // 创建项目元信息
        let now = Utc::now().to_rfc3339();
        let metadata = ProjectMetadata {
            name,
            created_at: now.clone(),
            updated_at: now,
            version: ProjectMetadata::CURRENT_VERSION,
        };

        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        write_file_atomically(&paths.metadata_file, &metadata_json)?;

        Ok(())
    })();

    if let Err(error) = create_result {
        let _ = fs::remove_dir_all(&project_root);
        return Err(error);
    }

    Ok(project_root)
}

/// 验证项目结构
pub fn validate_project_structure(project_root: &Path) -> Result<(), ProjectError> {
    if !project_root.is_dir() {
        return Err(ProjectError::InvalidStructure(
            "作品根目录不存在或不是文件夹".to_string(),
        ));
    }

    let paths = ProjectPaths::new(project_root.to_path_buf());

    if !paths.user_text_dir.is_dir() {
        return Err(ProjectError::InvalidStructure(
            "缺少作品文本文件夹".to_string(),
        ));
    }

    if !paths.system_dir.is_dir() {
        return Err(ProjectError::InvalidStructure(
            "缺少系统文件夹".to_string(),
        ));
    }

    // 检查必要文件是否存在
    if !paths.draft_file.is_file() {
        return Err(ProjectError::InvalidStructure(
            "缺少草稿本.txt".to_string(),
        ));
    }
    if !paths.main_file.is_file() {
        return Err(ProjectError::InvalidStructure(
            "缺少正文本.txt".to_string(),
        ));
    }
    if !paths.metadata_file.is_file() {
        return Err(ProjectError::InvalidStructure(
            "缺少project.json".to_string(),
        ));
    }

    let metadata_json = fs::read_to_string(&paths.metadata_file)
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;

    if metadata.version != ProjectMetadata::CURRENT_VERSION {
        return Err(ProjectError::InvalidStructure(format!(
            "不支持的项目结构版本: {}",
            metadata.version
        )));
    }

    Ok(())
}

/// 打开作品
pub fn open_project(project_root: &Path) -> Result<ProjectOpenResult, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 读取元信息
    let metadata_json = fs::read_to_string(&paths.metadata_file)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;

    // 读取文本内容
    let draft_content = fs::read_to_string(&paths.draft_file)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let main_content = fs::read_to_string(&paths.main_file)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;

    Ok(ProjectOpenResult {
        metadata,
        draft_content,
        main_content,
    })
}

/// 保存作品
pub fn save_project(
    project_root: &Path,
    draft_content: String,
    main_content: String,
) -> Result<(), ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 写入文本内容
    write_file_atomically(&paths.draft_file, &draft_content)?;
    write_file_atomically(&paths.main_file, &main_content)?;

    // 更新元信息中的更新时间
    let metadata_json = fs::read_to_string(&paths.metadata_file)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    
    metadata.updated_at = Utc::now().to_rfc3339();
    
    let updated_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    write_file_atomically(&paths.metadata_file, &updated_json)?;

    Ok(())
}

fn write_file_atomically(path: &Path, content: &str) -> Result<(), ProjectError> {
    let parent = path.parent().ok_or_else(|| {
        ProjectError::WriteError("目标文件缺少父目录".to_string())
    })?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    temp_file
        .write_all(content.as_bytes())
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    temp_file
        .flush()
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    temp_file
        .persist(path)
        .map_err(|e| ProjectError::WriteError(e.error.to_string()))?;

    Ok(())
}
