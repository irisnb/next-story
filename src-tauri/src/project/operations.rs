use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::{empty_notebook_value, ProjectError, ProjectMetadata, ProjectOpenResult, ProjectPaths};

pub(crate) const MAX_METADATA_BYTES: u64 = 64 * 1024;
pub(crate) const MAX_NOTEBOOK_BYTES: u64 = 10 * 1024 * 1024;

/// 手动保存事务目录名（位于 `next-story-system/` 下，系统所有，不放进用户本子）。
const SAVE_TRANSACTION_DIR: &str = "save-transaction";
/// 事务清单文件名。
const SAVE_MANIFEST_FILE: &str = "manifest.json";

/// 创建新作品
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
        fs::create_dir(&paths.system_dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;
        created_paths.push(paths.system_dir.clone());

        // 创建包含有效空白格式版本 1 文档的结构化本子文件
        let empty_notebook_json = serde_json::to_string_pretty(&empty_notebook_value())
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        write_file_atomically(&paths.draft_file, &empty_notebook_json)?;
        created_paths.push(paths.draft_file.clone());
        write_file_atomically(&paths.main_file, &empty_notebook_json)?;
        created_paths.push(paths.main_file.clone());

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
        cleanup_created_paths(&created_paths);
        return Err(error);
    }

    Ok(project_root)
}

/// 验证项目结构
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

    if !paths.user_text_dir.is_dir() {
        return Err(ProjectError::InvalidStructure(
            "缺少作品文本文件夹".to_string(),
        ));
    }

    if !paths.system_dir.is_dir() {
        return Err(ProjectError::InvalidStructure("缺少系统文件夹".to_string()));
    }

    // 先校验元信息与结构版本，再检查本子文件存在性：这样旧版本作品（含旧
    // `.txt` 本子）会得到「不支持的项目结构版本」而不是「缺少草稿本.json」。
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

    // 检查必要本子文件是否存在
    validate_required_file(&project_root, &paths.draft_file, "草稿本.json")?;
    validate_required_file(&project_root, &paths.main_file, "正文本.json")?;

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
fn read_and_validate_notebook(path: &Path, label: &str) -> Result<String, ProjectError> {
    let content = read_bounded_string(path, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    validate_notebook_content(&content, label).map_err(ProjectError::InvalidStructure)?;
    Ok(content)
}

/// 打开作品
pub fn open_project(project_root: &Path) -> Result<ProjectOpenResult, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    recover_interrupted_save(&paths)?;

    // 读取元信息
    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(e.to_string()))?;
    let metadata: ProjectMetadata =
        serde_json::from_str(&metadata_json).map_err(|e| ProjectError::ReadError(e.to_string()))?;

    // 读取并在进入编辑器前校验两份结构化本子
    let draft_content = read_and_validate_notebook(&paths.draft_file, "草稿本")?;
    let main_content = read_and_validate_notebook(&paths.main_file, "正文本")?;

    Ok(ProjectOpenResult {
        metadata,
        draft_content,
        main_content,
    })
}

/// 保存事务的阶段边界。无故障路径会经过每个边界但不做任何事；
/// 测试通过故障钩子在指定边界中断。此类型是项目领域内部私有，不暴露给 Tauri 或前端。
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ManifestPurpose {
    Save,
    MigrationRollback,
}

impl Default for ManifestPurpose {
    fn default() -> Self {
        ManifestPurpose::Save
    }
}

/// 进程内唯一递增的事务计数器，配合纳秒时间戳生成事务标识。
static TRANSACTION_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成一次保存/回滚事务的唯一标识。
fn new_transaction_id() -> String {
    let nanos = Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_default() as u128;
    let counter = TRANSACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{counter:x}")
}

/// 手动保存事务清单：记录这次保存所属的世代信息。
///
/// 清单是恢复代码判断“一次保存是否完成”的唯一依据，因此使用带类型的 serde
/// 结构，而不是裸字符串，避免手写字段名漂移。`transaction_id` 与 `purpose`
/// 带默认值，兼容本改动之前写下的旧清单。
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
}

impl SaveManifest {
    const CURRENT_VERSION: u32 = 1;
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

/// 保存作品：把一次手动保存当作一个完整世代，先整体暂存到事务目录，
/// 再按 草稿 -> 正文 -> 元信息 的顺序替换可见文件，元信息是最后的完成标记。
///
/// 这是对外的无故障路径；测试通过 `save_project_with_fault` 在各阶段之间注入中断。
pub fn save_project(
    project_root: &Path,
    draft_content: String,
    main_content: String,
) -> Result<(), ProjectError> {
    run_save_transaction(project_root, draft_content, main_content, |_| Ok(()))
}

/// 保存事务核心流程。`checkpoint` 在每个阶段之间被调用，无故障路径传入恒成功闭包。
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

    // 阶段一：把下一世代整体暂存到事务目录，此时不碰任何可见文件。
    stage_transaction(
        &layout,
        &draft_content,
        &main_content,
        &staged_metadata_json,
        &metadata.updated_at,
        &transaction_id,
    )?;
    checkpoint(SavePhase::AfterStaging)?;

