//! 最近作品列表（change: batch-improvement-candidates 任务组 3④/⑤）。
//!
//! 欢迎页「最近作品」的应用级存储：`recent-works.json` 放在应用本地数据目录
//! （与 llm-config.json 同目录），沿用其 load/save 命令形态：
//! - 读取失败开放：文件缺失、损坏（JSON 非法）或超过读取上限，一律视为空列表，
//!   不 panic、不向用户报错，绝不影响启动；
//! - 展示前做有效性检查：路径必须是仍存在的有效作品（判据：该目录下存在
//!   `next-story-system` 子目录，与 `project::ProjectPaths` 的布局一致），
//!   失效条目不返回，并顺手从存储移除（自愈回写为尽力而为，失败不影响读取）；
//! - 记录：按路径去重（重开移至最前）、至多保留 [`MAX_RECENT_WORKS`] 条、
//!   临时文件原子替换写回（同 llm-config 的落盘形态）。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 存储文件名（位于应用本地数据目录，与 llm-config.json 同目录）。
const RECENT_WORKS_FILE_NAME: &str = "recent-works.json";
/// 读取大小上限：防止损坏或被替换为巨型文件时无界分配内存（同 llm-config 思路）。
const MAX_RECENT_WORKS_BYTES: u64 = 64 * 1024;
/// 有效作品判据：作品根目录下的系统子目录（由作品创建逻辑产生）。
const WORK_SYSTEM_DIR_NAME: &str = "next-story-system";
/// 最近作品保留上限。
pub const MAX_RECENT_WORKS: usize = 8;

/// 单条最近作品记录（serde 序列化为 snake_case，与前端 `RecentWorkEntry` 对齐）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentWorkEntry {
    /// 作品名称（记录成功打开/新建时点的名称）。
    pub name: String,
    /// 作品根目录路径（去重键）。
    pub path: String,
    /// 最后打开时间（chrono 序列化为 RFC3339 字符串）。
    pub last_opened_at: DateTime<Utc>,
}

/// 最近作品存储写入错误（读取路径失败开放，不产生该错误）。
#[derive(Debug)]
pub struct RecentWorksError(String);

impl std::fmt::Display for RecentWorksError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "最近作品存储写入失败: {}", self.0)
    }
}

impl std::error::Error for RecentWorksError {}

/// 写入互斥：串行化并发「记录」，避免两个「读旧 → 去重裁剪 → 写回」交错丢条目。
static RECENT_WORKS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 计算最近作品存储文件路径（与 `llm_config::config_path_in` 同款）。
pub fn recent_works_path_in(base_dir: &Path) -> PathBuf {
    base_dir.join(RECENT_WORKS_FILE_NAME)
}

/// 路径是否仍是有效作品：目录存在且其下有 `next-story-system` 子目录。
fn is_valid_work_path(path: &str) -> bool {
    Path::new(path).join(WORK_SYSTEM_DIR_NAME).is_dir()
}

/// 读取存储条目（失败开放）：文件缺失、损坏、超读取上限一律返回空列表。
fn read_stored_entries(base_dir: &Path) -> Vec<RecentWorkEntry> {
    let path = recent_works_path_in(base_dir);
    if !path.is_file() {
        return Vec::new();
    }
    match fs::metadata(&path) {
        Ok(meta) if meta.len() <= MAX_RECENT_WORKS_BYTES => {}
        _ => return Vec::new(),
    }
    let json = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&json).unwrap_or_default()
}

/// 原子写回存储条目（临时文件 + persist，同 llm-config 的落盘形态）。
fn write_stored_entries(
    base_dir: &Path,
    entries: &[RecentWorkEntry],
) -> Result<(), RecentWorksError> {
    fs::create_dir_all(base_dir).map_err(|e| RecentWorksError(e.to_string()))?;
    let json =
        serde_json::to_string_pretty(entries).map_err(|e| RecentWorksError(e.to_string()))?;
    let mut temp_file =
        tempfile::NamedTempFile::new_in(base_dir).map_err(|e| RecentWorksError(e.to_string()))?;
    temp_file
        .write_all(json.as_bytes())
        .map_err(|e| RecentWorksError(e.to_string()))?;
    temp_file
        .flush()
        .map_err(|e| RecentWorksError(e.to_string()))?;
    temp_file
        .persist(recent_works_path_in(base_dir))
        .map(|_| ())
        .map_err(|e| RecentWorksError(e.error.to_string()))
}

/// 读取最近作品列表（失败开放，绝不报错）：只返回仍有效的条目；发现失效条目时
/// 顺手从存储移除（自愈回写为尽力而为，失败只忽略，不影响返回结果）。
pub fn load_recent_works(base_dir: &Path) -> Vec<RecentWorkEntry> {
    let stored = read_stored_entries(base_dir);
    let total = stored.len();
    let valid: Vec<RecentWorkEntry> = stored
        .into_iter()
        .filter(|entry| is_valid_work_path(&entry.path))
        .collect();
    if valid.len() != total {
        // 自愈：失效条目顺手移除；回写失败只忽略（下次记录会整体重写）。
        let _ = write_stored_entries(base_dir, &valid);
    }
    valid
}

