use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::{empty_notebook_value, ProjectError, ProjectMetadata, ProjectOpenResult, ProjectPaths};

const MAX_METADATA_BYTES: u64 = 64 * 1024;
const MAX_NOTEBOOK_BYTES: u64 = 10 * 1024 * 1024;

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

/// 解析并校验一段本子 JSON 字符串，失败返回中文错误。
fn validate_notebook_content(content: &str, label: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|_| format!("{label}不是合法 JSON"))?;
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
enum SavePhase {
    /// 三份内容与清单已暂存，尚未替换任何可见文件。
    AfterStaging,
    /// 可见草稿本已替换，正文本与元信息仍是旧世代。
    AfterDraftReplace,
    /// 可见草稿本与正文本已替换，元信息仍是旧世代。
    AfterMainReplace,
}

/// 事务恢复阶段：`Staged` 表示尚未触碰可见文件，`Committing` 表示已经进入可见提交。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum TransactionPhase {
    Staged,
    Committing,
}

/// 手动保存事务清单：记录这次保存所属的世代信息。
///
/// 清单是恢复代码判断“一次保存是否完成”的唯一依据，因此使用带类型的 serde
/// 结构，而不是裸字符串，避免手写字段名漂移。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveManifest {
    /// 清单结构版本，便于未来演进。
    manifest_version: u32,
    /// 当前事务所处恢复阶段。
    phase: TransactionPhase,
    /// 这次保存要写入元信息的更新时间（下一世代的 `updated_at`）。
    target_updated_at: String,
}

impl SaveManifest {
    const CURRENT_VERSION: u32 = 1;
}

/// 手动保存事务目录内的固定布局。
struct TransactionLayout {
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
    fn new(paths: &ProjectPaths) -> Self {
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
    validate_notebook_content(&draft_content, "草稿本")
        .map_err(ProjectError::InvalidStructure)?;
    validate_notebook_content(&main_content, "正文本")
        .map_err(ProjectError::InvalidStructure)?;

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

    // 阶段一：把下一世代整体暂存到事务目录，此时不碰任何可见文件。
    stage_transaction(
        &layout,
        &draft_content,
        &main_content,
        &staged_metadata_json,
        &metadata.updated_at,
    )?;
    checkpoint(SavePhase::AfterStaging)?;

    write_manifest_phase(&layout, &metadata.updated_at, TransactionPhase::Committing)?;

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
    };
    write_manifest(layout, &manifest)?;

    Ok(())
}

/// 打开或保存前恢复上一次中断的手动保存事务。
fn recover_interrupted_save(paths: &ProjectPaths) -> Result<(), ProjectError> {
    let layout = TransactionLayout::new(paths);

    if !layout.dir.exists() {
        return Ok(());
    }

    let manifest = read_transaction_manifest(&layout)?;
    ensure_staged_generation_is_complete(&layout, &manifest)?;

    match manifest.phase {
        TransactionPhase::Staged => {
            cleanup_transaction(&layout);
        }
        TransactionPhase::Committing => {
            replace_from_staged(&paths.draft_file, &layout.staged_draft)?;
            replace_from_staged(&paths.main_file, &layout.staged_main)?;
            replace_from_staged(&paths.metadata_file, &layout.staged_metadata)?;
            cleanup_transaction(&layout);
        }
    }

    Ok(())
}

fn read_transaction_manifest(layout: &TransactionLayout) -> Result<SaveManifest, ProjectError> {
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

fn ensure_staged_generation_is_complete(
    layout: &TransactionLayout,
    manifest: &SaveManifest,
) -> Result<(), ProjectError> {
    let staged_draft = read_bounded_string(&layout.staged_draft, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;
    let staged_main = read_bounded_string(&layout.staged_main, MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::ReadError(format!("无法恢复保存事务: {e}")))?;

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
    phase: TransactionPhase,
) -> Result<(), ProjectError> {
    let manifest = SaveManifest {
        manifest_version: SaveManifest::CURRENT_VERSION,
        phase,
        target_updated_at: target_updated_at.to_string(),
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

    temp_file
        .persist(path)
        .map_err(|e| ProjectError::WriteError(e.error.to_string()))?;

    Ok(())
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

fn read_bounded_string(path: &Path, max_bytes: u64) -> Result<String, ProjectError> {
    let metadata = fs::metadata(path).map_err(|e| ProjectError::ReadError(e.to_string()))?;

    if metadata.len() > max_bytes {
        return Err(ProjectError::ReadError(format!(
            "文件过大，无法读取: {}",
            path.display()
        )));
    }

    fs::read_to_string(path).map_err(|e| ProjectError::ReadError(e.to_string()))
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

    /// 测试专用故障注入点。仅存在于测试模块，绝不进入生产或 Tauri 命令路径。
    #[derive(Debug, Clone, Copy)]
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

        let result = save_project(
            &project_root,
            NEW_DRAFT.to_string(),
            NEW_MAIN.to_string(),
        );

        assert!(matches!(result, Err(ProjectError::ReadError(_))));
        assert!(layout.dir.exists());
    }
}
