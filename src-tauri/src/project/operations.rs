use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::{
    empty_notebook_value, ContentTree, ContentTreeError, NodeKind, ProjectError, ProjectMetadata,
    ProjectOpenResult, ProjectPaths,
};

pub(crate) const MAX_METADATA_BYTES: u64 = 64 * 1024;
pub(crate) const MAX_NOTEBOOK_BYTES: u64 = 10 * 1024 * 1024;
/// 内容树元数据文件的有界读取上限。树元数据只含结构信息，与正文解耦；
/// 有界读取保证超大或损坏的树文件不会被无界读入内存。
pub(crate) const MAX_CONTENT_TREE_BYTES: u64 = 1024 * 1024;

/// 手动保存事务目录名（位于 `next-story-system/` 下，系统所有，不放进用户本子）。
const SAVE_TRANSACTION_DIR: &str = "save-transaction";
/// 事务清单文件名。
const SAVE_MANIFEST_FILE: &str = "manifest.json";
/// 事务清单中元信息目标路径（相对作品根）。恢复代码据此识别「元信息 = 完成标记」。
const METADATA_TARGET: &str = "next-story-system/project.json";

/// 创建新作品：版本 3 内容树布局。
/// 根级创建一篇默认文档，正文文件按稳定 ID 命名放在
/// `作品文本/documents/`，树元数据放在 `next-story-system/content-tree.json`。
pub fn create_project(name: String, save_location: PathBuf) -> Result<PathBuf, ProjectError> {
    let project_root = save_location.join(&name);
    let paths = ProjectPaths::new(project_root.clone());
    let mut created_paths = Vec::new();

    let create_result = (|| -> Result<(), ProjectError> {
        fs::create_dir(&project_root).map_err(|e| ProjectError::WriteError(e.to_string()))?;
        created_paths.push(project_root.clone());
        fs::create_dir(&paths.user_text_dir)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        created_paths.push(paths.user_text_dir.clone());
        fs::create_dir(&paths.documents_dir)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        created_paths.push(paths.documents_dir.clone());
        fs::create_dir(&paths.system_dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;
        created_paths.push(paths.system_dir.clone());

        // 内容树：根级一篇默认文档（默认名「未命名文档」），分配稳定 ID。
        let mut tree = ContentTree::new();
        let document_id = tree
            .create_document(None)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;

        // 创建包含有效空白格式版本 2 文档的正文文件
        let empty_notebook_json = serde_json::to_string_pretty(&empty_notebook_value())
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        write_file_atomically(&paths.document_file(&document_id), &empty_notebook_json)?;
        created_paths.push(paths.document_file(&document_id));

        // 写入树元数据与作品元信息
        write_content_tree(&paths, &tree)?;
        created_paths.push(paths.content_tree_file.clone());

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
        cleanup_created_paths(&created_paths);
        return Err(error);
    }

    Ok(project_root)
}

/// 验证项目结构（版本 3 内容树布局）。
pub fn validate_project_structure(project_root: &Path) -> Result<(), ProjectError> {
    validate_no_reparse_point(project_root, "作品根目录")?;

    if !project_root.is_dir() {
        return Err(ProjectError::InvalidStructure(
            "作品根目录不存在或不是文件夹".to_string(),
        ));
    }

    let project_root = project_root
        .canonicalize()
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let paths = ProjectPaths::new(project_root.to_path_buf());

    validate_required_dir(&project_root, &paths.user_text_dir, "作品文本文件夹")?;
    validate_required_dir(&project_root, &paths.system_dir, "系统文件夹")?;

    // 先校验元信息与结构版本，再检查内容树文件存在性：这样旧版本作品（含旧
    // `.txt` 本子）会得到「不支持的项目结构版本」而不是「缺少content-tree.json」。
    validate_required_file(&project_root, &paths.metadata_file, "project.json")?;

    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::InvalidStructure(format!("项目元信息无法解析: {}", e)))?;

    if metadata.version != ProjectMetadata::CURRENT_VERSION {
        return Err(ProjectError::InvalidStructure(format!(
            "不支持的项目结构版本: {}",
            metadata.version
        )));
    }

    // 检查内容树布局必要文件/文件夹是否存在
    validate_required_dir(&project_root, &paths.documents_dir, "documents 文件夹")?;
    validate_required_file(&project_root, &paths.content_tree_file, "content-tree.json")?;

    Ok(())
}

/// 校验一份本子的字节数不超过保存上限，超限返回专用 ContentTooLarge。
/// 与读取/恢复端共享同一常量，杜绝保存端允许超限内容进入事务。
fn validate_notebook_size(content: &str, label: &str) -> Result<(), ProjectError> {
    let len = content.len() as u64;
    if len > MAX_NOTEBOOK_BYTES {
        return Err(ProjectError::ContentTooLarge(format!(
            "{label}内容过大：{len} 字节超过 {MAX_NOTEBOOK_BYTES} 字节上限，无法保存",
        )));
    }
    Ok(())
}

/// 解析并校验一段本子 JSON 字符串，失败返回中文错误。
fn validate_notebook_content(content: &str, label: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|_| format!("{label}不是合法 JSON"))?;
    super::validate_notebook_document(&value).map_err(|e| format!("{label}{e}"))
}

/// 读取并校验一个结构化本子文件，返回通过校验的原始 JSON 字符串。
/// 校验失败时返回中文可读的 InvalidStructure 错误，绝不产生空白替代。
/// 同时拒绝符号链接 / 重解析点，保证正文文件不会指向作品文件夹外部。
pub(crate) fn read_and_validate_notebook(path: &Path, label: &str) -> Result<String, ProjectError> {
    validate_no_reparse_point(path, label)?;
    let content = read_bounded_string(path, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    validate_notebook_content(&content, label).map_err(ProjectError::InvalidStructure)?;
    Ok(content)
}

/// 打开作品（版本 3 内容树）：恢复中断事务后，校验内容树结构与
/// 所有被引用正文文件存在且为合法 Tiptap JSON，并把整棵内容树返回给前端，
/// 由前端据此确定当前文档。
pub fn open_project(project_root: &Path) -> Result<ProjectOpenResult, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    recover_interrupted_save(&paths)?;

    // 读取元信息
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let metadata: ProjectMetadata =
        serde_json::from_str(&metadata_json).map_err(|e| ProjectError::ReadError(e.to_string()))?;

    // 读取并校验内容树结构
    let tree = read_content_tree(&paths)?;

    // 校验树中所有被引用的正文文件（含回收站内文档）存在且为合法 Tiptap JSON。
    for node in tree.nodes.values() {
        if node.kind == NodeKind::Document {
            read_and_validate_notebook(&paths.document_file(&node.id), &node.name)?;
        }
    }
    for entry in &tree.recycle_bin {
        for node in entry.nodes.values() {
            if node.kind == NodeKind::Document {
                read_and_validate_notebook(&paths.document_file(&node.id), &node.name)?;
            }
        }
    }

    Ok(ProjectOpenResult { metadata, tree })
}

/// 读取并校验内容树元数据文件。
pub(crate) fn read_content_tree(paths: &ProjectPaths) -> Result<ContentTree, ProjectError> {
    let json = read_bounded_string(&paths.content_tree_file, MAX_CONTENT_TREE_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(format!("内容树元数据无法读取: {e}")))?;
    let tree: ContentTree = serde_json::from_str(&json)
        .map_err(|e| ProjectError::InvalidStructure(format!("内容树元数据无法解析: {e}")))?;
    tree.validate()
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    Ok(tree)
}

/// 读取整棵内容树结构（公开入口，供命令层调用）：先恢复中断事务，再读取并校验。
pub fn open_content_tree(project_root: &Path) -> Result<ContentTree, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());
    recover_interrupted_save(&paths)?;
    read_content_tree(&paths)
}

/// 按文档 ID 读取单篇文档正文（公开入口，供命令层调用）。
/// 校验 ID 是内容树中的文档节点，正文在返回前通过后端校验。
pub fn read_document(project_root: &Path, document_id: &str) -> Result<String, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());
    recover_interrupted_save(&paths)?;
    let tree = read_content_tree(&paths)?;
    let node = tree
        .nodes
        .get(document_id)
        .ok_or_else(|| ProjectError::InvalidStructure(format!("内容树节点不存在: {document_id}")))?;
    if node.kind != NodeKind::Document {
        return Err(ProjectError::InvalidStructure(
            "只能读取文档节点，文件夹不承载正文".to_string(),
        ));
    }
    read_and_validate_notebook(&paths.document_file(document_id), &node.name)
}

/// 校验并原子写入内容树元数据文件。
pub(crate) fn write_content_tree(
    paths: &ProjectPaths,
    tree: &ContentTree,
) -> Result<(), ProjectError> {
    tree.validate()
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let json =
        serde_json::to_string_pretty(tree).map_err(|e| ProjectError::WriteError(e.to_string()))?;
    write_file_atomically(&paths.content_tree_file, &json)
}

/// 在根级查找指定名称的文档节点 ID。仅测试专用路径（`run_save_transaction`）使用。
#[cfg(test)]
fn root_document_id(tree: &ContentTree, name: &str) -> Option<String> {
    tree.root_children.iter().find_map(|id| {
        let node = tree.nodes.get(id)?;
        (node.kind == NodeKind::Document && node.name == name).then(|| id.clone())
    })
}

/// 结构变更事务的公共入口：读取并校验当前内容树，在克隆上执行 `mutate`，
/// 校验目标结构后，通过映射式事务把 `content-tree.json` 与更新了 `updated_at`
/// 的 `project.json` 一起原子提交（元信息最后，作为完成标记）。
///
/// `mutate` 返回 `Some(新文档 ID)` 表示本次变更创建了一篇文档，调用方会额外在
/// 同一事务内暂存一篇合法的空 Tiptap 文档文件；返回 `None` 表示纯结构变更，
/// 不触碰任何正文文件。任何失败都在提交前中止，不留下部分应用的结构变更。
fn run_structure_change(
    project_root: &Path,
    mutate: impl FnOnce(&mut ContentTree) -> Result<Option<String>, ContentTreeError>,
) -> Result<Option<String>, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 先恢复上次中断的事务，保证从一致有效世代开始。
    recover_interrupted_save(&paths)?;

    // 读取并校验当前内容树，在克隆上执行变更，绝不直接改可见文件。
    let mut tree = read_content_tree(&paths)?;
    let new_document_id =
        mutate(&mut tree).map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    tree.validate()
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;

    // 计算下一世代元信息（只更新 updated_at）。
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let mut metadata: ProjectMetadata =
        serde_json::from_str(&metadata_json).map_err(|e| ProjectError::ReadError(e.to_string()))?;
    metadata.updated_at = Utc::now().to_rfc3339();
    let staged_metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    let tree_json =
        serde_json::to_string_pretty(&tree).map_err(|e| ProjectError::WriteError(e.to_string()))?;

    // 暂存文件：内容树 → （可选）新建文档正文 → 元信息（最后，完成标记）。
    let mut staged_writes: Vec<(StagedFile, String)> = vec![(
        StagedFile {
            staged: "content-tree.json".to_string(),
            target: "next-story-system/content-tree.json".to_string(),
            action: StagedAction::Replace,
        },
        tree_json,
    )];

    if let Some(doc_id) = &new_document_id {
        let empty_notebook_json = serde_json::to_string_pretty(&empty_notebook_value())
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        staged_writes.push((
            StagedFile {
                staged: format!("doc-{doc_id}.json"),
                target: format!("作品文本/documents/{doc_id}.json"),
                action: StagedAction::Replace,
            },
            empty_notebook_json,
        ));
    }

    staged_writes.push((
        StagedFile {
            staged: "project.json".to_string(),
            target: METADATA_TARGET.to_string(),
            action: StagedAction::Replace,
        },
        staged_metadata_json,
    ));

    transactional_write_mapped(
        &paths,
        &staged_writes,
        &metadata.updated_at,
        ManifestPurpose::StructureChange,
    )?;

    Ok(new_document_id)
}

