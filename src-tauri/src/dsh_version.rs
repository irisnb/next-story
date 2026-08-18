//! DSH 版本目录与 DSH_HOME 隔离。
//!
//! 布局：`<root>/versions/<version>/`（安装目录）、`<root>/homes/<version>/`（独立 DSH_HOME）、
//! `<root>/current.json`（当前版本指针）。升级时新版本独立安装 + 独立 DSH_HOME + 回归验证，
//! 通过后才切换指针；旧版本保留用于回滚。回滚 = 把指针切回已验证版本，不动用户作品文件。

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// 当前锁定的 DSH 精确版本，与 `sidecar/package.json` 一致。
pub const LOCKED_DSH_VERSION: &str = "0.1.0-rc.7";

/// 当前版本指针文件名。
const CURRENT_FILE: &str = "current.json";

/// `current.json` 的内容：指向当前激活的 DSH 版本。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CurrentPointer {
    pub version: String,
}

/// DSH 版本目录布局。
#[derive(Debug, Clone)]
pub struct DshVersionLayout {
    root: PathBuf,
}

impl DshVersionLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn versions_dir(&self) -> PathBuf {
        self.root.join("versions")
    }

    pub fn homes_dir(&self) -> PathBuf {
        self.root.join("homes")
    }

    fn current_file(&self) -> PathBuf {
        self.root.join(CURRENT_FILE)
    }

    /// 指定版本的安装目录（`versions/<version>`）。
    pub fn version_dir(&self, version: &str) -> PathBuf {
        self.versions_dir().join(version)
    }

    /// 指定版本的独立 DSH_HOME（`homes/<version>`）。
    pub fn home_dir(&self, version: &str) -> PathBuf {
        self.homes_dir().join(version)
    }

    /// 读当前激活版本；指针缺失或损坏时回退到锁定版本。
    pub fn current_version(&self) -> String {
        fs::read_to_string(self.current_file())
            .ok()
            .and_then(|raw| serde_json::from_str::<CurrentPointer>(&raw).ok())
            .map(|pointer| pointer.version)
            .filter(|version| !version.trim().is_empty())
            .unwrap_or_else(|| LOCKED_DSH_VERSION.to_string())
    }

    /// 当前激活版本的 DSH_HOME（`homes/<current_version>`）。
    ///
    /// 指针缺失时回退到锁定版本；目录本身可能尚未创建，由调用方按需 `create_dir_all`。
    pub fn current_home(&self) -> PathBuf {
        self.home_dir(&self.current_version())
    }

    /// 激活某版本：原子写入 `current.json` 指针。
    ///
    /// 调用方应先确保该版本已安装且通过验证；本函数只负责切换指针，不做校验，
    /// 也绝不删除旧版本目录或任何用户文件。
    pub fn activate(&self, version: &str) -> std::io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let pointer = CurrentPointer {
            version: version.to_string(),
        };
        let json = serde_json::to_string_pretty(&pointer)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        let mut temp = tempfile::NamedTempFile::new_in(&self.root)?;
        temp.write_all(json.as_bytes())?;
        temp.flush()?;
        temp.persist(self.current_file())
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_falls_back_to_locked_when_pointer_missing() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let layout = DshVersionLayout::new(temp.path());
        assert_eq!(layout.current_version(), LOCKED_DSH_VERSION);
    }

    #[test]
    fn current_version_falls_back_when_pointer_is_corrupt() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        fs::create_dir_all(temp.path()).unwrap();
        fs::write(temp.path().join(CURRENT_FILE), "not json").unwrap();
        let layout = DshVersionLayout::new(temp.path());
        assert_eq!(layout.current_version(), LOCKED_DSH_VERSION);
    }

    #[test]
    fn activate_writes_pointer_and_current_version_reads_it() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let layout = DshVersionLayout::new(temp.path());
        layout.activate("0.2.0-rc.1").expect("activate");
        assert_eq!(layout.current_version(), "0.2.0-rc.1");
    }

    #[test]
    fn version_and_home_dirs_are_per_version() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let layout = DshVersionLayout::new(temp.path());
        assert_eq!(
            layout.version_dir("a"),
            temp.path().join("versions").join("a")
        );
        assert_eq!(layout.home_dir("b"), temp.path().join("homes").join("b"));
        assert_ne!(layout.version_dir("a"), layout.version_dir("b"));
    }

    #[test]
    fn activate_is_idempotent() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let layout = DshVersionLayout::new(temp.path());
        layout.activate("0.1.0-rc.7").expect("first");
        layout.activate("0.1.0-rc.7").expect("second");
        assert_eq!(layout.current_version(), "0.1.0-rc.7");
    }
}
