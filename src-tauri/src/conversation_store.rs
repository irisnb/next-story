//! 讨论档案存储模块（change: add-conversation-persistence-and-isolation 任务 2.1–2.5）。
//!
//! 职责：把每个讨论的档案保存为作品文件夹内
//! `next-story-system/conversations/<conversation_id>.json` 的独立版本化 JSON 文件，
//! 与作品正文分开存放。提供 list / save / delete 三个前端命令（命令层在 `lib.rs`），
//! 有界读取 + JSON 校验，损坏/超限档案跳过并如实提示，保存复用
//! `write_file_atomically`（tempfile + persist），不重复造事务框架。
//!
//! 安全边界（任务 2.5）：本模块的 save / delete 是**受控应用服务**在用户操作驱动下
//! 调用的前端命令，绝不注册为 AI 可调用工具、不进入 `capability_gateway` 授权面。
//! AI 路径继续零写回作品文档与讨论档案。此边界由 `capability_gateway` 的锚点测试
//! `conversation_store_commands_are_not_ai_callable_tools` 固化。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::project::{ProjectError, ProjectPaths};

/// 讨论档案文件的有界读取上限（1 MiB）。损坏或超限的档案在列表中跳过。
pub const MAX_CONVERSATION_BYTES: u64 = 1024 * 1024;
/// 讨论档案当前格式版本。为未来格式演进预留迁移位。
pub const CONVERSATION_VERSION: u32 = 1;
/// 列表条目标题截断长度（按字符数）。
const TITLE_MAX_CHARS: usize = 40;
/// 讨论档案目录名（位于 `next-story-system/` 下，系统所有，不放进用户正文）。
const CONVERSATIONS_DIR: &str = "conversations";

// ========== 数据结构（serde 契约，snake_case 与前端约定一致） ==========

/// 单条讨论轮次：角色（user/assistant）、文本与生成终态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub role: String,
    pub text: String,
    /// 生成终态：`pending` / `success` / `failed` / `cancelled` / `interrupted`。
    pub status: String,
}

/// 首轮材料来源：入口类型、直接提问的问题（召唤时为空）与可选冻结选区快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FirstRoundMaterial {
    /// 入口类型：`direct_question` / `summon`。
    pub kind: String,
    pub question: String,
    pub selection_text: Option<String>,
}

/// 一份完整的讨论档案。为阶段 5/6 预留 `materials`/`tool_events` 扩展位，当前不实填。
/// 多窗口快车道（任务 9.1）新增两个可选字段：自定义标题 `title` 与置顶标记 `pinned`，
/// 均带 `#[serde(default)]`，缺失时按「未重命名、未置顶」处理，不视为损坏、不提升版本号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationRecord {
    pub version: u32,
    pub conversation_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub focus_document_id: Option<String>,
    pub focus_document_title: Option<String>,
    pub first_round_material: FirstRoundMaterial,
    pub turns: Vec<ConversationTurn>,
    /// 可选自定义标题：`None` 表示未重命名，列表回退到由首轮材料派生的标题。
    #[serde(default)]
    pub title: Option<String>,
    /// 置顶标记：缺失或 `false` 表示未置顶。
    #[serde(default)]
    pub pinned: bool,
}

/// 会话列表条目：除列表展示所需的身份 / 标题 / 时间 / 终态外，还携带重开所需的
/// 完整轮次与首轮材料（本车道只有 list/save/delete 三个命令，无单独「读取一条」
/// 命令，故列表必须一次带回重开所需全部内容）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub conversation_id: String,
    /// 列表显示标题：用户自定义标题优先，否则回退到派生标题。
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_status: Option<String>,
    pub focus_document_id: Option<String>,
    pub focus_document_title: Option<String>,
    pub first_round_material: FirstRoundMaterial,
    pub turns: Vec<ConversationTurn>,
    /// 用户自定义标题原值：`None` 表示未重命名，前端据此区分「已重命名」与「派生标题」。
    pub custom_title: Option<String>,
    /// 置顶标记：`false` 表示未置顶。
    pub pinned: bool,
}

