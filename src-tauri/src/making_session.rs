//! 制作助手会话通道与制作对话持久化（change: add-making-module-core 任务组 5）。
//!
//! 职责（design D4 / D5，spec `making-conversation`）：
//! - **制作助手信封**（单一来源 [`making_session_system_prompt`]）：首行身份句，
//!   首个换行后＝宪法红线同文（复用 [`CONSTITUTION_CLAUSES`]，一字不改）＋空行
//!   ＋制作守则段；沿用既有两段拆段协议（驱动侧按首个换行拆 persona /
//!   constitution，`splitSystemPrompt` 零改动），红线永居任何卡内容之上。
//! - **制作会话命令层**（镜像 [`crate::ai_host`] 形态，全部 `making_` 前缀）：
//!   复用同一常驻驱动进程，`start_session` 以 `session_kind="making"` 建会话
//!   （驱动侧跳过 story 工具四件套注册）；本模块结构上不触碰
//!   `ai_orchestration` / `story_tool_channel`——不为制作会话 `register_round`，
//!   未注册路由失败关闭＝宿主侧第二道保险。
//! - **制作对话持久化**：全局侧 `making-module/conversations/<id>.json` 完整
//!   逐字历史，绝不写入任何作品文件夹；按链路组织，重启后重开可继续（重开＝
//!   新驱动会话＋从档案 turns 重放 seed，重放信封与原发同一纯常量，逐字一致）。
//!
//! 隔离边界（spec「制作助手不读作品」）：制作轮次 user 文本**纯文本直发**——
//! 不选区授权、不自动取材、不目录检索、不带 chain_cards（传 `None`）、无
//! provenance。并发：走 [`DshDriverManager::send_message_with_cards_and_wait`]
//! 即进入既有全局同时生成上限准入（同讨论重复与全局超限都在写协议前拒绝）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::chain_library::{conversations_dir_in, making_module_dir_in};
use crate::dsh_driver::{
    next_id, DriverParams, DriverReplayTurn, DshDriverManager, MessageOutcome, SessionKind,
    REQUEST_TIMEOUT,
};
use crate::dsh_version::DshVersionLayout;
use crate::llm_config::generate::CONSTITUTION_CLAUSES;
use crate::llm_config::{
    app_data_dir_failure_result, load_llm_config, validate_llm_config, GenerateAiError,
    GenerateAiErrorCode, GenerateAiResult, LlmConfig,
};

// ========== 制作助手信封（任务 5.1，design D4） ==========

/// 制作助手身份句（信封 persona 段，独占首行；design D4 备选 A 草案）。
const MAKING_IDENTITY_SENTENCE: &str = "你是帮助剧本创作者制作陪想要求的助手。";

/// 制作守则段（信封 constitution 段内、红线之后；design D4＋spec 行为规范；
/// add-posture-slot 任务 3.1 增姿态卡把关条款）：与红线同入
/// `nextstory:constitution` 段（order 10），制度上次居任何卡内容之上。
/// 文本不含 `{{`/`}}`（驱动侧 dsh-system-prompt 严格变量插值，未知引用 fail loud）。
const MAKING_GUARD_RULES: &str = "制作守则：\
你不读取任何作品材料，也不请求读取授权；只依据用户的口述与试问结果工作，材料不足时如实说明，并用提问补足。\
用户的口语描述存在会影响要求内容的关键歧义时，先适量提问澄清，再出草稿；关注总沟通负担，不在一次澄清中堆叠过多问题。\
按用户的技术水平说话：用户不了解开发术语，出现术语时当场用大白话解释。\
草稿中的每条要求都必须能溯源到用户的口述或反馈实例，不自创要求，不替用户决定要求的内容。\
卡草稿是临时材料，用户显式启用之前不产生任何效果；用户的肯定表述（如「这版不错」）不等于启用，启用必须是用户的明确动作。\
不替用户判断创意高低；所有候选与判断最终由用户决定。\
链路配置只能经制作模块的制作对话修改：用户提到想在日常聊天里修改链路时，说明日常聊天不能修改链路，请其前往制作模块的制作对话处理。\n\
姿态卡把用户的口述变成陪想的出场姿态：范围是用户口述的人设、看剧本的出发点或陪想本身的姿态，不是新的职权。\
起草姿态卡前先澄清：用户要的是语气上的皮，还是真要陪想当裁判——语气随便换，裁判权换不走。\
口述中的裁判性诉求（如「替我判断好坏」「毒舌锐评我的水平」）只转化为语气条款，不写入职权条款。\
姿态卡正文用第二人称书写，并含「底线不换皮」条款；范本口径：嘴硬心软可以毒舌，但毒舌后必须跟实打实的想法；说作品「不行」只能带依据；不代写，稿子一字不许动。\
每条链路每个版本可以并存多张姿态卡；系统不做冲突调和，怎么组合由用户决定。\
用户想要第二张姿态卡时，先问「替换现有的，还是并存」，按用户的选择起草（替换＝出一个新版本，并存＝同版本多张）。\
草稿代表新版本的完整卡清单：并存时把既有卡原样重述、与新卡一起输出；替换时只输出新卡。不知道既有卡内容时，先如实说明，依会话内「链路现状」附言或用户提供的文本重述，不编造。\
发现新姿态与已有姿态明显相抵（如相反的语气）时，明确提醒用户，但不阻止保存。\
只含姿态卡、不含要求卡的版本允许保存。\
姿态卡的触发描述仅供用户选择链路时参考，系统不会据此自动切换姿态。\n\
产出或修改卡草稿时，用固定标记块输出，便于界面识别：\n\
【卡草稿开始】\n\
类型：要求卡 或 类型：姿态卡\n\
卡名：…\n\
何时用：…\n\
何时不用：…\n\
正文：…\n\
【卡草稿结束】\n\
一次可输出多个块；块外文字正常对话。";

/// 制作会话信封（`start_session.system_prompt`）纯常量组装（单一来源）：
/// 首行＝制作助手身份句，首个换行后＝宪法红线全文（同文，一字不改）＋空行＋
/// 制作守则段。首行换行即驱动侧拆段契约（首行遮蔽 `deployment:persona`，其余
/// 全部入 `nextstory:constitution`——红线在前、守则在后，同段内次序固定）。
///
/// 纯常量确定性组装：正常 `start_session` 与崩溃恢复重放由同一函数重算重发，
/// 逐字一致由无状态保证。红线经 [`CONSTITUTION_CLAUSES`] 同一常量引用，
/// 杜绝第二副本漂移（generate.rs 已 `pub(crate)`）。
pub fn making_session_system_prompt() -> String {
    format!("{MAKING_IDENTITY_SENTENCE}\n{CONSTITUTION_CLAUSES}\n\n{MAKING_GUARD_RULES}")
}

// ========== 制作对话持久化（任务 5.3，design D3/D5） ==========

/// 制作会话档案读写大小上限（1 MiB，对齐链路库主文件口径）：超出明确报错，
/// 不静默截断、不无界读入内存。
pub const MAX_MAKING_CONVERSATION_BYTES: u64 = 1024 * 1024;

/// 一条制作对话轮次：角色（user/assistant）、文本与生成终态（对齐日常讨论：
/// `pending` / `success` / `failed` / `cancelled`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MakingTurn {
    pub role: String,
    pub text: String,
    pub status: String,
}

/// 一份完整制作会话档案（`making-module/conversations/<id>.json`，全局侧）。
/// 制作档案**无后端自有字段**：整档由前端驱动保存，后端无需合并保护。
/// `updated_at` 由前端维护（RFC3339，列表按其倒序）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MakingConversationRecord {
    pub id: String,
    /// 所属链路 id；`None`＝未绑定会话（空库直接口述建立，保存草稿时才建立链路并绑定）。
    /// 旧档案的字符串 `chain_id` 反序列化为 `Some`，向后兼容；`null` 为未绑定。
    #[serde(default)]
    pub chain_id: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub turns: Vec<MakingTurn>,
}

/// 列表条目摘要（不含 turns 全文，镜像日常会话列表的摘要口径）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MakingConversationSummary {
    pub id: String,
    /// 所属链路 id；`None`＝未绑定会话。
    #[serde(default)]
    pub chain_id: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub turn_count: usize,
}

/// 会话列表结果：正常条目＋被跳过（损坏/超限等）的可见提示（对齐
/// conversation_store 的 ListResult 惯例——跳过必须如实可见，不静默吞）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct MakingConversationListResult {
    pub conversations: Vec<MakingConversationSummary>,
    pub skipped: Vec<String>,
}

/// 制作会话档案错误：全部映射为明确中文文案，绝不静默截断/丢弃/谎报成功。
#[derive(Debug)]
pub enum MakingConversationError {
    /// 应用本地数据目录不可用。
    AppDirUnavailable,
    /// 档案超过 1 MiB 读取/保存上限。
    TooLarge { actual_bytes: u64 },
    /// 会话标识不是安全的文件名分量。
    InvalidId { reason: String },
    /// 记录内容无效（角色/终态/字段缺失等），未保存。
    InvalidRecord { reason: String },
    /// 指定会话档案不存在。
    NotFound { conversation_id: String },
    /// 读取失败（IO）。
    Read(String),
    /// 写入失败（建目录、临时文件、原子替换等）。
    Write(String),
    /// 会话已删除，迟到的保存被墓碑拒绝（不复活已删档案）。
    AlreadyDeleted { conversation_id: String },
    /// 普通整档保存试图撤销或改绑已落盘的链路绑定（迟到旧快照 / 旧轮覆盖）。
    BindingRegression {
        conversation_id: String,
        reason: String,
    },
}

