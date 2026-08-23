//! 项目版本迁移框架。
//!
//! 打开项目时若结构版本不是当前版本，会先走迁移框架：
//! - 等于当前版本：直接通过；
//! - 大于当前版本（未来版本）：拒绝（「不支持的项目结构版本」）；
//! - 小于当前版本：按注册的迁移步骤 `from_version`→`to_version` 逐级升级，
//!   执行前先备份，任一步骤失败即回滚备份并返回错误。
//!
//! 回滚复用项目保存的事务式暂存/恢复机制（`operations::transactional_restore`）：
//! 先整体暂存到 `next-story-system/save-transaction/` 并写入 `MigrationRollback`
//! 用途的 `Committing` 清单，再按 草稿 → 正文 → 元信息 顺序替换可见文件；
//! 迁移中途崩溃留下的暂存会在下次打开时由框架优先恢复（见
//! [`recover_pending_migration_rollback`]）。
//!
//! 迁移步骤必须是幂等的：允许在失败或崩溃后再次打开时被重新执行。
//!
//! 生产环境当前注册一个迁移步骤：`2 → 3`（固定双本子 → 内容树根层两篇普通
//! 文档「草稿本」「正文本」）。版本 1（旧 `.txt` 本子）仍无迁移步骤，继续被
//! 拒绝，与迁移框架出现前的行为一致。

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::operations::{
    read_and_validate_notebook, read_bounded_string, recover_migration_rollback_transaction,
    recover_pending_save_before_migration, transactional_restore, transactional_write_mapped,
    validate_migration_source_files, ManifestPurpose, StagedAction, StagedFile, MAX_METADATA_BYTES,
    MAX_NOTEBOOK_BYTES,
};
use super::{ContentTree, ProjectError, ProjectMetadata, ProjectPaths};

/// 备份目录所在的父目录（位于 `next-story-system/` 下，系统所有）。
const MIGRATIONS_DIR: &str = "migrations";

/// 一次迁移步骤：把项目结构从 `from_version` 升到 `to_version`。
///
/// `migrate` 接收作品根目录，负责完成升级并让 `project.json` 的版本号变为
/// `to_version`。框架会在每一步执行后校验版本是否确实到达 `to_version`。
#[derive(Debug, Clone, Copy)]
pub(crate) struct MigrationStep {
    pub(crate) from_version: u32,
    pub(crate) to_version: u32,
    pub(crate) migrate: fn(&Path) -> Result<(), ProjectError>,
}

/// 生产环境迁移注册表：`2 → 3` 把固定双本子迁移为内容树根层两篇普通文档。
/// 版本 1（旧 `.txt` 本子）无迁移步骤，继续拒绝。
pub(crate) const PRODUCTION_MIGRATIONS: &[MigrationStep] = &[MigrationStep {
    from_version: 2,
    to_version: 3,
    migrate: migrate_v2_to_v3,
}];

/// 版本 2 → 3：把固定双本子（`作品文本/草稿本.json`、`作品文本/正文本.json`）
/// 迁移为内容树根层两篇普通文档，名称保留「草稿本」「正文本」，正文保留原
/// Tiptap JSON 文字与格式，不保留特殊本子身份，也不额外包裹迁移文件夹。
///
/// 原子切换顺序：写入两篇新正文文件 → 写入树元数据 → 删除旧双本子文件 →
/// 提交版本 3 元信息（完成标记）。删除旧文件是清单中的可恢复动作，与替换
/// 一样按顺序前滚：中途崩溃后再次打开时，事务恢复机制从清单重放剩余动作
/// （含删除），不会留下「版本 3 已提交但旧文件残留」或「旧文件已删但版本
/// 仍是 2」的部分状态。
fn migrate_v2_to_v3(project_root: &Path) -> Result<(), ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    // 读取旧双本子内容（保留文字与格式），失败即回滚，不产生部分迁移。
    let draft_content = read_and_validate_notebook(&paths.draft_file, "草稿本")?;
    let main_content = read_and_validate_notebook(&paths.main_file, "正文本")?;

    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::InvalidStructure(format!("项目元信息无法解析: {e}")))?;

    // 内容树根层两篇普通文档，名称保留「草稿本」「正文本」。
    let mut tree = ContentTree::new();
    let draft_id = tree
        .create_document(None)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    tree.rename(&draft_id, "草稿本")
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    let main_id = tree
        .create_document(None)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    tree.rename(&main_id, "正文本")
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;

    let tree_json =
        serde_json::to_string_pretty(&tree).map_err(|e| ProjectError::WriteError(e.to_string()))?;
    metadata.version = 3;
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    let staged_writes = vec![
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
                staged: "content-tree.json".into(),
                target: "next-story-system/content-tree.json".into(),
                action: StagedAction::Replace,
            },
            tree_json,
        ),
        // 删除旧双本子文件作为可恢复动作，排在元信息（完成标记）之前。
        (
            StagedFile {
                staged: String::new(),
                target: "作品文本/草稿本.json".into(),
                action: StagedAction::Delete,
            },
            String::new(),
        ),
        (
            StagedFile {
                staged: String::new(),
                target: "作品文本/正文本.json".into(),
                action: StagedAction::Delete,
            },
            String::new(),
        ),
        (
            StagedFile {
                staged: "project.json".into(),
                target: "next-story-system/project.json".into(),
                action: StagedAction::Replace,
            },
            metadata_json,
        ),
    ];
    transactional_write_mapped(
        &paths,
        &staged_writes,
        &metadata.updated_at,
        ManifestPurpose::Migration,
    )?;

    Ok(())
}