/// 会话列表结果：正常条目 + 被跳过（损坏/超限等）的可见提示。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ListResult {
    pub conversations: Vec<ConversationSummary>,
    pub skipped: Vec<String>,
}

// ========== 错误契约（稳定中文信息，不含路径细节泄露） ==========

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationStoreError {
    InvalidConversationId(String),
    UnsupportedVersion(String),
    InvalidRecord(String),
    ReadError(String),
    WriteError(String),
    NotFound(String),
    AlreadyDeleted(String),
}

impl std::fmt::Display for ConversationStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConversationStoreError::InvalidConversationId(msg) => {
                write!(f, "讨论标识无效: {msg}")
            }
            ConversationStoreError::UnsupportedVersion(v) => {
                write!(f, "不支持的讨论档案版本: {v}")
            }
            ConversationStoreError::InvalidRecord(msg) => write!(f, "讨论记录无效: {msg}"),
            ConversationStoreError::ReadError(msg) => write!(f, "读取讨论档案失败: {msg}"),
            ConversationStoreError::WriteError(msg) => write!(f, "保存讨论档案失败: {msg}"),
            ConversationStoreError::NotFound(msg) => write!(f, "讨论不存在: {msg}"),
            ConversationStoreError::AlreadyDeleted(msg) => {
                write!(f, "讨论已删除，无法保存: {msg}")
            }
        }
    }
}

impl std::error::Error for ConversationStoreError {}

// ========== save/delete 串行化与删除墓碑 ==========

/// save / delete 的进程内互斥 + 删除墓碑（二合一，风格同 llm_config 的 `CONFIG_SAVE_LOCK`）：
/// - save 与 delete 全程持锁，保证同一讨论的 save / delete 不交错；
/// - 已删除档案的文件路径记入墓碑（键含作品根，测试各自 TempDir 互不干扰）；
/// - 删除后迟到的 save 命中墓碑被拒绝，不复活已删除的档案文件。
static CONVERSATION_STORE_LOCK: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// 服务端盖时间戳：save 落盘时用当前 UTC 覆盖 updated_at（固定毫秒精度的 RFC3339，
/// 保证同偏移下字典序即时间序），created_at 由调用方保留原值。
fn current_utc_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
}

// ========== 路径 ==========

fn conversations_dir(root: &Path) -> PathBuf {
    ProjectPaths::new(root.to_path_buf())
        .system_dir
        .join(CONVERSATIONS_DIR)
}

fn conversation_file(root: &Path, id: &str) -> PathBuf {
    conversations_dir(root).join(format!("{id}.json"))
}

// ========== 校验 ==========

/// 校验讨论标识是安全的文件名分量：非空、非 `.`/`..`、不含路径分隔符、
/// 冒号（Windows 非法文件名 + 消息身份前缀分隔符）与控制字符。
fn validate_conversation_id(id: &str) -> Result<(), ConversationStoreError> {
    if id.is_empty() {
        return Err(ConversationStoreError::InvalidConversationId(
            "不能为空".to_string(),
        ));
    }
    if id == "." || id == ".." {
        return Err(ConversationStoreError::InvalidConversationId(
            "标识不能是 . 或 ..".to_string(),
        ));
    }
    if id.chars()
        .any(|c| c == '/' || c == '\\' || c == ':' || c == '\0' || c.is_control())
    {
        return Err(ConversationStoreError::InvalidConversationId(
            "含非法字符".to_string(),
        ));
    }
    Ok(())
}

/// 单文件读取失败分类：列表据此区分「超限」与「损坏/不可读」给出不同提示。
enum ReadFileFailure {
    TooLarge,
    Corrupt,
    Io(String),
}