impl std::fmt::Display for MakingConversationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MakingConversationError::AppDirUnavailable => {
                write!(f, "无法访问应用本地数据目录，请重启应用后重试")
            }
            MakingConversationError::TooLarge { actual_bytes } => write!(
                f,
                "制作会话档案超过 1 MiB 上限（当前 {actual_bytes} 字节），请新建制作会话继续"
            ),
            MakingConversationError::InvalidId { reason } => {
                write!(f, "制作会话标识无效: {reason}")
            }
            MakingConversationError::InvalidRecord { reason } => {
                write!(f, "制作会话记录无效: {reason}")
            }
            MakingConversationError::NotFound { conversation_id } => {
                write!(f, "制作会话不存在: {conversation_id}")
            }
            MakingConversationError::Read(msg) => write!(f, "读取制作会话档案失败: {msg}"),
            MakingConversationError::Write(msg) => write!(f, "保存制作会话档案失败: {msg}"),
            MakingConversationError::AlreadyDeleted { conversation_id } => {
                write!(f, "制作会话已删除，无法保存: {conversation_id}")
            }
            MakingConversationError::BindingRegression {
                conversation_id,
                reason,
            } => write!(f, "制作会话绑定冲突（{conversation_id}）: {reason}"),
        }
    }
}

impl std::error::Error for MakingConversationError {}

/// save / delete 的进程内互斥＋删除墓碑（风格同 conversation_store 的
/// `CONVERSATION_STORE_LOCK`）：同一档案的 save / delete 不交错；删除后迟到的
/// save 命中墓碑被拒绝，不复活已删除的档案文件。键为档案文件路径（各测试
/// TempDir 互不干扰）。
static MAKING_CONVERSATION_STORE_LOCK: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn lock_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// id 是否是安全的文件名分量（同 conversation_store / chain_library 的校验思路）。
fn is_safe_id_component(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && !id
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c == '\0' || c.is_control())
}

fn validate_making_conversation_id(id: &str) -> Result<(), MakingConversationError> {
    if !is_safe_id_component(id) {
        return Err(MakingConversationError::InvalidId {
            reason: "不能为空，且不得包含路径分隔符、冒号或控制字符".to_string(),
        });
    }
    Ok(())
}

fn conversation_file_in(conversations_dir: &Path, id: &str) -> PathBuf {
    conversations_dir.join(format!("{id}.json"))
}

/// 有界读取档案文件：打开一次句柄后 `take(max+1)` 限量读取，超限拒绝；
/// 不依赖读取前的元数据长度（消除 TOCTOU 竞态）。
fn read_conversation_file_bounded(path: &Path) -> Result<String, MakingConversationError> {
    let file = fs::File::open(path).map_err(|e| MakingConversationError::Read(e.to_string()))?;
    let mut limited = file.take(MAX_MAKING_CONVERSATION_BYTES + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| MakingConversationError::Read(e.to_string()))?;
    if content.len() as u64 > MAX_MAKING_CONVERSATION_BYTES {
        return Err(MakingConversationError::TooLarge {
            actual_bytes: content.len() as u64,
        });
    }
    Ok(content)
}

/// 单个档案文件的读取分类（列表据此跳过并如实提示，load 据此明确报错）。
enum ReadRecordFailure {
    TooLarge,
    Corrupt,
    Io(String),
}

fn parse_record_file(path: &Path) -> Result<MakingConversationRecord, ReadRecordFailure> {
    let content = read_conversation_file_bounded(path).map_err(|e| match e {
        MakingConversationError::TooLarge { .. } => ReadRecordFailure::TooLarge,
        MakingConversationError::Read(msg) => ReadRecordFailure::Io(msg),
        other => ReadRecordFailure::Io(other.to_string()),
    })?;
    serde_json::from_str(&content).map_err(|_| ReadRecordFailure::Corrupt)
}

/// 校验整档记录（保存前）：标识安全、链路 id 非空、时间戳非空（列表排序依赖
/// `updated_at`）、轮次角色与终态在锁定集合内。无效明确报错，不静默修复。
fn validate_record(record: &MakingConversationRecord) -> Result<(), MakingConversationError> {
    validate_making_conversation_id(&record.id)?;
    // 未绑定会话（空库直接口述）以 `None` 表示；不得用空字符串伪造链路身份。
    if let Some(chain_id) = &record.chain_id {
        if chain_id.trim().is_empty() {
            return Err(MakingConversationError::InvalidRecord {
                reason: "所属链路标识（chain_id）不能为空字符串；未绑定会话应为 null".to_string(),
            });
        }
    }
    if record.created_at.trim().is_empty() || record.updated_at.trim().is_empty() {
        return Err(MakingConversationError::InvalidRecord {
            reason: "创建与更新时间（created_at / updated_at）不能为空".to_string(),
        });
    }
    for (position, turn) in record.turns.iter().enumerate() {
        let ordinal = position + 1;
        match turn.role.as_str() {
            "user" | "assistant" => {}
            other => {
                return Err(MakingConversationError::InvalidRecord {
                    reason: format!("第 {ordinal} 轮角色无效（{other}，应为 user 或 assistant）"),
                })
            }
        }
        match turn.status.as_str() {
            "pending" | "success" | "failed" | "cancelled" => {}
            other => {
                return Err(MakingConversationError::InvalidRecord {
                    reason: format!(
                        "第 {ordinal} 轮终态无效（{other}，应为 pending/success/failed/cancelled）"
                    ),
                })
            }
        }
    }
    Ok(())
}

/// 原子写回档案（临时文件＋persist，同仓库落盘惯例）；序列化结果超 1 MiB
/// 明确报错，不静默截断。
fn save_record_to_dir(
    conversations_dir: &Path,
    record: &MakingConversationRecord,
) -> Result<(), MakingConversationError> {
    let write_err = |e: std::io::Error| MakingConversationError::Write(e.to_string());
    let json = serde_json::to_string_pretty(record)
        .map_err(|e| MakingConversationError::Write(e.to_string()))?;
    if json.len() as u64 > MAX_MAKING_CONVERSATION_BYTES {
        return Err(MakingConversationError::TooLarge {
            actual_bytes: json.len() as u64,
        });
    }
    fs::create_dir_all(conversations_dir).map_err(write_err)?;
    let mut temp_file = tempfile::NamedTempFile::new_in(conversations_dir).map_err(write_err)?;
    temp_file.write_all(json.as_bytes()).map_err(write_err)?;
    temp_file.flush().map_err(write_err)?;
    temp_file
        .persist(conversation_file_in(conversations_dir, &record.id))
        .map(|_| ())
        .map_err(|e| MakingConversationError::Write(e.error.to_string()))
}

/// 按链路列出制作会话（`updated_at` 倒序）。损坏/超限档案跳过并如实提示。
/// `chain_id` 为 `None` 时列出未绑定会话（空库直接口述建立、尚未保存草稿）。
/// 不校验链路是否仍存在（删除链路不清理制作会话档案——历史凭档案仍可读，
/// 链路不存在时的呈现由前端处理）。
pub fn list_making_conversations(
    conversations_dir: &Path,
    chain_id: Option<&str>,
) -> Result<MakingConversationListResult, MakingConversationError> {
    let mut result = MakingConversationListResult::default();
    let Ok(entries) = fs::read_dir(conversations_dir) else {
        return Ok(result);
    };
    let mut records = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        match parse_record_file(&path) {
            Ok(record) => {
                if record.chain_id.as_deref() == chain_id {
                    records.push(record);
                }
            }
            Err(ReadRecordFailure::TooLarge) => {
                result.skipped.push(format!("{id}: 文件超过 1 MiB 上限"));
            }
            Err(ReadRecordFailure::Corrupt) => {
                result
                    .skipped
                    .push(format!("{id}: 文件损坏（不是有效的制作会话数据）"));
            }
            Err(ReadRecordFailure::Io(msg)) => {
                result.skipped.push(format!("{id}: 读取失败（{msg}）"));
            }
        }
    }
    records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    result.conversations = records
        .into_iter()
        .map(|record| MakingConversationSummary {
            id: record.id,
            chain_id: record.chain_id,
            title: record.title,
            created_at: record.created_at,
            updated_at: record.updated_at,
            turn_count: record.turns.len(),
        })
        .collect();
    Ok(result)
}

/// 读取一份完整制作会话档案；缺失/损坏/超限明确报错。
pub fn load_making_conversation(
    conversations_dir: &Path,
    conversation_id: &str,
) -> Result<MakingConversationRecord, MakingConversationError> {
    validate_making_conversation_id(conversation_id)?;
    let path = conversation_file_in(conversations_dir, conversation_id);
    if !path.is_file() {
        return Err(MakingConversationError::NotFound {
            conversation_id: conversation_id.to_string(),
        });
    }
    parse_record_file(&path).map_err(|failure| match failure {
        ReadRecordFailure::TooLarge => MakingConversationError::TooLarge {
            actual_bytes: MAX_MAKING_CONVERSATION_BYTES + 1,
        },
        ReadRecordFailure::Corrupt => MakingConversationError::Read(
            "文件损坏（不是有效的制作会话数据），未做任何修改".to_string(),
        ),
        ReadRecordFailure::Io(msg) => MakingConversationError::Read(msg),
    })
}

