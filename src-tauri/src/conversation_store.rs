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

/// 最小材料出处元数据（controlled-story-read-visibility 任务 5.1）：
/// 记录一轮讨论实际使用过的作品文档 / 选区材料来源，用于权限变化后判定受影响讨论。
/// MUST NOT 因此保存完整正文副本；`document_version` 在快照未携带版本时为空。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialProvenance {
    /// 来源文档身份。
    pub document_id: String,
    /// 材料类型：`selection`（冻结选区）/ `snapshot`（未保存快照）/ `document`（已保存正文），
    /// 阶段五 A 另加 `focus_document`（关注文档现场材料）与 `search_snippet`（跨文档检索命中）。
    pub material_type: String,
    /// 材料版本身份；当前快照未携带版本时为 `None`。
    pub document_version: Option<String>,
    /// 所属轮次（首轮为 0）。
    pub turn_index: u32,
    /// 是否进入模型上下文：仅表示「材料已组装进被提交的请求」（想发送 / prepared / accepted），
    /// MUST NOT 被解读为「已实际发送给 provider」（sent）。DSH 进程接收不等于 provider 已发送。
    /// 生命周期状态映射（阶段五 A）：`prepared`/`accepted` → 本字段 true；
    /// `omitted` → 不出现于 provenance 列表；`rejected`/`failed` → 所属轮次终态为 failed；
    /// `unknown`（是否送达 provider）→ 由 `sent_confirmed` 缺省（未确认）表达。
    pub entered_model_context: bool,
    /// provider 发送回执（`message_sent`）：本轮观测到 provider 侧回应证据时为
    /// `Some(true)`；未观测到回执时为 `None`（未确认，不是「未发送」）。只有收到
    /// 回执才标记，绝不伪造。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent_confirmed: Option<bool>,
    /// 仅 `search_snippet` 有值：命中的候选词（供「本次参考了什么」显示检索来源）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_term: Option<String>,
    /// 关注文档现场材料是否来自未保存快照（仅 `focus_document` 有意义）。
    #[serde(default)]
    pub from_unsaved_snapshot: bool,
    /// 本轮跨文档检索结果状态（`hit` / `not_found` / `no_query_terms`），
    /// 挂在关注文档条目上；无关注文档取材时为 `None`。不是正文内容。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_status: Option<String>,
    /// 本轮检索是否达到输出硬上限（本次检索受限，非全量检索）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_limited: Option<bool>,
}

/// 按需补读授权状态（change: add-agent-on-demand-reading 任务 4.1，设计 D3）：
/// 授权真相持久化在讨论档案，宿主逐次校验；授权属于讨论、跨重启保留。
/// `None`（缺字段 / 显式未设置）表示未授权；用户关闭授权即回到 `None`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnDemandReadingGrant {
    /// 已授权时间（RFC3339，由写入方盖章）。
    pub granted_at: String,
}

/// 按需补读的阅读程度（三档；change: add-agent-on-demand-reading 任务 4.1）。
/// 本组只定义枚举与存储；按轮累计读取范围对照正文长度的判定逻辑是任务 6.2。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadingDepth {
    /// 搜索片段：仅检索命中，未读取正文区间。
    SearchSnippet,
    /// 局部阅读：读取过正文但未覆盖全文。
    Partial,
    /// 完整阅读：覆盖全文。
    Full,
}