/// 有界读取 + JSON 解析 + 版本校验。任何失败都归类为可跳过的读取失败，
/// 绝不让单个损坏档案拖垮整个列表。
fn read_record_file(path: &Path) -> Result<ConversationRecord, ReadFileFailure> {
    let content = crate::project::read_bounded_string(path, MAX_CONVERSATION_BYTES).map_err(
        |e| match e {
            ProjectError::ContentTooLarge(_) => ReadFileFailure::TooLarge,
            ProjectError::ReadError(msg) => ReadFileFailure::Io(msg),
            other => ReadFileFailure::Io(other.to_string()),
        },
    )?;
    let record: ConversationRecord =
        serde_json::from_str(&content).map_err(|_| ReadFileFailure::Corrupt)?;
    if record.version != CONVERSATION_VERSION {
        return Err(ReadFileFailure::Corrupt);
    }
    Ok(record)
}

// ========== 命令实现 ==========

/// 列出当前作品已保存的讨论摘要。损坏/超限档案被跳过并如实返回提示。
pub fn list_conversations(root: &Path) -> Result<ListResult, ConversationStoreError> {
    let dir = conversations_dir(root);
    if !dir.exists() {
        return Ok(ListResult::default());
    }

    let entries =
        fs::read_dir(&dir).map_err(|e| ConversationStoreError::ReadError(e.to_string()))?;

    let mut conversations = Vec::new();
    let mut skipped = Vec::new();

    for entry in entries {
        // 单个条目读取失败不拖垮整个列表。
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let stem = stem.to_string();

        match read_record_file(&path) {
            Ok(record) => {
                if record.conversation_id != stem {
                    skipped.push(skip_entry(&stem, "讨论档案标识与文件名不一致，已跳过"));
                    continue;
                }
                conversations.push(summarize(&record));
            }
            Err(ReadFileFailure::TooLarge) => {
                skipped.push(skip_entry(&stem, "讨论档案超过大小上限，已跳过"));
            }
            Err(ReadFileFailure::Corrupt) => {
                skipped.push(skip_entry(&stem, "讨论档案损坏，已跳过"));
            }
            Err(ReadFileFailure::Io(_)) => {
                skipped.push(skip_entry(&stem, "讨论档案无法读取，已跳过"));
            }
        }
    }

    // 按更新时间倒序（RFC3339 同偏移下字典序即时间序）。
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(ListResult {
        conversations,
        skipped,
    })
}

/// 原子保存一份讨论档案。校验标识与版本后才写入，绝不留下半写文件。
/// updated_at 由服务端盖当前 UTC 时间戳（created_at 保留原值）；删除墓碑命中即拒绝，
/// 删除后迟到的保存不复活已删除的档案文件。
pub fn save_conversation(
    root: &Path,
    record: &ConversationRecord,
) -> Result<(), ConversationStoreError> {
    validate_conversation_id(&record.conversation_id)?;
    if record.version != CONVERSATION_VERSION {
        return Err(ConversationStoreError::UnsupportedVersion(
            record.version.to_string(),
        ));
    }

    // 服务端盖时间戳：updated_at 以当前 UTC 覆盖，created_at 保留调用方原值。
    let mut stamped = record.clone();
    stamped.updated_at = current_utc_timestamp();

    // save / delete 串行化：全程持锁，同一讨论的 save 与 delete 不交错；
    // 删除墓碑命中即拒绝，避免「删除后迟到的保存」复活文件。
    let deleted = CONVERSATION_STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = conversation_file(root, &stamped.conversation_id);
    if deleted.contains(&file) {
        return Err(ConversationStoreError::AlreadyDeleted(
            stamped.conversation_id.clone(),
        ));
    }

    let dir = conversations_dir(root);
    fs::create_dir_all(&dir).map_err(|e| ConversationStoreError::WriteError(e.to_string()))?;

    let json = serde_json::to_string_pretty(&stamped)
        .map_err(|e| ConversationStoreError::InvalidRecord(e.to_string()))?;
    crate::project::write_file_atomically(&file, &json)
        .map_err(|e| ConversationStoreError::WriteError(e.to_string()))
}