/// 在指定父级（含根级）下创建文件夹，作为结构变更事务持久提交。
pub fn create_folder(project_root: &Path, parent: Option<&str>) -> Result<String, ProjectError> {
    let mut created_id: Option<String> = None;
    run_structure_change(project_root, |tree| {
        let id = tree.create_folder(parent)?;
        created_id = Some(id.clone());
        Ok(None)
    })?;
    created_id.ok_or_else(|| ProjectError::WriteError("创建文件夹失败".to_string()))
}

/// 在指定父级（含根级）下创建文档，并在同一事务内暂存一篇合法的空 Tiptap 文档文件。
pub fn create_document(project_root: &Path, parent: Option<&str>) -> Result<String, ProjectError> {
    run_structure_change(project_root, |tree| tree.create_document(parent).map(Some))?
        .ok_or_else(|| ProjectError::WriteError("创建文档失败".to_string()))
}

/// 重命名节点，作为结构变更事务持久提交。校验失败时保持原名不变。
pub fn rename_node(project_root: &Path, id: &str, name: &str) -> Result<(), ProjectError> {
    run_structure_change(project_root, |tree| tree.rename(id, name).map(|_| None))?;
    Ok(())
}

/// 移动节点（含完整子树）到另一父级（含根级），作为结构变更事务持久提交。
/// 禁止把文件夹移动到其自身或任意后代之内（循环检测）。
pub fn move_node(
    project_root: &Path,
    id: &str,
    new_parent: Option<&str>,
) -> Result<(), ProjectError> {
    run_structure_change(project_root, |tree| {
        tree.move_node(id, new_parent).map(|_| None)
    })?;
    Ok(())
}

/// 重排父级内子节点顺序，作为结构变更事务持久提交。
pub fn reorder_children(
    project_root: &Path,
    parent: Option<&str>,
    order: Vec<String>,
) -> Result<(), ProjectError> {
    run_structure_change(project_root, |tree| {
        tree.reorder_children(parent, order).map(|_| None)
    })?;
    Ok(())
}

/// 删除节点（含完整子树）进回收站，作为结构变更事务持久提交。
/// 正文文件保持原位、仍由稳定 ID 寻址，不删除、不改写任何文档文件。
pub fn delete_node(project_root: &Path, id: &str) -> Result<(), ProjectError> {
    run_structure_change(project_root, |tree| {
        tree.delete_to_recycle_bin(id).map(|_| None)
    })?;
    Ok(())
}

/// 从回收站恢复被删除的子树，作为结构变更事务持久提交。
/// 恢复后层级、顺序与名称保持删除前状态，正文文件仍原位。
pub fn restore_node(project_root: &Path, id: &str) -> Result<(), ProjectError> {
    run_structure_change(project_root, |tree| tree.restore(id).map(|_| None))?;
    Ok(())
}

/// 按文档 ID 保存单篇文档正文：校验 ID 是内容树中存在的文档节点、正文为合法
/// 格式版本 2 且不超限，复用映射式事务把该文档正文 + project.json 作为一个
/// 完整一致世代原子提交（元信息最后，作为完成标记）。
pub fn save_document(
    project_root: &Path,
    document_id: &str,
    content: &str,
) -> Result<(), ProjectError> {
    // 先在创建事务暂存文件前校验大小上限与结构合法性，非法载荷不得触碰任何文件。
    validate_notebook_size(content, "文档")?;
    validate_notebook_content(content, "文档").map_err(ProjectError::InvalidStructure)?;

    let paths = ProjectPaths::new(project_root.to_path_buf());

    recover_interrupted_save(&paths)?;

    // 定位并确认 document_id 是内容树中存在的文档节点。
    let tree = read_content_tree(&paths)?;
    let node = tree
        .nodes
        .get(document_id)
        .ok_or_else(|| ProjectError::InvalidStructure(format!("内容树节点不存在: {document_id}")))?;
    if node.kind != NodeKind::Document {
        return Err(ProjectError::InvalidStructure(
            "只能保存文档节点，文件夹不承载正文".to_string(),
        ));
    }

    // 计算下一世代元信息（基于当前可见元信息，只更新 updated_at）。
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let mut metadata: ProjectMetadata =
        serde_json::from_str(&metadata_json).map_err(|e| ProjectError::ReadError(e.to_string()))?;
    metadata.updated_at = Utc::now().to_rfc3339();
    let staged_metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    // 暂存该文档正文 + project.json（元信息最后提交），通过映射式事务前滚提交。
    let staged_writes: Vec<(StagedFile, String)> = vec![
        (
            StagedFile {
                staged: format!("doc-{document_id}.json"),
                target: format!("作品文本/documents/{document_id}.json"),
                action: StagedAction::Replace,
            },
            content.to_string(),
        ),
        (
            StagedFile {
                staged: "project.json".to_string(),
                target: METADATA_TARGET.to_string(),
                action: StagedAction::Replace,
            },
            staged_metadata_json,
        ),
    ];

    transactional_write_mapped(
        &paths,
        &staged_writes,
        &metadata.updated_at,
        ManifestPurpose::Save,
    )?;

    Ok(())
}

/// 迁移前校验源文件边界：作品根、元信息、旧双本子都不能是符号链接 /
/// 重解析点，且内容在读取上限内。在创建备份之前调用，保证迁移失败时
/// 不产生备份 / 回滚副作用，也不把作品文件夹外部的内容读入作品。
pub(crate) fn validate_migration_source_files(project_root: &Path) -> Result<(), ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    validate_no_reparse_point(project_root, "作品根目录")?;
    validate_no_reparse_point(&paths.metadata_file, "project.json")?;
    validate_no_reparse_point(&paths.draft_file, "草稿本.json")?;
    validate_no_reparse_point(&paths.main_file, "正文本.json")?;

    read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(format!("project.json 无法读取: {e}")))?;
    read_bounded_string(&paths.draft_file, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(format!("草稿本.json 无法读取: {e}")))?;
    read_bounded_string(&paths.main_file, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(format!("正文本.json 无法读取: {e}")))?;

    Ok(())
}

/// 保存事务的阶段边界。无故障路径会经过每个边界但不做任何事；
/// 测试通过故障钩子在指定边界中断。此类型是项目领域内部私有，不暴露给 Tauri 或前端。
/// 仅测试专用路径（`run_save_transaction`）使用。
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)] // After* 前缀是故障注入阶段边界的语义，非冗余
enum SavePhase {
    /// 三份内容与清单已暂存，尚未替换任何可见文件。
    AfterStaging,
    /// 可见草稿本已替换，正文本与元信息仍是旧世代。
    AfterDraftReplace,
    /// 可见草稿本与正文本已替换，元信息仍是旧世代。
    AfterMainReplace,
}

/// 事务恢复阶段：`Staged` 表示尚未触碰可见文件，`Committing` 表示已经进入可见提交。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum TransactionPhase {
    Staged,
    Committing,
}

/// 事务用途：手动保存与迁移回滚共用同一事务目录与恢复机制，
/// 迁移模块据此在读取版本前优先恢复自己中断的回滚。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManifestPurpose {
    #[default]
    Save,
    MigrationRollback,
    Migration,
    /// 结构变更（创建 / 重命名 / 移动 / 排序 / 删除 / 恢复）：改写内容树元数据
    /// 与 `project.json`，创建文档时另写一篇空正文文件。
    StructureChange,
}

/// 进程内唯一递增的事务计数器，配合纳秒时间戳生成事务标识。
static TRANSACTION_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成一次保存/回滚事务的唯一标识。
fn new_transaction_id() -> String {
    let nanos = Utc::now().timestamp_nanos_opt().unwrap_or_default() as u128;
    let counter = TRANSACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{counter:x}")
}

/// 手动保存事务清单：记录这次保存所属的世代信息。
///
/// 清单是恢复代码判断“一次保存是否完成”的唯一依据，因此使用带类型的 serde
/// 结构，而不是裸字符串，避免手写字段名漂移。`transaction_id` 与 `purpose`
/// 带默认值，兼容本改动之前写下的旧清单。
///
/// `files` 记录「暂存文件名 → 目标路径（相对作品根）」的映射与提交顺序；
/// 版本 2 的旧清单没有该字段（`#[serde(default)]` 为空），恢复代码据此分派到
/// 固定三文件（草稿本 / 正文本 / project.json）的旧恢复路径，保持向后兼容。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SaveManifest {
    /// 清单结构版本，便于未来演进。
    manifest_version: u32,
    /// 当前事务所处恢复阶段。
    phase: TransactionPhase,
    /// 这次保存要写入元信息的更新时间（下一世代的 `updated_at`）。
    target_updated_at: String,
    /// 本次事务唯一标识：提交前用于校验事务目录未被其它操作替换。
    #[serde(default)]
    transaction_id: String,
    /// 事务用途（迁移回滚与手动保存区分）。
    #[serde(default)]
    purpose: ManifestPurpose,
    /// 暂存文件到目标路径的映射（提交顺序）。空表示旧固定三文件清单。
    #[serde(default)]
    files: Vec<StagedFile>,
}

impl SaveManifest {
    const CURRENT_VERSION: u32 = 1;
}

/// 清单映射项的动作：默认替换目标文件；`Delete` 用于迁移中移除旧布局文件。
/// 旧清单没有 `action` 字段，serde 默认值为 `Replace`，保持向后兼容。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StagedAction {
    #[default]
    Replace,
    Delete,
}

/// 事务清单中的单个暂存文件映射：暂存文件名 → 目标路径（相对作品根）。
/// 目标路径只使用普通路径分量，恢复时拒绝任何越界（`..` / 绝对路径等）目标。
/// `Delete` 动作没有暂存文件（`staged` 为空），提交时删除目标文件。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StagedFile {
    pub(crate) staged: String,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) action: StagedAction,
}