    // 提交前校验：事务目录仍是本次保存的暂存（防锁遗漏导致的世代替换）。
    ensure_transaction_unchanged(&layout, &transaction_id)?;

    write_manifest_phase(
        &layout,
        &metadata.updated_at,
        &transaction_id,
        TransactionPhase::Committing,
    )?;

    // 阶段二：从暂存文件替换可见文件，元信息最后提交。
    replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
    checkpoint(SavePhase::AfterDraftReplace)?;
    replace_from_staged(&paths.main_file, &layout.staged_main)?;
    checkpoint(SavePhase::AfterMainReplace)?;
    replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;

    // 阶段三：提交完成，清理事务目录，不留内部实现痕迹。
    cleanup_transaction(&layout);

    Ok(())
}

/// 把下一世代的三份内容与清单写入事务目录。
fn stage_transaction(
    layout: &TransactionLayout,
    draft_content: &str,
    main_content: &str,
    metadata_json: &str,
    target_updated_at: &str,
    transaction_id: &str,
) -> Result<(), ProjectError> {
    // 清掉可能残留的旧事务目录，确保暂存的是干净的新世代。
    cleanup_transaction(layout);
    fs::create_dir_all(&layout.dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;

    write_file_atomically(&layout.staged_draft, draft_content)?;
    write_file_atomically(&layout.staged_main, main_content)?;
    write_file_atomically(&layout.staged_metadata, metadata_json)?;

    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase: TransactionPhase::Staged,
        target_updated_at: target_updated_at.to_string(),
        transaction_id: transaction_id.to_string(),
        purpose: ManifestPurpose::Save,
    };
    write_manifest(layout, &manifest)?;

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
            replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
            replace_from_staged(&paths.main_file, &layout.staged_main)?;
            replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;
            cleanup_transaction(&layout);
        }
    }

    Ok(())
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

    Ok(manifest)
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