/// 保存（原子写入）一份制作会话档案。前端驱动的整档保存：制作档案无后端
/// 自有字段，按传入内容原样落盘（无合并保护）；已删除档案的迟到保存被
/// 墓碑拒绝。保存失败明确报错（前端据此呈现「保存失败」，不显示已保存）。
pub fn save_making_conversation(
    conversations_dir: &Path,
    record: &MakingConversationRecord,
) -> Result<(), MakingConversationError> {
    validate_record(record)?;
    let tombstones = lock_recover(&MAKING_CONVERSATION_STORE_LOCK);
    let path = conversation_file_in(conversations_dir, &record.id);
    if tombstones.contains(&path) {
        return Err(MakingConversationError::AlreadyDeleted {
            conversation_id: record.id.clone(),
        });
    }
    // 绑定单调保护：整档保存不得撤销或改绑已落盘的链路绑定（同一把锁内读取现状比对）。
    // 迟到的旧快照（chain_id 为 None 或旧链路 id）不能覆盖已绑定会话。
    if let Ok(current) = parse_record_file(&path) {
        match (&current.chain_id, &record.chain_id) {
            (Some(current_id), None) => {
                return Err(MakingConversationError::BindingRegression {
                    conversation_id: record.id.clone(),
                    reason: format!("已绑定链路 {current_id}，普通保存不得解除绑定"),
                });
            }
            (Some(current_id), Some(incoming_id)) if incoming_id != current_id => {
                return Err(MakingConversationError::BindingRegression {
                    conversation_id: record.id.clone(),
                    reason: format!("已绑定链路 {current_id}，普通保存不得改绑到 {incoming_id}"),
                });
            }
            _ => {}
        }
    }
    save_record_to_dir(conversations_dir, record)
}

/// 会话存储锁内执行「建链路前置校验 + 链路库写入」的受限跨存储操作（有界线定）：
/// - 会话标识安全；
/// - 会话档案真实存在（未绑定会话建立时即落档）；
/// - 未被删除（墓碑）；
/// - 现有绑定为空，或不与目标链路冲突（同一会话不得改绑）。
///
/// **锁序（统一 session → chain）**：本函数在会话存储锁内运行 `body`（由调用方
/// 在其中取链路库锁写链路），因此 delete（同样取会话存储锁）无法在校验与链路写入之间
/// 插入；两锁不出现相反顺序（已核对：`chain_library` 的 `with_library` 锁内不访问
/// 制作会话存储，唯一跨存储点即本函数），故不死锁。`body` 内不得再取会话存储锁。
pub(crate) fn with_conversation_store_lock<R>(
    conversations_dir: &Path,
    conversation_id: &str,
    target_chain_id: &str,
    body: impl FnOnce() -> Result<R, String>,
) -> Result<R, String> {
    validate_making_conversation_id(conversation_id).map_err(|e| e.to_string())?;
    let path = conversation_file_in(conversations_dir, conversation_id);
    // 持有会话存储锁贯穿校验与 body（delete 走同一把锁，二者串行化）。
    let tombstones = lock_recover(&MAKING_CONVERSATION_STORE_LOCK);
    if tombstones.contains(&path) {
        return Err(MakingConversationError::AlreadyDeleted {
            conversation_id: conversation_id.to_string(),
        }
        .to_string());
    }
    let record = parse_record_file(&path).map_err(|failure| {
        let error = match failure {
            ReadRecordFailure::TooLarge => MakingConversationError::TooLarge {
                actual_bytes: MAX_MAKING_CONVERSATION_BYTES + 1,
            },
            ReadRecordFailure::Corrupt => {
                MakingConversationError::Read("制作会话档案损坏，无法建立链路".to_string())
            }
            ReadRecordFailure::Io(msg) => MakingConversationError::Read(msg),
        };
        error.to_string()
    })?;
    if let Some(current) = &record.chain_id {
        if current != target_chain_id {
            return Err(MakingConversationError::BindingRegression {
                conversation_id: conversation_id.to_string(),
                reason: format!("该会话已绑定链路 {current}，不得改绑"),
            }
            .to_string());
        }
    }
    body()
    // tombstones（会话存储锁）在 body 完成后随作用域释放。
}

/// 删除一份制作会话档案（幂等：不存在视为成功）并记入墓碑。
pub fn delete_making_conversation(
    conversations_dir: &Path,
    conversation_id: &str,
) -> Result<(), MakingConversationError> {
    validate_making_conversation_id(conversation_id)?;
    let mut tombstones = lock_recover(&MAKING_CONVERSATION_STORE_LOCK);
    let path = conversation_file_in(conversations_dir, conversation_id);
    tombstones.insert(path.clone());
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(MakingConversationError::Write(e.to_string())),
    }
}

// ========== 制作会话注册表与驱动会话核心（任务 5.2，design D4） ==========

/// 制作车道在驱动会话 id 上的保留前缀：制作会话的驱动 id 一律为
/// `making-<制作会话 id>-<进程内序号>`。前缀是增量事件分发的判据（见
/// [`install_making_event_bridge`]），也保证与日常会话 id 永不碰撞。
pub const MAKING_DRIVER_SESSION_PREFIX: &str = "making-";

/// 驱动会话 id 是否属于制作车道；是则返回其制作会话 id 部分（剥前缀与序号后缀）。
fn making_conversation_id_of_driver_session(session_id: &str) -> Option<&str> {
    let rest = session_id.strip_prefix(MAKING_DRIVER_SESSION_PREFIX)?;
    // 剥去末尾的进程内序号段（最后一个 '-' 之后）。
    let cut = rest.rfind('-')?;
    Some(&rest[..cut])
}

/// 制作会话注册表（AppState 单例，进程内）：制作会话 id → 当前驱动会话 id。
/// 驱动重启后注册表失效——前端收到既有 `ai-driver-lost` 事件后调用
/// `making_end_session` 清除条目，随后的 start / send 自动走恢复路径
/// （新驱动会话＋从档案重放，镜像日常会话的崩溃恢复链）。
#[derive(Clone, Default)]
pub struct MakingSessionRegistry {
    inner: Arc<Mutex<HashMap<String, String>>>,
}

impl MakingSessionRegistry {
    fn locked(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        lock_recover(&self.inner)
    }
}

/// 确保制作会话在驱动侧存在（懒建＋崩溃恢复镜像）：
/// 1. 注册表已有条目 → 直接复用（同会话不重建）；
/// 2. 无条目（应用重启 / 驱动重启后的首次操作）→ 新驱动会话 id＋以
///    [`making_session_system_prompt`] 纯常量信封 `start_session_with_kind`
///    （`SessionKind::Making`，驱动侧不注册 story 工具）＋从档案 turns 构造
///    seed 逐字重放（`replay_history`＋`replay_done`，与日常
///    `ai_replay_history` / `ai_replay_done` 同一重放链）——重放信封与原发
///    逐字一致（同一常量重算重发）。
///
/// 注意：注册表锁只在建会话期间持有（有界，SESSION_ACK_TIMEOUT 量级），
/// 绝不跨发送等待持有——不同制作会话的轮次互不阻塞。
fn ensure_making_session(
    manager: &DshDriverManager,
    registry: &MakingSessionRegistry,
    conversations_dir: &Path,
    conversation_id: &str,
) -> Result<String, GenerateAiError> {
    validate_making_conversation_id(conversation_id).map_err(|e| {
        GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            format!("{}，请重新打开该制作会话", e),
        )
    })?;
    {
        let sessions = registry.locked();
        if let Some(existing) = sessions.get(conversation_id) {
            return Ok(existing.clone());
        }
    }
    // 新驱动会话 id 带进程内序号：半途失败的建会话在驱动侧残留惰性会话时，
    // 重试不会撞 `session_exists`（与日常前端每次铸新 id 的行为一致）。
    let driver_session_id = format!(
        "{MAKING_DRIVER_SESSION_PREFIX}{conversation_id}-{}",
        next_id()
    );
    manager.start_session_with_kind(
        &driver_session_id,
        &making_session_system_prompt(),
        SessionKind::Making,
    )?;
    match load_making_conversation(conversations_dir, conversation_id) {
        Ok(record) => {
            let turns = replay_seed_turns(&record);
            if !turns.is_empty() {
                manager.replay_history(&driver_session_id, turns)?;
                manager.replay_done(&driver_session_id)?;
            }
        }
        Err(MakingConversationError::NotFound { .. }) => {
            // 新制作会话：档案尚不存在，无历史可重放。
        }
        Err(other) => {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::Service,
                format!("读取制作会话档案失败，无法恢复历史：{other}"),
            ));
        }
    }
    registry
        .locked()
        .insert(conversation_id.to_string(), driver_session_id.clone());
    Ok(driver_session_id)
}

/// 从制作档案构造重放 seed（前端显示历史的纯投影，不触发再生成）：
/// user 轮全量保留（对应日常重放显示历史的口径）；assistant 轮只保留有内容的
/// `success` / `cancelled` 轮（`pending` / `failed` 无完成内容，不冒充已说完的
/// 回应）；空文本轮一律跳过。
fn replay_seed_turns(record: &MakingConversationRecord) -> Vec<DriverReplayTurn> {
    record
        .turns
        .iter()
        .filter(|turn| {
            if turn.text.trim().is_empty() {
                return false;
            }
            match turn.role.as_str() {
                "user" => true,
                "assistant" => matches!(turn.status.as_str(), "success" | "cancelled"),
                _ => false,
            }
        })
        .map(|turn| DriverReplayTurn {
            role: turn.role.clone(),
            text: turn.text.clone(),
        })
        .collect()
}