/// 按需补读读取出处的一条最小元数据（任务 4.1）：只存文档身份、版本、阅读
/// 程度、所属轮次与是否进入模型上下文，MUST NOT 保存读取的正文副本。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnDemandReadingProvenance {
    /// 来源文档身份。
    pub document_id: String,
    /// 所读已保存正文的内容派生版本。
    pub version: String,
    /// 阅读程度（三档）。
    pub depth: ReadingDepth,
    /// 所属轮次（首轮为 0，与 `MaterialProvenance::turn_index` 同一约定）。
    pub turn_index: u32,
    /// 是否进入模型上下文：与 `MaterialProvenance::entered_model_context` 同一
    /// 语义（材料已组装进被提交的工具结果），MUST NOT 被解读为「已实际发送」。
    pub entered_model_context: bool,
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
    /// 材料出处元数据（最小）。`None` 表示旧档案缺少该字段，按保守策略处理：
    /// 可查看但不可自动重放（无法确认所用材料是否仍可查看）；`Some(vec)` 表示新档案
    /// （`vec` 可为空，表示本轮未使用任何作品材料）。不提升档案版本号，缺失不视为损坏。
    #[serde(default)]
    pub provenance: Option<Vec<MaterialProvenance>>,
    /// 按需补读授权状态（任务 4.1，设计 D3）：`None` 表示未授权（含旧档案缺字段的
    /// 缺省），`Some(_)` 表示已授权及时间。授权属于讨论、跨重启保留；用户关闭即置回
    /// `None`。缺失不视为损坏、不触发任何新行为（不自动重放语义照旧）。
    #[serde(default)]
    pub on_demand_reading_grant: Option<OnDemandReadingGrant>,
    /// 按需补读读取出处（最小元数据，任务 4.1）：`None` 表示旧档案缺字段（视为无
    /// 补读记录），`Some(vec)` 可为空。只存文档身份、版本、阅读程度、轮次与是否进入
    /// 模型上下文，MUST NOT 保存正文副本。不提升档案版本号。
    #[serde(default)]
    pub on_demand_reading_provenance: Option<Vec<OnDemandReadingProvenance>>,
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
    /// 材料出处元数据：`None` 表示旧档案缺少该字段（保守：可查看但不可自动重放）。
    pub provenance: Option<Vec<MaterialProvenance>>,
    /// 按需补读授权状态：`None` 表示未授权（含旧档案缺字段缺省）。摘要携带它供
    /// 前端授权开关与重开恢复使用（授权属于讨论、跨重启保留）。
    pub on_demand_reading_grant: Option<OnDemandReadingGrant>,
    /// 按需补读读取出处（最小元数据）：`None` 表示旧档案缺字段（视为无补读记录）。
    pub on_demand_reading_provenance: Option<Vec<OnDemandReadingProvenance>>,
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
    if id
        .chars()
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
    let content =
        crate::project::read_bounded_string(path, MAX_CONVERSATION_BYTES).map_err(|e| match e {
            ProjectError::ContentTooLarge(_) => ReadFileFailure::TooLarge,
            ProjectError::ReadError(msg) => ReadFileFailure::Io(msg),
            other => ReadFileFailure::Io(other.to_string()),
        })?;
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
    let deleted = CONVERSATION_STORE_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let file = conversation_file(root, &stamped.conversation_id);
    if deleted.contains(&file) {
        return Err(ConversationStoreError::AlreadyDeleted(
            stamped.conversation_id.clone(),
        ));
    }

    // 前端保存链保全（add-agent-on-demand-reading 任务 7）：按需补读出处由宿主
    // 工具通道按轮写入（`upsert_on_demand_provenance`），前端记录不携带该字段
    // （`None`）。保存时若调用方未提供出处而档案已有，则保留档案已有出处——
    // 前端轮次终态保存不得抹掉通道刚落档的补读记录。通道自身写入时始终携带
    // `Some(_)`（读改写），不受此保全影响。
    if stamped.on_demand_reading_provenance.is_none() && file.is_file() {
        if let Ok(existing) = read_record_file(&file) {
            stamped.on_demand_reading_provenance = existing.on_demand_reading_provenance;
        }
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
    let mut deleted = CONVERSATION_STORE_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
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
    let mut deleted = CONVERSATION_STORE_LOCK
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let file = conversation_file(root, id);
    deleted.remove(&file);
    Ok(())
}

/// 读取一份完整讨论档案（供重开查看与测试复用；当前不作为前端命令暴露）。
pub fn read_conversation(
    root: &Path,
    id: &str,
) -> Result<ConversationRecord, ConversationStoreError> {
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

// ========== 按需补读授权开关与影响查询（add-agent-on-demand-reading 任务 7.2/7.4/7.5 的最小命令支撑） ==========

/// 一个使用过指定文档的讨论（影响提示的最小展示数据；不含出处细节）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationUsage {
    pub conversation_id: String,
    pub title: String,
}

/// 指定讨论的按需补读状态（授权 + 补读出处；供前端在轮次完成后刷新显示）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct OnDemandReadingState {
    /// 授权状态：`None` 表示未授权（含旧档案缺字段缺省）。
    #[serde(default)]
    pub grant: Option<OnDemandReadingGrant>,
    /// 补读出处（最小元数据）：`None` 表示旧档案缺字段（视为无补读记录）。
    #[serde(default)]
    pub provenance: Option<Vec<OnDemandReadingProvenance>>,
}

/// 开启 / 关闭指定讨论的按需补读授权（任务 7.2：讨论内授权开关）。
/// 读改写落盘：开启写入已授权及时间；关闭置回 `None`（未授权）。
/// 关闭不清除已读内容：补读出处（`on_demand_reading_provenance`）原样保留。
pub fn set_on_demand_reading(
    root: &Path,
    id: &str,
    granted: bool,
) -> Result<(), ConversationStoreError> {
    let mut record = read_conversation(root, id)?;
    if granted {
        record.on_demand_reading_grant = Some(OnDemandReadingGrant {
            granted_at: current_utc_timestamp(),
        });
    } else {
        record.on_demand_reading_grant = None;
    }
    save_conversation(root, &record)
}