/// 记录一次成功的打开/新建：按路径去重（重开移至最前）、顺手清理失效条目、
/// 至多保留 [`MAX_RECENT_WORKS`] 条、原子写回。调用方只在作品成功就绪后调用。
pub fn record_recent_work(base_dir: &Path, name: &str, path: &str) -> Result<(), RecentWorksError> {
    // 并发记录串行化：整个「读旧 → 去重裁剪 → 写回」持锁。
    let _serialize = RECENT_WORKS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut entries: Vec<RecentWorkEntry> = read_stored_entries(base_dir)
        .into_iter()
        .filter(|entry| is_valid_work_path(&entry.path))
        .filter(|entry| entry.path != path)
        .collect();
    entries.insert(
        0,
        RecentWorkEntry {
            name: name.to_string(),
            path: path.to_string(),
            last_opened_at: Utc::now(),
        },
    );
    entries.truncate(MAX_RECENT_WORKS);
    write_stored_entries(base_dir, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个作品目录（`valid` 控制是否含系统子目录），返回其路径字符串。
    fn make_work(root: &Path, name: &str, valid: bool) -> String {
        let dir = root.join(name);
        fs::create_dir_all(&dir).expect("创建作品目录");
        if valid {
            fs::create_dir_all(dir.join(WORK_SYSTEM_DIR_NAME)).expect("创建系统子目录");
        }
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn record_dedupes_by_path_and_moves_entry_to_front() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let work_a = make_work(base.path(), "作品甲", true);
        let work_b = make_work(base.path(), "作品乙", true);

        record_recent_work(base.path(), "作品甲", &work_a).expect("记录甲");
        record_recent_work(base.path(), "作品乙", &work_b).expect("记录乙");
        // 重开甲：同名路径去重并移到最前，名称更新为记录时点的新名称。
        record_recent_work(base.path(), "作品甲（改名）", &work_a).expect("重开甲");

        let entries = load_recent_works(base.path());
        assert_eq!(entries.len(), 2, "按路径去重后只保留两条");
        assert_eq!(entries[0].path, work_a, "重开的作品移至最前");
        assert_eq!(entries[0].name, "作品甲（改名）", "重开时更新名称");
        assert_eq!(entries[1].path, work_b);
    }

    #[test]
    fn record_trims_list_to_eight_entries() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        for index in 0..(MAX_RECENT_WORKS + 2) {
            let path = make_work(base.path(), &format!("作品{index}"), true);
            record_recent_work(base.path(), &format!("作品{index}"), &path).expect("记录");
        }

        let entries = load_recent_works(base.path());
        assert_eq!(entries.len(), MAX_RECENT_WORKS, "至多保留 8 条");
        // 最新的在最前，最早的两条被裁掉。
        assert_eq!(
            entries[0].name,
            format!("作品{}", MAX_RECENT_WORKS + 1),
            "最新记录在最前"
        );
        assert_eq!(
            entries.last().expect("非空").name,
            "作品2",
            "最早两条被裁剪"
        );
    }

    #[test]
    fn corrupted_storage_fails_open_as_empty_list() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        fs::write(
            recent_works_path_in(base.path()),
            "{ \"name\": \"残缺 JSON".as_bytes(),
        )
        .expect("写入损坏内容");

        let entries = load_recent_works(base.path());
        assert!(
            entries.is_empty(),
            "损坏存储失败开放为空列表，不 panic 不报错"
        );
    }

    #[test]
    fn missing_storage_fails_open_as_empty_list_without_creating_file() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        assert!(
            load_recent_works(base.path()).is_empty(),
            "文件缺失视为空列表"
        );
        assert!(
            !recent_works_path_in(base.path()).exists(),
            "纯读取不创建存储文件"
        );
    }

    #[test]
    fn load_drops_invalid_entries_and_heals_storage() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let valid = make_work(base.path(), "有效作品", true);
        let missing = base
            .path()
            .join("被删掉的作品")
            .to_string_lossy()
            .to_string();
        let not_work = make_work(base.path(), "普通文件夹", false);

        // 直接写入原始存储：一条有效、一条路径不存在、一条无系统子目录。
        let raw = vec![
            RecentWorkEntry {
                name: "有效".to_string(),
                path: valid.clone(),
                last_opened_at: Utc::now(),
            },
            RecentWorkEntry {
                name: "路径没了".to_string(),
                path: missing,
                last_opened_at: Utc::now(),
            },
            RecentWorkEntry {
                name: "不是作品".to_string(),
                path: not_work,
                last_opened_at: Utc::now(),
            },
        ];
        write_stored_entries(base.path(), &raw).expect("写入原始存储");

        let entries = load_recent_works(base.path());
        assert_eq!(entries.len(), 1, "失效条目不返回");
        assert_eq!(entries[0].path, valid);

        // 自愈：失效条目已从存储移除，存储仍是合法 JSON 且只含有效条目。
        let healed_json = fs::read_to_string(recent_works_path_in(base.path())).expect("读回存储");
        let healed: Vec<RecentWorkEntry> =
            serde_json::from_str(&healed_json).expect("存储仍是合法 JSON");
        assert_eq!(healed.len(), 1, "自愈后存储只保留有效条目");
        assert_eq!(healed[0].path, valid);
    }

    #[test]
    fn record_roundtrips_through_load() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let work = make_work(base.path(), "作品", true);
        record_recent_work(base.path(), "作品", &work).expect("记录");

        let entries = load_recent_works(base.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "作品");
        assert_eq!(entries[0].path, work);
    }
}
