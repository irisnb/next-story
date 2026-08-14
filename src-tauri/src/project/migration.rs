//! 项目版本迁移框架。
//!
//! 打开项目时若结构版本不是当前版本，会先走迁移框架：
//! - 等于当前版本：直接通过；
//! - 大于当前版本（未来版本）：拒绝（「不支持的项目结构版本」）；
//! - 小于当前版本：按注册的迁移步骤 `from_version`→`to_version` 逐级升级，
//!   执行前先备份，任一步骤失败即回滚备份并返回错误。
//!
//! 生产环境当前注册零个迁移步骤：版本 2 就是最新版，团队有意不迁移旧 v1
//! `.txt` 项目，因此旧版本依然会被拒绝，与迁移框架出现前的行为一致。

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use super::operations::{read_bounded_string, MAX_METADATA_BYTES};
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
            rollback_backup(&backup_dir, project_root);
            return Err(error);
        }

        let after_version = match read_project_version(project_root) {
            Ok(after) => after,
            Err(error) => {
                rollback_backup(&backup_dir, project_root);
                return Err(error);
            }
        };
        if after_version != step.to_version {
            rollback_backup(&backup_dir, project_root);
            return Err(ProjectError::InvalidStructure(format!(
                "迁移步骤校验失败: 从 {} 迁移后版本为 {}，期望 {}",
                step.from_version, after_version, step.to_version
            )));
        }
    }

    Ok(target_version)
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

/// 用备份恢复被改动的文件；恢复成功才删除备份目录，恢复失败则保留目录便于人工处理。
fn rollback_backup(backup_dir: &Path, project_root: &Path) {
    let paths = ProjectPaths::new(project_root.to_path_buf());

    let restored = fs::copy(backup_dir.join("project.json"), &paths.metadata_file).is_ok()
        && fs::copy(backup_dir.join("草稿本.json"), &paths.draft_file).is_ok()
        && fs::copy(backup_dir.join("正文本.json"), &paths.main_file).is_ok();

    if restored {
        let _ = fs::remove_dir_all(backup_dir);
    }
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
}