/// 手动保存事务目录内的固定布局。
pub(crate) struct TransactionLayout {
    /// 事务根目录 `next-story-system/save-transaction/`。
    dir: PathBuf,
    /// 暂存的草稿本。
    staged_draft: PathBuf,
    /// 暂存的正文本。
    staged_main: PathBuf,
    /// 暂存的元信息。
    staged_metadata: PathBuf,
    /// 事务清单。
    manifest: PathBuf,
}

impl TransactionLayout {
    pub(crate) fn new(paths: &ProjectPaths) -> Self {
        let dir = paths.system_dir.join(SAVE_TRANSACTION_DIR);

        Self {
            staged_draft: dir.join("草稿本.json"),
            staged_main: dir.join("正文本.json"),
            staged_metadata: dir.join("project.json"),
            manifest: dir.join(SAVE_MANIFEST_FILE),
            dir,
        }
    }
}

/// 保存事务核心流程。`checkpoint` 在每个阶段之间被调用，无故障路径传入恒成功闭包。
///
/// 这是双槽位保存事务的测试专用路径：`save_document` 走 `transactional_write_mapped`，
/// 但本函数及其故障注入测试覆盖「保存事务在 Staged / Committing 各阶段中断后
/// 由 `recover_interrupted_save` 恢复」的通用能力，故保留供测试使用，不对外暴露。
#[cfg(test)]
fn run_save_transaction(
    project_root: &Path,
    draft_content: String,
    main_content: String,
    mut checkpoint: impl FnMut(SavePhase) -> Result<(), ProjectError>,
) -> Result<(), ProjectError> {
    // 在创建事务暂存文件前校验两份结构化载荷，非法载荷不得触碰任何文件。
    // 先做廉价的大小上限校验，再做结构解析；超限内容不得进入事务目录。
    validate_notebook_size(&draft_content, "草稿本")?;
    validate_notebook_size(&main_content, "正文本")?;
    validate_notebook_content(&draft_content, "草稿本").map_err(ProjectError::InvalidStructure)?;
    validate_notebook_content(&main_content, "正文本").map_err(ProjectError::InvalidStructure)?;

    let paths = ProjectPaths::new(project_root.to_path_buf());
    let layout = TransactionLayout::new(&paths);

    recover_interrupted_save(&paths)?;

    // 定位根级文档「草稿本」「正文本」的稳定 ID，正文文件按 ID 寻址。
    let tree = read_content_tree(&paths)?;
    let draft_id = root_document_id(&tree, "草稿本").ok_or_else(|| {
        ProjectError::InvalidStructure("内容树缺少根级文档「草稿本」".to_string())
    })?;
    let main_id = root_document_id(&tree, "正文本").ok_or_else(|| {
        ProjectError::InvalidStructure("内容树缺少根级文档「正文本」".to_string())
    })?;

    // 计算下一世代的元信息（基于当前可见元信息，只更新 updated_at）。
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let mut metadata: ProjectMetadata =
        serde_json::from_str(&metadata_json).map_err(|e| ProjectError::ReadError(e.to_string()))?;
    metadata.updated_at = Utc::now().to_rfc3339();
    let staged_metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    // 本次事务的唯一标识，写入清单；提交前据此校验事务目录未被其它操作替换。
    let transaction_id = new_transaction_id();

    // 本次保存暂存两篇正文文件 + project.json；提交顺序为 草稿 → 正文 → 元信息。
    let staged_writes: Vec<(StagedFile, String)> = vec![
        (
            StagedFile {
                staged: format!("doc-{draft_id}.json"),
                target: format!("作品文本/documents/{draft_id}.json"),
                action: StagedAction::Replace,
            },
            draft_content,
        ),
        (
            StagedFile {
                staged: format!("doc-{main_id}.json"),
                target: format!("作品文本/documents/{main_id}.json"),
                action: StagedAction::Replace,
            },
            main_content,
        ),
        (
            StagedFile {
                staged: "project.json".to_string(),
                target: METADATA_TARGET.to_string(),
                action: StagedAction::Replace,
            },
            staged_metadata_json,
        ),
    ];

    // 阶段一：把下一世代整体暂存到事务目录，此时不碰任何可见文件。
    stage_transaction_v3(
        &layout,
        &staged_writes,
        &metadata.updated_at,
        &transaction_id,
    )?;
    checkpoint(SavePhase::AfterStaging)?;

    // 提交前校验：事务目录仍是本次保存的暂存（防锁遗漏导致的世代替换）。
    ensure_transaction_unchanged(&layout, &transaction_id)?;

    let files: Vec<StagedFile> = staged_writes.iter().map(|(file, _)| file.clone()).collect();
    write_manifest_phase(
        &layout,
        &metadata.updated_at,
        &transaction_id,
        TransactionPhase::Committing,
        &files,
    )?;

    // 阶段二：从暂存文件替换可见文件，元信息最后提交。
    replace_staged_to_target(&paths, &layout, &files[0])?;
    checkpoint(SavePhase::AfterDraftReplace)?;
    replace_staged_to_target(&paths, &layout, &files[1])?;
    checkpoint(SavePhase::AfterMainReplace)?;
    replace_staged_to_target(&paths, &layout, &files[2])?;

    // 阶段三：提交完成，清理事务目录，不留内部实现痕迹。
    cleanup_transaction(&layout);

    Ok(())
}

/// 把下一世代的一组文件（映射清单 + 内容）与清单写入事务目录。
/// 仅测试专用路径（`run_save_transaction`）使用。
#[cfg(test)]
fn stage_transaction_v3(
    layout: &TransactionLayout,
    staged_writes: &[(StagedFile, String)],
    target_updated_at: &str,
    transaction_id: &str,
) -> Result<(), ProjectError> {
    // 清掉可能残留的旧事务目录，确保暂存的是干净的新世代。
    cleanup_transaction(layout);
    fs::create_dir_all(&layout.dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;

    for (file, content) in staged_writes {
        write_file_atomically(&layout.dir.join(&file.staged), content)?;
    }

    let files: Vec<StagedFile> = staged_writes.iter().map(|(file, _)| file.clone()).collect();
    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase: TransactionPhase::Staged,
        target_updated_at: target_updated_at.to_string(),
        transaction_id: transaction_id.to_string(),
        purpose: ManifestPurpose::Save,
        files,
    };
    write_manifest(layout, &manifest)?;

    Ok(())
}

/// 提交一组映射文件，供迁移复用同一份暂存、清单和前滚协议。
pub(crate) fn transactional_write_mapped(
    paths: &ProjectPaths,
    staged_writes: &[(StagedFile, String)],
    target_updated_at: &str,
    purpose: ManifestPurpose,
) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);
    let transaction_id = new_transaction_id();
    cleanup_transaction(&layout);
    fs::create_dir_all(&layout.dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;
    for (file, content) in staged_writes {
        // 删除动作没有暂存文件，只记录清单映射。
        if file.action == StagedAction::Delete {
            continue;
        }
        write_file_atomically(&layout.dir.join(&file.staged), content)?;
    }
    let files: Vec<StagedFile> = staged_writes.iter().map(|(file, _)| file.clone()).collect();
    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase: TransactionPhase::Staged,
        target_updated_at: target_updated_at.to_string(),
        transaction_id: transaction_id.clone(),
        purpose,
        files,
    };
    write_manifest(&layout, &manifest)?;
    ensure_transaction_unchanged(&layout, &transaction_id)?;
    let committing = SaveManifest {
        phase: TransactionPhase::Committing,
        ..manifest
    };
    write_manifest(&layout, &committing)?;
    ensure_staged_generation_is_complete(&layout, &committing)?;
    commit_staged_generation(paths, &layout, &committing)?;
    cleanup_transaction(&layout);
    Ok(())
}

/// 提交前确认事务目录仍是本次保存写入的暂存：重读清单比较事务标识，
/// 标识不一致说明事务目录被其它操作替换（锁遗漏的并发保护第二道防线）。
fn ensure_transaction_unchanged(
    layout: &TransactionLayout,
    transaction_id: &str,
) -> Result<(), ProjectError> {
    let manifest = read_transaction_manifest(layout)?;
    if manifest.transaction_id != transaction_id {
        return Err(ProjectError::WriteError(
            "保存事务已被其它操作替换，已中止保存".to_string(),
        ));
    }
    Ok(())
}

/// 打开或保存前恢复上一次中断的手动保存事务。
/// 迁移回滚事务（`purpose == MigrationRollback`）与手动保存走同一恢复逻辑。
/// 清单无 `files` 映射时按旧固定三文件布局恢复，有映射时按清单顺序恢复，
/// 元信息总是最后提交的完成标记。
pub(crate) fn recover_interrupted_save(paths: &ProjectPaths) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);

    if !layout.dir.exists() {
        return Ok(());
    }

    let manifest = read_transaction_manifest(&layout)?;

    match manifest.phase {
        TransactionPhase::Staged => {
            // 暂存阶段尚未触碰任何可见文件，直接丢弃即可，无需读取或校验暂存内容；
            // 这也避免了超限暂存内容把作品卡死。
            cleanup_transaction(&layout);
        }
        TransactionPhase::Committing => {
            ensure_staged_generation_is_complete(&layout, &manifest)?;
            commit_staged_generation(paths, &layout, &manifest)?;
            cleanup_transaction(&layout);
        }
    }

    Ok(())
}

/// 迁移前恢复遗留的手动保存事务（旧版本作品先按旧事务恢复，再走迁移）。
/// 与迁移回滚恢复一致：只处理可读清单，清单缺失/损坏时原样跳过，交给打开
/// 流程的常规事务恢复处理，避免改变既有错误语义（如 `save-transaction`
/// 路径被文件占用时仍走迁移框架的既有报错路径）。
pub(crate) fn recover_pending_save_before_migration(
    paths: &ProjectPaths,
) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);
    if !layout.dir.exists() {
        return Ok(());
    }

    let manifest = match read_transaction_manifest(&layout) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(()),
    };

    match manifest.phase {
        TransactionPhase::Staged => {
            cleanup_transaction(&layout);
        }
        TransactionPhase::Committing => {
            ensure_staged_generation_is_complete(&layout, &manifest)?;
            commit_staged_generation(paths, &layout, &manifest)?;
            cleanup_transaction(&layout);
        }
    }

    Ok(())
}

/// 把暂存文件替换到清单记录的目标路径。旧清单（无映射）按固定三文件布局提交。
fn commit_staged_generation(
    paths: &ProjectPaths,
    layout: &TransactionLayout,
    manifest: &SaveManifest,
) -> Result<(), ProjectError> {
    if manifest.files.is_empty() {
        replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
        replace_from_staged(&paths.main_file, &layout.staged_main)?;
        replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;
        return Ok(());
    }

    for file in &manifest.files {
        match file.action {
            StagedAction::Delete => delete_manifest_target(paths, file)?,
            StagedAction::Replace => replace_staged_to_target(paths, layout, file)?,
        }
    }
    Ok(())
}