fn ensure_staged_generation_is_complete(
    layout: &TransactionLayout,
    manifest: &SaveManifest,
) -> Result<(), ProjectError> {
    let staged_draft = read_staged_notebook(&layout.staged_draft, "草稿本")?;
    let staged_main = read_staged_notebook(&layout.staged_main, "正文本")?;

    // 恢复流程在提交暂存世代前校验两份结构化文档。
    validate_notebook_content(&staged_draft, "草稿本")
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
    validate_notebook_content(&staged_main, "正文本")
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;

    let metadata_json = read_bounded_string(&layout.staged_metadata, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;

    if metadata.updated_at != manifest.target_updated_at {
        return Err(ProjectError::ReadError(
            "无法恢复保存事务: 暂存元信息与事务清单不一致".to_string(),
        ));
    }

    Ok(())
}

fn write_manifest_phase(
    layout: &TransactionLayout,
    target_updated_at: &str,
    transaction_id: &str,
    phase: TransactionPhase,
) -> Result<(), ProjectError> {
    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase,
        target_updated_at: target_updated_at.to_string(),
        transaction_id: transaction_id.to_string(),
        purpose: ManifestPurpose::Save,
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
    write_file_atomically(visible, &content)
}

/// 删除事务目录及其内容。清理失败不影响已完成的保存，故忽略错误。
fn cleanup_transaction(layout: &TransactionLayout) {
    let _ = fs::remove_dir_all(&layout.dir);
}

fn write_file_atomically(path: &Path, content: &str) -> Result<(), ProjectError> {
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

fn validate_no_reparse_point(path: &Path, label: &str) -> Result<(), ProjectError> {
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

    /// 建立一个有效作品，并把三份可见文件写成彼此不同、可辨认的“旧世代”值。
    fn seed_project_with_old_generation(temp: &tempfile::TempDir, name: &str) -> PathBuf {
        create_project(name.to_string(), temp.path().to_path_buf())
            .expect("create project skeleton");

        let project_root = temp.path().join(name);
        let paths = ProjectPaths::new(project_root.clone());

        fs::write(&paths.draft_file, OLD_DRAFT).expect("seed old draft");
        fs::write(&paths.main_file, OLD_MAIN).expect("seed old main");

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

    fn read_visible_updated_at(paths: &ProjectPaths) -> String {
        let json = fs::read_to_string(&paths.metadata_file).expect("read metadata");
        let metadata: ProjectMetadata = serde_json::from_str(&json).expect("parse metadata");
        metadata.updated_at
    }

    fn assert_opened_generation(
        result: &ProjectOpenResult,
        draft: &str,
        main: &str,
        updated_at: &str,
    ) {
        assert_eq!(result.draft_content, draft);
        assert_eq!(result.main_content, main);
        assert_eq!(result.metadata.updated_at, updated_at);
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

        // 可见文件仍是旧世代，未被触碰
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            OLD_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            OLD_MAIN
        );
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 新世代已暂存在事务目录中
        let tx_dir = paths.system_dir.join("save-transaction");
        assert_eq!(
            fs::read_to_string(tx_dir.join("草稿本.json")).expect("read staged draft"),
            NEW_DRAFT
        );
        assert_eq!(
            fs::read_to_string(tx_dir.join("正文本.json")).expect("read staged main"),
            NEW_MAIN
        );
        assert!(tx_dir.join("manifest.json").is_file());
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

        // 可见草稿本已是新世代，正文本与元信息仍是旧世代（可见状态混世代，等待恢复）。
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            NEW_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            OLD_MAIN
        );
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 暂存的新世代仍完整保留，恢复代码后续可据此前滚。
        let layout = TransactionLayout::new(&paths);
        assert_eq!(
            fs::read_to_string(&layout.staged_main).expect("read staged main"),
            NEW_MAIN
        );
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

        // 两个本子都已是新世代，只有作为完成标记的元信息仍是旧世代。
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            NEW_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            NEW_MAIN
        );
        assert_eq!(read_visible_updated_at(&paths), OLD_UPDATED_AT);

        // 暂存的新世代元信息仍完整保留，恢复代码后续可据此前滚提交。
        let layout = TransactionLayout::new(&paths);
        let staged_json =
            fs::read_to_string(&layout.staged_metadata).expect("read staged metadata");
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

        // 三份可见文件都进入同一新世代。
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            NEW_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            NEW_MAIN
        );
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

        assert_opened_generation(&opened, OLD_DRAFT, OLD_MAIN, OLD_UPDATED_AT);
        assert!(!TransactionLayout::new(&paths).dir.exists());
    }

    #[test]
    fn open_after_draft_replace_fault_rolls_forward_to_new_generation() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "草稿中断后打开");

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterDraftReplace),
        )
        .expect_err("injected draft replace fault");

        let opened = open_project(&project_root).expect("open rolls transaction forward");

        assert_eq!(opened.draft_content, NEW_DRAFT);
        assert_eq!(opened.main_content, NEW_MAIN);
        assert_ne!(opened.metadata.updated_at, OLD_UPDATED_AT);
    }

    #[test]
    fn open_after_main_replace_fault_rolls_forward_metadata() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root = seed_project_with_old_generation(&temp, "正文中断后打开");

        save_project_with_fault(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
            Some(SaveFault::AfterMainReplace),
        )
        .expect_err("injected main replace fault");

        let opened = open_project(&project_root).expect("open commits staged metadata");

        assert_eq!(opened.draft_content, NEW_DRAFT);
        assert_eq!(opened.main_content, NEW_MAIN);
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

        let result = save_project(&project_root, NEW_DRAFT.to_string(), NEW_MAIN.to_string());

        assert!(matches!(result, Err(ProjectError::ReadError(_))));
        assert!(layout.dir.exists());
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
            run_save_transaction(&root_b, GEN_B_DRAFT.to_string(), GEN_B_MAIN.to_string(), |_| {
                Ok(())
            })
            .expect("B 保存成功");
        });

        handle_a.join().expect("A 线程正常结束");
        handle_b.join().expect("B 线程正常结束");

        // 最终可见文件必须是 B 的完整世代（B 最后执行），无混合世代。
        assert_eq!(
            fs::read_to_string(&paths.draft_file).expect("read draft"),
            GEN_B_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths.main_file).expect("read main"),
            GEN_B_MAIN
        );
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
            run_save_transaction(&root_a2, GEN_A_DRAFT.to_string(), GEN_A_MAIN.to_string(), |_| {
                Ok(())
            })
            .expect("甲保存成功");
        });

        let locks_b = locks.clone();
        let root_b2 = root_b.clone();
        let handle_b = thread::spawn(move || {
            let _guard = locks_b.acquire(&root_b2).expect("B 取得作品乙锁，不应被甲阻塞");
            let _ = b_acquired_tx.send(());
            run_save_transaction(&root_b2, GEN_B_DRAFT.to_string(), GEN_B_MAIN.to_string(), |_| {
                Ok(())
            })
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
        assert_eq!(
            fs::read_to_string(&paths_a.draft_file).expect("read 甲草稿"),
            GEN_A_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths_a.main_file).expect("read 甲正文"),
            GEN_A_MAIN
        );
        assert_eq!(
            fs::read_to_string(&paths_b.draft_file).expect("read 乙草稿"),
            GEN_B_DRAFT
        );
        assert_eq!(
            fs::read_to_string(&paths_b.main_file).expect("read 乙正文"),
            GEN_B_MAIN
        );
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
        fs::write(
            &path,
            "x".repeat(MAX_METADATA_BYTES as usize + 128 * 1024),
        )
        .expect("grow file past limit");
        let result = read_bounded_string(&path, MAX_METADATA_BYTES);
        assert!(
            matches!(result, Err(ProjectError::ContentTooLarge(_))),
            "有界读取应拒绝超限文件，实际: {result:?}"
        );
    }
}