/// 删除一份讨论档案（幂等：目标不存在视为成功，不遗留孤儿档案）。
/// 先记删除墓碑再移除文件：之后迟到的 save 被墓碑拒绝，不复活档案。
pub fn delete_conversation(root: &Path, id: &str) -> Result<(), ConversationStoreError> {
    validate_conversation_id(id)?;
    let mut deleted = CONVERSATION_STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = conversation_file(root, id);
    deleted.insert(file.clone());
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(ConversationStoreError::WriteError(e.to_string())),
    }
}

/// 撤销删除：清除该讨论的删除墓碑，使随后的 save 可再次写入档案。
/// 仅用于删除撤销路径；幂等（不存在墓碑时成功）。
pub fn restore_conversation(root: &Path, id: &str) -> Result<(), ConversationStoreError> {
    validate_conversation_id(id)?;
    let mut deleted = CONVERSATION_STORE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let file = conversation_file(root, id);
    deleted.remove(&file);
    Ok(())
}

/// 读取一份完整讨论档案（供重开查看与测试复用；当前不作为前端命令暴露）。
pub fn read_conversation(root: &Path, id: &str) -> Result<ConversationRecord, ConversationStoreError> {
    validate_conversation_id(id)?;
    let path = conversation_file(root, id);
    if !path.is_file() {
        return Err(ConversationStoreError::NotFound(id.to_string()));
    }
    let record = read_record_file(&path).map_err(|e| match e {
        ReadFileFailure::TooLarge => ConversationStoreError::ReadError(format!(
            "讨论档案超过 {MAX_CONVERSATION_BYTES} 字节上限"
        )),
        ReadFileFailure::Corrupt => {
            ConversationStoreError::InvalidRecord("档案损坏或无法解析".to_string())
        }
        ReadFileFailure::Io(msg) => ConversationStoreError::ReadError(msg),
    })?;
    if record.conversation_id != id {
        return Err(ConversationStoreError::InvalidRecord(
            "档案标识与请求不一致".to_string(),
        ));
    }
    Ok(record)
}

// ========== 摘要派生 ==========

fn summarize(record: &ConversationRecord) -> ConversationSummary {
    ConversationSummary {
        conversation_id: record.conversation_id.clone(),
        title: effective_title(record),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        last_status: record.turns.last().map(|t| t.status.clone()),
        focus_document_id: record.focus_document_id.clone(),
        focus_document_title: record.focus_document_title.clone(),
        first_round_material: record.first_round_material.clone(),
        turns: record.turns.clone(),
        custom_title: record.title.clone(),
        pinned: record.pinned,
    }
}

/// 列表显示标题：用户自定义标题优先（空白视为未重命名），否则回退到派生标题。
fn effective_title(record: &ConversationRecord) -> String {
    match record.title.as_deref() {
        Some(t) if !t.trim().is_empty() => t.to_string(),
        _ => derive_title(&record.first_round_material, &record.created_at),
    }
}

/// 标题：优先首轮问题，其次选区文本（截断），空则用创建时间。
fn derive_title(material: &FirstRoundMaterial, created_at: &str) -> String {
    let question = material.question.trim();
    if !question.is_empty() {
        return truncate_title(question);
    }
    if let Some(selection) = material.selection_text.as_deref() {
        let selection = selection.trim();
        if !selection.is_empty() {
            return truncate_title(selection);
        }
    }
    time_title(created_at)
}

fn truncate_title(s: &str) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(TITLE_MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn time_title(ts: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| ts.to_string())
}