/// 版本迁移入口：读取当前版本，与目标版本比较并执行需要的迁移。
pub(crate) fn migrate_project(
    project_root: &Path,
    migrations: &[MigrationStep],
    target_version: u32,
) -> Result<u32, ProjectError> {
    // 先恢复上次迁移回滚中断留下的事务（复用保存事务的暂存/恢复机制），
    // 再读取版本：保证「迁移中途崩溃后再次打开」从一致有效世代继续。
    let paths = ProjectPaths::new(project_root.to_path_buf());
    recover_pending_migration_rollback(&paths)?;

    let current_version = read_project_version(project_root)?;

    if current_version == target_version {
        return Ok(current_version);
    }
    if current_version > target_version {
        return Err(unsupported_version(current_version));
    }

    // 先收集从当前版本到目标版本的迁移链，按版本逐级查找；找不到步骤的版本无法迁移。
    // 链在改动任何文件之前就确定下来，缺步骤的旧版本直接拒绝，不会留下部分迁移。
    let mut chain: Vec<&MigrationStep> = Vec::new();
    let mut version = current_version;
    while version < target_version {
        let step = migrations
            .iter()
            .find(|step| step.from_version == version)
            .ok_or_else(|| unsupported_version(version))?;

        if step.to_version <= step.from_version {
            return Err(ProjectError::InvalidStructure(format!(
                "迁移步骤定义不合法: 目标版本 {} 未高于起始版本 {}",
                step.to_version, step.from_version
            )));
        }
        if step.to_version > target_version {
            return Err(ProjectError::InvalidStructure(format!(
                "迁移步骤定义不合法: 从 {} 到 {} 超出目标版本 {}",
                step.from_version, step.to_version, target_version
            )));
        }

        chain.push(step);
        version = step.to_version;
    }

    // 确认存在迁移链后，先恢复遗留的手动保存事务（旧版本作品先按旧事务恢复，
    // 再走迁移），再校验源文件边界，最后备份。版本过低无迁移步骤时在链构建
    // 阶段已被拒绝，不会触碰任何文件。
    recover_pending_save_before_migration(&paths)?;

    // 恢复可能把中断的迁移事务前滚完成（含删除旧双本子文件）：此时版本已到
    // 目标，直接通过，不再要求旧源文件存在。
    let recovered_version = read_project_version(project_root)?;
    if recovered_version == target_version {
        return Ok(recovered_version);
    }
    if recovered_version > target_version {
        return Err(unsupported_version(recovered_version));
    }

    validate_migration_source_files(project_root)?;

    // 执行前先备份将被改动的文件（project.json 与两个本子）。
    let backup_dir = create_backup(project_root, current_version)?;

    // 逐级执行迁移，每一步后校验版本；任一步骤失败即回滚备份。
    for step in chain {
        if let Err(error) = (step.migrate)(project_root) {
            return Err(rollback_with_report(&backup_dir, project_root, error));
        }

        let after_version = match read_project_version(project_root) {
            Ok(after) => after,
            Err(error) => {
                return Err(rollback_with_report(&backup_dir, project_root, error));
            }
        };
        if after_version != step.to_version {
            return Err(rollback_with_report(
                &backup_dir,
                project_root,
                ProjectError::InvalidStructure(format!(
                    "迁移步骤校验失败: 从 {} 迁移后版本为 {}，期望 {}",
                    step.from_version, after_version, step.to_version
                )),
            ));
        }
    }

    Ok(target_version)
}

/// 迁移开始前恢复上次中断的迁移回滚事务；非迁移回滚用途的事务原样跳过。
fn recover_pending_migration_rollback(paths: &ProjectPaths) -> Result<(), ProjectError> {
    recover_migration_rollback_transaction(paths)
}

/// 迁移失败后回滚备份，并把原始迁移错误与回滚错误合并返回：
/// 回滚成功返回原错误；回滚失败时同时保留两者，并给出备份目录的人工恢复路径。
fn rollback_with_report(
    backup_dir: &Path,
    project_root: &Path,
    migration_error: ProjectError,
) -> ProjectError {
    match rollback_backup(backup_dir, project_root) {
        Ok(()) => migration_error,
        Err(rollback_error) => ProjectError::WriteError(format!(
            "迁移失败: {migration_error}；回滚失败: {rollback_error}。备份保留在 {} 目录，请按备份人工恢复。",
            backup_dir.display()
        )),
    }
}

/// 读取项目当前结构版本；读取或解析失败返回结构错误。
fn read_project_version(project_root: &Path) -> Result<u32, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    if !paths.metadata_file.is_file() {
        return Err(ProjectError::InvalidStructure(
            "缺少project.json".to_string(),
        ));
    }

    let metadata_json = read_bounded_string(&paths.metadata_file, MAX_METADATA_BYTES)
        .map_err(|e| ProjectError::InvalidStructure(e.to_string()))?;
    let metadata: ProjectMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| ProjectError::InvalidStructure(format!("项目元信息无法解析: {e}")))?;

    Ok(metadata.version)
}

/// 构造「不支持的项目结构版本」错误，文案与结构校验保持一致。
fn unsupported_version(version: u32) -> ProjectError {
    ProjectError::InvalidStructure(format!("不支持的项目结构版本: {version}"))
}

