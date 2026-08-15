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
//! 生产环境当前注册零个迁移步骤：版本 2 就是最新版，团队有意不迁移旧 v1
//! `.txt` 项目，因此旧版本依然会被拒绝，与迁移框架出现前的行为一致。

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::operations::{
    read_bounded_string, recover_migration_rollback_transaction, transactional_restore,
    MAX_METADATA_BYTES, MAX_NOTEBOOK_BYTES,
};
use super::{ProjectError, ProjectMetadata, ProjectPaths};

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

/// 生产环境迁移注册表：当前版本 2 即最新，没有任何迁移步骤。
pub(crate) const PRODUCTION_MIGRATIONS: &[MigrationStep] = &[];

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

    let metadata_json =
        read_bounded_string(&backup_dir.join("project.json"), MAX_METADATA_BYTES)
            .map_err(|e| ProjectError::WriteError(format!("回滚失败：无法读取备份 project.json: {e}")))?;
    let draft_json = read_bounded_string(&backup_dir.join("草稿本.json"), MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::WriteError(format!("回滚失败：无法读取备份 草稿本.json: {e}")))?;
    let main_json = read_bounded_string(&backup_dir.join("正文本.json"), MAX_NOTEBOOK_BYTES)
        .map_err(|e| ProjectError::WriteError(format!("回滚失败：无法读取备份 正文本.json: {e}")))?;

    transactional_restore(&paths, &metadata_json, &draft_json, &main_json)?;

    // 恢复成功才删除备份目录；失败则保留备份便于人工处理。
    let _ = fs::remove_dir_all(backup_dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
        seed_project(&root, 3);
        let before = metadata_bytes(&root);

        let result = migrate_project(
            &root,
            PRODUCTION_MIGRATIONS,
            ProjectMetadata::CURRENT_VERSION,
        );

        match result {
            Err(ProjectError::InvalidStructure(message)) => {
                assert!(message.contains("不支持的项目结构版本"), "实际: {message}");
                assert!(message.contains('3'), "实际: {message}");
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

        let result = migrate_project(&root, &steps, ProjectMetadata::CURRENT_VERSION);

        assert_eq!(
            result.expect("合成迁移成功"),
            ProjectMetadata::CURRENT_VERSION
        );
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

        let result = migrate_project(&root, &steps, ProjectMetadata::CURRENT_VERSION);

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

        let result = migrate_project(&root, &steps, ProjectMetadata::CURRENT_VERSION);

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

        let result = migrate_project(&root, &steps, ProjectMetadata::CURRENT_VERSION);

        match result {
            Err(ProjectError::WriteError(message)) => {
                assert!(message.contains("迁移失败"), "应含原始迁移错误，实际: {message}");
                assert!(message.contains("回滚失败"), "应含回滚失败说明，实际: {message}");
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
}