/// 制作轮次发送核心：确保会话存在后**纯文本直发**——`chain_cards` 与
/// `posture` 都传 `None`（制作助手不装配链路卡与姿态段——姿态经真实链路
/// 试用由试问车道负责，模型工具面也无 story 工具），无选区、无取材、无
/// provenance。走 [`DshDriverManager::send_message_with_cards_and_wait`] 即复用
/// 既有等待、停滞看护与全局并发准入（同讨论重复 / 全局超限在写协议前拒绝）。
fn send_making_message_core(
    manager: &DshDriverManager,
    registry: &MakingSessionRegistry,
    conversations_dir: &Path,
    conversation_id: &str,
    message_id: &str,
    text: &str,
) -> Result<MessageOutcome, GenerateAiError> {
    let driver_session_id =
        ensure_making_session(manager, registry, conversations_dir, conversation_id)?;
    manager.send_message_with_cards_and_wait(
        &driver_session_id,
        message_id,
        text,
        None,
        None,
        REQUEST_TIMEOUT,
    )
}

/// 结束制作会话：注册表除名＋驱动侧尽力结束（幂等）。前端在收到既有
/// `ai-driver-lost` 事件后调用以清除失效条目；不触碰 `story_tool_channel`
/// （制作会话从未注册工具路由，结构上无待决授权可清）。
fn end_making_session_core(
    manager: &DshDriverManager,
    registry: &MakingSessionRegistry,
    conversation_id: &str,
) -> Result<(), GenerateAiError> {
    let removed = registry.locked().remove(conversation_id);
    match removed {
        Some(driver_session_id) => manager.end_session(&driver_session_id).map(|_| ()),
        None => Ok(()),
    }
}

// ========== 配置与驱动懒启动（自建调用链，镜像 generate.rs 现有写法） ==========

/// 从应用数据目录派生版本隔离的 DSH_HOME（与常驻链同一布局）。
fn versioned_dsh_home(base_dir: &Path) -> PathBuf {
    DshVersionLayout::new(base_dir.join("dsh")).current_home()
}

/// 加载已保存的唯一 LLM 配置（阻塞读取放阻塞线程；文案与常驻链一致）。
async fn load_saved_config(base_dir: &Path) -> Result<LlmConfig, GenerateAiError> {
    let base = base_dir.to_path_buf();
    let loaded = tauri::async_runtime::spawn_blocking(move || load_llm_config(&base)).await;
    match loaded {
        Ok(Ok(Some(config))) => Ok(config),
        Ok(Ok(None)) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "缺少 LLM 配置，请先到设置中填写并保存 API 地址、Key 与模型名",
        )),
        Ok(Err(_)) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置无法读取，请重新保存配置",
        )),
        Err(_) => Err(GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置目录读取任务执行失败，请重启应用后重试",
        )),
    }
}

/// 确保常驻驱动进程以当前配置启动（懒启动 / 参数变化重启 / 崩溃重启，
/// 与常驻链共用同一进程与配置加载路径）。
async fn ensure_driver_started(
    config: &LlmConfig,
    base_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<(), GenerateAiError> {
    validate_llm_config(config).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置不完整，请检查 API 地址、Key 与模型名",
        )
    })?;
    let paths =
        crate::dsh_sidecar::resolve_paths(Some(versioned_dsh_home(base_dir)), resource_dir)?;
    let params = DriverParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
        max_tokens: config.max_tokens,
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().ensure_started(&params, &paths)
    })
    .await
    .map_err(|join_error| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("驱动启动任务执行失败: {join_error}"),
        )
    })?
}

// ========== Tauri 命令（任务 5.2 / 5.3；镜像 ai_host 形态） ==========

/// 制作会话事件名（前端订阅）：载荷与既有 `ai-delta` 同构
/// （`{session_id, message_id, seq, text}`），其中 `session_id` 为**制作会话 id**
/// （已剥驱动前缀，与命令入参一致）。终态不走路内事件——与日常链一致，
/// 由 `making_send_message` 的命令结果携带（成功全文 / 失败错误）。
pub const MAKING_MESSAGE_EVENT: &str = "making-message-event";

/// 制作增量事件分发：以分发 sink 替换 `ai_host` 安装的直通 sink——
/// `making-` 前缀会话的增量改发 [`MAKING_MESSAGE_EVENT`]；其余（日常会话）
/// 保持 `ai-delta` 事件名与载荷逐字不变（对日常链零行为变化）。
/// 必须在 `ai_host::install_driver_event_bridge` **之后**安装（lib.rs setup
/// 次序保证）；sink 仅此一处替换，两端事件名互不串扰。
pub(crate) fn install_making_event_bridge(app: &tauri::AppHandle) {
    let handle = app.clone();
    crate::dsh_driver::global_driver_manager().set_sink(Arc::new(move |payload| {
        if let Some(conversation_id) = making_conversation_id_of_driver_session(&payload.session_id)
        {
            let making_payload = crate::dsh_driver::DeltaPayload {
                session_id: conversation_id.to_string(),
                message_id: payload.message_id.clone(),
                seq: payload.seq,
                text: payload.text.clone(),
            };
            let _ = handle.emit(MAKING_MESSAGE_EVENT, &making_payload);
        } else {
            let _ = handle.emit("ai-delta", &payload);
        }
    }));
}

/// 从 AppState 取制作会话注册表（便宜 Clone 后移入阻塞线程）。
fn registry_from_app(app: &tauri::AppHandle) -> MakingSessionRegistry {
    app.state::<MakingSessionRegistry>().inner().clone()
}

/// 制作会话：启动会话（同时懒启动驱动进程；会话已存在时幂等复用，档案有
/// 历史则自动重放 seed——重开会话的恢复入口）。
#[tauri::command]
pub(crate) async fn making_start_session(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    let config = match load_saved_config(&dir).await {
        Ok(config) => config,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };
    if let Err(error) = ensure_driver_started(&config, &dir, resource_dir.as_deref()).await {
        return Ok(GenerateAiResult::failure(error));
    }
    let registry = registry_from_app(&app);
    let conversations_dir = conversations_dir_in(&making_module_dir_in(&dir));
    let conversation = conversation_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        ensure_making_session(
            crate::dsh_driver::global_driver_manager(),
            &registry,
            &conversations_dir,
            &conversation,
        )
    })
    .await;
    match result {
        Ok(Ok(_)) => Ok(GenerateAiResult::success(String::new())),
        Ok(Err(error)) => Ok(GenerateAiResult::failure(error)),
        Err(join_error) => Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("制作会话启动任务执行失败: {join_error}"),
        ))),
    }
}

/// 制作会话：发送消息并等待终态。user 文本纯文本直发（无选区授权、无自动
/// 取材、无目录检索、无 chain_cards、无 provenance）；流式增量经
/// [`MAKING_MESSAGE_EVENT`] 事件呈现；终态由本命令结果携带（镜像日常
/// `ai_send_message` 的结果契约，含 `sent_confirmed` 回执语义）。
#[tauri::command]
pub(crate) async fn making_send_message(
    app: tauri::AppHandle,
    conversation_id: String,
    message_id: String,
    text: String,
) -> Result<GenerateAiResult, String> {
    if text.trim().is_empty() {
        return Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "消息内容为空，请输入后再发送",
        )));
    }
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    let config = match load_saved_config(&dir).await {
        Ok(config) => config,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };
    if let Err(error) = ensure_driver_started(&config, &dir, resource_dir.as_deref()).await {
        return Ok(GenerateAiResult::failure(error));
    }
    let registry = registry_from_app(&app);
    let conversations_dir = conversations_dir_in(&making_module_dir_in(&dir));
    let conversation = conversation_id.clone();
    let message = message_id.clone();
    let question = text.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        send_making_message_core(
            crate::dsh_driver::global_driver_manager(),
            &registry,
            &conversations_dir,
            &conversation,
            &message,
            &question,
        )
    })
    .await;
    match result {
        Ok(Ok(outcome)) => {
            // 成功轮次携带 provider 发送回执（与日常链同一「未确认不伪造」语义）。
            let mut result = GenerateAiResult::success(outcome.text);
            result.sent_confirmed = Some(outcome.sent_confirmed);
            Ok(result)
        }
        Ok(Err(error)) => Ok(GenerateAiResult::failure(error)),
        Err(join_error) => Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("制作生成任务执行失败: {join_error}"),
        ))),
    }
}

/// 制作会话：取消进行中的生成（幂等；镜像日常 `ai_cancel_message`）。
#[tauri::command]
pub(crate) async fn making_cancel_message(
    app: tauri::AppHandle,
    conversation_id: String,
    message_id: String,
) -> Result<GenerateAiResult, String> {
    let registry = registry_from_app(&app);
    let conversation = conversation_id.clone();
    let message = message_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let driver_session_id = {
            let sessions = registry.locked();
            sessions.get(&conversation).cloned()
        };
        match driver_session_id {
            // 无注册会话＝无进行中的制作轮次，幂等成功。
            Some(driver_session_id) => crate::dsh_driver::global_driver_manager()
                .cancel_message(&driver_session_id, &message)
                .map(|_| ()),
            None => Ok(()),
        }
    })
    .await;
    match result {
        Ok(Ok(())) => Ok(GenerateAiResult::success(String::new())),
        Ok(Err(error)) => Ok(GenerateAiResult::failure(error)),
        Err(join_error) => Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("取消制作生成任务执行失败: {join_error}"),
        ))),
    }
}