/// 按清单删除一个目标文件（迁移移除旧布局文件）。目标已不存在视为成功，
/// 保证迁移事务前滚的幂等性：删除动作执行后崩溃，恢复时重放删除不会失败。
fn delete_manifest_target(paths: &ProjectPaths, file: &StagedFile) -> Result<(), ProjectError> {
    let target = resolve_manifest_target(paths, &file.target)?;
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ProjectError::WriteError(format!(
            "无法删除目标文件 {}: {error}",
            target.display()
        ))),
    }
}

/// 把一个清单映射项从事务目录暂存文件替换到目标路径。
fn replace_staged_to_target(
    paths: &ProjectPaths,
    layout: &TransactionLayout,
    file: &StagedFile,
) -> Result<(), ProjectError> {
    let target = resolve_manifest_target(paths, &file.target)?;
    let staged = layout.dir.join(&file.staged);
    replace_from_staged(&target, &staged)
}

/// 解析事务清单中的相对目标路径并校验其留在作品根内。
fn resolve_manifest_target(paths: &ProjectPaths, relative: &str) -> Result<PathBuf, ProjectError> {
    let path = Path::new(relative);
    let is_clean = !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)));
    if !is_clean {
        return Err(ProjectError::ReadError(
            "无法恢复保存事务: 事务清单包含非法目标路径".to_string(),
        ));
    }
    Ok(paths.root.join(path))
}

/// 迁移回滚的事务式暂存/恢复：把三份备份内容整体暂存到事务目录，写入
/// `MigrationRollback` 用途的 `Committing` 清单，再按 草稿 → 正文 → 元信息
/// 的顺序替换可见文件。中途崩溃留下的暂存会在下次打开/保存时由
/// [`recover_interrupted_save`] 完成恢复；元信息仍是最后替换的完成标记。
pub(crate) fn transactional_restore(
    paths: &ProjectPaths,
    metadata_json: &str,
    draft_json: &str,
    main_json: &str,
) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);
    let metadata: ProjectMetadata = serde_json::from_str(metadata_json)
        .map_err(|e| ProjectError::WriteError(format!("回滚内容无效: {e}")))?;

    cleanup_transaction(&layout);
    fs::create_dir_all(&layout.dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;
    write_file_atomically(&layout.staged_metadata, metadata_json)?;
    write_file_atomically(&layout.staged_draft, draft_json)?;
    write_file_atomically(&layout.staged_main, main_json)?;

    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase: TransactionPhase::Committing,
        target_updated_at: metadata.updated_at.clone(),
        transaction_id: new_transaction_id(),
        purpose: ManifestPurpose::MigrationRollback,
        files: Vec::new(),
    };
    write_manifest(&layout, &manifest)?;

    replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
    replace_from_staged(&paths.main_file, &layout.staged_main)?;
    replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;
    cleanup_transaction(&layout);

    Ok(())
}

/// 恢复上次迁移回滚中断留下的事务（供迁移模块在读取版本前调用）。
/// 只处理 `MigrationRollback` 用途的清单；清单缺失/损坏或属于手动保存时
/// 原样跳过，交给打开流程的常规事务恢复处理，避免改变既有错误语义。
pub(crate) fn recover_migration_rollback_transaction(
    paths: &ProjectPaths,
) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);
    if !layout.dir.exists() {
        return Ok(());
    }

    let manifest = match read_transaction_manifest(&layout) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(()),
    };
    if manifest.purpose != ManifestPurpose::MigrationRollback {
        return Ok(());
    }

    ensure_staged_generation_is_complete(&layout, &manifest)?;
    replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
    replace_from_staged(&paths.main_file, &layout.staged_main)?;
    replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;
    cleanup_transaction(&layout);

    Ok(())
}