fn skip_entry(stem: &str, reason: &str) -> String {
    format!("{stem}：{reason}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: &str, text: &str, status: &str) -> ConversationTurn {
        ConversationTurn {
            role: role.to_string(),
            text: text.to_string(),
            status: status.to_string(),
        }
    }

    fn record(
        id: &str,
        question: Option<&str>,
        selection: Option<&str>,
        turns: Vec<ConversationTurn>,
    ) -> ConversationRecord {
        ConversationRecord {
            version: CONVERSATION_VERSION,
            conversation_id: id.to_string(),
            created_at: "2026-09-09T10:00:00+00:00".to_string(),
            updated_at: "2026-09-09T10:30:00+00:00".to_string(),
            focus_document_id: Some("doc-1".to_string()),
            focus_document_title: Some("未命名文档".to_string()),
            first_round_material: FirstRoundMaterial {
                kind: "direct_question".to_string(),
                question: question.map(String::from).unwrap_or_default(),
                selection_text: selection.map(String::from),
            },
            turns,
            title: None,
            pinned: false,
        }
    }

    // ========== 保存 → 读取 ==========

    #[test]
    fn save_then_read_round_trips_record() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record(
            "conv-1",
            Some("这个角色为什么犹豫？"),
            None,
            vec![
                turn("user", "这个角色为什么犹豫？", "success"),
                turn("assistant", "他还没想清楚后果。", "success"),
            ],
        );

        save_conversation(temp.path(), &rec).expect("save");

        let loaded = read_conversation(temp.path(), "conv-1").expect("read");
        // updated_at 由服务端盖当前 UTC 时间戳，created_at 保留原值；其余字段逐字段一致。
        assert_eq!(loaded.created_at, rec.created_at, "created_at 必须保留原值");
        assert_ne!(loaded.updated_at, rec.updated_at, "updated_at 必须被服务端覆盖");
        assert_eq!(loaded.conversation_id, rec.conversation_id);
        assert_eq!(loaded.focus_document_id, rec.focus_document_id);
        assert_eq!(loaded.focus_document_title, rec.focus_document_title);
        assert_eq!(loaded.first_round_material, rec.first_round_material);
        assert_eq!(loaded.turns, rec.turns);

        // 档案落在作品系统目录的 conversations 子目录下，与正文分开。
        let path = conversations_dir(temp.path()).join("conv-1.json");
        assert!(path.is_file(), "档案文件应落在 {path:?}");
    }

    // ========== 自定义标题与置顶标记（任务 9.1） ==========

    #[test]
    fn save_then_read_round_trips_custom_title_and_pinned() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("这个角色为什么犹豫？"), None, vec![]);
        rec.title = Some("第二幕转折".to_string());
        rec.pinned = true;

        save_conversation(temp.path(), &rec).expect("save");
        let loaded = read_conversation(temp.path(), "conv-1").expect("read");

        assert_eq!(loaded.title.as_deref(), Some("第二幕转折"), "自定义标题必须原样保存");
        assert!(loaded.pinned, "置顶标记必须保存为 true");
    }

    #[test]
    fn list_summary_returns_custom_title_and_pinned() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("这个角色为什么犹豫？"), None, vec![]);
        rec.title = Some("第二幕转折".to_string());
        rec.pinned = true;
        save_conversation(temp.path(), &rec).expect("save");

        let result = list_conversations(temp.path()).expect("list");
        assert!(result.skipped.is_empty());
        assert_eq!(result.conversations.len(), 1);
        let summary = &result.conversations[0];

        // 列表标题取自定义标题，且自定义标题原值 / 置顶标记一并返回供前端使用。
        assert_eq!(summary.title, "第二幕转折");
        assert_eq!(summary.custom_title.as_deref(), Some("第二幕转折"));
        assert!(summary.pinned);
    }

    #[test]
    fn list_falls_back_to_derived_title_when_custom_title_is_blank() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("这个角色为什么犹豫？"), None, vec![]);
        rec.title = Some("   ".to_string());
        save_conversation(temp.path(), &rec).expect("save");

        let result = list_conversations(temp.path()).expect("list");
        // 空白自定义标题按未重命名处理，回退到派生标题。
        assert_eq!(result.conversations[0].title, "这个角色为什么犹豫？");
    }

    #[test]
    fn old_archive_without_extended_fields_reads_as_defaults() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        // 手工构造一份「旧档案」：只含必填字段，没有 title / pinned。
        let rec = record(
            "conv-old",
            Some("旧档案问题"),
            None,
            vec![turn("assistant", "旧回答", "success")],
        );
        let mut value = serde_json::to_value(&rec).expect("to value");
        value
            .as_object_mut()
            .expect("object")
            .remove("title");
        value
            .as_object_mut()
            .expect("object")
            .remove("pinned");
        let dir = conversations_dir(temp.path());
        fs::create_dir_all(&dir).expect("create dir");
        fs::write(
            dir.join("conv-old.json"),
            serde_json::to_string_pretty(&value).expect("serialize"),
        )
        .expect("write old archive");

        let result = list_conversations(temp.path()).expect("list");
        assert!(
            result.skipped.is_empty(),
            "缺扩展字段的旧档案不得视为损坏或跳过"
        );
        assert_eq!(result.conversations.len(), 1);
        let summary = &result.conversations[0];
        assert_eq!(summary.custom_title, None, "缺 title 按未重命名处理");
        assert!(!summary.pinned, "缺 pinned 按未置顶处理");
        assert_eq!(summary.title, "旧档案问题", "缺自定义标题回退到派生标题");
    }

    // ========== 原子写不半写 ==========

    #[test]
    fn save_is_atomic_and_leaves_no_temp_files() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record("conv-1", Some("问题"), None, vec![turn("user", "问题", "pending")]);

        save_conversation(temp.path(), &rec).expect("save");

        let dir = conversations_dir(temp.path());
        let names: Vec<String> = fs::read_dir(&dir)
            .expect("read dir")
            .map(|e| e.expect("entry").file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["conv-1.json".to_string()],
            "目录只应含档案文件，无临时文件残留"
        );

        // 档案内容完整可解析；除服务端盖时间戳的 updated_at 外，其余字段逐字段一致。
        let raw = fs::read_to_string(dir.join("conv-1.json")).expect("read file");
        let parsed: ConversationRecord = serde_json::from_str(&raw).expect("parse complete json");
        assert_eq!(parsed.created_at, rec.created_at);
        assert_ne!(parsed.updated_at, rec.updated_at);
        assert_eq!(parsed.conversation_id, rec.conversation_id);
        assert_eq!(parsed.turns, rec.turns);
        assert_eq!(parsed.first_round_material, rec.first_round_material);
    }

    // ========== 删除 ==========

    #[test]
    fn delete_removes_file_and_is_idempotent() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        save_conversation(temp.path(), &record("conv-1", Some("问题"), None, vec![]))
            .expect("save");

        delete_conversation(temp.path(), "conv-1").expect("delete");
        assert!(!conversation_file(temp.path(), "conv-1").exists());

        // 再次删除同一 id：幂等成功。
        delete_conversation(temp.path(), "conv-1").expect("delete again");
    }

    // ========== 列表扫描 ==========

    #[test]
    fn list_scans_directory_and_derives_summaries_sorted() {
        let temp = tempfile::TempDir::new().expect("temp dir");

        // 先保存 a，短暂间隔后保存 b：save 会盖 updated_at，b 晚保存必然时间更新。
        let a = record(
            "conv-a",
            Some("这个角色为什么犹豫？"),
            None,
            vec![turn("assistant", "回答A", "success")],
        );
        let b = record(
            "conv-b",
            None,
            Some("林站在天台边，没有回头。这是一段比较长的选区文本，用来验证标题截断逻辑，超过四十个字符之后的部分应该被截断。"),
            vec![turn("user", "追问", "pending")],
        );

        save_conversation(temp.path(), &a).expect("save a");
        std::thread::sleep(std::time::Duration::from_millis(5));
        save_conversation(temp.path(), &b).expect("save b");

        let result = list_conversations(temp.path()).expect("list");
        assert!(result.skipped.is_empty());
        assert_eq!(result.conversations.len(), 2);

        // 按 updated_at 倒序：b 晚保存，时间更新，排在前。
        assert_eq!(result.conversations[0].conversation_id, "conv-b");
        assert_eq!(result.conversations[1].conversation_id, "conv-a");

        // 标题：a 取首轮问题；b 取选区文本截断（含省略号）。
        assert_eq!(result.conversations[1].title, "这个角色为什么犹豫？");
        let title_b = &result.conversations[0].title;
        assert!(title_b.starts_with("林站在天台边"));
        assert!(title_b.ends_with('…'));
        assert!(
            title_b.chars().count() <= TITLE_MAX_CHARS + 1,
            "标题应被截断到 {TITLE_MAX_CHARS} 字符加省略号"
        );

        // last_status：a 最后一轮为 assistant/success；b 为 user/pending。
        assert_eq!(result.conversations[1].last_status.as_deref(), Some("success"));
        assert_eq!(result.conversations[0].last_status.as_deref(), Some("pending"));
    }

    #[test]
    fn list_on_missing_dir_returns_empty() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let result = list_conversations(temp.path()).expect("list empty");
        assert!(result.conversations.is_empty());
        assert!(result.skipped.is_empty());
    }

    #[test]
    fn list_falls_back_to_time_title_when_first_round_has_no_text() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record("conv-1", None, None, vec![]);
        save_conversation(temp.path(), &rec).expect("save");

        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1);
        // created_at = 2026-09-09T10:00:00+00:00 → 固定格式时间标题。
        assert_eq!(result.conversations[0].title, "2026-09-09 10:00");
    }

    // ========== 损坏 / 超限跳过 ==========

    #[test]
    fn list_skips_corrupt_file_with_visible_hint() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        save_conversation(temp.path(), &record("conv-good", Some("正常讨论"), None, vec![]))
            .expect("save good");
        fs::write(
            conversations_dir(temp.path()).join("conv-bad.json"),
            "这不是 JSON",
        )
        .expect("write corrupt");

        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1, "损坏项不得拖垮正常项");
        assert_eq!(result.conversations[0].conversation_id, "conv-good");
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].starts_with("conv-bad"), "跳过项必须标识来源");
        assert!(result.skipped[0].contains("损坏"), "损坏项必须给出可见提示");
    }

    #[test]
    fn list_skips_over_limit_file() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        save_conversation(temp.path(), &record("conv-good", Some("正常讨论"), None, vec![]))
            .expect("save good");
        let big = "x".repeat(MAX_CONVERSATION_BYTES as usize + 1024);
        fs::write(conversations_dir(temp.path()).join("conv-big.json"), big)
            .expect("write oversized");

        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1);
        assert_eq!(result.conversations[0].conversation_id, "conv-good");
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].starts_with("conv-big"));
        assert!(result.skipped[0].contains("大小上限"));
    }

    #[test]
    fn list_skips_file_whose_id_mismatches_filename() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        // 文件名是 conv-x，但内容里的 conversation_id 是另一个值。
        let mut rec = record("conv-x", Some("问题"), None, vec![]);
        rec.conversation_id = "conv-y".to_string();
        let dir = conversations_dir(temp.path());
        fs::create_dir_all(&dir).expect("create dir");
        fs::write(
            dir.join("conv-x.json"),
            serde_json::to_string_pretty(&rec).expect("serialize"),
        )
        .expect("write mismatched");

        let result = list_conversations(temp.path()).expect("list");
        assert!(result.conversations.is_empty());
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].starts_with("conv-x"));
    }

    // ========== 校验：非法标识 / 版本 ==========

    #[test]
    fn save_rejects_invalid_conversation_id() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        for bad_id in ["", ".", "..", "a/b", "a\\b", "a:b"] {
            let mut rec = record(bad_id, Some("问题"), None, vec![]);
            rec.conversation_id = bad_id.to_string();
            let result = save_conversation(temp.path(), &rec);
            assert!(
                matches!(result, Err(ConversationStoreError::InvalidConversationId(_))),
                "非法标识 {bad_id:?} 必须被拒绝"
            );
        }

        // 非法标识不得落盘任何档案文件。
        let dir = conversations_dir(temp.path());
        let has_files = dir.exists() && fs::read_dir(&dir).expect("read dir").next().is_some();
        assert!(!has_files, "非法标识不得落盘文件");
    }

    #[test]
    fn save_rejects_unsupported_version() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("问题"), None, vec![]);
        rec.version = 99;
        let result = save_conversation(temp.path(), &rec);
        assert!(matches!(result, Err(ConversationStoreError::UnsupportedVersion(_))));
    }

    #[test]
    fn read_unknown_conversation_errors_with_not_found() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let result = read_conversation(temp.path(), "conv-none");
        assert!(matches!(result, Err(ConversationStoreError::NotFound(_))));
    }

    // ========== 摘要携带完整记录（重开用） ==========

    #[test]
    fn list_summary_carries_full_record_for_reopen() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record(
            "conv-1",
            Some("这个角色为什么犹豫？"),
            None,
            vec![
                turn("user", "这个角色为什么犹豫？", "success"),
                turn("assistant", "他还没想清楚后果。", "success"),
            ],
        );
        save_conversation(temp.path(), &rec).expect("save");

        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1);
        let summary = &result.conversations[0];

        // 摘要必须携带重开所需的完整字段（本车道无单独「读取一条」命令）。
        assert_eq!(summary.conversation_id, "conv-1");
        assert_eq!(summary.title, "这个角色为什么犹豫？");
        assert_eq!(summary.created_at, rec.created_at);
        assert_eq!(summary.last_status.as_deref(), Some("success"));
        assert_eq!(summary.focus_document_id.as_deref(), Some("doc-1"));
        assert_eq!(summary.focus_document_title.as_deref(), Some("未命名文档"));
        assert_eq!(summary.first_round_material, rec.first_round_material);
        assert_eq!(summary.turns, rec.turns);
        // updated_at 已被服务端覆盖，摘要应反映落盘后的值而非原始传入值。
        assert_ne!(summary.updated_at, rec.updated_at);
    }

    // ========== 服务端盖时间戳 ==========

    #[test]
    fn save_stamps_updated_at_and_advances_on_repeated_saves() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record("conv-1", Some("问题"), None, vec![turn("user", "问题", "pending")]);

        save_conversation(temp.path(), &rec).expect("first save");
        let first = read_conversation(temp.path(), "conv-1").expect("read after first");
        assert_eq!(first.created_at, rec.created_at, "created_at 必须保留原值");
        assert_ne!(first.updated_at, rec.updated_at, "首次保存即由服务端盖时间戳");

        std::thread::sleep(std::time::Duration::from_millis(5));
        save_conversation(temp.path(), &rec).expect("second save");
        let second = read_conversation(temp.path(), "conv-1").expect("read after second");
        assert_eq!(second.created_at, rec.created_at, "两次保存后 created_at 仍保留原值");
        assert_ne!(
            second.updated_at, first.updated_at,
            "两次保存后 updated_at 必须变化，避免列表排序退化为恒等 created_at"
        );
    }

    // ========== 删除墓碑：删除后迟到的保存不复活 ==========

    #[test]
    fn save_after_delete_is_rejected_and_does_not_resurrect_file() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        save_conversation(temp.path(), &record("conv-x", Some("问题"), None, vec![]))
            .expect("save");
        delete_conversation(temp.path(), "conv-x").expect("delete");
        assert!(!conversation_file(temp.path(), "conv-x").exists());

        // 删除后迟到的保存被拒绝，不复活档案文件。
        let late = record("conv-x", Some("迟到保存"), None, vec![]);
        let result = save_conversation(temp.path(), &late);
        assert!(
            matches!(result, Err(ConversationStoreError::AlreadyDeleted(_))),
            "删除后的迟到保存必须被拒绝，实际为: {result:?}"
        );
        assert!(
            !conversation_file(temp.path(), "conv-x").exists(),
            "迟到保存不得复活已删除的档案文件"
        );
    }
}