/// 把将被迁移改动的文件备份到 `next-story-system/migrations/backup-<from_version>-<时间戳>/`。
/// 备份失败时清理已创建的部分备份目录，不留下残缺备份。
fn create_backup(project_root: &Path, from_version: u32) -> Result<PathBuf, ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S-%f").to_string();
    let backup_dir = paths
        .system_dir
        .join(MIGRATIONS_DIR)
        .join(format!("backup-{from_version}-{timestamp}"));

    let copy_result = (|| -> Result<(), ProjectError> {
        fs::create_dir_all(&backup_dir).map_err(|e| ProjectError::WriteError(e.to_string()))?;
        copy_file_into_backup(&paths.metadata_file, &backup_dir, "project.json")?;
        copy_file_into_backup(&paths.draft_file, &backup_dir, "草稿本.json")?;
        copy_file_into_backup(&paths.main_file, &backup_dir, "正文本.json")?;
        Ok(())
    })();

    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(&backup_dir);
        return Err(error);
    }

    Ok(backup_dir)
}

/// 复制一个文件到备份目录内。
fn copy_file_into_backup(
    source: &Path,
    backup_dir: &Path,
    file_name: &str,
) -> Result<(), ProjectError> {
    fs::copy(source, backup_dir.join(file_name))
        .map_err(|e| ProjectError::WriteError(e.to_string()))?;
    Ok(())
}