pub(crate) fn read_transaction_manifest(
    layout: &TransactionLayout,
) -> Result<SaveManifest, ProjectError> {
    let manifest_json = read_bounded_string(&layout.manifest, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
    let manifest: SaveManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;

    if manifest.manifest_version != SaveManifest::CURRENT_VERSION {
        return Err(ProjectError::ReadError(format!(
            "无法恢复保存事务: 不支持的事务清单版本 {}",
            manifest.manifest_version
        )));
    }

    if !manifest.files.is_empty() {
        let mut staged = std::collections::HashSet::new();
        let mut targets = std::collections::HashSet::new();
        for (index, file) in manifest.files.iter().enumerate() {
            match file.action {
                StagedAction::Delete => {
                    // 删除动作没有暂存文件，只允许迁移用途删除旧布局的固定文件；
                    // 普通保存 / 结构变更事务不得包含删除项。
                    if !file.staged.is_empty() {
                        return Err(ProjectError::ReadError(
                            "无法恢复保存事务: 删除动作不应携带暂存文件".to_string(),
                        ));
                    }
                    if manifest.purpose != ManifestPurpose::Migration {
                        return Err(ProjectError::ReadError(
                            "无法恢复保存事务: 删除动作只允许用于迁移事务".to_string(),
                        ));
                    }
                    if !is_legacy_delete_target(&file.target)
                        || !targets.insert(file.target.as_str())
                    {
                        return Err(ProjectError::ReadError(
                            "无法恢复保存事务: 事务清单包含非法或重复删除目标".to_string(),
                        ));
                    }
                }
                StagedAction::Replace => {
                    let staged_path = Path::new(&file.staged);
                    if file.staged.is_empty()
                        || staged_path.is_absolute()
                        || !staged_path
                            .components()
                            .all(|component| matches!(component, std::path::Component::Normal(_)))
                        || !staged.insert(file.staged.as_str())
                    {
                        return Err(ProjectError::ReadError(
                            "无法恢复保存事务: 事务清单包含非法或重复暂存路径".to_string(),
                        ));
                    }
                    if !is_allowed_manifest_target(&file.target)
                        || !targets.insert(file.target.as_str())
                    {
                        return Err(ProjectError::ReadError(
                            "无法恢复保存事务: 事务清单包含非法或重复目标路径".to_string(),
                        ));
                    }
                }
            }
            if file.target == METADATA_TARGET && index + 1 != manifest.files.len() {
                return Err(ProjectError::ReadError(
                    "无法恢复保存事务: 元信息必须是最后提交项".to_string(),
                ));
            }
        }
        if manifest
            .files
            .last()
            .is_none_or(|file| file.target != METADATA_TARGET)
        {
            return Err(ProjectError::ReadError(
                "无法恢复保存事务: 事务清单缺少最后的元信息提交项".to_string(),
            ));
        }
    }

    Ok(manifest)
}

/// 迁移删除动作允许的目标：旧双本子布局的两个固定文件。
fn is_legacy_delete_target(target: &str) -> bool {
    target == "作品文本/草稿本.json" || target == "作品文本/正文本.json"
}

fn is_allowed_manifest_target(target: &str) -> bool {
    if target == METADATA_TARGET || target == "next-story-system/content-tree.json" {
        return true;
    }
    let prefix = "作品文本/documents/";
    let Some(id) = target.strip_prefix(prefix) else {
        return false;
    };
    let path = Path::new(id);
    id.ends_with(".json")
        && path.components().count() == 1
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

/// 读取事务暂存本子。超限时返回带人工恢复路径的专用 ContentTooLarge，
/// 而不是混入 ReadError，避免作品被超限暂存内容永久卡死。
fn read_staged_notebook(path: &Path, label: &str) -> Result<String, ProjectError> {
    match read_bounded_string(path, MAX_NOTEBOOK_BYTES) {
        Ok(content) => Ok(content),
        Err(ProjectError::ContentTooLarge(_)) => Err(ProjectError::ContentTooLarge(format!(
            "无法恢复保存事务：暂存{label}超过 {MAX_NOTEBOOK_BYTES} 字节上限。请手动处理 next-story-system/save-transaction 事务目录（备份后删除或联系支持）"
        ))),
        Err(other) => Err(ProjectError::ReadError(format!("无法恢复保存事务: {other}"))),
    }
}

/// 校验暂存世代完整一致：元信息与清单 `target_updated_at` 一致，
/// 正文/文档暂存内容合法。清单无映射时校验旧固定三文件布局。
fn ensure_staged_generation_is_complete(
    layout: &TransactionLayout,
    manifest: &SaveManifest,
) -> Result<(), ProjectError> {
    if manifest.files.is_empty() {
        let staged_draft = read_staged_notebook(&layout.staged_draft, "草稿本")?;
        let staged_main = read_staged_notebook(&layout.staged_main, "正文本")?;

        validate_notebook_content(&staged_draft, "草稿本")
            .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
        validate_notebook_content(&staged_main, "正文本")
            .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;

        validate_staged_metadata(&layout.staged_metadata, &manifest.target_updated_at)?;
        return Ok(());
    }

    for file in &manifest.files {
        // 删除动作没有暂存内容，跳过内容校验。
        if file.action == StagedAction::Delete {
            continue;
        }
        let staged = layout.dir.join(&file.staged);
        if file.target == METADATA_TARGET {
            validate_staged_metadata(&staged, &manifest.target_updated_at)?;
        } else if file.target == "next-story-system/content-tree.json" {
            let content = read_bounded_string(&staged, MAX_CONTENT_TREE_BYTES)
                .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
            let tree: ContentTree = serde_json::from_str(&content).map_err(|_| {
                ProjectError::ReadError("无法恢复保存事务: 暂存内容树无法解析".to_string())
            })?;
            tree.validate().map_err(|e| {
                ProjectError::ReadError(format!("无法恢复保存事务: 暂存内容树无效: {e}"))
            })?;
        } else {
            let content = read_staged_notebook(&staged, "文档")?;
            validate_notebook_content(&content, "暂存文档")
                .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
        }
    }

    Ok(())
}

/// 校验暂存元信息：可解析且 `updated_at` 与清单目标一致。
fn validate_staged_metadata(path: &Path, target_updated_at: &str) -> Result<(), ProjectError> {
    let metadata_json = read_bounded_string(path, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|_| ProjectError::ReadError("无法恢复保存事务: 暂存元信息无法解析".to_string()))?;

    if metadata.updated_at != target_updated_at {
        return Err(ProjectError::ReadError(
            "无法恢复保存事务: 暂存元信息与事务清单不一致".to_string(),
        ));
    }

    Ok(())
}

/// 仅测试专用路径（`run_save_transaction`）使用。
#[cfg(test)]
fn write_manifest_phase(
    layout: &TransactionLayout,
    target_updated_at: &str,
    transaction_id: &str,
    phase: TransactionPhase,
    files: &[StagedFile],
) -> Result<(), ProjectError> {
    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase,
        target_updated_at: target_updated_at.to_string(),
        transaction_id: transaction_id.to_string(),
        purpose: ManifestPurpose::Save,
        files: files.to_vec(),
    };

    write_manifest(layout, &manifest)
}

fn write_manifest(layout: &TransactionLayout, manifest: &SaveManifest) -> Result<(), ProjectError> {
    let manifest_json = serde_json::to_string_pretty(manifest)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    write_file_atomically(&layout.manifest, &manifest_json)
}

/// 用暂存文件替换一个可见文件（复制暂存内容后原子落盘）。
fn replace_from_staged(visible: &Path, staged: &Path) -> Result<(), ProjectError> {
    let content = read_bounded_string(staged, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    if let Some(parent) = visible.parent() {
        fs::create_dir_all(parent).map_err(|e| ProjectError::WriteError(e.to_string()))?;
    }
    write_file_atomically(visible, &content)
}

/// 删除事务目录及其内容。清理失败不影响已完成的保存，故忽略错误。
fn cleanup_transaction(layout: &TransactionLayout) {
    let _ = fs::remove_dir_all(&layout.dir);
}

pub(crate) fn write_file_atomically(path: &Path, content: &str) -> Result<(), ProjectError> {
    let parent = path
        .parent()
        .ok_or_else(|| ProjectError::WriteError("目标文件缺少父目录".to_string()))?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    temp_file
        .write_all(content.as_bytes())
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    temp_file
        .flush()
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    // 关键文件在返回成功前把内容刷到持久介质，缩小进程中断与断电之间的持久性差距。
    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    temp_file
        .persist(path)
        .map_err(|e| ProjectError::WriteError(e.error.to_string()))?;

    // 重命名后尽力同步父目录，使重命名本身尽量可持久；失败不影响已完成的保存语义。
    sync_parent_dir(parent);

    Ok(())
}

/// 尽力同步父目录，使原子重命名尽量可持久。目录同步失败不视为保存失败。
fn sync_parent_dir(parent: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        // 打开目录句柄需要 FILE_FLAG_BACKUP_SEMANTICS。
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        if let Ok(dir) = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(parent)
        {
            let _ = dir.sync_all();
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

fn validate_required_dir(root: &Path, path: &Path, label: &str) -> Result<(), ProjectError> {
    validate_no_reparse_point(path, label)?;

    if !path.is_dir() {
        return Err(ProjectError::InvalidStructure(format!("缺少{label}")));
    }

    validate_path_stays_under_root(root, path, label)
}

fn validate_required_file(root: &Path, path: &Path, label: &str) -> Result<(), ProjectError> {
    validate_no_reparse_point(path, label)?;

    if !path.is_file() {
        return Err(ProjectError::InvalidStructure(format!("缺少{label}")));
    }

    validate_path_stays_under_root(root, path, label)
}

pub(crate) fn validate_no_reparse_point(path: &Path, label: &str) -> Result<(), ProjectError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| ProjectError::InvalidStructure(format!("缺少{label}")))?;

    if metadata.file_type().is_symlink() || is_windows_reparse_point(&metadata) {
        return Err(ProjectError::InvalidStructure(format!(
            "{label}不能是符号链接或重解析点"
        )));
    }

    Ok(())
}

#[cfg(windows)]
fn is_windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_windows_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn validate_path_stays_under_root(
    root: &Path,
    path: &Path,
    label: &str,
) -> Result<(), ProjectError> {
    let canonical_path = path
        .canonicalize()
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;

    if !canonical_path.starts_with(root) {
        return Err(ProjectError::InvalidStructure(format!(
            "{label}不能指向作品文件夹外部"
        )));
    }

    Ok(())
}

/// 有界读取：打开一次文件句柄后用 `take(max + 1)` 限量读取，超限拒绝。
/// 不依赖读取前的元数据长度（消除「先看长度再读」之间的 TOCTOU 竞态），
/// 也保证超限内容不会被无界读入内存。
pub(crate) fn read_bounded_string(path: &Path, max_bytes: u64) -> Result<String, ProjectError> {
    let file = fs::File::open(path).map_err(|e| ProjectError::ReadError(e.to_string()))?;

    let mut limited = file.take(max_bytes + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;

    if content.len() as u64 > max_bytes {
        return Err(ProjectError::ContentTooLarge(format!(
            "文件过大，无法读取: {}",
            path.display()
        )));
    }

    Ok(content)
}

fn cleanup_created_paths(created_paths: &[PathBuf]) {
    for path in created_paths.iter().rev() {
        let result = if path.is_dir() {
            fs::remove_dir(path)
        } else {
            fs::remove_file(path)
        };

        let _ = result;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    use super::super::ProjectLocks;

    /// 测试专用故障注入点。仅存在于测试模块，绝不进入生产或 Tauri 命令路径。
    #[derive(Debug, Clone, Copy)]
    #[allow(clippy::enum_variant_names)] // 与 SavePhase 对应的故障注入边界
    enum SaveFault {
        AfterStaging,
        AfterDraftReplace,
        AfterMainReplace,
    }

    /// 测试专用保存入口：在无故障保存流程的指定阶段边界强制中断。
    fn save_project_with_fault(
        project_root: &Path,
        draft_content: String,
        main_content: String,
        fault: Option<SaveFault>,
    ) -> Result<(), ProjectError> {
        run_save_transaction(project_root, draft_content, main_content, move |phase| {
            let should_fail = matches!(
                (fault, phase),
                (Some(SaveFault::AfterStaging), SavePhase::AfterStaging)
                    | (
                        Some(SaveFault::AfterDraftReplace),
                        SavePhase::AfterDraftReplace
                    )
                    | (
                        Some(SaveFault::AfterMainReplace),
                        SavePhase::AfterMainReplace
                    )
            );

            if should_fail {
                Err(ProjectError::WriteError(format!("测试注入中断: {phase:?}")))
            } else {
                Ok(())
            }
        })
    }

    #[test]
    fn failed_create_does_not_delete_preexisting_target_directory() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = temp.path().join("已有作品");
        fs::create_dir(&project_root).expect("create existing project dir");
        fs::write(project_root.join("keep.txt"), "用户已有内容").expect("write existing file");

        let result = create_project("已有作品".to_string(), temp.path().to_path_buf());

        assert!(matches!(result, Err(ProjectError::WriteError(_))));
        assert!(project_root.join("keep.txt").is_file());
    }

    const OLD_DRAFT: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"旧草稿内容"}]}]}}"#;
    const OLD_MAIN: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"旧正文内容"}]}]}}"#;
    const OLD_UPDATED_AT: &str = "2000-01-01T00:00:00+00:00";
    const NEW_DRAFT: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"新草稿内容"}]}]}}"#;
    const NEW_MAIN: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"新正文内容"}]}]}}"#;

    /// 建立一个版本 3 作品，并把两篇文档正文与元信息写成彼此不同、可辨认的“旧世代”值。
    /// `create_project` 现在只建一篇默认文档，这里把它重命名为「草稿本」并补一篇
    /// 「正文本」，构成双槽位保存事务测试所需的两篇根级文档。
    fn seed_project_with_old_generation(temp: &tempfile::TempDir, name: &str) -> PathBuf {
        create_project(name.to_string(), temp.path().to_path_buf())
            .expect("create project skeleton");

        let project_root = temp.path().join(name);
        let paths = ProjectPaths::new(project_root.clone());

        let tree = read_content_tree(&paths).expect("read content tree");
        let draft_id = tree.root_children[0].clone();
        rename_node(&project_root, &draft_id, "草稿本").expect("rename first to draft");
        let main_id = create_document(&project_root, None).expect("create main doc");
        rename_node(&project_root, &main_id, "正文本").expect("rename main doc");

        fs::write(paths.document_file(&draft_id), OLD_DRAFT).expect("seed old draft");
        fs::write(paths.document_file(&main_id), OLD_MAIN).expect("seed old main");

        let old_metadata = ProjectMetadata {
            name: name.to_string(),
            created_at: OLD_UPDATED_AT.to_string(),
            updated_at: OLD_UPDATED_AT.to_string(),
            version: ProjectMetadata::CURRENT_VERSION,
        };
        fs::write(
            &paths.metadata_file,
            serde_json::to_string_pretty(&old_metadata).expect("serialize old metadata"),
        )
        .expect("seed old metadata");

        project_root
    }

    fn read_draft_doc(paths: &ProjectPaths) -> String {
        let tree = read_content_tree(paths).expect("read content tree");
        let draft_id = root_document_id(&tree, "草稿本").expect("draft doc id");
        fs::read_to_string(paths.document_file(&draft_id)).expect("read draft doc")
    }

    fn read_main_doc(paths: &ProjectPaths) -> String {
        let tree = read_content_tree(paths).expect("read content tree");
        let main_id = root_document_id(&tree, "正文本").expect("main doc id");
        fs::read_to_string(paths.document_file(&main_id)).expect("read main doc")
    }

    fn read_visible_updated_at(paths: &ProjectPaths) -> String {
        let json = fs::read_to_string(&paths.metadata_file).expect("read metadata");
        let metadata: ProjectMetadata = serde_json::from_str(&json).expect("parse metadata");
        metadata.updated_at
    }

    fn assert_opened_generation(
        result: &ProjectOpenResult,
        paths: &ProjectPaths,
        draft: &str,
        main: &str,
    ) {
        // open_project 现在返回整棵树，不再返回正文；从树中定位两篇文档再读文件断言。
        let draft_id = root_document_id(&result.tree, "草稿本").expect("draft doc id");
        let main_id = root_document_id(&result.tree, "正文本").expect("main doc id");
        assert_eq!(
            fs::read_to_string(paths.document_file(&draft_id)).expect("read draft"),
            draft
        );
        assert_eq!(
            fs::read_to_string(paths.document_file(&main_id)).expect("read main"),
            main
        );
    }

    #[test]
    fn fault_after_staging_keeps_visible_old_generation_and_stages_new_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "暂存后中断");
        let paths = ProjectPaths::new(project_root.clone());

        let result = save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterStaging),
        );

        assert!(matches!(result, Err(ProjectError::WriteError(_))));

        // 可见文档与元信息仍是旧世代，未被触碰
        assert_eq!(read_draft_doc(&paths), OLD_DRAFT);
        assert_eq!(read_main_doc(&paths), OLD_MAIN);
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 新世代已暂存在事务目录中（映射清单 + 暂存文件）
        let layout = TransactionLayout::new(&paths);
        let manifest = read_transaction_manifest(&layout).expect("read staged manifest");
        assert_eq!(manifest.phase, TransactionPhase::Staged);
        assert_eq!(manifest.files.len(), 3);
        for file in &manifest.files {
            assert!(
                layout.dir.join(&file.staged).is_file(),
                "暂存文件缺失: {}",
                file.staged
            );
        }
    }

    #[test]
    fn fault_after_draft_replace_shows_new_draft_but_old_main_and_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "草稿替换后中断");
        let paths = ProjectPaths::new(project_root.clone());

        let result = save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterDraftReplace),
        );

        assert!(matches!(result, Err(ProjectError::WriteError(_))));

        // 可见草稿文档已是新世代，正文本与元信息仍是旧世代（可见状态混世代，等待恢复）。
        assert_eq!(read_draft_doc(&paths), NEW_DRAFT);
        assert_eq!(read_main_doc(&paths), OLD_MAIN);
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 暂存的新世代仍完整保留，恢复代码后续可据此前滚。
        let layout = TransactionLayout::new(&paths);
        let manifest = read_transaction_manifest(&layout).expect("read staged manifest");
        assert_eq!(manifest.phase, TransactionPhase::Committing);
    }

    #[test]
    fn fault_after_main_replace_shows_new_notebooks_but_old_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "正文替换后中断");
        let paths = ProjectPaths::new(project_root.clone());

        let result = save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterMainReplace),
        );

        assert!(matches!(result, Err(ProjectError::WriteError(_))));

        // 两篇文档都已是新世代，只有作为完成标记的元信息仍是旧世代。
        assert_eq!(read_draft_doc(&paths), NEW_DRAFT);
        assert_eq!(read_main_doc(&paths), NEW_MAIN);
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 暂存的新世代元信息仍完整保留，恢复代码后续可据此前滚提交。
        let layout = TransactionLayout::new(&paths);
        let manifest = read_transaction_manifest(&layout).expect("read staged manifest");
        let metadata_file = manifest
            .files
            .iter()
            .find(|file| file.target == METADATA_TARGET)
            .expect("metadata staged file");
        let staged_json = fs::read_to_string(layout.dir.join(&metadata_file.staged))
            .expect("read staged metadata");
        let staged: ProjectMetadata =
            serde_json::from_str(&staged_json).expect("parse staged metadata");
        assert_ne!(staged.updated_at, OLD_UPDATED_AT);
    }

    #[test]
    fn successful_save_commits_new_generation_and_removes_transaction_dir() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "成功保存");
        let paths = ProjectPaths::new(project_root.clone());

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            None,
        )
        .expect("save without fault succeeds");

        // 两篇文档与元信息都进入同一新世代。
        assert_eq!(read_draft_doc(&paths), NEW_DRAFT);
        assert_eq!(read_main_doc(&paths), NEW_MAIN);
        assert_ne!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 提交成功后事务目录必须被清理，不留内部实现痕迹。
        let layout = TransactionLayout::new(&paths);
        assert!(!layout.dir.exists());
    }

    #[test]
    fn open_after_staging_fault_discards_transaction_and_loads_old_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "暂存中断后打开");
        let paths = ProjectPaths::new(project_root.clone());

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterStaging),
        )
        .expect_err("injected staging fault");

        let opened = open_project(&project_root).expect("open recovers staged transaction");

        assert_opened_generation(&opened, &paths, OLD_DRAFT, OLD_MAIN);
        assert_eq!(opened.metadata.updated_at, OLD_UPDATED_AT);
        assert!(!TransactionLayout::new(&paths).dir.exists());
    }

    #[test]
    fn open_after_draft_replace_fault_rolls_forward_to_new_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "草稿中断后打开");
        let paths = ProjectPaths::new(project_root.clone());

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterDraftReplace),
        )
        .expect_err("injected draft replace fault");

        let opened = open_project(&project_root).expect("open rolls transaction forward");

        assert_opened_generation(&opened, &paths, NEW_DRAFT, NEW_MAIN);
        assert_ne!(opened.metadata.updated_at, OLD_UPDATED_AT);
    }

    #[test]
    fn open_after_main_replace_fault_rolls_forward_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "正文中断后打开");
        let paths = ProjectPaths::new(project_root.clone());

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterMainReplace),
        )
        .expect_err("injected main replace fault");

        let opened = open_project(&project_root).expect("open commits staged metadata");

        assert_opened_generation(&opened, &paths, NEW_DRAFT, NEW_MAIN);
        assert_ne!(opened.metadata.updated_at, OLD_UPDATED_AT);
    }

    #[test]
    fn open_with_unrecoverable_transaction_manifest_rejects_project() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "坏事务打开");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterDraftReplace),
        )
        .expect_err("injected draft replace fault");
        fs::write(&layout.manifest, "不是 JSON").expect("corrupt manifest");

        let result = open_project(&project_root);

        assert!(matches!(result, Err(ProjectError::ReadError(_))));
    }

    #[test]
    fn save_with_unrecoverable_previous_transaction_rejects_before_new_save() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "坏事务保存");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterDraftReplace),
        )
        .expect_err("injected draft replace fault");
        fs::write(&layout.manifest, "不是 JSON").expect("corrupt manifest");

        let result = save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            None,
        );

        assert!(matches!(result, Err(ProjectError::ReadError(_))));
        assert!(layout.dir.exists());
    }

    /// 旧清单（无 `files` 映射）的向后兼容恢复：模拟旧版本写下的固定三文件
    /// 事务，恢复必须按 草稿 → 正文 → 元信息 顺序前滚提交。
    #[test]
    fn legacy_manifest_without_files_rolls_forward_fixed_three_files() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "旧清单恢复");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);

        // 手工构造旧格式事务：清单无 files 字段，暂存固定三文件。
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(&layout.staged_draft, NEW_DRAFT).expect("stage draft");
        fs::write(&layout.staged_main, NEW_MAIN).expect("stage main");
        let staged_metadata = ProjectMetadata {
            name: "旧清单恢复".to_string(),
            created_at: OLD_UPDATED_AT.to_string(),
            updated_at: "2026-01-01T00:00:00+00:00".to_string(),
            version: 2,
        };
        fs::write(
            &layout.staged_metadata,
            serde_json::to_string_pretty(&staged_metadata).expect("serialize staged metadata"),
        )
        .expect("stage metadata");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-01-01T00:00:00+00:00",
                "transaction_id": "legacy-tx",
                "purpose": "save",
            })
            .to_string(),
        )
        .expect("write legacy manifest");

        recover_interrupted_save(&paths).expect("recover legacy transaction");

        // 旧格式恢复把内容写回固定双本子路径（迁移前版本 2 布局）。
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            NEW_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            NEW_MAIN
        );
        assert_eq!(read_visible_updated_at(&paths), "2026-01-01T00:00:00+00:00");
        assert!(!layout.dir.exists(), "恢复后事务目录应被清理");
    }

    // ========== 作品级串行化（P0：并发保存） ==========

    const GEN_A_DRAFT: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"世代A草稿"}]}]}}"#;
    const GEN_A_MAIN: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"世代A正文"}]}]}}"#;
    const GEN_B_DRAFT: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"世代B草稿"}]}]}}"#;
    const GEN_B_MAIN: &str = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"世代B正文"}]}]}}"#;

    /// 1.5 同一作品并发保存：屏障制造确定性重叠（A 完成暂存并持锁时 B 才开始
    /// 取锁，必然阻塞），断言两次保存串行完成、最终是 B 的完整世代，且无
    /// 暂存文件丢失/损坏、无残留事务目录。
    #[test]
    fn concurrent_saves_of_same_project_serialize_without_mixing_generations() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "并发保存");
        let paths = ProjectPaths::new(project_root.clone());
        let locks = ProjectLocks::default();
        let barrier = Arc::new(Barrier::new(2));

        let locks_a = locks.clone();
        let root_a = project_root.clone();
        let barrier_a = Arc::clone(&barrier);
        let handle_a = thread::spawn(move || {
            let _guard = locks_a.acquire(&root_a).expect("A 取得作品锁");
            // A 持锁保存；完成暂存后在屏障处等 B 进入（B 此刻阻塞在取锁）。
            run_save_transaction(
                &root_a,
                GEN_A_DRAFT.to_string(),
                GEN_A_MAIN.to_string(),
                |phase| {
                    if phase == SavePhase::AfterStaging {
                        barrier_a.wait();
                    }
                    Ok(())
                },
            )
            .expect("A 保存成功");
        });

        let locks_b = locks.clone();
        let root_b = project_root.clone();
        let barrier_b = Arc::clone(&barrier);
        let handle_b = thread::spawn(move || {
            // 与 A 的暂存完成同步后开始取锁：必然被 A 持有的锁挡住，直到 A 释放。
            barrier_b.wait();
            let _guard = locks_b.acquire(&root_b).expect("B 在 A 释放后取得作品锁");
            run_save_transaction(
                &root_b,
                GEN_B_DRAFT.to_string(),
                GEN_B_MAIN.to_string(),
                |_| Ok(()),
            )
            .expect("B 保存成功");
        });

        handle_a.join().expect("A 线程正常结束");
        handle_b.join().expect("B 线程正常结束");

        // 最终可见文档必须是 B 的完整世代（B 最后执行），无混合世代。
        assert_eq!(read_draft_doc(&paths), GEN_B_DRAFT);
        assert_eq!(read_main_doc(&paths), GEN_B_MAIN);
        assert_ne!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 无暂存文件丢失/损坏、无残留事务目录。
        let layout = TransactionLayout::new(&paths);
        assert!(!layout.dir.exists(), "保存完成后不应残留事务目录");
    }

    /// 1.6 两个不同作品并发保存可并行：A 持锁期间 B 必须能立即取得自己作品的锁
    /// （主线程在放行 A 之前先收到 B 已取锁的信号），且各自世代一致。
    #[test]
    fn concurrent_saves_of_different_projects_run_in_parallel() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root_a = seed_project_with_old_generation(&temp, "作品甲");
        let root_b = seed_project_with_old_generation(&temp, "作品乙");
        let locks = ProjectLocks::default();

        let (a_holding_tx, a_holding_rx) = mpsc::channel();
        let (release_a_tx, release_a_rx) = mpsc::channel();
        let (b_acquired_tx, b_acquired_rx) = mpsc::channel();

        let locks_a = locks.clone();
        let root_a2 = root_a.clone();
        let handle_a = thread::spawn(move || {
            let _guard = locks_a.acquire(&root_a2).expect("A 取得作品甲锁");
            let _ = a_holding_tx.send(());
            // 等主线程确认 B 已取到锁后再放行，保证 A 持锁时间足够长。
            let _ = release_a_rx.recv();
            run_save_transaction(
                &root_a2,
                GEN_A_DRAFT.to_string(),
                GEN_A_MAIN.to_string(),
                |_| Ok(()),
            )
            .expect("甲保存成功");
        });

        let locks_b = locks.clone();
        let root_b2 = root_b.clone();
        let handle_b = thread::spawn(move || {
            let _guard = locks_b
                .acquire(&root_b2)
                .expect("B 取得作品乙锁，不应被甲阻塞");
            let _ = b_acquired_tx.send(());
            run_save_transaction(
                &root_b2,
                GEN_B_DRAFT.to_string(),
                GEN_B_MAIN.to_string(),
                |_| Ok(()),
            )
            .expect("乙保存成功");
        });

        // A 已持锁；B 应能在 A 仍持锁时立即取得自己的锁（分路径并行）。
        a_holding_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("A 已持锁");
        b_acquired_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("B 在 A 持锁期间取得自己的锁");

        release_a_tx.send(()).expect("放行 A");
        handle_a.join().expect("A 线程正常结束");
        handle_b.join().expect("B 线程正常结束");

        // 各自世代一致，互不干扰。
        let paths_a = ProjectPaths::new(root_a);
        let paths_b = ProjectPaths::new(root_b);
        assert_eq!(read_draft_doc(&paths_a), GEN_A_DRAFT);
        assert_eq!(read_main_doc(&paths_a), GEN_A_MAIN);
        assert_eq!(read_draft_doc(&paths_b), GEN_B_DRAFT);
        assert_eq!(read_main_doc(&paths_b), GEN_B_MAIN);
        assert!(!TransactionLayout::new(&paths_a).dir.exists());
        assert!(!TransactionLayout::new(&paths_b).dir.exists());
    }

    /// 4.3 有界读取：文件在（旧实现的）长度检查之后、读取之前被增大时，
    /// 有界读取必须拒绝，且不会把超限内容无界读入内存。
    #[test]
    fn bounded_read_rejects_file_that_grew_past_limit_after_size_check() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let path = temp.path().join("growing.json");

        // 先写一份恰好不超限的文件（旧实现会在这一步通过长度检查）。
        fs::write(&path, "x".repeat(MAX_METADATA_BYTES as usize)).expect("write at limit");
        assert!(read_bounded_string(&path, MAX_METADATA_BYTES).is_ok());

        // 读取前把文件增大到超过上限：有界读取必须拒绝而非整读。
        fs::write(&path, "x".repeat(MAX_METADATA_BYTES as usize + 128 * 1024))
            .expect("grow file past limit");
        let result = read_bounded_string(&path, MAX_METADATA_BYTES);
        assert!(
            matches!(result, Err(ProjectError::ContentTooLarge(_))),
            "有界读取应拒绝超限文件，实际: {result:?}"
        );
    }

    // ========== 结构变更持久化（内容树操作） ==========

    /// 读取作品当前内容树（测试辅助）。
    fn read_tree(paths: &ProjectPaths) -> ContentTree {
        read_content_tree(paths).expect("read content tree")
    }

    #[test]
    fn create_document_persists_tree_document_file_and_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("结构作品".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let before_updated_at = read_visible_updated_at(&paths);

        let new_id = create_document(&project_root, None).expect("create document");

        // 内容树已持久化新文档节点
        let tree = read_tree(&paths);
        assert!(tree.nodes.contains_key(&new_id));
        assert_eq!(tree.nodes[&new_id].kind, NodeKind::Document);
        assert!(tree.root_children.contains(&new_id));

        // 新文档正文文件已创建且为合法空 Tiptap 文档
        let doc_path = paths.document_file(&new_id);
        assert!(doc_path.is_file());
        let content = fs::read_to_string(&doc_path).expect("read new doc");
        let value: serde_json::Value = serde_json::from_str(&content).expect("parse new doc");
        assert_eq!(value["format"], "next-story-tiptap");
        assert_eq!(value["version"], 2);
        assert_eq!(value["document"]["type"], "doc");

        // 元信息 updated_at 已更新
        assert_ne!(read_visible_updated_at(&paths), before_updated_at);

        // 事务目录已清理
        assert!(!TransactionLayout::new(&paths).dir.exists());
    }

    #[test]
    fn create_folder_persists_without_touching_document_files() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("结构文件夹".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        // 记录现有文档文件字节，纯结构变更不得改写它们。
        let tree_before = read_tree(&paths);
        let mut doc_bytes: Vec<(PathBuf, Vec<u8>)> = tree_before
            .nodes
            .values()
            .filter(|node| node.kind == NodeKind::Document)
            .map(|node| {
                let path = paths.document_file(&node.id);
                let bytes = fs::read(&path).expect("read doc before");
                (path, bytes)
            })
            .collect();
        doc_bytes.sort_by(|a, b| a.0.cmp(&b.0));

        let folder_id = create_folder(&project_root, None).expect("create folder");

        let tree = read_tree(&paths);
        assert!(tree.nodes.contains_key(&folder_id));
        assert_eq!(tree.nodes[&folder_id].kind, NodeKind::Folder);
        assert!(tree.root_children.contains(&folder_id));

        // 现有文档文件字节不变
        for (path, before) in &doc_bytes {
            assert_eq!(
                &fs::read(path).expect("read doc after"),
                before,
                "纯结构变更不得改写文档文件: {}",
                path.display()
            );
        }
    }

    #[test]
    fn delete_and_restore_document_persists_and_reopens() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("删除恢复".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let doc_id = create_document(&project_root, None).expect("create document");
        let doc_path = paths.document_file(&doc_id);
        let doc_bytes = fs::read(&doc_path).expect("read doc before delete");

        // 删除进回收站：正文文件保持原位，不被删除或改写
        delete_node(&project_root, &doc_id).expect("delete document");
        let tree = read_tree(&paths);
        assert!(!tree.nodes.contains_key(&doc_id));
        assert!(!tree.root_children.contains(&doc_id));
        assert_eq!(tree.recycle_bin.len(), 1);
        assert_eq!(tree.recycle_bin[0].root_id, doc_id);
        assert_eq!(
            fs::read(&doc_path).expect("read doc after delete"),
            doc_bytes
        );

        // 恢复：节点回到内容树，正文文件仍原位
        restore_node(&project_root, &doc_id).expect("restore document");
        let tree = read_tree(&paths);
        assert!(tree.nodes.contains_key(&doc_id));
        assert!(tree.root_children.contains(&doc_id));
        assert!(tree.recycle_bin.is_empty());
        assert_eq!(
            fs::read(&doc_path).expect("read doc after restore"),
            doc_bytes
        );

        // 重新打开作品：结构一致，可正常打开
        let opened = open_project(&project_root).expect("reopen after delete/restore");
        assert_eq!(opened.metadata.version, ProjectMetadata::CURRENT_VERSION);
    }

    #[test]
    fn delete_folder_subtree_and_restore_persists() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("删除子树".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let folder = create_folder(&project_root, None).expect("create folder");
        let child = create_document(&project_root, Some(&folder)).expect("create child doc");
        let child_path = paths.document_file(&child);
        let child_bytes = fs::read(&child_path).expect("read child before delete");

        // 删除文件夹连同完整子树进回收站
        delete_node(&project_root, &folder).expect("delete folder subtree");
        let tree = read_tree(&paths);
        assert!(!tree.nodes.contains_key(&folder));
        assert!(!tree.nodes.contains_key(&child));
        assert_eq!(tree.recycle_bin.len(), 1);
        assert_eq!(
            fs::read(&child_path).expect("read child after delete"),
            child_bytes
        );

        // 恢复文件夹连同完整子树
        restore_node(&project_root, &folder).expect("restore folder subtree");
        let tree = read_tree(&paths);
        assert!(tree.nodes.contains_key(&folder));
        assert!(tree.nodes.contains_key(&child));
        assert_eq!(tree.nodes[&folder].children, vec![child.clone()]);
        assert!(tree.recycle_bin.is_empty());
        assert_eq!(
            fs::read(&child_path).expect("read child after restore"),
            child_bytes
        );
    }

    #[test]
    fn rename_move_reorder_persist_across_reopen() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("结构操作".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let folder = create_folder(&project_root, None).expect("create folder");
        let doc = create_document(&project_root, Some(&folder)).expect("create doc in folder");

        // 重命名
        rename_node(&project_root, &doc, "角色设定").expect("rename");
        let tree = read_tree(&paths);
        assert_eq!(tree.nodes[&doc].name, "角色设定");

        // 移动到根级
        move_node(&project_root, &doc, None).expect("move to root");
        let tree = read_tree(&paths);
        assert!(tree.root_children.contains(&doc));
        assert!(!tree.nodes[&folder].children.contains(&doc));

        // 重排根级顺序
        let order = tree.root_children.clone();
        let mut reversed = order.clone();
        reversed.reverse();
        reorder_children(&project_root, None, reversed.clone()).expect("reorder");
        let tree = read_tree(&paths);
        assert_eq!(tree.root_children, reversed);

        // 重新打开：结构保持
        let opened = open_project(&project_root).expect("reopen");
        assert_eq!(opened.metadata.version, ProjectMetadata::CURRENT_VERSION);
    }

    #[test]
    fn failed_structure_change_leaves_visible_generation_unchanged() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("失败结构".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let tree_before = read_tree(&paths);
        let tree_json_before = fs::read(&paths.content_tree_file).expect("read tree before");
        let metadata_before = fs::read(&paths.metadata_file).expect("read metadata before");

        // 重命名为非法名称（含非法字符）必须失败，且不触碰任何文件。
        let result = rename_node(&project_root, "不存在的节点", "坏/名字");
        assert!(matches!(result, Err(ProjectError::InvalidStructure(_))));

        // 可见内容树与元信息字节不变，事务目录不残留。
        assert_eq!(
            fs::read(&paths.content_tree_file).expect("read tree after"),
            tree_json_before
        );
        assert_eq!(
            fs::read(&paths.metadata_file).expect("read metadata after"),
            metadata_before
        );
        assert!(!TransactionLayout::new(&paths).dir.exists());
        // 内容树结构仍与变更前一致。
        assert_eq!(read_tree(&paths), tree_before);
    }

    // ========== 结构变更事务的暂存/提交中断恢复（无部分可见世代） ==========

    /// 构造一个结构变更事务的暂存内容：在现有树克隆上加一个文件夹，元信息更新
    /// `updated_at`。返回（暂存树 JSON、暂存元信息 JSON、目标 updated_at）。
    fn build_structure_change_staged(paths: &ProjectPaths) -> (String, String, String) {
        let mut tree = read_content_tree(paths).expect("read current tree");
        tree.create_folder(None).expect("create folder in clone");
        let tree_json = serde_json::to_string_pretty(&tree).expect("serialize staged tree");

        let metadata_json = fs::read_to_string(&paths.metadata_file).expect("read metadata");
        let mut metadata: ProjectMetadata =
            serde_json::from_str(&metadata_json).expect("parse metadata");
        metadata.updated_at = "2026-06-01T00:00:00Z".to_string();
        let staged_metadata_json =
            serde_json::to_string_pretty(&metadata).expect("serialize staged metadata");
        (tree_json, staged_metadata_json, metadata.updated_at)
    }

    /// 结构变更事务在 `Staged` 阶段中断：可见文件仍是旧世代，打开时直接丢弃
    /// 暂存，不呈现任何部分结构。
    #[test]
    fn open_discards_staged_structure_change_and_loads_old_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("结构暂存中断".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let tree_before = read_tree(&paths);
        let tree_json_before = fs::read(&paths.content_tree_file).expect("read tree before");
        let metadata_before = fs::read(&paths.metadata_file).expect("read metadata before");

        let (tree_json, staged_metadata_json, target_updated_at) =
            build_structure_change_staged(&paths);
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(layout.dir.join("content-tree.json"), &tree_json).expect("stage tree");
        fs::write(layout.dir.join("project.json"), &staged_metadata_json).expect("stage metadata");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Staged",
                "target_updated_at": target_updated_at,
                "transaction_id": "structure-tx",
                "purpose": "structure_change",
                "files": [
                    { "staged": "content-tree.json", "target": "next-story-system/content-tree.json", "action": "replace" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        // 打开：Staged 事务被丢弃，加载旧世代，可见文件字节不变。
        let opened = open_project(&project_root).expect("open discards staged structure change");
        assert_eq!(read_tree(&paths), tree_before, "可见树应保持旧世代");
        assert_eq!(
            fs::read(&paths.content_tree_file).expect("read tree after"),
            tree_json_before
        );
        assert_eq!(
            fs::read(&paths.metadata_file).expect("read metadata after"),
            metadata_before
        );
        assert!(!layout.dir.exists(), "Staged 事务目录应被丢弃");
        assert_eq!(opened.metadata.version, ProjectMetadata::CURRENT_VERSION);
    }

    /// 结构变更事务在 `Committing` 阶段中断（可见内容树已是新世代、元信息仍是
    /// 旧世代）：打开时前滚元信息完成该世代，不呈现部分结构。
    #[test]
    fn open_rolls_forward_committing_structure_change_to_complete_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("结构提交中断".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let (tree_json, staged_metadata_json, target_updated_at) =
            build_structure_change_staged(&paths);
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(layout.dir.join("content-tree.json"), &tree_json).expect("stage tree");
        fs::write(layout.dir.join("project.json"), &staged_metadata_json).expect("stage metadata");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": target_updated_at,
                "transaction_id": "structure-tx",
                "purpose": "structure_change",
                "files": [
                    { "staged": "content-tree.json", "target": "next-story-system/content-tree.json", "action": "replace" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        // 模拟崩溃现场：可见内容树已是新世代，元信息仍是旧世代（完成标记未提交）。
        fs::write(&paths.content_tree_file, &tree_json).expect("replace visible tree");
        let metadata_before = fs::read(&paths.metadata_file).expect("read metadata before");

        // 打开：前滚元信息，完成结构变更世代。
        let opened = open_project(&project_root).expect("open rolls forward structure change");
        let tree_after = read_tree(&paths);
        assert_eq!(tree_after.root_children.len(), 2, "新世代树应含新增文件夹");
        assert_ne!(
            fs::read(&paths.metadata_file).expect("read metadata after"),
            metadata_before,
            "元信息应前滚到新世代"
        );
        assert!(!layout.dir.exists(), "前滚后事务目录应被清理");
        assert_eq!(opened.metadata.version, ProjectMetadata::CURRENT_VERSION);
    }

    // ========== 清单删除动作的用途与目标校验 ==========

    /// 删除动作只允许出现在迁移事务中：普通保存 / 结构变更清单含删除项必须拒绝。
    #[test]
    fn manifest_delete_entries_rejected_for_non_migration_purposes() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("删除用途校验".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);

        for purpose in ["save", "structure_change"] {
            fs::create_dir_all(&layout.dir).expect("create transaction dir");
            fs::write(
                &layout.manifest,
                serde_json::json!({
                    "manifest_version": 1,
                    "phase": "Committing",
                    "target_updated_at": "2026-06-01T00:00:00Z",
                    "transaction_id": "tx",
                    "purpose": purpose,
                    "files": [
                        { "staged": "", "target": "作品文本/草稿本.json", "action": "delete" },
                        { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                    ],
                })
                .to_string(),
            )
            .expect("write manifest");

            let result = read_transaction_manifest(&layout);
            assert!(
                matches!(result, Err(ProjectError::ReadError(ref message)) if message.contains("删除动作只允许用于迁移事务")),
                "purpose={purpose} 应拒绝删除动作"
            );
            fs::remove_dir_all(&layout.dir).expect("cleanup transaction dir");
        }
    }

    /// 迁移事务的删除动作只允许删除旧双本子固定文件，其它目标必须拒绝。
    #[test]
    fn manifest_delete_entry_with_non_legacy_target_rejected() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("删除目标校验".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-06-01T00:00:00Z",
                "transaction_id": "tx",
                "purpose": "migration",
                "files": [
                    { "staged": "", "target": "作品文本/documents/foo.json", "action": "delete" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        let result = read_transaction_manifest(&layout);
        assert!(
            matches!(result, Err(ProjectError::ReadError(ref message)) if message.contains("非法或重复删除目标")),
            "非旧双本子删除目标应被拒绝"
        );
    }

    /// 删除动作不应携带暂存文件：带暂存名的删除项必须拒绝。
    #[test]
    fn manifest_delete_entry_with_staged_content_rejected() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("删除暂存校验".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-06-01T00:00:00Z",
                "transaction_id": "tx",
                "purpose": "migration",
                "files": [
                    { "staged": "foo.json", "target": "作品文本/草稿本.json", "action": "delete" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        let result = read_transaction_manifest(&layout);
        assert!(
            matches!(result, Err(ProjectError::ReadError(ref message)) if message.contains("删除动作不应携带暂存文件")),
            "带暂存文件的删除项应被拒绝"
        );
    }

    /// 迁移事务含旧双本子删除动作的清单应通过校验（删除动作合法且有序）。
    #[test]
    fn manifest_migration_delete_entries_are_accepted() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("迁移删除清单".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-06-01T00:00:00Z",
                "transaction_id": "tx",
                "purpose": "migration",
                "files": [
                    { "staged": "doc-a.json", "target": "作品文本/documents/a.json", "action": "replace" },
                    { "staged": "", "target": "作品文本/草稿本.json", "action": "delete" },
                    { "staged": "", "target": "作品文本/正文本.json", "action": "delete" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        let manifest = read_transaction_manifest(&layout).expect("迁移删除清单应通过校验");
        assert_eq!(manifest.files.len(), 4);
        assert_eq!(manifest.files[1].action, StagedAction::Delete);
        assert_eq!(manifest.files[2].action, StagedAction::Delete);
        assert_eq!(manifest.files[1].target, "作品文本/草稿本.json");
        assert_eq!(manifest.files[2].target, "作品文本/正文本.json");
    }

    // ========== 按文档 ID 保存 / 读取内容树（命令层） ==========

    fn any_document_id(paths: &ProjectPaths) -> String {
        let tree = read_tree(paths);
        tree.nodes
            .values()
            .find(|node| node.kind == NodeKind::Document)
            .expect("a document exists")
            .id
            .clone()
    }

    const BY_ID_CONTENT: &str = r#"{"format":"next-story-tiptap","version":2,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"按ID写入的内容"}]}]}}"#;

    #[test]
    fn save_document_writes_body_and_updates_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("按ID保存".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let doc_id = any_document_id(&paths);
        let before_updated_at = read_visible_updated_at(&paths);

        save_document(&project_root, &doc_id, BY_ID_CONTENT).expect("save document");

        assert_eq!(
            fs::read_to_string(paths.document_file(&doc_id)).expect("read doc after"),
            BY_ID_CONTENT
        );
        assert_ne!(read_visible_updated_at(&paths), before_updated_at);
        assert!(!TransactionLayout::new(&paths).dir.exists());
    }

    #[test]
    fn save_document_rejects_unknown_id_folder_and_invalid_content() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("按ID保存拒绝".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        // 不存在的 ID
        assert!(matches!(
            save_document(&project_root, "不存在的节点", BY_ID_CONTENT),
            Err(ProjectError::InvalidStructure(_))
        ));

        // 文件夹不是文档，不能保存正文
        let folder = create_folder(&project_root, None).expect("create folder");
        assert!(matches!(
            save_document(&project_root, &folder, BY_ID_CONTENT),
            Err(ProjectError::InvalidStructure(_))
        ));

        // 非法正文在写盘前被拒，且不残留事务目录
        let doc_id = any_document_id(&paths);
        let before = fs::read_to_string(paths.document_file(&doc_id)).expect("read before");
        assert!(save_document(&project_root, &doc_id, "不是 JSON").is_err());
        assert_eq!(
            fs::read_to_string(paths.document_file(&doc_id)).expect("read after"),
            before
        );
        assert!(!TransactionLayout::new(&paths).dir.exists());
    }

    #[test]
    fn open_content_tree_and_read_document_return_validated_structure() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("读树读文档".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());

        let tree = open_content_tree(&project_root).expect("open content tree");
        assert_eq!(tree.root_children.len(), 1);
        assert!(tree.recycle_bin.is_empty());

        let doc_id = any_document_id(&paths);
        let body = read_document(&project_root, &doc_id).expect("read document");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid notebook json");
        assert_eq!(parsed["format"], "next-story-tiptap");

        // 读取不存在的 ID 与文件夹都被拒绝
        assert!(read_document(&project_root, "不存在的节点").is_err());
        let folder = create_folder(&project_root, None).expect("create folder");
        assert!(read_document(&project_root, &folder).is_err());
    }

    /// 单文档保存事务在 `Staged` 阶段中断：打开时直接丢弃暂存，加载旧世代，
    /// 证明 `save_document` 走的映射式事务与既有恢复路径一致。
    #[test]
    fn open_discards_staged_single_document_save_and_loads_old_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = create_project("单文档暂存中断".to_string(), temp.path().to_path_buf())
            .expect("create project");
        let paths = ProjectPaths::new(project_root.clone());
        let doc_id = any_document_id(&paths);
        let body_before = fs::read_to_string(paths.document_file(&doc_id)).expect("read before");
        let metadata_before = fs::read(&paths.metadata_file).expect("read metadata before");

        // 手工构造一个 Staged 阶段的单文档保存事务（正文 + project.json）。
        let layout = TransactionLayout::new(&paths);
        fs::create_dir_all(&layout.dir).expect("create transaction dir");
        fs::write(layout.dir.join(format!("doc-{doc_id}.json")), BY_ID_CONTENT)
            .expect("stage document");
        fs::write(layout.dir.join("project.json"), "{}").expect("stage metadata placeholder");
        fs::write(
            &layout.manifest,
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Staged",
                "target_updated_at": "2026-09-01T00:00:00Z",
                "transaction_id": "single-doc-tx",
                "purpose": "save",
                "files": [
                    { "staged": format!("doc-{doc_id}.json"), "target": format!("作品文本/documents/{doc_id}.json"), "action": "replace" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("write manifest");

        // 打开：Staged 事务被丢弃，加载旧世代，可见文件字节不变。
        let opened = open_project(&project_root).expect("open discards staged single-doc save");
        assert_eq!(
            fs::read_to_string(paths.document_file(&doc_id)).expect("read doc after"),
            body_before
        );
        assert_eq!(
            fs::read(&paths.metadata_file).expect("read metadata after"),
            metadata_before
        );
        assert!(!layout.dir.exists(), "Staged 事务目录应被丢弃");
        assert_eq!(opened.metadata.version, ProjectMetadata::CURRENT_VERSION);
    }
}
