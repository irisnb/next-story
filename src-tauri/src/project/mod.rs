mod operations;
mod validation;

pub use validation::*;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 项目元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMetadata {
    /// 作品名称
    pub name: String,
    /// 创建时间 (ISO 8601)
    pub created_at: String,
    /// 更新时间 (ISO 8601)
    pub updated_at: String,
    /// 结构版本
    pub version: u32,
}

impl ProjectMetadata {
    pub const CURRENT_VERSION: u32 = 1;
}

/// 项目打开结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectOpenResult {
    /// 项目元信息
    pub metadata: ProjectMetadata,
    /// 草稿本内容
    pub draft_content: String,
    /// 正文本内容
    pub main_content: String,
}

/// 创建项目参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectParams {
    /// 作品名称
    pub name: String,
    /// 保存位置
    pub save_location: String,
}

/// 项目验证错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProjectError {
    /// 作品名称为空
    EmptyName,
    /// 作品名称包含非法字符
    InvalidNameChars(String),
    /// 保存位置不可访问
    InaccessibleLocation(String),
    /// 目标文件夹已存在
    FolderExists(String),
    /// 项目结构无效
    InvalidStructure(String),
    /// 读取失败
    ReadError(String),
    /// 写入失败
    WriteError(String),
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectError::EmptyName => write!(f, "作品名称不能为空"),
            ProjectError::InvalidNameChars(chars) => write!(f, "作品名称包含非法字符: {}", chars),
            ProjectError::InaccessibleLocation(loc) => write!(f, "保存位置不可访问: {}", loc),
            ProjectError::FolderExists(path) => write!(f, "目标文件夹已存在: {}", path),
            ProjectError::InvalidStructure(msg) => write!(f, "项目结构无效: {}", msg),
            ProjectError::ReadError(msg) => write!(f, "读取失败: {}", msg),
            ProjectError::WriteError(msg) => write!(f, "写入失败: {}", msg),
        }
    }
}

impl std::error::Error for ProjectError {}

/// 获取作品文件夹内的路径结构
pub struct ProjectPaths {
    pub user_text_dir: PathBuf,
    pub draft_file: PathBuf,
    pub main_file: PathBuf,
    pub system_dir: PathBuf,
    pub metadata_file: PathBuf,
}

impl ProjectPaths {
    pub fn new(root: PathBuf) -> Self {
        let user_text_dir = root.join("作品文本");
        let system_dir = root.join("next-story-system");
        
        Self {
            user_text_dir: user_text_dir.clone(),
            draft_file: user_text_dir.join("草稿本.txt"),
            main_file: user_text_dir.join("正文本.txt"),
            system_dir: system_dir.clone(),
            metadata_file: system_dir.join("project.json"),
        }
    }
}

/// 创建新作品：包含完整验证和文件结构创建。
pub fn create_new_project(params: CreateProjectParams) -> Result<PathBuf, ProjectError> {
    validate_project_name(&params.name)?;

    let save_path = PathBuf::from(&params.save_location);
    validate_save_location(&save_path)?;
    check_target_not_exists(&save_path, &params.name)?;

    operations::create_project(params.name, save_path)
}

/// 打开已有作品：先严格校验结构，再读取内容。
pub fn open_existing_project(project_root: &Path) -> Result<ProjectOpenResult, ProjectError> {
    operations::validate_project_structure(project_root)?;
    operations::open_project(project_root)
}

/// 保存已有作品：先确认仍是有效作品，再写入两个本子。
pub fn save_existing_project(
    project_root: &Path,
    draft_content: String,
    main_content: String,
) -> Result<(), ProjectError> {
    operations::validate_project_structure(project_root)?;
    operations::save_project(project_root, draft_content, main_content)
}
