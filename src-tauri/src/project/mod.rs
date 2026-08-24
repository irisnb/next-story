mod content_tree;
mod docx_export;
mod export;
mod migration;
mod notebook;
mod operations;
mod validation;

pub use content_tree::*;
pub use docx_export::render_docx;
pub use export::{
    build_export_project, export_project_to_word, ExportBlock, ExportListItem, ExportMark,
    ExportNode, ExportProject, ExportText, ExportWordResult,
};
pub use notebook::*;
pub use operations::{
    create_document, create_folder, delete_node, move_node, open_content_tree, read_document,
    rename_node, reorder_children, restore_node, save_document,
};
pub use validation::*;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

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
    /// 当前作品结构版本：3 = 内容树（文件夹 + 文档）。
    /// 版本 2 = 固定双本子（草稿本 / 正文本），打开时由迁移框架升级到 3；
    /// 版本 1 = 旧 `.txt` 本子，无迁移步骤，继续拒绝。
    pub const CURRENT_VERSION: u32 = 3;
}

/// 项目打开结果：元信息 + 整棵内容树。前端据此确定当前文档，再用
/// `read_document` 按需读取正文。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectOpenResult {
    /// 项目元信息
    pub metadata: ProjectMetadata,
    /// 整棵内容树结构
    pub tree: ContentTree,
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
    /// 本子内容超过大小上限
    ContentTooLarge(String),
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
            ProjectError::ContentTooLarge(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ProjectError {}

/// 获取作品文件夹内的路径结构。
///
/// 版本 3 磁盘布局（正文在用户文本区、树元数据与作品元信息在系统抽屉）：
/// - 正文：每篇文档一个文件，`作品文本/documents/<稳定ID>.json`，内容为 Tiptap JSON；
/// - 树元数据：`next-story-system/content-tree.json`（节点类型 / 父子 / 排序 / 回收站）；
/// - 作品元信息：`next-story-system/project.json`（name / created_at / updated_at / version）。
///
/// `draft_file` / `main_file` 是版本 2 固定双本子的旧路径，仅用于迁移与旧事务恢复。
pub struct ProjectPaths {
    pub root: PathBuf,
    pub user_text_dir: PathBuf,
    pub documents_dir: PathBuf,
    pub content_tree_file: PathBuf,
    pub draft_file: PathBuf,
    pub main_file: PathBuf,
    pub system_dir: PathBuf,
    pub metadata_file: PathBuf,
}

impl ProjectPaths {
    pub fn new(root: PathBuf) -> Self {
        let user_text_dir = root.join("作品文本");
        let documents_dir = user_text_dir.join("documents");
        let system_dir = root.join("next-story-system");

        Self {
            root,
            user_text_dir: user_text_dir.clone(),
            documents_dir,
            content_tree_file: system_dir.join("content-tree.json"),
            draft_file: user_text_dir.join("草稿本.json"),
            main_file: user_text_dir.join("正文本.json"),
            system_dir: system_dir.clone(),
            metadata_file: system_dir.join("project.json"),
        }
    }

    /// 文档正文文件路径：按稳定节点 ID 寻址，与名称、路径无关。
    pub fn document_file(&self, id: &str) -> PathBuf {
        self.documents_dir.join(format!("{id}.json"))
    }
}

/// 进程内作品锁注册表：同一作品（键为规范化后的作品根路径）的打开、保存、迁移
/// 在进程内串行化，不同作品仍可并行。锁在 Tauri 应用状态中维护，
/// 由命令层在阻塞线程内「取锁 → 操作 → 释放」（见 `lib.rs` 各命令处理器）。
///
/// 每个作品路径对应一个进程生命周期内不复用的 `&'static Mutex<()>`（`Box::leak`），
/// 与「`HashMap` 持 `Arc<Mutex<()>>` 且条目从不删除」等价：锁对象与注册表同寿，
/// 因此返回的 guard 只需持 `'static` 的 `MutexGuard`，无需自引用结构。
#[derive(Clone, Default)]
pub struct ProjectLocks {
    inner: Arc<Mutex<HashMap<PathBuf, &'static Mutex<()>>>>,
}

/// 持有中的作品锁；析构时自动释放，保证「取锁 → 执行 → 释放」不会漏放。
pub struct ProjectLockGuard {
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl ProjectLocks {
    /// 取得指定作品根的锁。路径先规范化，确保同一作品的不同写法（相对/绝对、
    /// 大小写变体等）落到同一把锁；规范化失败视为结构错误拒绝操作。
    pub fn acquire(&self, project_root: &Path) -> Result<ProjectLockGuard, ProjectError> {
        let canonical = project_root
            .canonicalize()
            .map_err(|e| ProjectError::InvalidStructure(format!("作品路径无法解析: {e}")))?;

        // 把 `&'static` 引用复制出来，避免锁守卫借用注册表自身的互斥。
        let lock: &'static Mutex<()> = {
            let mut locks = self
                .inner
                .lock()
                .map_err(|_| ProjectError::WriteError("作品锁注册表不可用".to_string()))?;
            locks
                .entry(canonical)
                .or_insert_with(|| Box::leak(Box::new(Mutex::new(()))))
        };

        let guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(ProjectLockGuard { _guard: guard })
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

/// 打开已有作品：版本不符先走迁移框架（旧双本子 → 内容树，版本 1 继续拒绝），
/// 迁移前恢复遗留事务，再严格校验结构，最后读取内容树。
pub fn open_existing_project(project_root: &Path) -> Result<ProjectOpenResult, ProjectError> {
    migration::migrate_project(
        project_root,
        migration::PRODUCTION_MIGRATIONS,
        ProjectMetadata::CURRENT_VERSION,
    )?;
    operations::validate_project_structure(project_root)?;
    operations::open_project(project_root)
}