/// 用备份事务式恢复被改动的文件：整体暂存进 `save-transaction/` 后按
/// 草稿 → 正文 → 元信息 顺序原子替换，不再用三次裸 `fs::copy`（裸复制
/// 中途失败会留下部分回滚状态，且没有恢复标记）。恢复成功才删除备份目录，
/// 恢复失败返回错误并保留备份目录便于人工处理。
fn rollback_backup(backup_dir: &Path, project_root: &Path) -> Result<(), ProjectError> {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    let metadata_json = read_bounded_string(&backup_dir.join("project.json"), MAX_METADATA_BYTES)
        .map_err(|e| {
        ProjectError::WriteError(format!("回滚失败：无法读取备份 project.json: {e}"))
    })?;
    let draft_json = read_bounded_string(&backup_dir.join("草稿本.json"), MAX_NOTEBOOK_BYTES)
        .map_err(|e| {
            ProjectError::WriteError(format!("回滚失败：无法读取备份 草稿本.json: {e}"))
        })?;
    let main_json = read_bounded_string(&backup_dir.join("正文本.json"), MAX_NOTEBOOK_BYTES)
        .map_err(|e| {
            ProjectError::WriteError(format!("回滚失败：无法读取备份 正文本.json: {e}"))
        })?;

    transactional_restore(&paths, &metadata_json, &draft_json, &main_json)?;

    // 恢复成功才删除备份目录；失败则保留备份便于人工处理。
    let _ = fs::remove_dir_all(backup_dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{ContentTreeNode, NodeKind};
    use tempfile::TempDir;

    /// 建一个带指定结构版本的完整项目骨架（project.json + 两个本子文件）。
    fn seed_project(root: &Path, version: u32) {
        fs::create_dir_all(root.join("作品文本")).expect("创建作品文本文件夹");
        fs::create_dir_all(root.join("next-story-system")).expect("创建系统文件夹");
        fs::write(root.join("作品文本").join("草稿本.json"), "{}").expect("写入草稿本");
        fs::write(root.join("作品文本").join("正文本.json"), "{}").expect("写入正文本");
        fs::write(
            root.join("next-story-system").join("project.json"),
            format!(
                r#"{{"name":"测试作品","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","version":{version}}}"#
            ),
        )
        .expect("写入元信息");
    }

    fn read_version(root: &Path) -> u32 {
        let json = fs::read_to_string(root.join("next-story-system").join("project.json"))
            .expect("读取元信息");
        let metadata: ProjectMetadata = serde_json::from_str(&json).expect("解析元信息");
        metadata.version
    }

    fn metadata_bytes(root: &Path) -> Vec<u8> {
        fs::read(root.join("next-story-system").join("project.json")).expect("读取元信息字节")
    }

    /// 列出 `next-story-system/migrations/` 下的备份目录（按名字排序，便于断言）。
    fn backup_dirs(root: &Path) -> Vec<PathBuf> {
        let migrations_dir = root.join("next-story-system").join("migrations");
        if !migrations_dir.is_dir() {
            return Vec::new();
        }
        let mut dirs: Vec<PathBuf> = fs::read_dir(&migrations_dir)
            .expect("读取备份目录")
            .map(|entry| entry.expect("读取目录项").path())
            .collect();
        dirs.sort();
        dirs
    }

    /// 把 `project.json` 的版本号改写为指定值。
    fn set_metadata_version(project_root: &Path, version: u32) -> Result<(), ProjectError> {
        let metadata_path = project_root.join("next-story-system").join("project.json");
        let json = fs::read_to_string(&metadata_path)
            .map_err(|e| ProjectError::ReadError(e.to_string()))?;
        let mut metadata: ProjectMetadata =
            serde_json::from_str(&json).map_err(|e| ProjectError::WriteError(e.to_string()))?;
        metadata.version = version;
        let new_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        fs::write(&metadata_path, new_json).map_err(|e| ProjectError::WriteError(e.to_string()))
    }

    /// 合成迁移步骤：1 → 2，把 `project.json` 的版本号改为 2。
    fn synthetic_upgrade_v1_to_v2(project_root: &Path) -> Result<(), ProjectError> {
        set_metadata_version(project_root, 2)
    }

    /// 合成迁移步骤：2 → 3，把 `project.json` 的版本号改为 3。
    fn synthetic_upgrade_v2_to_v3(project_root: &Path) -> Result<(), ProjectError> {
        set_metadata_version(project_root, 3)
    }

    /// 合成迁移步骤：什么都不做（用于校验框架对「未推进版本」的检测）。
    fn synthetic_noop_step(_project_root: &Path) -> Result<(), ProjectError> {
        Ok(())
    }

    /// 合成迁移步骤：先破坏 `project.json` 再故意失败（用于验证回滚恢复了原文件）。
    fn synthetic_step_fails_after_writing(project_root: &Path) -> Result<(), ProjectError> {
        let metadata_path = project_root.join("next-story-system").join("project.json");
        fs::write(&metadata_path, "被迁移破坏的内容")
            .map_err(|e| ProjectError::WriteError(e.to_string()))?;
        Err(ProjectError::WriteError("测试注入的迁移失败".to_string()))
    }

    #[test]
    fn migrate_returns_early_when_version_equals_target() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("当前版本");
        seed_project(&root, ProjectMetadata::CURRENT_VERSION);

        let result = migrate_project(
            &root,
            PRODUCTION_MIGRATIONS,
            ProjectMetadata::CURRENT_VERSION,
        );

        assert_eq!(
            result.expect("当前版本直接通过"),
            ProjectMetadata::CURRENT_VERSION
        );
        assert!(backup_dirs(&root).is_empty(), "版本相同时不应产生备份");
    }

    #[test]
    fn migrate_rejects_future_version_without_backup() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("未来版本");
        seed_project(&root, 4);
        let before = metadata_bytes(&root);

        let result = migrate_project(
            &root,
            PRODUCTION_MIGRATIONS,
            ProjectMetadata::CURRENT_VERSION,
        );

        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("不支持的项目结构版本"), "实际: {message}");
                assert!(message.contains('4'), "实际: {message}");
            }
            other => panic!("期望版本拒绝，实际: {other:?}"),
        }
        assert_eq!(metadata_bytes(&root), before, "拒绝时不得改动文件");
        assert!(backup_dirs(&root).is_empty(), "拒绝时不应产生备份");
    }

    #[test]
    fn migrate_rejects_old_version_with_empty_registry() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("旧版本");
        seed_project(&root, 1);
        let before = metadata_bytes(&root);

        let result = migrate_project(
            &root,
            PRODUCTION_MIGRATIONS,
            ProjectMetadata::CURRENT_VERSION,
        );

        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("不支持的项目结构版本"), "实际: {message}");
            }
            other => panic!("期望版本拒绝，实际: {other:?}"),
        }
        assert_eq!(metadata_bytes(&root), before, "空注册表拒绝时不得改动文件");
        assert!(backup_dirs(&root).is_empty(), "空注册表不应产生备份");
    }

    #[test]
    fn migrate_runs_synthetic_step_keeps_backup_and_upgrades_version() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("可迁移项目");
        seed_project(&root, 1);
        let before = metadata_bytes(&root);
        let steps = [MigrationStep {
            from_version: 1,
            to_version: 2,
            migrate: synthetic_upgrade_v1_to_v2,
        }];

        let result = migrate_project(&root, &steps, 2);

        assert_eq!(result.expect("合成迁移成功"), 2);
        assert_eq!(read_version(&root), 2, "迁移后版本应为 2");
        assert_ne!(metadata_bytes(&root), before, "迁移应改写元信息");

        // 备份存在且包含三份被保护的文件，备份内容是迁移前的版本 1。
        let backups = backup_dirs(&root);
        assert_eq!(backups.len(), 1, "应恰有一个备份目录: {backups:?}");
        let backup = &backups[0];
        assert!(backup.join("project.json").is_file());
        assert!(backup.join("草稿本.json").is_file());
        assert!(backup.join("正文本.json").is_file());

        let backup_json = fs::read_to_string(backup.join("project.json")).expect("读取备份元信息");
        let backup_metadata: ProjectMetadata =
            serde_json::from_str(&backup_json).expect("解析备份元信息");
        assert_eq!(backup_metadata.version, 1, "备份应保留迁移前的版本");
    }

    #[test]
    fn migrate_chains_steps_level_by_level() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("逐级迁移");
        seed_project(&root, 1);
        let steps = [
            MigrationStep {
                from_version: 1,
                to_version: 2,
                migrate: synthetic_upgrade_v1_to_v2,
            },
            MigrationStep {
                from_version: 2,
                to_version: 3,
                migrate: synthetic_upgrade_v2_to_v3,
            },
        ];

        let result = migrate_project(&root, &steps, 3);

        assert_eq!(result.expect("逐级迁移成功"), 3);
        assert_eq!(read_version(&root), 3, "逐级迁移后版本应为 3");
        assert_eq!(backup_dirs(&root).len(), 1, "整条迁移链只备份一次");
    }

    #[test]
    fn migrate_rolls_back_original_files_when_step_fails() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("失败迁移");
        seed_project(&root, 1);
        let before = metadata_bytes(&root);
        let steps = [MigrationStep {
            from_version: 1,
            to_version: 2,
            migrate: synthetic_step_fails_after_writing,
        }];

        let result = migrate_project(&root, &steps, 2);

        assert!(matches!(result, Err(ProjectError::WriteError(_))));
        assert_eq!(metadata_bytes(&root), before, "失败后应恢复原元信息");
        assert!(backup_dirs(&root).is_empty(), "回滚成功后应清理备份目录");
    }

    #[test]
    fn migrate_rejects_step_that_does_not_advance_version() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("未推进版本");
        seed_project(&root, 1);
        let before = metadata_bytes(&root);
        let steps = [MigrationStep {
            from_version: 1,
            to_version: 2,
            migrate: synthetic_noop_step,
        }];

        let result = migrate_project(&root, &steps, 2);

        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("迁移步骤校验失败"), "实际: {message}");
            }
            other => panic!("期望步骤校验失败，实际: {other:?}"),
        }
        assert_eq!(metadata_bytes(&root), before, "校验失败后应恢复原元信息");
        assert!(backup_dirs(&root).is_empty(), "校验失败后应清理备份目录");
    }

    #[test]
    fn migrate_rejects_invalid_step_definition_without_backup() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("非法步骤");
        seed_project(&root, 1);
        let steps = [MigrationStep {
            from_version: 1,
            to_version: 1,
            migrate: synthetic_noop_step,
        }];

        let result = migrate_project(&root, &steps, ProjectMetadata::CURRENT_VERSION);

        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("迁移步骤定义不合法"), "实际: {message}");
            }
            other => panic!("期望步骤定义拒绝，实际: {other:?}"),
        }
        assert!(backup_dirs(&root).is_empty(), "定义不合法不应产生备份");
    }

    /// 回滚失败必须显式上报：错误同时包含原始迁移错误、回滚失败说明与人工恢复路径，
    /// 且备份目录被保留（内容完整可供人工恢复）。
    #[test]
    fn migrate_reports_rollback_failure_and_keeps_backup() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("回滚失败");
        seed_project(&root, 1);

        // 让回滚的事务式暂存失败：`save-transaction` 路径被一个文件占住。
        fs::write(
            root.join("next-story-system").join("save-transaction"),
            "占位文件",
        )
        .expect("占用事务目录路径");
        let steps = [MigrationStep {
            from_version: 1,
            to_version: 2,
            migrate: synthetic_step_fails_after_writing,
        }];

        let result = migrate_project(&root, &steps, 2);

        match result {
            Err(ProjectError::WriteError(message)) => {
                assert!(
                    message.contains("迁移失败"),
                    "应含原始迁移错误，实际: {message}"
                );
                assert!(
                    message.contains("回滚失败"),
                    "应含回滚失败说明，实际: {message}"
                );
                assert!(
                    message.contains("备份") && message.contains("人工恢复"),
                    "应给出人工恢复路径，实际: {message}"
                );
            }
            other => panic!("期望合并回滚失败错误，实际: {other:?}"),
        }

        // 备份被保留且三份文件完整。
        let backups = backup_dirs(&root);
        assert_eq!(backups.len(), 1, "回滚失败应保留备份: {backups:?}");
        assert!(backups[0].join("project.json").is_file());
        assert!(backups[0].join("草稿本.json").is_file());
        assert!(backups[0].join("正文本.json").is_file());
    }

    /// 「迁移中途崩溃后再次打开」：回滚进行到一半进程退出（可见元信息已被破坏，
    /// 事务目录留有 `MigrationRollback` 暂存），再次打开应先把回滚事务恢复完成，
    /// 使作品回到一致有效世代，再继续迁移流程。
    #[test]
    fn reopen_after_crash_during_migration_rollback_recovers_consistent_generation() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("崩溃恢复");
        seed_project(&root, 1);
        let paths = ProjectPaths::new(root.clone());

        // 用合法结构化本子替换测试骨架里的占位 `{}`，保证恢复校验可通过对暂存内容。
        let valid_draft = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原草稿"}]}]}}"#;
        let valid_main = r#"{"format":"next-story-tiptap","version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"原正文"}]}]}}"#;
        fs::write(&paths.draft_file, valid_draft).expect("写入有效草稿本");
        fs::write(&paths.main_file, valid_main).expect("写入有效正文本");
        let original_metadata = fs::read(&paths.metadata_file).expect("读取原元信息");
        let original_draft = fs::read(&paths.draft_file).expect("读取原草稿");
        let original_main = fs::read(&paths.main_file).expect("读取原正文");

        // 模拟崩溃现场：可见元信息已被迁移步骤破坏，事务目录留有
        // `MigrationRollback` 用途的 `Committing` 暂存（完整备份内容）。
        fs::write(&paths.metadata_file, "被迁移破坏的内容").expect("破坏可见元信息");
        let tx_dir = paths.system_dir.join("save-transaction");
        fs::create_dir_all(&tx_dir).expect("创建事务目录");
        fs::write(tx_dir.join("草稿本.json"), &original_draft).expect("暂存草稿");
        fs::write(tx_dir.join("正文本.json"), &original_main).expect("暂存正文");
        fs::write(tx_dir.join("project.json"), &original_metadata).expect("暂存元信息");
        fs::write(
            tx_dir.join("manifest.json"),
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-01-01T00:00:00Z",
                "purpose": "migration_rollback",
            })
            .to_string(),
        )
        .expect("写入回滚清单");

        // 再次打开：先完成回滚恢复，再走迁移（v1 无生产步骤 → 拒绝）。
        let result = crate::project::open_existing_project(&root);
        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("不支持的项目结构版本"), "实际: {message}");
            }
            other => panic!("期望版本拒绝，实际: {other:?}"),
        }

        // 作品已恢复到一致有效的 v1 世代，回滚事务目录被清理。
        assert_eq!(
            fs::read(&paths.metadata_file).expect("读取元信息"),
            original_metadata,
            "元信息应恢复为迁移前内容"
        );
        assert_eq!(
            fs::read(&paths.draft_file).expect("读取草稿"),
            original_draft,
            "草稿应恢复为迁移前内容"
        );
        assert_eq!(
            fs::read(&paths.main_file).expect("读取正文"),
            original_main,
            "正文应恢复为迁移前内容"
        );
        assert!(!tx_dir.exists(), "回滚事务目录应已被清理");
    }

    // ========== 版本 2 → 3 迁移（固定双本子 → 内容树） ==========

    /// 生成一段合法格式版本 1 的本子 JSON 字符串。
    fn valid_notebook_json(text: &str) -> String {
        let value = serde_json::json!({
            "format": "next-story-tiptap",
            "version": 1,
            "document": {
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
            }
        });
        serde_json::to_string_pretty(&value).expect("serialize notebook")
    }

    /// 建一个版本 2 固定双本子项目（合法本子内容 + 版本 2 元信息）。
    fn seed_v2_project_with_valid_notebooks(root: &Path, draft: &str, main: &str) {
        fs::create_dir_all(root.join("作品文本")).expect("创建作品文本文件夹");
        fs::create_dir_all(root.join("next-story-system")).expect("创建系统文件夹");
        fs::write(root.join("作品文本").join("草稿本.json"), draft).expect("写入草稿本");
        fs::write(root.join("作品文本").join("正文本.json"), main).expect("写入正文本");
        fs::write(
            root.join("next-story-system").join("project.json"),
            r#"{"name":"迁移作品","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","version":2}"#,
        )
        .expect("写入元信息");
    }

    /// 从打开结果返回的内容树里，按名称读取根级文档正文（迁移后「草稿本」「正文本」
    /// 是普通文档，正文按稳定 ID 存放在 `作品文本/documents/<id>.json`）。
    fn root_doc_body(root: &Path, tree: &ContentTree, name: &str) -> String {
        let id = tree
            .root_children
            .iter()
            .find(|id| tree.nodes[*id].name == name)
            .unwrap_or_else(|| panic!("根级文档不存在: {name}"));
        fs::read_to_string(
            root.join("作品文本")
                .join("documents")
                .join(format!("{id}.json")),
        )
        .expect("读取文档正文")
    }

    #[test]
    fn migrate_v2_to_v3_converts_dual_notebooks_to_two_root_docs() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("迁移作品");
        let draft = valid_notebook_json("草稿内容");
        let main = valid_notebook_json("正文内容");
        seed_v2_project_with_valid_notebooks(&root, &draft, &main);

        let opened = crate::project::open_existing_project(&root).expect("迁移并打开");

        assert_eq!(opened.metadata.version, 3);
        assert_eq!(
            root_doc_body(&root, &opened.tree, "草稿本"),
            draft,
            "草稿文字与格式保留"
        );
        assert_eq!(
            root_doc_body(&root, &opened.tree, "正文本"),
            main,
            "正文文字与格式保留"
        );

        // 旧双本子文件已移除，新布局就位
        assert!(!root.join("作品文本").join("草稿本.json").exists());
        assert!(!root.join("作品文本").join("正文本.json").exists());
        let tree_json =
            fs::read_to_string(root.join("next-story-system").join("content-tree.json"))
                .expect("读取内容树");
        let tree: ContentTree = serde_json::from_str(&tree_json).expect("解析内容树");
        assert_eq!(tree.root_children.len(), 2, "根层两篇普通文档");
        let names: Vec<&str> = tree
            .root_children
            .iter()
            .map(|id| tree.nodes[id].name.as_str())
            .collect();
        assert_eq!(names, vec!["草稿本", "正文本"]);
        for id in &tree.root_children {
            assert!(
                root.join("作品文本")
                    .join("documents")
                    .join(format!("{id}.json"))
                    .is_file(),
                "文档正文文件应存在: {id}"
            );
        }

        // 迁移前备份保留
        assert_eq!(backup_dirs(&root).len(), 1, "迁移应保留备份");
    }

    #[test]
    fn migrate_v2_to_v3_reopens_after_partial_migration_crash() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("部分迁移");
        let draft = valid_notebook_json("草稿内容");
        let main = valid_notebook_json("正文内容");
        seed_v2_project_with_valid_notebooks(&root, &draft, &main);

        // 模拟迁移中途崩溃：正文文件与树元数据已写、版本仍为 2、旧双本子仍在。
        let mut tree = ContentTree::new();
        let draft_id = tree.create_document(None).expect("创建草稿节点");
        tree.rename(&draft_id, "草稿本").expect("重命名草稿");
        let main_id = tree.create_document(None).expect("创建正文节点");
        tree.rename(&main_id, "正文本").expect("重命名正文");
        fs::create_dir_all(root.join("作品文本").join("documents")).expect("创建 documents");
        fs::write(
            root.join("作品文本")
                .join("documents")
                .join(format!("{draft_id}.json")),
            &draft,
        )
        .expect("写入草稿正文");
        fs::write(
            root.join("作品文本")
                .join("documents")
                .join(format!("{main_id}.json")),
            &main,
        )
        .expect("写入正文本正文");
        fs::write(
            root.join("next-story-system").join("content-tree.json"),
            serde_json::to_string(&tree).expect("序列化内容树"),
        )
        .expect("写入内容树");

        // 再次打开：版本仍是 2，重跑迁移（幂等），最终一致有效。
        let opened = crate::project::open_existing_project(&root).expect("崩溃后再次打开");
        assert_eq!(opened.metadata.version, 3);
        assert_eq!(root_doc_body(&root, &opened.tree, "草稿本"), draft);
        assert_eq!(root_doc_body(&root, &opened.tree, "正文本"), main);
        assert!(!root.join("作品文本").join("草稿本.json").exists());
        assert!(!root.join("作品文本").join("正文本.json").exists());
    }

    #[test]
    fn open_v3_project_with_leftover_old_duals_ignores_them() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("残留旧本子");
        let draft = valid_notebook_json("草稿内容");
        let main = valid_notebook_json("正文内容");
        seed_v2_project_with_valid_notebooks(&root, &draft, &main);

        // 先完整迁移，再模拟「版本 3 已提交但旧文件移除前崩溃」：旧双本子残留。
        crate::project::open_existing_project(&root).expect("首次迁移");
        fs::write(root.join("作品文本").join("草稿本.json"), &draft).expect("残留草稿本");
        fs::write(root.join("作品文本").join("正文本.json"), &main).expect("残留正文本");

        let opened = crate::project::open_existing_project(&root).expect("残留旧文件时打开");
        assert_eq!(opened.metadata.version, 3);
        assert_eq!(root_doc_body(&root, &opened.tree, "草稿本"), draft);
        assert_eq!(root_doc_body(&root, &opened.tree, "正文本"), main);
    }

    #[test]
    fn v2_project_with_interrupted_legacy_save_recovers_before_migration() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("旧版中断保存");
        let old_draft = valid_notebook_json("旧草稿");
        let old_main = valid_notebook_json("旧正文");
        seed_v2_project_with_valid_notebooks(&root, &old_draft, &old_main);

        // 模拟旧版本写下的中断保存事务：清单无 files 字段（固定三文件），
        // 暂存的是新世代内容，元信息 updated_at 与清单目标一致。
        let new_draft = valid_notebook_json("新草稿");
        let new_main = valid_notebook_json("新正文");
        let tx_dir = root.join("next-story-system").join("save-transaction");
        fs::create_dir_all(&tx_dir).expect("创建事务目录");
        fs::write(tx_dir.join("草稿本.json"), &new_draft).expect("暂存草稿");
        fs::write(tx_dir.join("正文本.json"), &new_main).expect("暂存正文");
        fs::write(
            tx_dir.join("project.json"),
            r#"{"name":"旧版中断保存","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-02-01T00:00:00Z","version":2}"#,
        )
        .expect("暂存元信息");
        fs::write(
            tx_dir.join("manifest.json"),
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-02-01T00:00:00Z",
                "transaction_id": "legacy-tx",
                "purpose": "save",
            })
            .to_string(),
        )
        .expect("写入旧清单");

        // 打开：先按旧事务恢复（新世代），再迁移，打开返回恢复后的内容。
        let opened = crate::project::open_existing_project(&root).expect("恢复旧事务后迁移打开");
        assert_eq!(
            root_doc_body(&root, &opened.tree, "草稿本"),
            new_draft,
            "应先恢复旧事务的新草稿"
        );
        assert_eq!(
            root_doc_body(&root, &opened.tree, "正文本"),
            new_main,
            "应先恢复旧事务的新正文"
        );
        assert_eq!(opened.metadata.version, 3);
        assert!(!tx_dir.exists(), "恢复后事务目录应被清理");
    }

    // ========== 迁移提交中断的前滚恢复（删除动作可恢复） ==========

    /// 构造一个「迁移提交进行到一半」的现场：事务目录留有 `Migration` 用途的
    /// `Committing` 清单（含两个删除旧双本子的动作），暂存内容与
    /// `migrate_v2_to_v3` 的产物一致。返回事务目录路径。
    fn seed_interrupted_migration_commit(
        root: &Path,
        draft: &str,
        main: &str,
    ) -> (PathBuf, String, String) {
        let paths = ProjectPaths::new(root.to_path_buf());
        let draft_id = "node-mig-draft".to_string();
        let main_id = "node-mig-main".to_string();

        let mut tree = ContentTree::new();
        tree.nodes.insert(
            draft_id.clone(),
            ContentTreeNode {
                id: draft_id.clone(),
                name: "草稿本".into(),
                kind: NodeKind::Document,
                children: Vec::new(),
            },
        );
        tree.nodes.insert(
            main_id.clone(),
            ContentTreeNode {
                id: main_id.clone(),
                name: "正文本".into(),
                kind: NodeKind::Document,
                children: Vec::new(),
            },
        );
        tree.root_children = vec![draft_id.clone(), main_id.clone()];
        let tree_json = serde_json::to_string_pretty(&tree).expect("序列化内容树");

        let tx_dir = paths.system_dir.join("save-transaction");
        fs::create_dir_all(&tx_dir).expect("创建事务目录");
        fs::create_dir_all(&paths.documents_dir).expect("创建 documents 目录");
        fs::write(tx_dir.join(format!("doc-{draft_id}.json")), draft).expect("暂存草稿正文");
        fs::write(tx_dir.join(format!("doc-{main_id}.json")), main).expect("暂存正文正文");
        fs::write(tx_dir.join("content-tree.json"), &tree_json).expect("暂存内容树");
        fs::write(
            tx_dir.join("project.json"),
            r#"{"name":"迁移作品","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-03-01T00:00:00Z","version":3}"#,
        )
        .expect("暂存元信息");
        fs::write(
            tx_dir.join("manifest.json"),
            serde_json::json!({
                "manifest_version": 1,
                "phase": "Committing",
                "target_updated_at": "2026-03-01T00:00:00Z",
                "transaction_id": "migration-tx",
                "purpose": "migration",
                "files": [
                    { "staged": format!("doc-{draft_id}.json"), "target": format!("作品文本/documents/{draft_id}.json"), "action": "replace" },
                    { "staged": format!("doc-{main_id}.json"), "target": format!("作品文本/documents/{main_id}.json"), "action": "replace" },
                    { "staged": "content-tree.json", "target": "next-story-system/content-tree.json", "action": "replace" },
                    { "staged": "", "target": "作品文本/草稿本.json", "action": "delete" },
                    { "staged": "", "target": "作品文本/正文本.json", "action": "delete" },
                    { "staged": "project.json", "target": "next-story-system/project.json", "action": "replace" }
                ],
            })
            .to_string(),
        )
        .expect("写入迁移清单");

        (tx_dir, draft_id, main_id)
    }

    /// 迁移提交中途崩溃（至少一次替换与一次删除已落盘）：再次打开时从事务清单
    /// 前滚剩余动作（含删除旧双本子），最终到达一致有效的版本 3 世代。
    #[test]
    fn reopen_after_crash_during_migration_commit_rolls_forward_from_manifest() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("迁移提交崩溃");
        let draft = valid_notebook_json("草稿内容");
        let main = valid_notebook_json("正文内容");
        seed_v2_project_with_valid_notebooks(&root, &draft, &main);
        let paths = ProjectPaths::new(root.clone());

        let (tx_dir, draft_id, main_id) = seed_interrupted_migration_commit(&root, &draft, &main);

        // 模拟崩溃现场：草稿正文已替换、草稿本已删除，其余动作未执行。
        fs::write(paths.document_file(&draft_id), &draft).expect("替换可见草稿正文");
        fs::remove_file(&paths.draft_file).expect("删除可见草稿本");

        // 再次打开：前滚剩余动作，到达一致有效的版本 3。
        let opened = crate::project::open_existing_project(&root).expect("崩溃后前滚打开");
        assert_eq!(opened.metadata.version, 3);
        assert_eq!(root_doc_body(&root, &opened.tree, "草稿本"), draft);
        assert_eq!(root_doc_body(&root, &opened.tree, "正文本"), main);
        assert!(!paths.draft_file.exists(), "旧草稿本应已被删除");
        assert!(!paths.main_file.exists(), "旧正文本应已被删除");
        assert!(paths.document_file(&draft_id).is_file(), "新草稿正文应就位");
        assert!(paths.document_file(&main_id).is_file(), "新正文正文应就位");
        assert!(!tx_dir.exists(), "前滚后事务目录应被清理");
    }

    /// 迁移提交在「所有替换与删除都完成、仅剩元信息完成标记」时崩溃：再次打开
    /// 前滚元信息即可完成迁移，旧双本子不会残留。
    #[test]
    fn reopen_after_crash_before_metadata_during_migration_commit_completes() {
        let temp = TempDir::new().expect("创建临时目录");
        let root = temp.path().join("迁移提交差元信息");
        let draft = valid_notebook_json("草稿内容");
        let main = valid_notebook_json("正文内容");
        seed_v2_project_with_valid_notebooks(&root, &draft, &main);
        let paths = ProjectPaths::new(root.clone());

        let (tx_dir, draft_id, main_id) = seed_interrupted_migration_commit(&root, &draft, &main);

        // 模拟崩溃现场：所有替换与删除都已落盘，只有元信息仍是版本 2。
        fs::write(paths.document_file(&draft_id), &draft).expect("替换可见草稿正文");
        fs::write(paths.document_file(&main_id), &main).expect("替换可见正文正文");
        fs::write(
            paths.content_tree_file,
            fs::read(tx_dir.join("content-tree.json")).expect("读取暂存内容树"),
        )
        .expect("替换可见内容树");
        fs::remove_file(&paths.draft_file).expect("删除可见草稿本");
        fs::remove_file(&paths.main_file).expect("删除可见正文本");

        // 再次打开：前滚元信息完成迁移。
        let opened = crate::project::open_existing_project(&root).expect("前滚元信息完成迁移");
        assert_eq!(opened.metadata.version, 3);
        assert_eq!(root_doc_body(&root, &opened.tree, "草稿本"), draft);
        assert_eq!(root_doc_body(&root, &opened.tree, "正文本"), main);
        assert!(!paths.draft_file.exists());
        assert!(!paths.main_file.exists());
        assert!(!tx_dir.exists(), "前滚后事务目录应被清理");
    }
}