/// 查询使用过指定文档的讨论（任务 7.5：关闭 AI 可见性前的影响提示）。
/// 覆盖两类出处：常规材料出处（`provenance`，含选区 / 关注文档 / 检索命中）与
/// 按需补读出处（`on_demand_reading_provenance`）。只读，不修改任何档案。
pub fn conversations_using_document(
    root: &Path,
    document_id: &str,
) -> Result<Vec<ConversationUsage>, ConversationStoreError> {
    let mut usage = Vec::new();
    for summary in list_conversations(root)?.conversations {
        let referenced = summary
            .provenance
            .as_ref()
            .is_some_and(|entries| entries.iter().any(|p| p.document_id == document_id))
            || summary
                .on_demand_reading_provenance
                .as_ref()
                .is_some_and(|entries| {
                    entries.iter().any(|p| p.document_id == document_id)
                });
        if referenced {
            usage.push(ConversationUsage {
                conversation_id: summary.conversation_id,
                title: summary.title,
            });
        }
    }
    Ok(usage)
}

/// 读取指定讨论的按需补读状态（授权 + 补读出处；任务 7.4 显示刷新用）。只读。
pub fn on_demand_reading_state(
    root: &Path,
    id: &str,
) -> Result<OnDemandReadingState, ConversationStoreError> {
    let record = read_conversation(root, id)?;
    Ok(OnDemandReadingState {
        grant: record.on_demand_reading_grant,
        provenance: record.on_demand_reading_provenance,
    })
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
        provenance: record.provenance.clone(),
        on_demand_reading_grant: record.on_demand_reading_grant.clone(),
        on_demand_reading_provenance: record.on_demand_reading_provenance.clone(),
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
            provenance: Some(vec![]),
            on_demand_reading_grant: None,
            on_demand_reading_provenance: None,
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
        assert_ne!(
            loaded.updated_at, rec.updated_at,
            "updated_at 必须被服务端覆盖"
        );
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

        assert_eq!(
            loaded.title.as_deref(),
            Some("第二幕转折"),
            "自定义标题必须原样保存"
        );
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
        value.as_object_mut().expect("object").remove("title");
        value.as_object_mut().expect("object").remove("pinned");
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

    // ========== 材料出处元数据（controlled-story-read-visibility 任务 5.1） ==========

    fn provenance(doc: &str, turn: u32) -> MaterialProvenance {
        MaterialProvenance {
            document_id: doc.to_string(),
            material_type: "selection".to_string(),
            document_version: None,
            turn_index: turn,
            entered_model_context: true,
            matched_term: None,
            from_unsaved_snapshot: false,
            search_status: None,
            search_limited: None,
            sent_confirmed: None,
        }
    }

    #[test]
    fn save_then_read_round_trips_provenance_without_body_copy() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.provenance = Some(vec![provenance("doc-1", 0)]);

        save_conversation(temp.path(), &rec).expect("save");
        let loaded = read_conversation(temp.path(), "conv-1").expect("read");

        assert_eq!(
            loaded.provenance,
            Some(vec![provenance("doc-1", 0)]),
            "材料出处元数据必须原样往返"
        );

        // 档案不得复制保存完整正文：选区正文只存在于 first_round_material，不出现在出处元数据里。
        let raw = fs::read_to_string(conversation_file(temp.path(), "conv-1")).expect("read raw");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        let provenance_value = parsed["provenance"].as_array().expect("provenance array");
        assert_eq!(provenance_value.len(), 1);
        assert!(
            !provenance_value[0]
                .as_object()
                .expect("object")
                .contains_key("body"),
            "出处元数据不得包含正文副本字段"
        );
        assert!(
            !provenance_value[0]
                .as_object()
                .expect("object")
                .contains_key("text"),
            "出处元数据不得包含选区正文"
        );
    }

    #[test]
    fn old_archive_without_provenance_reads_as_none_and_is_not_corrupt() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record(
            "conv-old",
            Some("旧档案问题"),
            None,
            vec![turn("assistant", "旧回答", "success")],
        );
        let mut value = serde_json::to_value(&rec).expect("to value");
        value.as_object_mut().expect("object").remove("provenance");
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
            "缺 provenance 的旧档案不得视为损坏或跳过"
        );
        assert_eq!(result.conversations.len(), 1);
        assert_eq!(
            result.conversations[0].provenance, None,
            "缺 provenance 字段按保守策略读取为 None"
        );
    }

    #[test]
    fn list_summary_carries_provenance_for_reopen() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("这个角色为什么犹豫？"), None, vec![]);
        rec.provenance = Some(vec![provenance("doc-9", 0)]);
        save_conversation(temp.path(), &rec).expect("save");

        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1);
        assert_eq!(
            result.conversations[0].provenance,
            Some(vec![provenance("doc-9", 0)]),
            "摘要必须携带材料出处供前端判定权限影响"
        );
    }

    // ========== 7.3 收窄：出处元数据字段白名单（不落正文副本字段） ==========

    #[test]
    fn provenance_metadata_contains_only_allowed_fields_and_no_body_copy_keys() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        // 覆盖材料类型标签（selection / snapshot / focus_document）：标签作为值存在是
        // 合法的（判定影响关系），但绝不允许出现 snapshot / bodySnapshot / content /
        // documents 等「正文副本」字段名。
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.provenance = Some(vec![
            MaterialProvenance {
                document_id: "doc-1".to_string(),
                material_type: "selection".to_string(),
                document_version: None,
                turn_index: 0,
                entered_model_context: true,
                matched_term: None,
                from_unsaved_snapshot: false,
                search_status: None,
                search_limited: None,
                sent_confirmed: None,
            },
            MaterialProvenance {
                document_id: "doc-2".to_string(),
                material_type: "snapshot".to_string(),
                document_version: Some("v1".to_string()),
                turn_index: 0,
                entered_model_context: true,
                matched_term: None,
                from_unsaved_snapshot: false,
                search_status: None,
                search_limited: None,
                sent_confirmed: None,
            },
            MaterialProvenance {
                document_id: "doc-3".to_string(),
                material_type: "focus_document".to_string(),
                document_version: None,
                turn_index: 0,
                entered_model_context: true,
                matched_term: None,
                from_unsaved_snapshot: true,
                search_status: Some("not_found".to_string()),
                search_limited: Some(false),
                sent_confirmed: None,
            },
        ]);

        save_conversation(temp.path(), &rec).expect("save");

        let raw = fs::read_to_string(conversation_file(temp.path(), "conv-1")).expect("read raw");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        let entries = parsed["provenance"].as_array().expect("provenance array");

        const ALLOWED: [&str; 10] = [
            "document_id",
            "material_type",
            "document_version",
            "turn_index",
            "entered_model_context",
            "matched_term",
            "from_unsaved_snapshot",
            "search_status",
            "search_limited",
            "sent_confirmed",
        ];
        const FORBIDDEN: [&str; 4] = ["snapshot", "bodySnapshot", "content", "documents"];

        assert_eq!(entries.len(), 3, "三种材料类型出处都应往返保留");
        for entry in entries {
            let obj = entry.as_object().expect("provenance entry is object");
            for key in obj.keys() {
                assert!(
                    ALLOWED.contains(&key.as_str()),
                    "出处元数据出现未授权字段: {key}"
                );
                assert!(
                    !FORBIDDEN.contains(&key.as_str()),
                    "出处元数据不得包含正文副本字段: {key}"
                );
            }
        }
    }

    #[test]
    fn matched_term_and_search_metadata_round_trip() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.provenance = Some(vec![MaterialProvenance {
            document_id: "doc-9".to_string(),
            material_type: "search_snippet".to_string(),
            document_version: Some("v2".to_string()),
            turn_index: 1,
            entered_model_context: true,
            matched_term: Some("林晓".to_string()),
            from_unsaved_snapshot: false,
            search_status: None,
            search_limited: None,
            sent_confirmed: Some(true),
        }]);

        save_conversation(temp.path(), &rec).expect("save");
        let loaded = read_conversation(temp.path(), "conv-1").expect("read");

        assert_eq!(
            loaded.provenance, rec.provenance,
            "含 matched_term 的出处必须原样往返"
        );
        assert_eq!(
            loaded.provenance.as_ref().expect("provenance")[0]
                .matched_term
                .as_deref(),
            Some("林晓"),
            "检索来源匹配词必须被持久化，不能被丢弃"
        );
        assert_eq!(
            loaded.provenance.as_ref().expect("provenance")[0].sent_confirmed,
            Some(true),
            "provider 发送回执必须被持久化"
        );
    }

    /// 回执标记的诚实边界：未确认（`None`）的轮次序列化后不携带任何发送状态字段，
    /// 绝不出现无回执即标的 `sent` / `delivered` 状态。
    #[test]
    fn unconfirmed_round_carries_no_fake_sent_marker() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.provenance = Some(vec![provenance("doc-1", 0)]);

        save_conversation(temp.path(), &rec).expect("save");
        let raw = fs::read_to_string(conversation_file(temp.path(), "conv-1")).expect("read raw");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        let entry = parsed["provenance"][0].as_object().expect("object");

        assert!(
            !entry.contains_key("sent_confirmed"),
            "未确认轮次不得携带回执标记"
        );
        for forbidden_state in ["sent", "delivered", "send_status", "received_by_provider"] {
            assert!(
                !entry.contains_key(forbidden_state),
                "出处元数据不得伪造发送状态字段: {forbidden_state}"
            );
        }
    }

    #[test]
    fn old_archive_with_partial_provenance_fields_reads_defaults() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        // 阶段四旧出处只含 5 个字段（无 matched_term / from_unsaved_snapshot /
        // search_status / search_limited），必须仍能读取且新字段取默认值。
        let rec = record("conv-old", None, Some("林站在天台边。"), vec![]);
        let mut value = serde_json::to_value(&rec).expect("to value");
        value.as_object_mut().expect("object").insert(
            "provenance".to_string(),
            serde_json::json!([{
                "document_id": "doc-1",
                "material_type": "selection",
                "document_version": null,
                "turn_index": 0,
                "entered_model_context": true
            }]),
        );
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
            "缺新字段的旧出处不得视为损坏或跳过"
        );
        assert_eq!(result.conversations.len(), 1);
        let entry = &result.conversations[0]
            .provenance
            .as_ref()
            .expect("provenance")[0];
        assert_eq!(entry.document_id, "doc-1");
        assert_eq!(entry.material_type, "selection");
        assert_eq!(entry.matched_term, None, "缺 matched_term 按 None 处理");
        assert!(
            !entry.from_unsaved_snapshot,
            "缺 from_unsaved_snapshot 按 false 处理"
        );
        assert_eq!(entry.search_status, None, "缺 search_status 按 None 处理");
        assert_eq!(entry.search_limited, None, "缺 search_limited 按 None 处理");
        assert_eq!(
            entry.sent_confirmed, None,
            "缺 sent_confirmed 按 None（未确认）处理，不伪造已发送"
        );
    }

    #[test]
    fn entered_model_context_is_assembled_intent_not_sent() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.provenance = Some(vec![MaterialProvenance {
            document_id: "doc-9".to_string(),
            material_type: "search_snippet".to_string(),
            document_version: None,
            turn_index: 0,
            entered_model_context: true,
            matched_term: Some("林晓".to_string()),
            from_unsaved_snapshot: false,
            search_status: None,
            search_limited: None,
            sent_confirmed: None,
        }]);

        save_conversation(temp.path(), &rec).expect("save");
        let raw = fs::read_to_string(conversation_file(temp.path(), "conv-1")).expect("read raw");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        let entry = parsed["provenance"][0].as_object().expect("object");

        // entered_model_context 表示「已组装/想发送」，不是「已发送」；已发送只能
        // 由 sent_confirmed（仅收到 message_sent 回执时才出现）表达。
        assert_eq!(
            entry.get("entered_model_context"),
            Some(&serde_json::json!(true)),
            "已组装进请求的材料标记为想发送"
        );
        assert!(
            !entry.contains_key("sent_confirmed"),
            "无回执的轮次不得携带 sent_confirmed"
        );

        // 不存在任何「已发送给 provider」的状态字段：不得伪造 sent。
        for forbidden_state in ["sent", "delivered", "send_status", "received_by_provider"] {
            assert!(
                !entry.contains_key(forbidden_state),
                "出处元数据不得伪造发送状态字段: {forbidden_state}"
            );
        }
    }

    // ========== 按需补读授权状态与读取出处（add-agent-on-demand-reading 任务 4.1/4.2） ==========

    #[test]
    fn on_demand_reading_state_round_trips_across_restart() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", Some("这个角色为什么犹豫？"), None, vec![]);
        rec.on_demand_reading_grant = Some(OnDemandReadingGrant {
            granted_at: "2026-09-20T08:30:00.123Z".to_string(),
        });
        rec.on_demand_reading_provenance = Some(vec![
            OnDemandReadingProvenance {
                document_id: "doc-1".to_string(),
                version: "version-hash-1".to_string(),
                depth: ReadingDepth::Full,
                turn_index: 2,
                entered_model_context: true,
            },
            OnDemandReadingProvenance {
                document_id: "doc-2".to_string(),
                version: "version-hash-2".to_string(),
                depth: ReadingDepth::Partial,
                turn_index: 2,
                entered_model_context: true,
            },
            OnDemandReadingProvenance {
                document_id: "doc-3".to_string(),
                version: "version-hash-3".to_string(),
                depth: ReadingDepth::SearchSnippet,
                turn_index: 3,
                entered_model_context: false,
            },
        ]);

        save_conversation(temp.path(), &rec).expect("save");

        // 「重启」：新实例只依赖磁盘档案恢复状态（保存 → 重开 → 状态恢复）。
        let loaded = read_conversation(temp.path(), "conv-1").expect("read after restart");
        assert_eq!(
            loaded.on_demand_reading_grant, rec.on_demand_reading_grant,
            "授权状态（已授权及时间）必须跨重启恢复"
        );
        assert_eq!(
            loaded.on_demand_reading_provenance, rec.on_demand_reading_provenance,
            "补读出处（含三档阅读程度）必须跨重启恢复"
        );

        // 摘要携带两组字段：授权开关与「本次参考了什么」扩展的数据面。
        let result = list_conversations(temp.path()).expect("list");
        assert_eq!(result.conversations.len(), 1);
        let summary = &result.conversations[0];
        assert_eq!(summary.on_demand_reading_grant, rec.on_demand_reading_grant);
        assert_eq!(
            summary.on_demand_reading_provenance,
            rec.on_demand_reading_provenance
        );

        // 未授权档案：字段保持 None（未授权），保存往返不引入状态。
        save_conversation(
            temp.path(),
            &record("conv-plain", Some("未授权讨论"), None, vec![]),
        )
        .expect("save plain");
        let plain = read_conversation(temp.path(), "conv-plain").expect("read plain");
        assert_eq!(plain.on_demand_reading_grant, None, "缺省即未授权");
        assert_eq!(plain.on_demand_reading_provenance, None, "缺省即无补读记录");
    }

    #[test]
    fn on_demand_provenance_stores_minimal_metadata_without_body_copy() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-1", None, Some("林站在天台边。"), vec![]);
        rec.on_demand_reading_grant = Some(OnDemandReadingGrant {
            granted_at: "2026-09-20T08:30:00.123Z".to_string(),
        });
        rec.on_demand_reading_provenance = Some(vec![OnDemandReadingProvenance {
            document_id: "doc-9".to_string(),
            version: "version-hash-9".to_string(),
            depth: ReadingDepth::Partial,
            turn_index: 1,
            entered_model_context: true,
        }]);

        save_conversation(temp.path(), &rec).expect("save");

        // 序列化形状：授权对象只含 granted_at；出处条目字段在最小白名单内，
        // 绝不出现正文副本字段。
        let raw = fs::read_to_string(conversation_file(temp.path(), "conv-1")).expect("raw");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        let grant = parsed["on_demand_reading_grant"].as_object().expect("grant");
        assert_eq!(
            grant.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["granted_at"],
            "授权对象只存已授权时间"
        );

        let entries = parsed["on_demand_reading_provenance"]
            .as_array()
            .expect("provenance array");
        assert_eq!(entries.len(), 1);
        let entry = entries[0].as_object().expect("entry object");
        const ALLOWED: [&str; 5] = [
            "document_id",
            "version",
            "depth",
            "turn_index",
            "entered_model_context",
        ];
        for key in entry.keys() {
            assert!(
                ALLOWED.contains(&key.as_str()),
                "补读出处出现未授权字段: {key}"
            );
        }
        assert_eq!(entry["depth"], serde_json::json!("partial"));
        assert_eq!(entry["entered_model_context"], serde_json::json!(true));
        // 不含正文副本：条目里没有任何内容字段（与既有出处白名单同一红线）；
        // 检查范围限于补读出处数组——首轮冻结选区文本在 first_round_material
        // 中保存是既有合法行为，不属于出处副本。
        for forbidden in ["content", "body", "text", "snippet"] {
            assert!(
                !entry.contains_key(forbidden),
                "补读出处不得包含正文副本字段: {forbidden}"
            );
        }
        let provenance_raw = parsed["on_demand_reading_provenance"].to_string();
        assert!(
            !provenance_raw.contains("林站在天台边"),
            "补读出处元数据不得含正文文本"
        );

        // 三档阅读程度的稳定标签（snake_case）。
        let mut rec2 = record("conv-2", Some("三档"), None, vec![]);
        rec2.on_demand_reading_provenance = Some(vec![
            OnDemandReadingProvenance {
                document_id: "a".to_string(),
                version: "v".to_string(),
                depth: ReadingDepth::SearchSnippet,
                turn_index: 0,
                entered_model_context: true,
            },
            OnDemandReadingProvenance {
                document_id: "b".to_string(),
                version: "v".to_string(),
                depth: ReadingDepth::Full,
                turn_index: 0,
                entered_model_context: true,
            },
        ]);
        save_conversation(temp.path(), &rec2).expect("save 2");
        let raw2 = fs::read_to_string(conversation_file(temp.path(), "conv-2")).expect("raw 2");
        assert!(raw2.contains("\"search_snippet\""));
        assert!(raw2.contains("\"full\""));
    }

    /// 任务 4.2：旧档案缺少按需补读字段 → 正常打开查看、视为未授权；
    /// 缺字段不触发任何新行为（不自动重放语义照旧）。
    #[test]
    fn old_archive_without_on_demand_fields_reads_as_unauthorized() {
        let temp = tempfile::TempDir::new().expect("temp dir");
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
            .remove("on_demand_reading_grant");
        value
            .as_object_mut()
            .expect("object")
            .remove("on_demand_reading_provenance");
        let dir = conversations_dir(temp.path());
        fs::create_dir_all(&dir).expect("create dir");
        fs::write(
            dir.join("conv-old.json"),
            serde_json::to_string_pretty(&value).expect("serialize"),
        )
        .expect("write old archive");

        // 正常列出：不跳过、不损坏。
        let result = list_conversations(temp.path()).expect("list");
        assert!(result.skipped.is_empty(), "缺按需补读字段的旧档案不得跳过");
        assert_eq!(result.conversations.len(), 1);
        let summary = &result.conversations[0];
        assert_eq!(
            summary.on_demand_reading_grant, None,
            "旧档案缺授权字段按未授权处理"
        );
        assert_eq!(
            summary.on_demand_reading_provenance, None,
            "旧档案缺补读出处按无记录处理"
        );

        // 正常读取查看。
        let loaded = read_conversation(temp.path(), "conv-old").expect("read old");
        assert_eq!(loaded.on_demand_reading_grant, None);
        assert_eq!(loaded.on_demand_reading_provenance, None);
    }

    // ========== 按需补读授权开关与影响查询（add-agent-on-demand-reading 任务 7） ==========

    #[test]
    fn set_on_demand_reading_toggles_grant_and_keeps_provenance() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut rec = record("conv-t", Some("问题"), None, vec![]);
        rec.on_demand_reading_provenance = Some(vec![OnDemandReadingProvenance {
            document_id: "doc-1".to_string(),
            version: "v1".to_string(),
            depth: ReadingDepth::Partial,
            turn_index: 1,
            entered_model_context: true,
        }]);
        save_conversation(temp.path(), &rec).expect("save");

        // 开启：写入已授权及时间。
        set_on_demand_reading(temp.path(), "conv-t", true).expect("grant");
        let granted = read_conversation(temp.path(), "conv-t").expect("read");
        let grant = granted.on_demand_reading_grant.expect("granted");
        assert!(!grant.granted_at.is_empty());
        assert_eq!(
            granted.on_demand_reading_provenance, rec.on_demand_reading_provenance,
            "开启授权不得改动补读出处"
        );

        // 关闭：置回未授权；已读内容（出处）不清除。
        set_on_demand_reading(temp.path(), "conv-t", false).expect("revoke");
        let revoked = read_conversation(temp.path(), "conv-t").expect("read");
        assert_eq!(revoked.on_demand_reading_grant, None, "关闭即未授权");
        assert_eq!(
            revoked.on_demand_reading_provenance, rec.on_demand_reading_provenance,
            "关闭不清除已读内容的出处记录"
        );

        // 状态查询与档案一致。
        let state = on_demand_reading_state(temp.path(), "conv-t").expect("state");
        assert_eq!(state.grant, None);
        assert_eq!(state.provenance, rec.on_demand_reading_provenance);
    }

    #[test]
    fn conversations_using_document_covers_material_and_on_demand_provenance() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        // 材料出处引用 doc-1 的讨论。
        let mut material_rec = record("conv-m", Some("材料讨论"), None, vec![]);
        material_rec.provenance = Some(vec![MaterialProvenance {
            document_id: "doc-1".to_string(),
            material_type: "focus_document".to_string(),
            document_version: None,
            turn_index: 0,
            entered_model_context: true,
            sent_confirmed: None,
            matched_term: None,
            from_unsaved_snapshot: false,
            search_status: None,
            search_limited: None,
        }]);
        save_conversation(temp.path(), &material_rec).expect("save material");
        // 按需补读出处引用 doc-1 的讨论。
        let mut on_demand_rec = record("conv-r", Some("补读讨论"), None, vec![]);
        on_demand_rec.on_demand_reading_provenance = Some(vec![OnDemandReadingProvenance {
            document_id: "doc-1".to_string(),
            version: "v1".to_string(),
            depth: ReadingDepth::Full,
            turn_index: 2,
            entered_model_context: true,
        }]);
        save_conversation(temp.path(), &on_demand_rec).expect("save on-demand");
        // 无关讨论。
        save_conversation(temp.path(), &record("conv-x", Some("无关"), None, vec![]))
            .expect("save unrelated");

        let mut usage = conversations_using_document(temp.path(), "doc-1").expect("usage");
        usage.sort_by(|a, b| a.conversation_id.cmp(&b.conversation_id));
        assert_eq!(
            usage,
            vec![
                ConversationUsage {
                    conversation_id: "conv-m".to_string(),
                    title: "材料讨论".to_string(),
                },
                ConversationUsage {
                    conversation_id: "conv-r".to_string(),
                    title: "补读讨论".to_string(),
                },
            ],
            "材料出处与补读出处都计入影响范围"
        );

        // 未被任何讨论使用：空结果（关闭前不弹影响提示）。
        assert!(conversations_using_document(temp.path(), "doc-none")
            .expect("usage none")
            .is_empty());
    }

    /// 任务 7 前端保存链保全：前端记录不携带补读出处（`None`）时，保存不得抹掉
    /// 宿主通道已落档的出处；显式携带 `Some(_)`（通道读改写 / 删除撤销重写）时以
    /// 调用方为准。
    #[test]
    fn save_preserves_backend_owned_on_demand_provenance_when_caller_omits_it() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record("conv-p", Some("问题"), None, vec![]);
        save_conversation(temp.path(), &rec).expect("initial save");

        // 宿主通道按轮写入补读出处（读改写，始终携带 Some）。
        let mut with_provenance = read_conversation(temp.path(), "conv-p").expect("read");
        with_provenance.on_demand_reading_provenance = Some(vec![OnDemandReadingProvenance {
            document_id: "doc-2".to_string(),
            version: "v2".to_string(),
            depth: ReadingDepth::SearchSnippet,
            turn_index: 1,
            entered_model_context: true,
        }]);
        save_conversation(temp.path(), &with_provenance).expect("save provenance");

        // 前端轮次终态保存：记录不携带出处字段 → 档案已有出处必须保全。
        let frontend_rec = record("conv-p", Some("问题"), None, vec![
            turn("assistant", "终态回答", "success"),
        ]);
        save_conversation(temp.path(), &frontend_rec).expect("frontend save");
        let loaded = read_conversation(temp.path(), "conv-p").expect("read");
        assert_eq!(
            loaded.on_demand_reading_provenance,
            with_provenance.on_demand_reading_provenance,
            "前端保存不得抹掉通道落档的补读出处"
        );
        assert_eq!(
            loaded.turns.last().map(|t| t.text.clone()),
            Some("终态回答".to_string()),
            "前端保存的轮次内容正常落盘"
        );

        // 显式携带（删除撤销重写路径）：以调用方为准。
        let mut explicit = read_conversation(temp.path(), "conv-p").expect("read");
        explicit.on_demand_reading_provenance = Some(vec![]);
        save_conversation(temp.path(), &explicit).expect("explicit save");
        let reloaded = read_conversation(temp.path(), "conv-p").expect("read");
        assert_eq!(reloaded.on_demand_reading_provenance, Some(vec![]));
    }

    #[test]
    fn turn_status_distinguishes_failed_from_cancelled() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record(
            "conv-1",
            Some("问题"),
            None,
            vec![
                turn("user", "问题", "failed"),
                turn("assistant", "", "cancelled"),
            ],
        );
        save_conversation(temp.path(), &rec).expect("save");
        let loaded = read_conversation(temp.path(), "conv-1").expect("read");
        assert_eq!(
            loaded.turns[0].status, "failed",
            "失败轮次必须保留 failed 终态"
        );
        assert_eq!(
            loaded.turns[1].status, "cancelled",
            "取消轮次必须保留 cancelled 终态，且与 failed 区分"
        );
    }

    // ========== 原子写不半写 ==========

    #[test]
    fn save_is_atomic_and_leaves_no_temp_files() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let rec = record(
            "conv-1",
            Some("问题"),
            None,
            vec![turn("user", "问题", "pending")],
        );

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
        assert_eq!(
            result.conversations[1].last_status.as_deref(),
            Some("success")
        );
        assert_eq!(
            result.conversations[0].last_status.as_deref(),
            Some("pending")
        );
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
        save_conversation(
            temp.path(),
            &record("conv-good", Some("正常讨论"), None, vec![]),
        )
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
        assert!(
            result.skipped[0].starts_with("conv-bad"),
            "跳过项必须标识来源"
        );
        assert!(result.skipped[0].contains("损坏"), "损坏项必须给出可见提示");
    }

    #[test]
    fn list_skips_over_limit_file() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        save_conversation(
            temp.path(),
            &record("conv-good", Some("正常讨论"), None, vec![]),
        )
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
                matches!(
                    result,
                    Err(ConversationStoreError::InvalidConversationId(_))
                ),
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
        assert!(matches!(
            result,
            Err(ConversationStoreError::UnsupportedVersion(_))
        ));
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
        let rec = record(
            "conv-1",
            Some("问题"),
            None,
            vec![turn("user", "问题", "pending")],
        );

        save_conversation(temp.path(), &rec).expect("first save");
        let first = read_conversation(temp.path(), "conv-1").expect("read after first");
        assert_eq!(first.created_at, rec.created_at, "created_at 必须保留原值");
        assert_ne!(
            first.updated_at, rec.updated_at,
            "首次保存即由服务端盖时间戳"
        );

        std::thread::sleep(std::time::Duration::from_millis(5));
        save_conversation(temp.path(), &rec).expect("second save");
        let second = read_conversation(temp.path(), "conv-1").expect("read after second");
        assert_eq!(
            second.created_at, rec.created_at,
            "两次保存后 created_at 仍保留原值"
        );
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