/// 制作会话：结束会话（收到 `ai-driver-lost` 后的复位入口，或删除会话时的
/// 清理；幂等）。清除注册表条目后，下次 start / send 自动走恢复路径。
#[tauri::command]
pub(crate) async fn making_end_session(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<GenerateAiResult, String> {
    let registry = registry_from_app(&app);
    let conversation = conversation_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        end_making_session_core(
            crate::dsh_driver::global_driver_manager(),
            &registry,
            &conversation,
        )
    })
    .await;
    match result {
        Ok(Ok(())) => Ok(GenerateAiResult::success(String::new())),
        Ok(Err(error)) => Ok(GenerateAiResult::failure(error)),
        Err(join_error) => Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("结束制作会话任务执行失败: {join_error}"),
        ))),
    }
}

/// 按链路列出制作会话（`updated_at` 倒序）；损坏/超限档案跳过并如实提示。
/// `chain_id` 为 `null` 时列出未绑定会话；不校验链路是否仍存在。
#[tauri::command]
pub(crate) async fn making_conversation_list(
    app: tauri::AppHandle,
    chain_id: Option<String>,
) -> Result<MakingConversationListResult, String> {
    let conversations_dir = making_conversations_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        list_making_conversations(&conversations_dir, chain_id.as_deref())
    })
    .await
    .map_err(|e| format!("读取制作会话列表任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 读取一份完整制作会话档案（重开会话用）；缺失/损坏/超限明确报错。
#[tauri::command]
pub(crate) async fn making_conversation_load(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<MakingConversationRecord, String> {
    let conversations_dir = making_conversations_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        load_making_conversation(&conversations_dir, &conversation_id)
    })
    .await
    .map_err(|e| format!("读取制作会话任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 保存（原子写入）一份制作会话档案：前端驱动的整档保存，按传入内容原样
/// 落盘（制作档案无后端自有字段，无合并保护）；保存失败明确报错，前端据此
/// 呈现失败、不显示已保存。
#[tauri::command]
pub(crate) async fn making_conversation_save(
    app: tauri::AppHandle,
    record: MakingConversationRecord,
) -> Result<(), String> {
    let conversations_dir = making_conversations_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_making_conversation(&conversations_dir, &record)
    })
    .await
    .map_err(|e| format!("保存制作会话任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 删除一份制作会话档案（幂等：不存在视为成功）。
#[tauri::command]
pub(crate) async fn making_conversation_delete(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<(), String> {
    let conversations_dir = making_conversations_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_making_conversation(&conversations_dir, &conversation_id)
    })
    .await
    .map_err(|e| format!("删除制作会话任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 解析应用本地数据目录 → `making-module/conversations/`（不可得时明确报错）。
pub(crate) fn making_conversations_dir_from_app(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| conversations_dir_in(&making_module_dir_in(&dir)))
        .map_err(|e| format!("无法访问应用本地数据目录: {e}"))
}

// ========== 单元测试（任务 5.1/5.2/5.3） ==========

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsh_sidecar::DshRuntimePaths;

    // ---------- 任务 5.1：制作助手信封 ----------

    /// 首行逐字＝制作助手身份句（拆段契约：驱动侧按首个换行拆 persona）。
    #[test]
    fn making_envelope_first_line_is_verbatim_identity_sentence() {
        let envelope = making_session_system_prompt();
        let mut lines = envelope.split('\n');
        assert_eq!(
            lines.next(),
            Some("你是帮助剧本创作者制作陪想要求的助手。"),
            "信封首行必须是制作助手身份句（逐字）"
        );
    }

    /// 红线同文包含且次序固定：首个换行后＝红线全文（一字不改）＋空行＋守则段，
    /// 红线永居守则（与任何卡内容）之上。
    #[test]
    fn making_envelope_carries_constitution_verbatim_then_guard_rules() {
        let envelope = making_session_system_prompt();
        let (first_line, rest) = envelope.split_once('\n').expect("信封必含首个换行");
        assert_eq!(first_line, "你是帮助剧本创作者制作陪想要求的助手。");
        // 红线同文：rest 以红线常量开头（一字不改，无第二副本）。
        assert!(
            rest.starts_with(CONSTITUTION_CLAUSES),
            "首个换行后必须以宪法红线同文开头"
        );
        assert!(
            envelope.contains(CONSTITUTION_CLAUSES),
            "信封必须包含红线全文"
        );
        // 红线之后恰为一个空行，再接守则段。
        let after_constitution = &rest[CONSTITUTION_CLAUSES.len()..];
        assert!(
            after_constitution.starts_with("\n\n"),
            "红线与守则段之间必须恰为一个空行"
        );
        assert!(
            after_constitution[2..].starts_with("制作守则："),
            "空行后必须是制作守则段"
        );
        // 次序不变式：红线在守则之前（同段内次序固定）。
        let constitution_at = envelope.find(CONSTITUTION_CLAUSES).expect("红线在场");
        let guard_at = envelope.find("制作守则：").expect("守则在场");
        assert!(constitution_at < guard_at, "红线必须永居守则之前");
        // 与日常信封相互独立：不含日常身份句，也不是日常信封。
        assert!(
            !envelope.contains("你是陪伴剧本创作者思考与探索的助手。"),
            "制作信封不得携带日常身份句"
        );
        assert_ne!(envelope, crate::llm_config::session_system_prompt());
    }

    /// 守则各要点在场（spec：制作助手信封构成＋行为规范；add-posture-slot
    /// 任务 3.1：姿态卡把关条款）；且信封不含任何 story 工具引导（制作会话
    /// 工具面无四件套，提示词同样不出现）。
    #[test]
    fn making_envelope_covers_all_guard_rule_points_and_no_story_tools() {
        let envelope = making_session_system_prompt();
        for point in [
            "不读取任何作品材料",
            "只依据用户的口述与试问结果工作",
            "适量提问澄清",
            "总沟通负担",
            "大白话解释",
            "溯源到用户的口述",
            "不自创要求",
            "卡草稿是临时材料",
            "显式启用之前不产生任何效果",
            "「这版不错」",
            "不等于启用",
            "不替用户判断创意高低",
            "前往制作模块的制作对话",
        ] {
            assert!(envelope.contains(point), "制作守则缺少要点: {point}");
        }
        // 姿态卡把关条款（add-posture-slot 任务 3.1＋2026-10-07 修订 7.2/7.5，
        // spec making-conversation：范围／骨与衣服分界／裁判性诉求转化／
        // 第二人称＋底线不换皮／多张并存不调和＋第二张先问替换或并存＋完整
        // 卡清单（并存＝原样重述＋新卡，替换＝只新卡，不知既有卡时如实说明
        // 不编造）＋相抵提醒不阻止／纯姿态版本允许／触发描述不自动切换）。
        for point in [
            "用户口述的人设、看剧本的出发点或陪想本身的姿态",
            "语气上的皮",
            "真要陪想当裁判",
            "语气随便换，裁判权换不走",
            "只转化为语气条款，不写入职权条款",
            "第二人称",
            "底线不换皮",
            "毒舌后必须跟实打实的想法",
            "说作品「不行」只能带依据",
            "不代写，稿子一字不许动",
            "可以并存多张姿态卡",
            "系统不做冲突调和",
            "怎么组合由用户决定",
            "替换现有的，还是并存",
            "替换＝出一个新版本，并存＝同版本多张",
            "草稿代表新版本的完整卡清单",
            "把既有卡原样重述、与新卡一起输出",
            "替换时只输出新卡",
            "先如实说明",
            "「链路现状」附言",
            "用户提供的文本重述",
            "不编造",
            "明显相抵（如相反的语气）",
            "明确提醒用户，但不阻止保存",
            "只含姿态卡、不含要求卡的版本允许保存",
            "触发描述仅供用户选择链路时参考，系统不会据此自动切换姿态",
        ] {
            assert!(envelope.contains(point), "姿态卡把关条款缺少要点: {point}");
        }
        // 新条款次序（修订 7.5）：完整卡清单条紧随「先问替换或并存」之后、
        // 「相抵提醒」之前——与钉死合同的插入位置一致。
        let ask_at = envelope
            .find("替换现有的，还是并存")
            .expect("先问替换或并存条在场");
        let list_at = envelope
            .find("草稿代表新版本的完整卡清单")
            .expect("完整卡清单条在场");
        let conflict_at = envelope
            .find("发现新姿态与已有姿态明显相抵")
            .expect("相抵提醒条在场");
        assert!(
            ask_at < list_at && list_at < conflict_at,
            "完整卡清单条必须位于「先问替换或并存」之后、「相抵提醒」之前"
        );
        // 旧「至多一张」措辞不得残留（2026-10-07 用户拍板否决）。
        for prohibited_old in ["至多一张姿态卡", "不并存两张", "每版本至多一张"]
        {
            assert!(
                !envelope.contains(prohibited_old),
                "旧「至多一张」措辞已被多张并存修订取代，不得残留: {prohibited_old}"
            );
        }
        // 卡草稿输出格式段（任务 B，逐字；add-posture-slot 协议项 8：类型行在
        // 「卡名」之前）：固定标记块完整在场且次序固定。
        for point in [
            "产出或修改卡草稿时，用固定标记块输出，便于界面识别：",
            "【卡草稿开始】",
            "类型：要求卡 或 类型：姿态卡",
            "卡名：…",
            "何时用：…",
            "何时不用：…",
            "正文：…",
            "【卡草稿结束】",
            "一次可输出多个块；块外文字正常对话。",
        ] {
            assert!(envelope.contains(point), "草稿输出格式段缺少要点: {point}");
        }
        let start_at = envelope.find("【卡草稿开始】").expect("开始标记");
        let type_at = envelope
            .find("类型：要求卡 或 类型：姿态卡")
            .expect("类型行");
        let name_at = envelope.find("卡名：…").expect("卡名行");
        let end_at = envelope.find("【卡草稿结束】").expect("结束标记");
        assert!(start_at < end_at, "开始标记必须先于结束标记");
        assert!(
            start_at < type_at && type_at < name_at,
            "类型行必须位于「卡名」之前（卡草稿标记块协议）"
        );
        for tool in [
            "story-list",
            "story-read",
            "story-search",
            "story-request-reading",
        ] {
            assert!(
                !envelope.contains(tool),
                "制作信封不得出现 story 工具引导: {tool}"
            );
        }
        // 驱动侧 dsh-system-prompt 严格变量插值：未知 {{…}} 引用会 fail loud。
        assert!(
            !envelope.contains("{{"),
            "信封文本不得包含插值变量引用（{{）"
        );
    }

    /// 纯常量组装：两次组装逐字相等（正常建会话与崩溃恢复重放逐字一致的
    /// 基础）。
    #[test]
    fn making_envelope_is_pure_constant_assembly() {
        assert_eq!(
            making_session_system_prompt(),
            making_session_system_prompt(),
            "纯常量：两次组装必须逐字相等"
        );
    }

    /// 驱动会话 id 前缀解析：制作车道可识别、日常会话不误判。
    #[test]
    fn driver_session_prefix_routes_making_only() {
        assert_eq!(
            making_conversation_id_of_driver_session("making-mconv-1-7"),
            Some("mconv-1")
        );
        assert_eq!(
            making_conversation_id_of_driver_session("conv-1725-aaaa:msg-1"),
            None,
            "日常会话 id 不得被误判为制作车道"
        );
        assert_eq!(making_conversation_id_of_driver_session("making-"), None);
    }

    // ---------- 任务 5.3：制作对话持久化 ----------

    fn sample_record(id: &str, chain_id: &str, updated_at: &str) -> MakingConversationRecord {
        MakingConversationRecord {
            id: id.to_string(),
            chain_id: Some(chain_id.to_string()),
            title: format!("制作 {id}"),
            created_at: "2026-10-06T10:00:00.000Z".to_string(),
            updated_at: updated_at.to_string(),
            turns: vec![
                MakingTurn {
                    role: "user".to_string(),
                    text: "我想要一条先问动机的链路".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "好的，先澄清两点……".to_string(),
                    status: "success".to_string(),
                },
            ],
        }
    }

    fn temp_conversations_dir() -> (tempfile::TempDir, PathBuf) {
        let base = tempfile::tempdir().expect("创建临时目录");
        let module_dir = making_module_dir_in(base.path());
        let conversations_dir = conversations_dir_in(&module_dir);
        (base, conversations_dir)
    }

    // TempDir 存活到函数结束（档案文件依赖它存在）。

    /// 保存 → 读取 → 按链路列出（updated_at 倒序）整链路往返；serde 字段
    /// snake_case 锚定（前端契约）。
    #[test]
    fn making_conversations_roundtrip_list_desc_and_snake_case() {
        let (_base, dir) = temp_conversations_dir();
        save_making_conversation(
            &dir,
            &sample_record("mc-1", "chain-a", "2026-10-06T10:00:00.000Z"),
        )
        .expect("保存 1");
        save_making_conversation(
            &dir,
            &sample_record("mc-2", "chain-a", "2026-10-06T12:00:00.000Z"),
        )
        .expect("保存 2");
        save_making_conversation(
            &dir,
            &sample_record("mc-3", "chain-b", "2026-10-06T11:00:00.000Z"),
        )
        .expect("保存 3（其他链路）");

        let list = list_making_conversations(&dir, Some("chain-a")).expect("列出 chain-a");
        assert_eq!(list.skipped.len(), 0);
        assert_eq!(
            list.conversations
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            vec!["mc-2", "mc-1"],
            "按 updated_at 倒序，且只含该链路"
        );
        assert_eq!(list.conversations[0].turn_count, 2);

        let loaded = load_making_conversation(&dir, "mc-1").expect("读取");
        assert_eq!(
            loaded,
            sample_record("mc-1", "chain-a", "2026-10-06T10:00:00.000Z")
        );

        // serde 字段名（前端契约）：snake_case 锚定。
        let json = serde_json::to_value(&loaded).expect("序列化");
        for field in [
            "id",
            "chain_id",
            "title",
            "created_at",
            "updated_at",
            "turns",
        ] {
            assert!(json.get(field).is_some(), "档案缺少字段 {field}");
        }
        let turn = &json["turns"][0];
        for field in ["role", "text", "status"] {
            assert!(turn.get(field).is_some(), "轮次缺少字段 {field}");
        }
    }

    /// 空链路无档案：列表返回空（空态引导由前端负责，命令层如实返回空）。
    #[test]
    fn making_conversation_list_empty_when_no_archive() {
        let (_base, dir) = temp_conversations_dir();
        let list = list_making_conversations(&dir, Some("chain-none")).expect("列出空链路");
        assert!(list.conversations.is_empty());
        assert!(list.skipped.is_empty());
    }

    fn sample_unbound_record(id: &str, updated_at: &str) -> MakingConversationRecord {
        let mut record = sample_record(id, "chain-ignored", updated_at);
        record.chain_id = None;
        record
    }

    /// 未绑定会话（空库直接口述）：以 `null` chain_id 往返，并在未绑定列表下可见。
    #[test]
    fn making_conversation_unbound_roundtrip_and_list() {
        let (_base, dir) = temp_conversations_dir();
        save_making_conversation(
            &dir,
            &sample_unbound_record("mc-u1", "2026-10-06T10:00:00.000Z"),
        )
        .expect("保存未绑定 1");
        save_making_conversation(
            &dir,
            &sample_unbound_record("mc-u2", "2026-10-06T12:00:00.000Z"),
        )
        .expect("保存未绑定 2");
        save_making_conversation(
            &dir,
            &sample_record("mc-b1", "chain-a", "2026-10-06T11:00:00.000Z"),
        )
        .expect("保存已绑定");

        let list = list_making_conversations(&dir, None).expect("列出未绑定");
        assert_eq!(
            list.conversations
                .iter()
                .map(|summary| summary.id.as_str())
                .collect::<Vec<_>>(),
            vec!["mc-u2", "mc-u1"],
            "只含未绑定会话，按 updated_at 倒序"
        );
        assert!(list
            .conversations
            .iter()
            .all(|summary| summary.chain_id.is_none()));

        let loaded = load_making_conversation(&dir, "mc-u1").expect("读取未绑定");
        assert!(loaded.chain_id.is_none(), "未绑定以 null 往返");
    }

    /// 旧档案兼容：字符串 chain_id 反序列化为 `Some`；`null` 为未绑定。
    #[test]
    fn making_conversation_legacy_string_chain_id_is_compatible() {
        let legacy = r#"{"id":"mc-old","chain_id":"chain-a","title":"旧","created_at":"t","updated_at":"t","turns":[]}"#;
        let record: MakingConversationRecord = serde_json::from_str(legacy).expect("旧档案可读");
        assert_eq!(record.chain_id.as_deref(), Some("chain-a"));
        let unbound = r#"{"id":"mc-new","chain_id":null,"title":"新","created_at":"t","updated_at":"t","turns":[]}"#;
        let record: MakingConversationRecord = serde_json::from_str(unbound).expect("null 可读");
        assert!(record.chain_id.is_none());
    }

    /// 空字符串 chain_id 明确拒绝（不得以空字符串伪造未绑定）。
    #[test]
    fn making_conversation_empty_string_chain_id_is_rejected() {
        let (_base, dir) = temp_conversations_dir();
        let mut record = sample_record("mc-x", "chain-a", "t");
        record.chain_id = Some("   ".to_string());
        let error = save_making_conversation(&dir, &record).expect_err("空字符串应被拒绝");
        assert!(error.to_string().contains("空字符串"), "{error}");
    }

    /// 绑定单调保护：普通整档保存不得撤销或改绑已落盘绑定；首次绑定（None→Some）允许。
    #[test]
    fn save_rejects_binding_regression() {
        let (_base, dir) = temp_conversations_dir();
        let bound = sample_record("mc-b", "chain-a", "t");
        save_making_conversation(&dir, &bound).expect("保存已绑定");

        let mut unbound = bound.clone();
        unbound.chain_id = None;
        let error = save_making_conversation(&dir, &unbound).expect_err("不得撤销绑定");
        assert!(error.to_string().contains("不得解除绑定"), "{error}");

        let mut rebound = bound.clone();
        rebound.chain_id = Some("chain-b".to_string());
        let error = save_making_conversation(&dir, &rebound).expect_err("不得改绑");
        assert!(error.to_string().contains("不得改绑"), "{error}");

        // 首次绑定（None→Some）允许。
        let unbound0 = sample_unbound_record("mc-u", "t");
        save_making_conversation(&dir, &unbound0).expect("未绑定可保存");
        let mut first_bind = unbound0.clone();
        first_bind.chain_id = Some("chain-x".to_string());
        save_making_conversation(&dir, &first_bind).expect("首次绑定允许");
    }

    /// ensure 边界（经受限跨存储 helper，空 body）：不存在 / 已删除 / 绑定冲突拒绝；绑定一致允许。
    #[test]
    fn with_conversation_store_lock_rejects_missing_deleted_and_conflict() {
        let (_base, dir) = temp_conversations_dir();
        assert!(
            with_conversation_store_lock(&dir, "mc-none", "chain-mc-none", || Ok(())).is_err(),
            "不存在的会话拒绝"
        );

        save_making_conversation(&dir, &sample_unbound_record("mc-del", "t")).expect("保存");
        delete_making_conversation(&dir, "mc-del").expect("删除");
        let error = with_conversation_store_lock(&dir, "mc-del", "chain-mc-del", || Ok(()))
            .expect_err("删除后拒绝");
        assert!(error.contains("已删除"), "{error}");

        save_making_conversation(&dir, &sample_record("mc-conf", "chain-a", "t")).expect("保存");
        let error = with_conversation_store_lock(&dir, "mc-conf", "chain-mc-conf", || Ok(()))
            .expect_err("改绑拒绝");
        assert!(error.contains("已绑定"), "{error}");
        with_conversation_store_lock(&dir, "mc-conf", "chain-a", || Ok(())).expect("绑定一致允许");
    }

    /// 受限 helper 在 body 期间持有会话存储锁：并发 delete 阻塞到 body 完成，
    /// 因此 delete 无法插入校验与链路写入之间（无孤链、无死锁）。
    #[test]
    fn with_conversation_store_lock_serializes_concurrent_delete() {
        let (_base, dir) = temp_conversations_dir();
        save_making_conversation(&dir, &sample_unbound_record("mc-lock", "t")).expect("保存");

        let dir_for_ensure = dir.clone();
        let (in_body_tx, in_body_rx) = std::sync::mpsc::channel::<()>();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let ensure = std::thread::spawn(move || {
            with_conversation_store_lock(&dir_for_ensure, "mc-lock", "chain-mc-lock", || {
                in_body_tx.send(()).expect("信号");
                release_rx.recv().expect("等待放行");
                Ok::<_, String>(())
            })
        });
        in_body_rx.recv().expect("body 已进入（持锁）");

        let dir_for_delete = dir.clone();
        let deleted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let deleted_flag = deleted.clone();
        let deleter = std::thread::spawn(move || {
            delete_making_conversation(&dir_for_delete, "mc-lock").expect("删除");
            deleted_flag.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            !deleted.load(std::sync::atomic::Ordering::SeqCst),
            "delete 应在 body 持锁期间阻塞"
        );

        release_tx.send(()).expect("放行");
        ensure.join().expect("ensure 完成").expect("ensure 成功");
        deleter.join().expect("delete 完成");
        assert!(deleted.load(std::sync::atomic::Ordering::SeqCst));
    }

    /// 损坏/超限档案：load 明确报错；list 跳过并如实提示（不静默吞）。
    #[test]
    fn making_conversations_corrupt_and_oversized_are_explicit() {
        let (_base, dir) = temp_conversations_dir();
        fs::create_dir_all(&dir).expect("建目录");
        fs::write(dir.join("mc-bad.json"), "{ \"id\":").expect("写损坏档案");
        fs::write(
            dir.join("mc-big.json"),
            "x".repeat(MAX_MAKING_CONVERSATION_BYTES as usize + 128),
        )
        .expect("写超限档案");

        let error = load_making_conversation(&dir, "mc-bad").expect_err("损坏档案必须明确报错");
        assert!(error.to_string().contains("损坏"), "{}", error);
        let error = load_making_conversation(&dir, "mc-big").expect_err("超限档案必须明确报错");
        assert!(error.to_string().contains("1 MiB"), "{}", error);
        let error = load_making_conversation(&dir, "mc-missing").expect_err("缺失档案必须明确报错");
        assert!(error.to_string().contains("不存在"), "{}", error);

        let list = list_making_conversations(&dir, Some("chain-a")).expect("列出");
        assert!(list.conversations.is_empty());
        assert_eq!(list.skipped.len(), 2, "损坏与超限各产生一条可见提示");
        let skipped_text = list.skipped.join("\n");
        assert!(skipped_text.contains("mc-bad") && skipped_text.contains("损坏"));
        assert!(skipped_text.contains("mc-big") && skipped_text.contains("1 MiB"));
    }

    /// 无效记录明确拒绝（不静默修复）：不安全 id、缺链路标识、缺时间戳、
    /// 非法角色/终态、序列化超限——全部未落盘。
    #[test]
    fn making_conversation_save_rejects_invalid_records() {
        let (_base, dir) = temp_conversations_dir();

        let cases: Vec<(MakingConversationRecord, &str)> = vec![
            (
                sample_record("../evil", "chain-a", "2026-10-06T10:00:00.000Z"),
                "标识无效",
            ),
            (
                sample_record("mc-x", "  ", "2026-10-06T10:00:00.000Z"),
                "chain_id",
            ),
            (sample_record("mc-x", "chain-a", " "), "updated_at"),
        ];
        for (record, marker) in cases {
            let error = save_making_conversation(&dir, &record).expect_err("无效记录必须拒绝");
            assert!(
                error.to_string().contains(marker),
                "报错应含 {marker}: {error}"
            );
        }

        let mut bad_role = sample_record("mc-x", "chain-a", "2026-10-06T10:00:00.000Z");
        bad_role.turns[0].role = "system".to_string();
        let error = save_making_conversation(&dir, &bad_role).expect_err("非法角色必须拒绝");
        assert!(error.to_string().contains("角色"), "{}", error);

        let mut bad_status = sample_record("mc-x", "chain-a", "2026-10-06T10:00:00.000Z");
        bad_status.turns[0].status = "interrupted".to_string();
        let error = save_making_conversation(&dir, &bad_status).expect_err("非法终态必须拒绝");
        assert!(error.to_string().contains("终态"), "{}", error);

        let mut oversized = sample_record("mc-x", "chain-a", "2026-10-06T10:00:00.000Z");
        oversized.turns.push(MakingTurn {
            role: "assistant".to_string(),
            text: "字".repeat(MAX_MAKING_CONVERSATION_BYTES as usize),
            status: "success".to_string(),
        });
        let error = save_making_conversation(&dir, &oversized).expect_err("超限必须拒绝");
        assert!(error.to_string().contains("1 MiB"), "{}", error);

        assert!(
            !dir.join("mc-x.json").exists() && !dir.join("../evil.json").exists(),
            "被拒绝的保存不落任何文件"
        );
    }

    /// 删除幂等＋墓碑：删除后迟到的保存被拒绝，不复活已删档案。
    #[test]
    fn making_conversation_delete_is_idempotent_and_tombstoned() {
        let (_base, dir) = temp_conversations_dir();
        let record = sample_record("mc-1", "chain-a", "2026-10-06T10:00:00.000Z");
        save_making_conversation(&dir, &record).expect("保存");
        delete_making_conversation(&dir, "mc-1").expect("删除");
        delete_making_conversation(&dir, "mc-1").expect("再删幂等成功");
        assert!(!dir.join("mc-1.json").exists());

        let error =
            save_making_conversation(&dir, &record).expect_err("删除后的迟到保存必须被墓碑拒绝");
        assert!(error.to_string().contains("已删除"), "{}", error);
        assert!(!dir.join("mc-1.json").exists(), "档案不得复活");
    }

    /// 写入失败如实报错（占位文件顶住目录位置，建目录/临时文件必然失败）。
    #[test]
    fn making_conversation_write_failure_is_reported() {
        let base = tempfile::tempdir().expect("创建临时目录");
        let module_dir = making_module_dir_in(base.path());
        fs::write(&module_dir, b"not a dir").expect("占位文件");
        let dir = conversations_dir_in(&module_dir);
        let error = save_making_conversation(&dir, &sample_record("mc-1", "chain-a", "t"))
            .expect_err("写入失败必须报错");
        assert!(
            error.to_string().contains("保存制作会话档案失败"),
            "{}",
            error
        );
    }

    // ---------- 任务 5.2：会话核心（假驱动端到端） ----------

    /// 假驱动夹具（模式同 dsh_driver 测试）：记录每个会话的 session_kind 与
    /// 信封、重放 turns；send_message 时以 JSON 回显全部观测（kind / prompt /
    /// replayTurns / chainCards / text / sessionId），端到端断言宿主发送侧。
    fn observing_driver_script() -> String {
        r#"
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const kinds = new Map();
const prompts = new Map();
const replays = new Map();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    kinds.set(cmd.session_id, Object.hasOwn(cmd, 'session_kind') ? cmd.session_kind : '(absent)');
    prompts.set(cmd.session_id, cmd.system_prompt);
    replays.set(cmd.session_id, []);
    console.log(JSON.stringify({ type: 'session_started', session_id: cmd.session_id }));
  } else if (cmd.type === 'replay_history') {
    replays.get(cmd.session_id).push(...(cmd.turns ?? []));
  } else if (cmd.type === 'replay_done') {
    console.log(JSON.stringify({ type: 'replay_ok', session_id: cmd.session_id }));
  } else if (cmd.type === 'send_message') {
    console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: JSON.stringify({
      kind: kinds.get(cmd.session_id) ?? null,
      prompt: prompts.get(cmd.session_id) ?? null,
      replayTurns: replays.get(cmd.session_id) ?? [],
      chainCards: Object.hasOwn(cmd, 'chain_cards') ? cmd.chain_cards : null,
      posture: Object.hasOwn(cmd, 'posture') ? cmd.posture : null,
      text: cmd.text,
      sessionId: cmd.session_id,
    }) }));
  } else if (cmd.type === 'end_session') {
    console.log(JSON.stringify({ type: 'session_ended', session_id: cmd.session_id }));
  } else if (cmd.type === 'cancel_message') {
    console.log(JSON.stringify({ type: 'message_failed', session_id: cmd.session_id, message_id: cmd.message_id, code: 'cancelled', message: '已取消' }));
  } else if (cmd.type === 'shutdown') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
setInterval(() => {}, 1000);
"#
        .to_string()
    }

    fn fake_driver_paths(script: &str) -> (tempfile::TempDir, DshRuntimePaths, DriverParams) {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let driver_dir = temp.path().join("driver");
        fs::create_dir_all(&driver_dir).expect("driver dir");
        let driver_entry = driver_dir.join("driver.mjs");
        fs::write(&driver_entry, script).expect("write fake driver");
        let paths = DshRuntimePaths {
            node_bin: PathBuf::from("node"),
            bin_js: PathBuf::new(),
            driver_entry,
            driver_cwd: driver_dir,
            dsh_home: Some(temp.path().join("home")),
        };
        let params = DriverParams {
            model: "m".to_string(),
            api_base_url: "http://localhost".to_string(),
            api_key: "k".to_string(),
            max_tokens: None,
        };
        (temp, paths, params)
    }

    /// 解析假驱动回显的观测 JSON。
    fn parse_observation(outcome: &MessageOutcome) -> serde_json::Value {
        serde_json::from_str(&outcome.text).expect("假驱动回显必须是 JSON")
    }

    /// 端到端：制作会话以 `session_kind="making"`＋纯常量信封建立；有历史档案
    /// 时自动重放 seed（user＋assistant success/cancelled，排除 pending/failed/
    /// 空文本）；发送文本纯文本直发、线缆无 chain_cards；同会话第二次发送
    /// 复用既有驱动会话（不重建、不重放）。
    #[test]
    fn making_core_starts_making_session_replays_archive_and_sends_pure_text() {
        let (_base, conversations_dir) = temp_conversations_dir();
        // 档案：可重放（user / assistant success / assistant cancelled）＋
        // 不可重放（assistant failed / assistant pending / 空 user）各就位。
        let record = MakingConversationRecord {
            id: "mc-1".to_string(),
            chain_id: Some("chain-a".to_string()),
            title: "制作".to_string(),
            created_at: "2026-10-06T10:00:00.000Z".to_string(),
            updated_at: "2026-10-06T10:05:00.000Z".to_string(),
            turns: vec![
                MakingTurn {
                    role: "user".to_string(),
                    text: "我想要一条先问动机的链路".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "好的，先澄清两点。".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "user".to_string(),
                    text: "第二点展开说说".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "（部分内容后停止）".to_string(),
                    status: "cancelled".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "失败轮不应重放".to_string(),
                    status: "failed".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "进行中轮不应重放".to_string(),
                    status: "pending".to_string(),
                },
                MakingTurn {
                    role: "user".to_string(),
                    text: "   ".to_string(),
                    status: "success".to_string(),
                },
            ],
        };
        save_making_conversation(&conversations_dir, &record).expect("保存档案");

        let (_temp, paths, params) = fake_driver_paths(&observing_driver_script());
        let manager = DshDriverManager::new();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let registry = MakingSessionRegistry::default();

        let outcome = send_making_message_core(
            &manager,
            &registry,
            &conversations_dir,
            "mc-1",
            "m-1",
            "帮我改这张卡",
        )
        .expect("制作轮次完成");
        let observed = parse_observation(&outcome);
        assert_eq!(observed["kind"], "making", "必须以 making 会话种类建立");
        assert_eq!(
            observed["prompt"],
            making_session_system_prompt(),
            "信封必须与纯常量组装逐字一致（单一来源）"
        );
        assert_eq!(
            observed["chainCards"],
            serde_json::Value::Null,
            "制作轮次线缆上不得出现 chain_cards 字段"
        );
        assert_eq!(
            observed["posture"],
            serde_json::Value::Null,
            "制作轮次线缆上不得出现 posture 字段（制作助手不装配姿态段）"
        );
        assert_eq!(observed["text"], "帮我改这张卡", "user 文本纯文本直发");
        assert!(
            observed["sessionId"]
                .as_str()
                .expect("sessionId")
                .starts_with("making-mc-1-"),
            "驱动会话 id 必须带制作车道保留前缀"
        );

        let replay_turns = observed["replayTurns"].as_array().expect("重放 turns");
        assert_eq!(
            replay_turns.len(),
            4,
            "只重放 user×2＋assistant success＋cancelled"
        );
        assert_eq!(replay_turns[0]["role"], "user");
        assert_eq!(replay_turns[1]["role"], "assistant");
        assert_eq!(replay_turns[2]["role"], "user");
        assert_eq!(replay_turns[3]["role"], "assistant");
        let replay_text = observed["replayTurns"].to_string();
        assert!(
            !replay_text.contains("失败轮") && !replay_text.contains("进行中轮"),
            "failed / pending 轮不得进入 seed"
        );

        // 同会话第二次发送：复用驱动会话——不重放（replayTurns 仍为上次的 4 条，
        // 新会话才从零记录）。
        let second = send_making_message_core(
            &manager,
            &registry,
            &conversations_dir,
            "mc-1",
            "m-2",
            "再改一处",
        )
        .expect("第二次发送完成");
        let observed2 = parse_observation(&second);
        assert_eq!(
            observed2["sessionId"], observed["sessionId"],
            "注册表命中时必须复用同一驱动会话"
        );
        assert_eq!(
            observed2["replayTurns"].as_array().expect("turns").len(),
            4,
            "复用会话不得重复重放"
        );

        manager.shutdown_best_effort();
    }

    /// 无档案的新会话：直接建立（无重放），发送照常。
    #[test]
    fn making_core_new_conversation_without_archive_skips_replay() {
        let (_base, conversations_dir) = temp_conversations_dir();
        let (_temp, paths, params) = fake_driver_paths(&observing_driver_script());
        let manager = DshDriverManager::new();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let registry = MakingSessionRegistry::default();

        let outcome = send_making_message_core(
            &manager,
            &registry,
            &conversations_dir,
            "mc-fresh",
            "m-1",
            "从零开始做一条链路",
        )
        .expect("新会话首轮完成");
        let observed = parse_observation(&outcome);
        assert_eq!(observed["kind"], "making");
        assert_eq!(
            observed["replayTurns"].as_array().expect("turns").len(),
            0,
            "无档案时不重放"
        );

        manager.shutdown_best_effort();
    }

    /// 崩溃恢复链（镜像 ai_replay_history / ai_replay_done）：end（前端收到
    /// `ai-driver-lost` 后的复位）之后，下一次发送自动走恢复路径——新驱动
    /// 会话 id＋同一纯常量信封＋从档案重新重放 seed。
    #[test]
    fn making_core_end_then_next_send_recovers_with_new_session_and_replay() {
        let (_base, conversations_dir) = temp_conversations_dir();
        let record = sample_record("mc-1", "chain-a", "2026-10-06T10:00:00.000Z");
        save_making_conversation(&conversations_dir, &record).expect("保存档案");

        let (_temp, paths, params) = fake_driver_paths(&observing_driver_script());
        let manager = DshDriverManager::new();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let registry = MakingSessionRegistry::default();

        let first = send_making_message_core(
            &manager,
            &registry,
            &conversations_dir,
            "mc-1",
            "m-1",
            "第一轮",
        )
        .expect("第一轮完成");
        let first_observed = parse_observation(&first);

        end_making_session_core(&manager, &registry, "mc-1").expect("结束会话");

        let second = send_making_message_core(
            &manager,
            &registry,
            &conversations_dir,
            "mc-1",
            "m-2",
            "恢复后的第二轮",
        )
        .expect("恢复后的第二轮完成");
        let second_observed = parse_observation(&second);
        assert_ne!(
            second_observed["sessionId"], first_observed["sessionId"],
            "复位后必须新建驱动会话（新 session_id）"
        );
        assert_eq!(
            second_observed["prompt"],
            making_session_system_prompt(),
            "恢复会话的信封与原发同一纯常量，逐字一致"
        );
        assert_eq!(
            second_observed["replayTurns"]
                .as_array()
                .expect("turns")
                .len(),
            2,
            "恢复时从档案重新重放 seed"
        );

        manager.shutdown_best_effort();
    }

    /// 重放 seed 纯函数：口径独立锚定（user 全量、assistant 仅 success/cancelled、
    /// 空文本跳过、未知角色跳过）。
    #[test]
    fn replay_seed_filters_unfinished_and_empty_turns() {
        let record = MakingConversationRecord {
            id: "mc-1".to_string(),
            chain_id: Some("chain-a".to_string()),
            title: String::new(),
            created_at: "2026-10-06T10:00:00.000Z".to_string(),
            updated_at: "2026-10-06T10:00:00.000Z".to_string(),
            turns: vec![
                MakingTurn {
                    role: "user".to_string(),
                    text: "口述".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "user".to_string(),
                    text: String::new(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "完成回复".to_string(),
                    status: "success".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "部分回复".to_string(),
                    status: "cancelled".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "失败回复".to_string(),
                    status: "failed".to_string(),
                },
                MakingTurn {
                    role: "assistant".to_string(),
                    text: "等待中".to_string(),
                    status: "pending".to_string(),
                },
                MakingTurn {
                    role: "system".to_string(),
                    text: "未知角色".to_string(),
                    status: "success".to_string(),
                },
            ],
        };
        let turns = replay_seed_turns(&record);
        let texts: Vec<&str> = turns.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, vec!["口述", "完成回复", "部分回复"]);
    }
}
