//! 制作模块·链路库存储与数据模型（change: add-making-module-core 任务组 1）。
//!
//! 链路库存放于应用本地数据目录全局侧 `making-module/` 子目录，绝不写入任何
//! 作品文件夹：
//!
//! ```text
//! making-module/
//!   chains.json              链路库主文件（只存结构与引用，保持小）
//!   conversations/<id>.json  制作会话档案（写入逻辑属后续任务组，本次只惰性建目录）
//!   trials/<id>.json         试问证据全文（写入逻辑属后续任务组，本次只惰性建目录）
//! ```
//!
//! 数据与规则（design D3）：
//! - 版本不可变：改卡＝追加新版本，旧版本只读保留；
//! - 回退＝`active` 指针指向旧版本，绝不删除较新版本；
//! - 启用＝显式设置 `active` 指针，存了不等于生效（保存新版本不动指针）；
//! - 停用＝`active` 置 `None`，链路、版本与试问档案全部保留；
//! - 删除链路是独立命令：从主文件移除该链路并清理其试问证据引用所指文件，
//!   不触碰任何作品文件夹与讨论档案；
//! - 写入沿用仓库原子写惯例（临时文件＋persist）；`chains.json` 读取上限
//!   1 MiB，超限明确报错并提示清理，绝不静默丢弃（静默失败禁止）。
//!
//! 并发：[`ChainLibraryStore`] 是注册进 AppState 的单例，内部 Mutex 串行化
//! 所有「读库 → 改 → 写回」；`active` 指针的读取与冻结
//! （[`ChainLibraryStore::snapshot_active`]）也在锁内完成（design D6：
//! 多窗口并发轮次发起各自读到一致的指针快照）。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::Manager;

// ========== 常量 ==========

/// 应用本地数据目录下的链路库子目录名。
const MAKING_MODULE_DIR_NAME: &str = "making-module";
/// 链路库主文件名（只存结构与引用）。
const CHAINS_FILE_NAME: &str = "chains.json";
/// 制作会话档案子目录（写入逻辑属后续任务组）。
const CONVERSATIONS_DIR_NAME: &str = "conversations";
/// 试问证据子目录（写入逻辑属后续任务组）。
const TRIALS_DIR_NAME: &str = "trials";

/// `chains.json` 读取大小上限：超出明确报错（多版本累积超限时提示清理旧试问
/// 证据），不静默丢、不无界读入内存（同 llm-config / recent-works 的有界读取思路）。
const MAX_CHAINS_FILE_BYTES: u64 = 1024 * 1024;

/// 单份试问证据文件的读写大小上限（1 MiB，对齐制作会话档案口径）：超出明确
/// 报错，不静默截断、不无界读入内存（任务 6.4）。
pub const MAX_TRIAL_RECORD_BYTES: u64 = 1024 * 1024;

/// 链路库主文件的格式版本：不认识的更高版本明确报错，避免误读后覆盖丢数据。
/// 版本 2（add-posture-slot）：卡结构增 `slot_type` 字段（要求卡／姿态卡）。
/// v1 文件向前兼容读取（卡按缺省视为全要求卡），读取后规范化为当前版本，
/// 保存一律写 2；遇更高版本明确拒读（防旧版误读姿态卡为要求卡后整库保存
/// 造成类型永久丢失）。
pub const CHAIN_LIBRARY_FORMAT_VERSION: u32 = 2;

/// 卡类型取值（add-posture-slot）：要求卡（可多张）。
pub const SLOT_TYPE_REQUIREMENT: &str = "requirement";
/// 卡类型取值（add-posture-slot）：姿态卡（每链路版本可多张并存——2026-10-07
/// 用户拍板修订；系统不做冲突调和，组合权在用户）。
pub const SLOT_TYPE_POSTURE: &str = "posture";

/// 卡类型缺省值：要求卡（v1 数据与省缺字段的入参都按要求卡读）。
fn default_requirement() -> String {
    SLOT_TYPE_REQUIREMENT.to_string()
}

/// 卡结构上限（design D2）：触发描述 ≤400 字。
pub const MAX_TRIGGER_DESC_CHARS: usize = 400;
/// 卡结构上限（design D2）：单卡正文 ≤2000 字。
pub const MAX_CARD_BODY_CHARS: usize = 2000;
/// 卡结构上限（design D2）：单版本全部卡合计 ≤6000 字。
/// 合计口径＝各卡「触发描述＋正文」的字符数总和（两者都进注入文本）；
/// 标题不进注入文本、不计入合计。按 `chars().count()` 计数。
pub const MAX_VERSION_TOTAL_CHARS: usize = 6000;

// ========== 数据模型 ==========

/// 链路库主文件对应的完整数据（`making-module/chains.json`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainLibrary {
    /// 主文件格式版本（防误读更高版本的文件后覆盖写坏数据）。
    #[serde(default = "default_format_version")]
    pub format_version: u32,
    /// 全部链路（多条相互独立并存）。
    #[serde(default)]
    pub chains: Vec<Chain>,
    /// 当前链路（全局一条，所有作品共用）；`None`＝未启用（日常陪想）。
    #[serde(default)]
    pub active: Option<ActiveRef>,
}

/// 当前链路引用（全局一条，所有作品共用）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveRef {
    pub chain_id: String,
    pub version_id: String,
}

/// 一条思维链路：名称＋只增不减的版本序列。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chain {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// 版本序列（按追加顺序；旧版本只读保留，绝不原地修改）。
    #[serde(default)]
    pub versions: Vec<ChainVersion>,
}

/// 链路的一个不可变版本：每次确认保存的改卡都追加新版本。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainVersion {
    pub id: String,
    /// 链内递增序号（第 1 版起）。
    pub index: u32,
    pub created_at: DateTime<Utc>,
    /// 本版本的卡列表（整版本冻结，不逐卡修改）。
    #[serde(default)]
    pub cards: Vec<RequirementCard>,
    /// 变更说明（用户保存时填写，可为空）。
    #[serde(default)]
    pub change_note: String,
    /// 试问证据引用（完整 TrialRecord 的读写属后续任务组，这里只存引用）。
    #[serde(default)]
    pub trials: Vec<TrialRef>,
}

/// 卡：触发描述（含负例：近似但不该触发的情形）＋正文两段构成；类型分
/// 要求卡（可多张）与姿态卡（每链路版本可多张并存，add-posture-slot
/// 2026-10-07 修订）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequirementCard {
    pub id: String,
    pub title: String,
    /// 触发描述（含适用与不适用情形），≤400 字；姿态卡的触发描述仅供用户
    /// 选择链路时参考，不承担自动切换。
    pub trigger_desc: String,
    /// 正文，单卡 ≤2000 字（允许为空：规格只强制触发描述在场）。
    pub body: String,
    /// 卡类型（add-posture-slot）：`"requirement"`（要求卡）或 `"posture"`
    /// （姿态卡）。缺省要求卡：v1 数据无该字段，向前兼容视为全要求卡。
    #[serde(default = "default_requirement")]
    pub slot_type: String,
}

/// 试问证据引用（证据全文在 `trials/<id>.json`，跟链路走、不进作品文件夹）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrialRef {
    pub trial_id: String,
    pub created_at: DateTime<Utc>,
    /// 是否带卡试跑（对照试跑为 `false`）。
    pub with_card: bool,
}

/// 试问终态（对齐日常讨论轮次口径；pending＝发起后未收束的在场状态）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrialStatus {
    Pending,
    Success,
    Failed,
    Cancelled,
}

/// 一份试问证据（`making-module/trials/<id>.json`，全局侧、跟链路走）：
/// 问答全文只存本文件（add-making-module-core 任务 6.4，design D5 方案二——
/// 试问轮不产生讨论档案，本文件是问答内容的唯一真相源）；`created_at` 为
/// RFC3339（chrono 序列化），列表按其倒序。serde 字段 snake_case（前端契约）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrialRecord {
    pub id: String,
    pub chain_id: String,
    pub chain_name: String,
    pub version_id: String,
    /// 版本序号（「第 N 版」显示用）。
    pub version_index: u32,
    /// 是否带卡试跑（对照试跑为 `false`）。
    pub with_card: bool,
    pub question: String,
    /// 回复全文；未收束（pending）或失败 / 取消轮为空串。
    pub reply_text: String,
    pub status: TrialStatus,
    pub created_at: DateTime<Utc>,
    /// 试用作品名称快照（换作品、删作品不影响证据完整）。
    pub work_title: String,
    pub focus_document_id: Option<String>,
    pub focus_document_title: Option<String>,
    /// 用户反馈（可后补；`None`＝未填写）。
    #[serde(default)]
    pub feedback: Option<String>,
}

/// 试问证据列表结果（命令 `trial_list_for_version` 的返回形状：`{"trials": […]}`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TrialListResult {
    pub trials: Vec<TrialRecord>,
}

/// 保存新版本的入参卡（前端/制作助手提交的草稿形态；id 由后端生成，
/// 不接受外部指定，杜绝伪造 id）。`slot_type` 缺省要求卡（旧前端入参兼容）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardInput {
    pub title: String,
    pub trigger_desc: String,
    pub body: String,
    #[serde(default = "default_requirement")]
    pub slot_type: String,
}

/// 轮次发起时冻结的启用链路快照（design D6）：在链路库单例锁内完成读取，
/// 冻结后不再读指针（在途轮不受打扰）；卡文本组装（design D2）由编排层
/// 基于本快照完成。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrozenActive {
    pub chain_id: String,
    /// 链路名称快照（逐轮记录显示用，链路日后删除仍可读）。
    pub chain_name: String,
    pub version_id: String,
    /// 版本序号（「第 N 版」显示用）。
    pub version_index: u32,
    /// 冻结的本版本卡数据（组装注入文本用）。
    pub cards: Vec<RequirementCard>,
}

impl ChainLibrary {
    /// 空链路库（首次启动、主文件尚不存在时）。
    fn empty() -> Self {
        ChainLibrary {
            format_version: CHAIN_LIBRARY_FORMAT_VERSION,
            chains: Vec::new(),
            active: None,
        }
    }
}

fn default_format_version() -> u32 {
    CHAIN_LIBRARY_FORMAT_VERSION
}

// ========== 错误 ==========

/// 「空库直接口述」首次保存的动作结果（有界限定操作；供前端如实措辞）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnsureChainAction {
    /// 新建链路并写入首版本。
    Created,
    /// 链路已存在但无版本（前次部分失败）：补写首版本。
    Repaired,
    /// 链路已有版本且卡内容与本次一致：幂等返回，未追加。
    Idempotent,
    /// 链路已有版本但均与本次卡内容不同：明确冲突，未追加、未改动。
    Conflict,
}

/// `making_chain_ensure_for_conversation` 的返回：链路快照＋动作。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnsureChainResult {
    pub chain: Chain,
    pub action: EnsureChainAction,
}

/// 链路库错误：全部映射为明确的中文文案，绝不静默截断/丢弃/谎报成功。
#[derive(Debug)]
pub enum ChainLibraryError {
    /// 应用本地数据目录不可用（启动时仍注册单例，命令层明确报错不 panic）。
    AppDirUnavailable,
    /// 读取失败（IO）。
    Read(String),
    /// 主文件损坏（不是有效的链路库 JSON）：明确报错，不用空库覆盖。
    Corrupt,
    /// 主文件由更新版本的应用创建，当前应用无法安全读取。
    UnsupportedFormat(u32),
    /// 主文件超过 1 MiB 读取上限。
    TooLarge { actual_bytes: u64 },
    /// 写入失败（建目录、临时文件、原子替换等）。
    Write(String),
    /// 链路已删除，但其试问证据文件清理失败（如实上报残留）。
    Cleanup(String),
    /// 指定的链路不存在（可能已被删除）。
    ChainNotFound { chain_id: String },
    /// 指定的版本不存在于该链路。
    VersionNotFound {
        chain_id: String,
        version_id: String,
    },
    /// 链路名称无效。
    InvalidChainName { reason: String },
    /// 要求卡校验未通过（未保存）。
    InvalidCard { reason: String },
    /// 指定的试问证据文件不存在。
    TrialNotFound { trial_id: String },
    /// 试问证据文件损坏（不是有效的试问数据）。
    TrialCorrupt { trial_id: String },
    /// 试问证据文件超过 1 MiB 读取上限。
    TrialTooLarge { actual_bytes: u64 },
    /// 试问记录内容无效（标识 / 前缀 / 必填字段缺失等），未保存。
    InvalidTrial { reason: String },
}

impl std::fmt::Display for ChainLibraryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChainLibraryError::AppDirUnavailable => {
                write!(f, "无法访问应用本地数据目录，请重启应用后重试")
            }
            ChainLibraryError::Read(msg) => write!(f, "读取链路库失败: {msg}"),
            ChainLibraryError::Corrupt => write!(
                f,
                "链路库文件损坏（chains.json 不是有效的链路库数据），未做任何修改"
            ),
            ChainLibraryError::UnsupportedFormat(version) => write!(
                f,
                // add-posture-slot：文案含规格钉住的「由更新版本创建」逐字短语。
                "链路库文件由更新版本创建（格式版本 {version}），当前应用无法安全读取，请先升级应用"
            ),
            ChainLibraryError::TooLarge { actual_bytes } => write!(
                f,
                "链路库文件超过 1 MiB 读取上限（当前 {actual_bytes} 字节）：多版本累积过多时，请清理旧试问证据或删除不再需要的链路后重试"
            ),
            ChainLibraryError::Write(msg) => write!(f, "链路库写入失败: {msg}"),
            ChainLibraryError::Cleanup(msg) => {
                write!(f, "链路已删除，但清理试问证据文件失败: {msg}")
            }
            ChainLibraryError::ChainNotFound { chain_id } => {
                write!(f, "链路不存在或已被删除: {chain_id}")
            }
            ChainLibraryError::VersionNotFound {
                chain_id,
                version_id,
            } => {
                write!(f, "链路 {chain_id} 下不存在指定版本: {version_id}")
            }
            ChainLibraryError::InvalidChainName { reason } => {
                write!(f, "链路名称无效: {reason}")
            }
            ChainLibraryError::InvalidCard { reason } => {
                write!(f, "要求卡未保存: {reason}")
            }
            ChainLibraryError::TrialNotFound { trial_id } => {
                write!(f, "试问记录不存在: {trial_id}")
            }
            ChainLibraryError::TrialCorrupt { trial_id } => {
                write!(
                    f,
                    "试问证据文件损坏（{trial_id}.json 不是有效的试问数据），未做任何修改"
                )
            }
            ChainLibraryError::TrialTooLarge { actual_bytes } => write!(
                f,
                "试问证据文件超过 1 MiB 读取上限（当前 {actual_bytes} 字节），无法读取"
            ),
            ChainLibraryError::InvalidTrial { reason } => {
                write!(f, "试问记录无效: {reason}")
            }
        }
    }
}

impl std::error::Error for ChainLibraryError {}

// ========== 路径 ==========

/// 应用本地数据目录 → 链路库子目录（`making-module/`）。
pub fn making_module_dir_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(MAKING_MODULE_DIR_NAME)
}

/// 链路库子目录 → 主文件路径（`chains.json`）。
fn chains_file_in(module_dir: &Path) -> PathBuf {
    module_dir.join(CHAINS_FILE_NAME)
}

/// 链路库子目录 → 制作会话档案目录（后续任务组的写入位置，本次只惰性建目录）。
pub fn conversations_dir_in(module_dir: &Path) -> PathBuf {
    module_dir.join(CONVERSATIONS_DIR_NAME)
}

/// 链路库子目录 → 试问证据目录（后续任务组的写入位置，本次只惰性建目录）。
pub fn trials_dir_in(module_dir: &Path) -> PathBuf {
    module_dir.join(TRIALS_DIR_NAME)
}

/// id 是否是安全的文件名分量（同 conversation_store 的讨论标识校验思路）。
/// `pub(crate)`：试问车道（trial_session）复用同一校验，保证试问 id 落盘安全。
pub(crate) fn is_safe_id_component(id: &str) -> bool {
    !id.is_empty()
        && id != "."
        && id != ".."
        && !id
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c == '\0' || c.is_control())
}

/// 生成 id（仓库惯例：前缀-纳秒时间-进程内自增序号，不引入 uuid 依赖）。
fn new_id(prefix: &str) -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}-{now}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

// ========== 卡校验（design D2 / 任务 1.3；add-posture-slot 任务 2.2 类型规则） ==========

/// 校验一批入参卡：非空（任一类型即可，纯姿态版本允许）、每卡有标题与触发
/// 描述、卡类型取值合法、三类长度上限（触发描述 ≤400、单卡正文 ≤2000、版本
/// 合计 ≤6000——两类卡合计，按 `chars().count()` 计；多张姿态卡自然受此约束，
/// 2026-10-07 修订：姿态卡每版本可多张，不做数量限制与冲突调和）。
/// 超限或缺项返回带实际数值的中文错误，不静默截断。
pub fn validate_cards(cards: &[CardInput]) -> Result<(), ChainLibraryError> {
    let invalid = |reason: String| ChainLibraryError::InvalidCard { reason };

    if cards.is_empty() {
        return Err(invalid(
            "至少需要一张卡（要求卡或姿态卡，任一类型均可）".to_string(),
        ));
    }

    let mut total_chars = 0usize;
    for (position, card) in cards.iter().enumerate() {
        let ordinal = position + 1;
        if card.slot_type != SLOT_TYPE_POSTURE && card.slot_type != SLOT_TYPE_REQUIREMENT {
            return Err(invalid(format!(
                "第 {ordinal} 张卡的类型无效（须为要求卡或姿态卡），未保存"
            )));
        }
        if card.title.trim().is_empty() {
            return Err(invalid(format!("第 {ordinal} 张卡缺少标题")));
        }
        if card.trigger_desc.trim().is_empty() {
            return Err(invalid(format!(
                "第 {ordinal} 张卡缺少触发描述（需写清适用与不适用的情形）"
            )));
        }
        let trigger_chars = card.trigger_desc.chars().count();
        if trigger_chars > MAX_TRIGGER_DESC_CHARS {
            return Err(invalid(format!(
                "第 {ordinal} 张卡的触发描述超过 {MAX_TRIGGER_DESC_CHARS} 字上限（当前 {trigger_chars} 字），请精简后重试"
            )));
        }
        let body_chars = card.body.chars().count();
        if body_chars > MAX_CARD_BODY_CHARS {
            return Err(invalid(format!(
                "第 {ordinal} 张卡的正文超过 {MAX_CARD_BODY_CHARS} 字上限（当前 {body_chars} 字），请精简后重试"
            )));
        }
        total_chars += trigger_chars + body_chars;
    }

    if total_chars > MAX_VERSION_TOTAL_CHARS {
        return Err(invalid(format!(
            "本版本全部卡合计超过 {MAX_VERSION_TOTAL_CHARS} 字上限（当前 {total_chars} 字），请减少卡数或精简内容"
        )));
    }
    Ok(())
}

// ========== 存储原语（模块内私有，测试可直接使用） ==========

/// 有界读取 `chains.json`：打开一次句柄后 `take(max+1)` 限量读取，超限拒绝；
/// 不依赖读取前的元数据长度（消除 TOCTOU 竞态），超限内容不会被无界读入内存。
fn read_chains_file_bounded(path: &Path) -> Result<String, ChainLibraryError> {
    let file = fs::File::open(path).map_err(|e| ChainLibraryError::Read(e.to_string()))?;

    let mut limited = file.take(MAX_CHAINS_FILE_BYTES + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| ChainLibraryError::Read(e.to_string()))?;

    if content.len() as u64 > MAX_CHAINS_FILE_BYTES {
        return Err(ChainLibraryError::TooLarge {
            actual_bytes: content.len() as u64,
        });
    }
    Ok(content)
}

/// 读取链路库：主文件缺失＝空库（首次启动，纯读取不建目录不建文件）；
/// 损坏／超限／格式过新＝明确报错（绝不用空库覆盖用户的既有数据）。
fn load_library_from_dir(module_dir: &Path) -> Result<ChainLibrary, ChainLibraryError> {
    let path = chains_file_in(module_dir);
    if !path.is_file() {
        return Ok(ChainLibrary::empty());
    }
    let content = read_chains_file_bounded(&path)?;
    let library: ChainLibrary =
        serde_json::from_str(&content).map_err(|_| ChainLibraryError::Corrupt)?;
    if library.format_version > CHAIN_LIBRARY_FORMAT_VERSION {
        return Err(ChainLibraryError::UnsupportedFormat(library.format_version));
    }
    // v1（及更早写入的缺省版本值）向前兼容读取：卡无 slot_type 字段时按
    // serde 缺省视为全要求卡；读取后规范化为当前格式版本——此后任何保存都
    // 写版本 2（spec「v1 兼容读取：保存时升级写为格式版本 2」），旧版本号
    // 绝不落回盘。
    let mut library = library;
    library.format_version = CHAIN_LIBRARY_FORMAT_VERSION;
    Ok(library)
}

/// 保证目录布局就位：`making-module/` 及其 `conversations/`、`trials/` 子目录
/// （惰性创建——首次写入时建立；子目录写入逻辑属后续任务组）。
fn ensure_module_layout(module_dir: &Path) -> Result<(), ChainLibraryError> {
    let write_err = |e: std::io::Error| ChainLibraryError::Write(e.to_string());
    fs::create_dir_all(module_dir).map_err(write_err)?;
    fs::create_dir_all(conversations_dir_in(module_dir)).map_err(write_err)?;
    fs::create_dir_all(trials_dir_in(module_dir)).map_err(write_err)?;
    Ok(())
}

/// 原子写回链路库主文件（临时文件＋persist，同 llm-config / recent-works 落盘形态）。
fn save_library_to_dir(module_dir: &Path, library: &ChainLibrary) -> Result<(), ChainLibraryError> {
    ensure_module_layout(module_dir)?;
    let write_err = |e: std::io::Error| ChainLibraryError::Write(e.to_string());
    let json = serde_json::to_string_pretty(library)
        .map_err(|e| ChainLibraryError::Write(e.to_string()))?;
    let mut temp_file = tempfile::NamedTempFile::new_in(module_dir).map_err(write_err)?;
    temp_file.write_all(json.as_bytes()).map_err(write_err)?;
    temp_file.flush().map_err(write_err)?;
    temp_file
        .persist(chains_file_in(module_dir))
        .map(|_| ())
        .map_err(|e| ChainLibraryError::Write(e.error.to_string()))
}

// ========== 试问证据文件读写（add-making-module-core 任务 6.4，design D5 方案二） ==========

/// 试问证据目录 → 单份证据文件路径。
fn trial_record_file_in(trials_dir: &Path, trial_id: &str) -> PathBuf {
    trials_dir.join(format!("{trial_id}.json"))
}

/// 校验试问记录（保存前）：标识安全且带 `trial-` 前缀（工具路由的身份判据）、
/// 链路与作品标识非空、问题非空。无效明确报错，不静默修复。
fn validate_trial_record(record: &TrialRecord) -> Result<(), ChainLibraryError> {
    if !is_safe_id_component(&record.id) {
        return Err(ChainLibraryError::InvalidTrial {
            reason: "试问编号不能为空，且不得包含路径分隔符、冒号或控制字符".to_string(),
        });
    }
    if !record.id.starts_with(crate::trial_session::TRIAL_ID_PREFIX) {
        return Err(ChainLibraryError::InvalidTrial {
            reason: format!(
                "试问编号必须以 {} 开头",
                crate::trial_session::TRIAL_ID_PREFIX
            ),
        });
    }
    if record.chain_id.trim().is_empty() {
        return Err(ChainLibraryError::InvalidTrial {
            reason: "缺少所属链路标识（chain_id）".to_string(),
        });
    }
    if record.work_title.trim().is_empty() {
        return Err(ChainLibraryError::InvalidTrial {
            reason: "缺少试用作品名称（work_title）".to_string(),
        });
    }
    if record.question.trim().is_empty() {
        return Err(ChainLibraryError::InvalidTrial {
            reason: "缺少试问问题（question）".to_string(),
        });
    }
    Ok(())
}

/// 保存（原子写入）一份试问证据：pending → 终态的更新同样经本函数整档重写。
/// 序列化结果超 1 MiB 明确报错，不静默截断。
pub fn save_trial_record(trials_dir: &Path, record: &TrialRecord) -> Result<(), ChainLibraryError> {
    validate_trial_record(record)?;
    let write_err = |e: std::io::Error| ChainLibraryError::Write(e.to_string());
    let json = serde_json::to_string_pretty(record)
        .map_err(|e| ChainLibraryError::Write(e.to_string()))?;
    if json.len() as u64 > MAX_TRIAL_RECORD_BYTES {
        return Err(ChainLibraryError::TrialTooLarge {
            actual_bytes: json.len() as u64,
        });
    }
    fs::create_dir_all(trials_dir).map_err(write_err)?;
    let mut temp_file = tempfile::NamedTempFile::new_in(trials_dir).map_err(write_err)?;
    temp_file.write_all(json.as_bytes()).map_err(write_err)?;
    temp_file.flush().map_err(write_err)?;
    temp_file
        .persist(trial_record_file_in(trials_dir, &record.id))
        .map(|_| ())
        .map_err(|e| ChainLibraryError::Write(e.error.to_string()))
}

/// 读取一份试问证据；缺失 / 损坏 / 超限明确报错（绝不静默吞）。
pub fn load_trial_record(
    trials_dir: &Path,
    trial_id: &str,
) -> Result<TrialRecord, ChainLibraryError> {
    if !is_safe_id_component(trial_id) {
        return Err(ChainLibraryError::InvalidTrial {
            reason: "试问编号不能为空，且不得包含路径分隔符、冒号或控制字符".to_string(),
        });
    }
    let path = trial_record_file_in(trials_dir, trial_id);
    if !path.is_file() {
        return Err(ChainLibraryError::TrialNotFound {
            trial_id: trial_id.to_string(),
        });
    }
    let file = fs::File::open(&path).map_err(|e| ChainLibraryError::Read(e.to_string()))?;
    let mut limited = file.take(MAX_TRIAL_RECORD_BYTES + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| ChainLibraryError::Read(e.to_string()))?;
    if content.len() as u64 > MAX_TRIAL_RECORD_BYTES {
        return Err(ChainLibraryError::TrialTooLarge {
            actual_bytes: content.len() as u64,
        });
    }
    serde_json::from_str(&content).map_err(|_| ChainLibraryError::TrialCorrupt {
        trial_id: trial_id.to_string(),
    })
}

/// 试问证据文件是否已存在（同 id 重复发起的防覆盖检查）。
pub fn trial_record_exists(trials_dir: &Path, trial_id: &str) -> bool {
    is_safe_id_component(trial_id) && trial_record_file_in(trials_dir, trial_id).is_file()
}

// ========== 库操作实现（模块内私有；单例方法在锁内调用） ==========

/// 新建链路（只有名称，尚无版本；首版本由用户确认保存产生）。
fn create_chain_in_dir(module_dir: &Path, name: &str) -> Result<Chain, ChainLibraryError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ChainLibraryError::InvalidChainName {
            reason: "链路名称不能为空".to_string(),
        });
    }
    let mut library = load_library_from_dir(module_dir)?;
    let chain = Chain {
        id: new_id("chain"),
        name: trimmed.to_string(),
        created_at: Utc::now(),
        versions: Vec::new(),
    };
    library.chains.push(chain.clone());
    save_library_to_dir(module_dir, &library)?;
    Ok(chain)
}

/// 保存新版本（用户确认保存的入口，命令层不自动调用；制作助手无库写权限）：
/// 校验通过后追加不可变新版本，绝不修改旧版本，也绝不顺手改 `active`
/// （存草稿不等于生效）。卡 id 由后端生成。
fn save_version_in_dir(
    module_dir: &Path,
    chain_id: &str,
    cards: &[CardInput],
    change_note: &str,
) -> Result<ChainVersion, ChainLibraryError> {
    validate_cards(cards)?;
    let mut library = load_library_from_dir(module_dir)?;
    let chain = library
        .chains
        .iter_mut()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    // 链内递增序号：旧版本只增不减，取末位序号＋1（首版本为 1）。
    let next_index = chain.versions.last().map(|v| v.index + 1).unwrap_or(1);
    let version = ChainVersion {
        id: new_id("chainver"),
        index: next_index,
        created_at: Utc::now(),
        // 触发描述与正文原样保存（不截断、不去空白）；标题只作显示，顺手去首尾空白；
        // 卡类型（add-posture-slot）原样随卡保存。
        cards: cards
            .iter()
            .map(|card| RequirementCard {
                id: new_id("card"),
                title: card.title.trim().to_string(),
                trigger_desc: card.trigger_desc.clone(),
                body: card.body.clone(),
                slot_type: card.slot_type.clone(),
            })
            .collect(),
        change_note: change_note.trim().to_string(),
        trials: Vec::new(),
    };
    chain.versions.push(version.clone());
    save_library_to_dir(module_dir, &library)?;
    Ok(version)
}

/// 由卡输入构造链路的首版本（序号 1；卡 id 由后端生成）。
fn first_version_from_inputs(cards: &[CardInput], change_note: &str) -> ChainVersion {
    ChainVersion {
        id: new_id("chainver"),
        index: 1,
        created_at: Utc::now(),
        cards: cards
            .iter()
            .map(|card| RequirementCard {
                id: new_id("card"),
                title: card.title.trim().to_string(),
                trigger_desc: card.trigger_desc.clone(),
                body: card.body.clone(),
                slot_type: card.slot_type.clone(),
            })
            .collect(),
        change_note: change_note.trim().to_string(),
        trials: Vec::new(),
    }
}

/// 空库直接口述的首次保存（有界限定操作）：以制作会话 id 派生确定性链路 id
/// （`chain-<conversation_id>`），在同一链路库锁内一次读改写完成「建链路＋首版本」，
/// 绝不触碰 `active`（保存草稿不等于启用）。
///
/// 幂等：同会话 id 重复调用不产生第二条链路或重复首版本——已有版本原样返回；
/// 仅有链路、尚缺版本（前次部分失败）时补写首版本。写入失败即整体未落盘，可安全重试。
/// 试问卡的既有版本与新入参卡是否同内容（顺序敏感；与 `save_version_in_dir`
/// 的落盘口径一致：标题去首尾空白，其余原样）。
fn chain_version_matches_inputs(version: &ChainVersion, cards: &[CardInput]) -> bool {
    version.cards.len() == cards.len()
        && version.cards.iter().zip(cards).all(|(existing, incoming)| {
            existing.title == incoming.title.trim()
                && existing.trigger_desc == incoming.trigger_desc
                && existing.body == incoming.body
                && existing.slot_type == incoming.slot_type
        })
}

fn ensure_chain_with_first_version_in_dir(
    module_dir: &Path,
    conversation_id: &str,
    name: &str,
    cards: &[CardInput],
    change_note: &str,
) -> Result<EnsureChainResult, ChainLibraryError> {
    if !is_safe_id_component(conversation_id) {
        return Err(ChainLibraryError::InvalidChainName {
            reason: "制作会话标识无效，无法建立链路".to_string(),
        });
    }
    validate_cards(cards)?;
    let chain_id = format!("chain-{conversation_id}");
    let mut library = load_library_from_dir(module_dir)?;
    if let Some(existing) = library.chains.iter_mut().find(|chain| chain.id == chain_id) {
        if existing.versions.is_empty() {
            // 前次部分失败：链路已建、首版本缺失 → 补写首版本。
            existing
                .versions
                .push(first_version_from_inputs(cards, change_note));
            let chain = existing.clone();
            save_library_to_dir(module_dir, &library)?;
            return Ok(EnsureChainResult {
                chain,
                action: EnsureChainAction::Repaired,
            });
        }
        // 已有任一版本与本次卡内容一致 → 幂等（相同保存重试不追加）。
        if existing
            .versions
            .iter()
            .any(|version| chain_version_matches_inputs(version, cards))
        {
            return Ok(EnsureChainResult {
                chain: existing.clone(),
                action: EnsureChainAction::Idempotent,
            });
        }
        // 既有版本均不同 → 明确冲突：不追加、不改动（恢复绑定后由普通保存追加）。
        return Ok(EnsureChainResult {
            chain: existing.clone(),
            action: EnsureChainAction::Conflict,
        });
    }
    let trimmed = name.trim();
    let chain = Chain {
        id: chain_id,
        name: if trimmed.is_empty() {
            "新链路".to_string()
        } else {
            trimmed.to_string()
        },
        created_at: Utc::now(),
        versions: vec![first_version_from_inputs(cards, change_note)],
    };
    library.chains.push(chain.clone());
    save_library_to_dir(module_dir, &library)?;
    Ok(EnsureChainResult {
        chain,
        action: EnsureChainAction::Created,
    })
}

/// 解析链路与版本（两者都必须真实存在，防悬空指针）。
fn resolve_chain_and_version<'a>(
    library: &'a ChainLibrary,
    chain_id: &str,
    version_id: &str,
) -> Result<(&'a Chain, &'a ChainVersion), ChainLibraryError> {
    let chain = library
        .chains
        .iter()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    let version = chain
        .versions
        .iter()
        .find(|version| version.id == version_id)
        .ok_or_else(|| ChainLibraryError::VersionNotFound {
            chain_id: chain_id.to_string(),
            version_id: version_id.to_string(),
        })?;
    Ok((chain, version))
}

/// 显式设置 `active` 指针（启用 / 切换 / 回退的共同机制）：
/// 只动指针，不改任何链路数据、不删任何版本。
fn set_active_in_dir(
    module_dir: &Path,
    chain_id: &str,
    version_id: &str,
) -> Result<ActiveRef, ChainLibraryError> {
    let mut library = load_library_from_dir(module_dir)?;
    let _resolved = resolve_chain_and_version(&library, chain_id, version_id)?;
    let active = ActiveRef {
        chain_id: chain_id.to_string(),
        version_id: version_id.to_string(),
    };
    library.active = Some(active.clone());
    save_library_to_dir(module_dir, &library)?;
    Ok(active)
}

/// 停用：`active` 置 `None`（下一轮起回到日常陪想）；链路、版本与试问档案全保留。
fn deactivate_in_dir(module_dir: &Path) -> Result<(), ChainLibraryError> {
    let mut library = load_library_from_dir(module_dir)?;
    library.active = None;
    save_library_to_dir(module_dir, &library)
}

/// 读取启用指针的冻结快照：`active` 为 `None` 时返回 `None`；指针悬空
/// （理论上只出现在主文件被手工编辑后）防御性视为未启用，不让日常轮次失败。
fn snapshot_active_in_dir(module_dir: &Path) -> Result<Option<FrozenActive>, ChainLibraryError> {
    let library = load_library_from_dir(module_dir)?;
    let Some(active) = library.active.as_ref() else {
        return Ok(None);
    };
    let resolved = resolve_chain_and_version(&library, &active.chain_id, &active.version_id);
    let (chain, version) = match resolved {
        Ok(pair) => pair,
        Err(_) => return Ok(None),
    };
    Ok(Some(FrozenActive {
        chain_id: chain.id.clone(),
        chain_name: chain.name.clone(),
        version_id: version.id.clone(),
        version_index: version.index,
        cards: version.cards.clone(),
    }))
}

/// 删除链路（独立动作，前端加确认；命令层直接执行）：从主文件移除该链路，
/// 若 `active` 指向它则一并置空，再清理其试问证据引用所指文件（缺失视为已清理）。
/// 绝不触碰任何作品文件夹与讨论档案。
fn delete_chain_in_dir(module_dir: &Path, chain_id: &str) -> Result<(), ChainLibraryError> {
    let mut library = load_library_from_dir(module_dir)?;
    let position = library
        .chains
        .iter()
        .position(|chain| chain.id == chain_id)
        .ok_or_else(|| ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    let removed = library.chains.remove(position);
    if library
        .active
        .as_ref()
        .is_some_and(|a| a.chain_id == chain_id)
    {
        library.active = None;
    }
    // 先提交主文件（删除的提交点），再清理证据文件；清理失败如实上报残留。
    save_library_to_dir(module_dir, &library)?;

    let trials_dir = trials_dir_in(module_dir);
    for version in &removed.versions {
        for trial in &version.trials {
            // 引用里的 id 不安全（手工编辑出的穿越路径等）时跳过，绝不拿去拼路径。
            if !is_safe_id_component(&trial.trial_id) {
                continue;
            }
            let path = trials_dir.join(format!("{}.json", trial.trial_id));
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(ChainLibraryError::Cleanup(format!(
                        "{}: {e}",
                        path.display()
                    )))
                }
            }
        }
    }
    Ok(())
}

/// 向指定版本追加试问证据引用（任务 6.4）：链路库锁内读改写；同一 trial_id
/// 已存在时按传入值原位更新（幂等重试安全），不产生重复条目；不动 `active`
/// 指针（试问不切全局链路）。
fn append_trial_ref_in_dir(
    module_dir: &Path,
    chain_id: &str,
    version_id: &str,
    trial_ref: TrialRef,
) -> Result<(), ChainLibraryError> {
    let mut library = load_library_from_dir(module_dir)?;
    let chain = library
        .chains
        .iter_mut()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    let version = chain
        .versions
        .iter_mut()
        .find(|version| version.id == version_id)
        .ok_or_else(|| ChainLibraryError::VersionNotFound {
            chain_id: chain_id.to_string(),
            version_id: version_id.to_string(),
        })?;
    match version
        .trials
        .iter()
        .position(|existing| existing.trial_id == trial_ref.trial_id)
    {
        Some(position) => version.trials[position] = trial_ref,
        None => version.trials.push(trial_ref),
    }
    save_library_to_dir(module_dir, &library)
}

/// 重命名链路（可选能力）：只改名称，不动版本与指针。
fn rename_chain_in_dir(
    module_dir: &Path,
    chain_id: &str,
    name: &str,
) -> Result<(), ChainLibraryError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ChainLibraryError::InvalidChainName {
            reason: "链路名称不能为空".to_string(),
        });
    }
    let mut library = load_library_from_dir(module_dir)?;
    let chain = library
        .chains
        .iter_mut()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    chain.name = trimmed.to_string();
    save_library_to_dir(module_dir, &library)
}

// ========== 链路库单例（AppState 持有） ==========

/// 链路库单例：注册进 AppState（`.manage`），`Clone` 便宜（Arc）。
/// 所有操作在进程内 Mutex 串行下完成「读库 → 改 → 写回」与指针冻结读取。
#[derive(Clone)]
pub struct ChainLibraryStore {
    inner: Arc<ChainLibraryInner>,
}

struct ChainLibraryInner {
    /// 应用本地数据目录（启动时不可得则记 `None`，命令返回明确错误、不 panic）。
    app_data_dir: Option<PathBuf>,
    /// 链路库单例锁：任何读写（含 `snapshot_active`）全程持锁。
    lock: Mutex<()>,
}

impl ChainLibraryStore {
    /// 建单例。`app_data_dir` 是 Tauri 的应用本地数据目录
    /// （链路库实际落在其下 `making-module/` 子目录）。
    pub fn new(app_data_dir: Option<PathBuf>) -> Self {
        ChainLibraryStore {
            inner: Arc::new(ChainLibraryInner {
                app_data_dir,
                lock: Mutex::new(()),
            }),
        }
    }

    fn module_dir(&self) -> Result<PathBuf, ChainLibraryError> {
        self.inner
            .app_data_dir
            .as_deref()
            .map(making_module_dir_in)
            .ok_or(ChainLibraryError::AppDirUnavailable)
    }

    /// 取锁后在 `making-module/` 上执行操作（读改写全程互斥）。
    fn with_library<T>(
        &self,
        operate: impl FnOnce(&Path) -> Result<T, ChainLibraryError>,
    ) -> Result<T, ChainLibraryError> {
        let module_dir = self.module_dir()?;
        let _guard = self
            .inner
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operate(&module_dir)
    }

    /// 读取链路库（缺文件＝空库；损坏/超限＝明确报错）。
    pub fn load(&self) -> Result<ChainLibrary, ChainLibraryError> {
        self.with_library(load_library_from_dir)
    }

    /// 新建链路（名称）。
    pub fn create_chain(&self, name: &str) -> Result<Chain, ChainLibraryError> {
        self.with_library(|dir| create_chain_in_dir(dir, name))
    }

    /// 保存新版本（用户确认保存的入口；不改 `active` 指针）。
    pub fn save_version(
        &self,
        chain_id: &str,
        cards: &[CardInput],
        change_note: &str,
    ) -> Result<ChainVersion, ChainLibraryError> {
        self.with_library(|dir| save_version_in_dir(dir, chain_id, cards, change_note))
    }

    /// 空库直接口述的首次保存（有界限定操作）：建链路＋首版本；幂等、不改 `active`。
    pub fn ensure_chain_with_first_version(
        &self,
        conversation_id: &str,
        name: &str,
        cards: &[CardInput],
        change_note: &str,
    ) -> Result<EnsureChainResult, ChainLibraryError> {
        self.with_library(|dir| {
            ensure_chain_with_first_version_in_dir(dir, conversation_id, name, cards, change_note)
        })
    }

    /// 显式启用/切换当前链路（全局一条，所有作品共用）。
    pub fn set_active(
        &self,
        chain_id: &str,
        version_id: &str,
    ) -> Result<ActiveRef, ChainLibraryError> {
        self.with_library(|dir| set_active_in_dir(dir, chain_id, version_id))
    }

    /// 回退＝`active` 指针指向旧版本；较新版本及其试问证据原样保留。
    pub fn rollback(
        &self,
        chain_id: &str,
        version_id: &str,
    ) -> Result<ActiveRef, ChainLibraryError> {
        self.with_library(|dir| set_active_in_dir(dir, chain_id, version_id))
    }

    /// 停用：`active` 置 `None`，一切档案保留。
    pub fn deactivate(&self) -> Result<(), ChainLibraryError> {
        self.with_library(deactivate_in_dir)
    }

    /// 删除链路（含其试问证据引用所指文件）；不触碰作品文件夹与讨论档案。
    pub fn delete_chain(&self, chain_id: &str) -> Result<(), ChainLibraryError> {
        self.with_library(|dir| delete_chain_in_dir(dir, chain_id))
    }

    /// 重命名链路。
    pub fn rename_chain(&self, chain_id: &str, name: &str) -> Result<(), ChainLibraryError> {
        self.with_library(|dir| rename_chain_in_dir(dir, chain_id, name))
    }

    /// 读取 `active` 指针的冻结快照（后续装配车道用）：在锁内完成读取，
    /// 返回冻结的链路/版本标识、名称快照与卡数据；未启用返回 `None`。
    pub fn snapshot_active(&self) -> Result<Option<FrozenActive>, ChainLibraryError> {
        self.with_library(snapshot_active_in_dir)
    }

    /// 向指定版本的 `trials` 追加试问证据引用（任务 6.4）：链路库锁内读改写，
    /// 同 id 幂等更新；不动 `active` 指针。
    pub fn append_trial_ref(
        &self,
        chain_id: &str,
        version_id: &str,
        trial_ref: TrialRef,
    ) -> Result<(), ChainLibraryError> {
        self.with_library(|dir| append_trial_ref_in_dir(dir, chain_id, version_id, trial_ref))
    }
}

// ========== Tauri 命令（任务 1.2；命名对齐仓库 snake_case） ==========

/// 从 AppState 取链路库单例（便宜 Clone 后移入阻塞线程）。
fn store_from_app(app: &tauri::AppHandle) -> ChainLibraryStore {
    app.state::<ChainLibraryStore>().inner().clone()
}

/// 加载链路库（链路列表＋版本＋启用指针；缺主文件时返回空库）。
#[tauri::command]
pub async fn chain_library_load(app: tauri::AppHandle) -> Result<ChainLibrary, String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.load())
        .await
        .map_err(|e| format!("读取链路库任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 新建链路（名称）；新链路尚无版本，也不改变当前启用状态。
#[tauri::command]
pub async fn chain_create(app: tauri::AppHandle, name: String) -> Result<Chain, String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.create_chain(&name))
        .await
        .map_err(|e| format!("新建链路任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 保存新版本（用户确认保存的入口，命令层不自动调用）：入参＝链路 id、
/// 卡列表、变更说明；校验失败（超限/缺触发描述/格式无效）明确报错，不静默截断。
#[tauri::command]
pub async fn chain_save_version(
    app: tauri::AppHandle,
    chain_id: String,
    cards: Vec<CardInput>,
    change_note: Option<String>,
) -> Result<ChainVersion, String> {
    let store = store_from_app(&app);
    let note = change_note.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || store.save_version(&chain_id, &cards, &note))
        .await
        .map_err(|e| format!("保存链路版本任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 空库直接口述的首次保存（有界限定操作）：入参＝制作会话 id、链路名、卡列表、
/// 变更说明。以会话 id 派生确定性链路 id，一次读改写建链路＋首版本；幂等、绝不启用。
/// 边界与写入在同一会话存储锁内完成（session → chain 锁序），delete 无法在校验与写入
/// 之间插入，避免孤链；不出现相反锁序（`with_library` 锁内不访问会话存储）。
#[tauri::command]
pub async fn making_chain_ensure_for_conversation(
    app: tauri::AppHandle,
    conversation_id: String,
    name: String,
    cards: Vec<CardInput>,
    change_note: Option<String>,
) -> Result<EnsureChainResult, String> {
    let store = store_from_app(&app);
    let note = change_note.unwrap_or_default();
    let conversations_dir = crate::making_session::making_conversations_dir_from_app(&app)?;
    let target_chain_id = format!("chain-{conversation_id}");
    tauri::async_runtime::spawn_blocking(move || {
        crate::making_session::with_conversation_store_lock(
            &conversations_dir,
            &conversation_id,
            &target_chain_id,
            || {
                store
                    .ensure_chain_with_first_version(&conversation_id, &name, &cards, &note)
                    .map_err(|e| e.to_string())
            },
        )
    })
    .await
    .map_err(|e| format!("建立链路任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 显式启用/切换当前链路（全局一条，所有作品共用；从下一轮开始生效）。
#[tauri::command]
pub async fn chain_set_active(
    app: tauri::AppHandle,
    chain_id: String,
    version_id: String,
) -> Result<(), String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.set_active(&chain_id, &version_id))
        .await
        .map_err(|e| format!("切换当前链路任务执行失败: {e}"))?
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 回退：把当前链路的启用指针指向旧版本；较新版本及其试问证据保留。
#[tauri::command]
pub async fn chain_rollback(
    app: tauri::AppHandle,
    chain_id: String,
    version_id: String,
) -> Result<(), String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.rollback(&chain_id, &version_id))
        .await
        .map_err(|e| format!("回退链路版本任务执行失败: {e}"))?
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 停用当前链路：下一轮起回到日常陪想；链路、版本与试问档案全部保留。
#[tauri::command]
pub async fn chain_deactivate(app: tauri::AppHandle) -> Result<(), String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.deactivate())
        .await
        .map_err(|e| format!("停用链路任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 删除链路（独立动作，前端负责确认）：删除该链路全部数据（版本＋试问证据
/// 引用所指文件）；不触碰任何作品文件夹与讨论档案。
#[tauri::command]
pub async fn chain_delete(app: tauri::AppHandle, chain_id: String) -> Result<(), String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.delete_chain(&chain_id))
        .await
        .map_err(|e| format!("删除链路任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 重命名链路（可选能力）：只改名称，不动版本与启用指针。
#[tauri::command]
pub async fn chain_rename(
    app: tauri::AppHandle,
    chain_id: String,
    name: String,
) -> Result<(), String> {
    let store = store_from_app(&app);
    tauri::async_runtime::spawn_blocking(move || store.rename_chain(&chain_id, &name))
        .await
        .map_err(|e| format!("重命名链路任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

// ========== 单元测试（任务 1.4） ==========

#[cfg(test)]
mod tests {
    use super::*;

    /// 以临时目录充当应用本地数据目录，建链路库单例。
    fn store_in(base: &tempfile::TempDir) -> ChainLibraryStore {
        ChainLibraryStore::new(Some(base.path().to_path_buf()))
    }

    fn module_dir_of(base: &tempfile::TempDir) -> PathBuf {
        making_module_dir_in(base.path())
    }

    /// 一组合法入参卡（缺省要求卡：不传 slot_type 的旧入参形态）。
    fn sample_cards() -> Vec<CardInput> {
        vec![CardInput {
            title: "节奏紧张时先问人物动机".to_string(),
            trigger_desc: "适用：情节推进快、冲突密集的段落。\n不适用：日常舒缓的过渡段落。"
                .to_string(),
            body: "先指出当前场景的人物动机，再给出两种可能走向，由用户决定。".to_string(),
            slot_type: SLOT_TYPE_REQUIREMENT.to_string(),
        }]
    }

    /// 一张合法姿态卡入参。
    fn sample_posture_card() -> CardInput {
        CardInput {
            title: "傲娇搭档".to_string(),
            trigger_desc: "适用：想要嘴硬心软的陪想语气时。\n不适用：需要冷静客观复盘时。"
                .to_string(),
            body: "你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。".to_string(),
            slot_type: SLOT_TYPE_POSTURE.to_string(),
        }
    }

    /// 直接向主文件注入一条试问证据引用（完整读写属后续任务组，测试借用内部原语）。
    fn inject_trial_ref(
        base: &tempfile::TempDir,
        chain_index: usize,
        version_index: usize,
        trial_id: &str,
    ) {
        let dir = module_dir_of(base);
        let mut library = load_library_from_dir(&dir).expect("读库");
        library.chains[chain_index].versions[version_index]
            .trials
            .push(TrialRef {
                trial_id: trial_id.to_string(),
                created_at: Utc::now(),
                with_card: true,
            });
        save_library_to_dir(&dir, &library).expect("写库");
    }

    /// 空库直接口述的首次保存：一次建链路＋首版本；不改 active；同内容重复调用幂等。
    #[test]
    fn ensure_chain_with_first_version_creates_once_and_is_idempotent() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);

        let first = store
            .ensure_chain_with_first_version("mc-1", "口述链路", &sample_cards(), "制作会话保存")
            .expect("建链路＋首版");
        assert_eq!(first.action, EnsureChainAction::Created);
        assert_eq!(first.chain.id, "chain-mc-1", "确定性链路 id 由会话 id 派生");
        assert_eq!(first.chain.name, "口述链路");
        assert_eq!(first.chain.versions.len(), 1);
        assert_eq!(first.chain.versions[0].index, 1);
        assert_eq!(first.chain.versions[0].cards.len(), 1);

        // 幂等：同会话、同内容再次调用不新增链路 / 版本。
        let again = store
            .ensure_chain_with_first_version("mc-1", "口述链路", &sample_cards(), "重复")
            .expect("幂等返回");
        assert_eq!(again.action, EnsureChainAction::Idempotent);
        assert_eq!(again.chain.versions.len(), 1, "不重复首版本");
        let library = store.load().expect("读库");
        assert_eq!(library.chains.len(), 1, "不重复建链路");
        assert!(
            library.active.is_none(),
            "保存草稿不得启用（active 保持 None）"
        );
    }

    /// 不同卡内容：明确冲突，不追加、不改动（不谎称已保存）；恢复绑定后普通保存追加。
    #[test]
    fn ensure_chain_with_first_version_reports_conflict_without_appending() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        store
            .ensure_chain_with_first_version("mc-c", "口述链路", &sample_cards(), "首版")
            .expect("首版");

        let mut different = sample_cards();
        different[0].title = "完全不同的卡".to_string();
        let result = store
            .ensure_chain_with_first_version("mc-c", "口述链路", &different, "改稿")
            .expect("冲突返回（不报错、不谎称成功）");
        assert_eq!(result.action, EnsureChainAction::Conflict);
        assert_eq!(result.chain.versions.len(), 1, "冲突不追加版本");
        assert_eq!(result.chain.id, "chain-mc-c");
        // 冲突后（会话已绑定该链路）普通保存追加为第 2 版。
        let appended = store
            .save_version("chain-mc-c", &different, "改稿")
            .expect("追加新版本");
        assert_eq!(appended.index, 2);
    }

    /// 前次部分失败（链路已建、尚无版本）：补写首版本，不重复建链路。
    #[test]
    fn ensure_chain_with_first_version_repairs_chain_without_versions() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        store.create_chain("半成品").expect("建空链路（无版本）");
        // 改写为确定性 id，模拟「链路已建、但首版本尚未写入」的部分成功状态。
        let dir = module_dir_of(&base);
        let mut library = load_library_from_dir(&dir).expect("读库");
        library.chains[0].id = "chain-mc-2".to_string();
        save_library_to_dir(&dir, &library).expect("改写库");

        let chain = store
            .ensure_chain_with_first_version("mc-2", "半成品", &sample_cards(), "补首版")
            .expect("补首版");
        assert_eq!(chain.action, EnsureChainAction::Repaired);
        assert_eq!(chain.chain.id, "chain-mc-2");
        assert_eq!(chain.chain.versions.len(), 1, "补写首版本");
        assert_eq!(
            load_library_from_dir(&dir).expect("读库").chains.len(),
            1,
            "不重复建链路"
        );
    }

    /// 空名称回退「新链路」，不虚空建名。
    #[test]
    fn ensure_chain_with_first_version_falls_back_name() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store
            .ensure_chain_with_first_version("mc-3", "   ", &sample_cards(), "")
            .expect("建链路");
        assert_eq!(chain.chain.name, "新链路");
    }

    /// 命令组合的并发语义：会话已删除时 ensure 拒绝且不产生孤链（校验与写入同锁内）。
    #[test]
    fn ensure_via_helper_rejects_deleted_conversation_without_creating_chain() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let conversations_dir = conversations_dir_in(&module_dir_of(&base));
        let record = crate::making_session::MakingConversationRecord {
            id: "mc-del".to_string(),
            chain_id: None,
            title: "制作".to_string(),
            created_at: "t".to_string(),
            updated_at: "t".to_string(),
            turns: Vec::new(),
        };
        crate::making_session::save_making_conversation(&conversations_dir, &record).expect("保存");
        crate::making_session::delete_making_conversation(&conversations_dir, "mc-del")
            .expect("删除");

        let result = crate::making_session::with_conversation_store_lock(
            &conversations_dir,
            "mc-del",
            "chain-mc-del",
            || {
                store
                    .ensure_chain_with_first_version("mc-del", "链路", &sample_cards(), "")
                    .map_err(|e| e.to_string())
            },
        );
        assert!(result.is_err(), "删除会话后 ensure 拒绝");
        assert!(store.load().expect("读库").chains.is_empty(), "不产生孤链");
    }

    #[test]
    fn saving_new_version_appends_and_keeps_old_version_intact() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");

        let v1 = store
            .save_version(&chain.id, &sample_cards(), "初稿")
            .expect("存第 1 版");
        let mut changed = sample_cards();
        changed[0].body = "改写后的正文，与初稿不同。".to_string();
        let v2 = store
            .save_version(&chain.id, &changed, "改卡")
            .expect("存第 2 版");

        assert_eq!(v1.index, 1, "首版本序号为 1");
        assert_eq!(v2.index, 2, "新版本序号链内递增");
        assert_ne!(v1.id, v2.id);

        let library = store.load().expect("读库");
        let stored = library
            .chains
            .iter()
            .find(|c| c.id == chain.id)
            .expect("链路仍在");
        assert_eq!(stored.versions.len(), 2, "两个版本并存");
        assert_eq!(
            stored.versions[0].cards, v1.cards,
            "旧版本内容保持不变（不可变）"
        );
        assert_eq!(stored.versions[0].id, v1.id);
        // 保存新版本不是启用：active 不因保存而改变。
        assert!(
            library.active.is_none(),
            "存草稿不等于生效，保存后指针仍为空"
        );
    }

    #[test]
    fn rollback_points_active_at_old_version_and_keeps_newer_ones() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");
        let v1 = store
            .save_version(&chain.id, &sample_cards(), "v1")
            .expect("v1");
        let v2 = store
            .save_version(&chain.id, &sample_cards(), "v2")
            .expect("v2");
        let v3 = store
            .save_version(&chain.id, &sample_cards(), "v3")
            .expect("v3");
        store.set_active(&chain.id, &v3.id).expect("启用 v3");
        inject_trial_ref(&base, 0, 2, "trial-v3");

        store.rollback(&chain.id, &v2.id).expect("回退到 v2");

        let library = store.load().expect("读库");
        let active = library.active.as_ref().expect("回退后仍启用");
        assert_eq!(active.chain_id, chain.id);
        assert_eq!(active.version_id, v2.id, "指针指向旧版本");
        let stored = &library.chains[0];
        assert_eq!(stored.versions.len(), 3, "回退不删除较新版本");
        assert!(stored.versions.iter().any(|v| v.id == v1.id));
        assert!(stored.versions.iter().any(|v| v.id == v3.id));
        assert_eq!(
            stored.versions[2].trials.len(),
            1,
            "v3 的试问证据引用完整保留"
        );
    }

    #[test]
    fn deactivating_preserves_archives_and_clears_snapshot() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");
        let v1 = store
            .save_version(&chain.id, &sample_cards(), "初稿")
            .expect("存版本");
        store.set_active(&chain.id, &v1.id).expect("启用");

        let frozen = store.snapshot_active().expect("冻结快照").expect("已启用");
        assert_eq!(frozen.chain_id, chain.id);
        assert_eq!(frozen.chain_name, "链路甲");
        assert_eq!(frozen.version_id, v1.id);
        assert_eq!(frozen.version_index, 1);
        assert_eq!(frozen.cards, v1.cards, "快照携带冻结的卡数据");

        store.deactivate().expect("停用");

        let library = store.load().expect("读库");
        assert!(library.active.is_none(), "停用后指针置空");
        assert_eq!(library.chains.len(), 1, "链路保留");
        assert_eq!(library.chains[0].versions.len(), 1, "版本保留");
        assert_eq!(library.chains[0].versions[0].cards, v1.cards, "卡内容保留");
        assert!(
            store.snapshot_active().expect("冻结快照").is_none(),
            "停用后快照为空（下一轮回到日常陪想）"
        );

        // 停用是轻量动作：可再次启用。
        store.set_active(&chain.id, &v1.id).expect("再次启用");
        assert!(store.snapshot_active().expect("冻结快照").is_some());
    }

    #[test]
    fn multiple_chains_coexist_independently() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain_a = store.create_chain("链路甲").expect("建甲");
        let chain_b = store.create_chain("链路乙").expect("建乙");

        let va = store
            .save_version(&chain_a.id, &sample_cards(), "甲 v1")
            .expect("甲版本");
        let vb = store
            .save_version(&chain_b.id, &sample_cards(), "乙 v1")
            .expect("乙版本");
        assert_ne!(va.id, vb.id, "不同链路的版本相互独立");
        store.set_active(&chain_a.id, &va.id).expect("启用甲");

        // 删除乙不影响甲的版本、指针与试问证据。
        inject_trial_ref(&base, 0, 0, "trial-a");
        store.delete_chain(&chain_b.id).expect("删除乙");

        let library = store.load().expect("读库");
        assert_eq!(library.chains.len(), 1, "只剩甲");
        assert_eq!(library.chains[0].id, chain_a.id);
        assert_eq!(library.chains[0].versions.len(), 1, "甲版本不受影响");
        let active = library.active.as_ref().expect("指针不受影响");
        assert_eq!(active.chain_id, chain_a.id);
        assert_eq!(active.version_id, va.id);
        assert_eq!(
            library.chains[0].versions[0].trials.len(),
            1,
            "甲的试问证据引用不受影响"
        );
    }

    #[test]
    fn deleting_chain_clears_pointer_and_removes_its_trial_files() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain_a = store.create_chain("链路甲").expect("建甲");
        let chain_b = store.create_chain("链路乙").expect("建乙");
        let va = store
            .save_version(&chain_a.id, &sample_cards(), "甲 v1")
            .expect("甲版本");
        store
            .save_version(&chain_b.id, &sample_cards(), "乙 v1")
            .expect("乙版本");
        store.set_active(&chain_a.id, &va.id).expect("启用甲");

        // 两条试问证据占位文件各归其链路（写入逻辑属后续任务组，这里手动落文件）。
        let trials_dir = trials_dir_in(&module_dir_of(&base));
        fs::create_dir_all(&trials_dir).expect("建试问目录");
        fs::write(trials_dir.join("trial-a.json"), "{}").expect("写甲证据");
        fs::write(trials_dir.join("trial-b.json"), "{}").expect("写乙证据");
        inject_trial_ref(&base, 0, 0, "trial-a");
        inject_trial_ref(&base, 1, 0, "trial-b");

        store.delete_chain(&chain_a.id).expect("删除甲");

        let library = store.load().expect("读库");
        assert!(library.active.is_none(), "指针指向被删链路时一并置空");
        assert_eq!(library.chains.len(), 1, "只剩乙");
        assert!(
            !trials_dir.join("trial-a.json").exists(),
            "被删链路的试问证据文件一并清理"
        );
        assert!(
            trials_dir.join("trial-b.json").exists(),
            "其他链路的试问证据文件不受影响"
        );
    }

    #[test]
    fn card_limits_are_enforced_with_explicit_errors() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");

        // 触发描述超限（401 > 400）。
        let mut cards = sample_cards();
        cards[0].trigger_desc = "触".repeat(MAX_TRIGGER_DESC_CHARS + 1);
        let error = store
            .save_version(&chain.id, &cards, "")
            .expect_err("触发描述超限必须拒绝");
        let message = error.to_string();
        assert!(message.contains("触发描述"), "{message}");
        assert!(message.contains("401"), "报错带实际长度: {message}");

        // 单卡正文超限（2001 > 2000）。
        let mut cards = sample_cards();
        cards[0].body = "文".repeat(MAX_CARD_BODY_CHARS + 1);
        let error = store
            .save_version(&chain.id, &cards, "")
            .expect_err("正文超限必须拒绝");
        let message = error.to_string();
        assert!(message.contains("正文"), "{message}");
        assert!(message.contains("2001"), "报错带实际长度: {message}");

        // 版本合计超限：3 张卡各 400 触发＋1601 正文＝6003 > 6000（单卡均未超限）。
        let cards: Vec<CardInput> = (0..3)
            .map(|i| CardInput {
                title: format!("卡{i}"),
                trigger_desc: "触".repeat(MAX_TRIGGER_DESC_CHARS),
                body: "文".repeat(1601),
                slot_type: SLOT_TYPE_REQUIREMENT.to_string(),
            })
            .collect();
        let error = store
            .save_version(&chain.id, &cards, "")
            .expect_err("版本合计超限必须拒绝");
        let message = error.to_string();
        assert!(message.contains("合计"), "{message}");
        assert!(message.contains("6003"), "报错带实际合计: {message}");

        // 三次失败后库中不产生任何版本（未写入）。
        let library = store.load().expect("读库");
        assert!(
            library.chains[0].versions.is_empty(),
            "被拒绝的保存不落任何版本"
        );
    }

    #[test]
    fn missing_trigger_description_and_empty_cards_are_rejected() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");

        let mut cards = sample_cards();
        cards[0].trigger_desc = "   ".to_string();
        let error = store
            .save_version(&chain.id, &cards, "")
            .expect_err("缺触发描述必须拒绝");
        assert!(
            error.to_string().contains("触发描述"),
            "{}",
            error.to_string()
        );

        let error = store
            .save_version(&chain.id, &[], "")
            .expect_err("空卡列表必须拒绝");
        assert!(
            error.to_string().contains("至少需要一张卡"),
            "{}",
            error.to_string()
        );

        // 链路名称同理：空白名称拒绝。
        let error = store.create_chain("   ").expect_err("空白名称必须拒绝");
        assert!(
            error.to_string().contains("链路名称不能为空"),
            "{}",
            error.to_string()
        );
    }

    /// add-posture-slot 任务 2.2/2.6（2026-10-07 修订 7.2）：卡类型规则——
    /// 姿态卡每版本可多张（受合计上限约束）、纯姿态版本允许、类型取值合法、
    /// 长度上限两类合计。
    #[test]
    fn posture_card_type_rules_are_enforced() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");

        // 两张姿态卡并存：保存通过（修订 7.2——否决原「至多一张」）。
        let two_postures = vec![sample_posture_card(), sample_posture_card()];
        let two = store
            .save_version(&chain.id, &two_postures, "两姿态")
            .expect("两张姿态卡并存必须允许保存");
        assert_eq!(
            two.cards
                .iter()
                .filter(|card| card.slot_type == SLOT_TYPE_POSTURE)
                .count(),
            2,
            "两张姿态卡全部落版本"
        );

        // 无效类型取值：拒绝（静默当要求卡保存会丢语义）。
        let mut bad_type = sample_cards();
        bad_type[0].slot_type = "background".to_string();
        let error = store
            .save_version(&chain.id, &bad_type, "")
            .expect_err("未知卡类型必须拒绝");
        assert!(
            error.to_string().contains("类型无效"),
            "{}",
            error.to_string()
        );

        // 纯姿态版本：保存成功（至少一张卡、任一类型即通过）。
        let pure_posture = vec![sample_posture_card()];
        store
            .save_version(&chain.id, &pure_posture, "纯姿态")
            .expect("纯姿态卡版本允许保存");

        // 姿态＋要求并存：成功，类型随卡往返保留，serde 字段名为 slot_type。
        let mixed = vec![sample_cards()[0].clone(), sample_posture_card()];
        let version = store
            .save_version(&chain.id, &mixed, "混合")
            .expect("姿态＋要求卡版本允许保存");
        assert_eq!(version.cards[0].slot_type, SLOT_TYPE_REQUIREMENT);
        assert_eq!(version.cards[1].slot_type, SLOT_TYPE_POSTURE);
        let library = store.load().expect("读库");
        assert_eq!(
            library.chains[0].versions.last().expect("版本在场").cards,
            version.cards,
            "卡类型经落盘往返完整保留"
        );
        let json = serde_json::to_value(&version).expect("序列化");
        assert!(
            json["cards"][1].get("slot_type").is_some(),
            "卡类型 JSON 字段名必须为 slot_type"
        );
        assert_eq!(json["cards"][1]["slot_type"], SLOT_TYPE_POSTURE);

        // 三张姿态卡（含与要求卡混排）：保存通过，全部随版本保留——多张受
        // 合计上限自然约束，不做数量限制。
        let mut three_postures = vec![sample_cards()[0].clone()];
        three_postures.extend([
            sample_posture_card(),
            sample_posture_card(),
            sample_posture_card(),
        ]);
        let three = store
            .save_version(&chain.id, &three_postures, "三姿态")
            .expect("三张姿态卡并存必须允许保存");
        assert_eq!(
            three
                .cards
                .iter()
                .filter(|card| card.slot_type == SLOT_TYPE_POSTURE)
                .count(),
            3,
            "三张姿态卡全部落版本（不做冲突调和、组合权在用户）"
        );

        // 版本计数：全部成功保存均落版本（两姿态＝第 1 版、纯姿态＝第 2 版、
        // 混合＝第 3 版、三姿态＝第 4 版，共四版；唯一被拒的是无效类型）。
        let library = store.load().expect("读库");
        assert_eq!(
            library.chains[0].versions.len(),
            4,
            "被拒绝的保存不落版本，成功保存全部落版本"
        );

        // 长度上限两类合计：1 张姿态卡（400 触发＋1601 正文）＋2 张要求卡
        // （各 400 触发＋1601 正文）＝6003 > 6000（单卡均未超限）。
        let oversized: Vec<CardInput> = (0..3)
            .map(|i| CardInput {
                title: format!("卡{i}"),
                trigger_desc: "触".repeat(MAX_TRIGGER_DESC_CHARS),
                body: "文".repeat(1601),
                slot_type: if i == 0 {
                    SLOT_TYPE_POSTURE.to_string()
                } else {
                    SLOT_TYPE_REQUIREMENT.to_string()
                },
            })
            .collect();
        let error = store
            .save_version(&chain.id, &oversized, "")
            .expect_err("两类卡合计超限必须拒绝");
        assert!(error.to_string().contains("6003"), "{}", error.to_string());

        // 多张姿态卡的合计上限同口径：3 张姿态卡各 400 触发＋1601 正文＝6003
        // > 6000，超限拒绝（多张自然受此约束，不豁免）。
        let oversized_postures: Vec<CardInput> = (0..3)
            .map(|i| CardInput {
                title: format!("姿态{i}"),
                trigger_desc: "触".repeat(MAX_TRIGGER_DESC_CHARS),
                body: "文".repeat(1601),
                slot_type: SLOT_TYPE_POSTURE.to_string(),
            })
            .collect();
        let error = store
            .save_version(&chain.id, &oversized_postures, "")
            .expect_err("多张姿态卡合计超限必须拒绝");
        assert!(error.to_string().contains("合计"), "{}", error.to_string());
    }

    /// add-posture-slot 任务 2.1/2.6：v1 兼容读取——卡无类型字段视为全要求卡；
    /// 读取后保存一律升级写 v2（含 slot_type 字段）。
    #[test]
    fn v1_library_loads_as_all_requirement_and_next_save_upgrades_to_v2() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let module_dir = module_dir_of(&base);
        fs::create_dir_all(&module_dir).expect("建目录");
        // 手写 v1 主文件：卡结构无 slot_type 字段。
        fs::write(
            chains_file_in(&module_dir),
            r#"{
  "format_version": 1,
  "chains": [
    {
      "id": "chain-1",
      "name": "旧链路",
      "created_at": "2026-10-01T00:00:00Z",
      "versions": [
        {
          "id": "chainver-1",
          "index": 1,
          "created_at": "2026-10-01T00:00:00Z",
          "cards": [
            {"id": "card-1", "title": "旧卡", "trigger_desc": "适用：旧场景。", "body": "旧正文。"}
          ],
          "change_note": "",
          "trials": []
        }
      ]
    }
  ],
  "active": null
}"#,
        )
        .expect("写 v1 主文件");

        let store = store_in(&base);
        let library = store.load().expect("v1 文件必须兼容读取");
        assert!(
            library.chains[0].versions[0]
                .cards
                .iter()
                .all(|card| card.slot_type == SLOT_TYPE_REQUIREMENT),
            "v1 数据全部卡视为要求卡"
        );
        // 读取即规范化为当前版本：此后任何保存都写 2。
        assert_eq!(library.format_version, CHAIN_LIBRARY_FORMAT_VERSION);

        // 触发一次写路径（保存新版本）：主文件升级为 v2，旧版本卡补上 slot_type。
        store
            .save_version("chain-1", &[sample_posture_card()], "升级后存姿态")
            .expect("存版本");
        let on_disk = fs::read_to_string(chains_file_in(&module_dir)).expect("读主文件");
        let on_disk: serde_json::Value = serde_json::from_str(&on_disk).expect("主文件 JSON");
        assert_eq!(
            on_disk["format_version"],
            serde_json::json!(CHAIN_LIBRARY_FORMAT_VERSION),
            "保存一律写格式版本 2"
        );
        let old_card = &on_disk["chains"][0]["versions"][0]["cards"][0];
        assert_eq!(old_card["slot_type"], SLOT_TYPE_REQUIREMENT);

        // 保存后类型不丢：再次打开（新单例模拟重启），姿态卡类型完整保留。
        let store2 = ChainLibraryStore::new(Some(base.path().to_path_buf()));
        let reloaded = store2.load().expect("重读");
        assert_eq!(
            reloaded.chains[0].versions[1].cards[0].slot_type, SLOT_TYPE_POSTURE,
            "含姿态卡的版本经保存后再次打开，类型完整保留"
        );
    }

    /// add-posture-slot 任务 2.1/2.6：遇高于支持的格式版本明确拒读（「由更新
    /// 版本创建」），不误读、不重写该文件。
    #[test]
    fn newer_format_version_is_rejected_without_rewrite() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let module_dir = module_dir_of(&base);
        fs::create_dir_all(&module_dir).expect("建目录");
        let newer = r#"{
  "format_version": 3,
  "chains": [],
  "active": null
}"#;
        fs::write(chains_file_in(&module_dir), newer).expect("写更高版本主文件");

        let store = store_in(&base);
        let error = store.load().expect_err("更高版本必须明确拒读");
        let message = error.to_string();
        assert!(
            message.contains("由更新版本创建"),
            "拒读文案必须含「由更新版本创建」: {message}"
        );

        // 不重写：文件内容逐字保持（旧版误存会把类型永久丢掉，此处必须原样）。
        assert_eq!(
            fs::read_to_string(chains_file_in(&module_dir)).expect("读主文件"),
            newer,
            "拒读路径不得改写主文件"
        );
    }

    #[test]
    fn write_failure_is_reported_not_silent() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        // 占住 making-module 位置的是一个普通文件：建目录必然失败（目录不可写场景）。
        let module_path = making_module_dir_in(base.path());
        fs::write(&module_path, b"not a dir").expect("占位文件");

        let store = store_in(&base);
        let error = store.create_chain("链路甲").expect_err("写入失败必须报错");
        let message = error.to_string();
        assert!(message.contains("链路库写入失败"), "{message}");
    }

    #[test]
    fn oversized_chains_file_is_rejected_with_cleanup_hint() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let module_dir = module_dir_of(&base);
        fs::create_dir_all(&module_dir).expect("建目录");
        fs::write(
            chains_file_in(&module_dir),
            "x".repeat(MAX_CHAINS_FILE_BYTES as usize + 128),
        )
        .expect("写超限文件");

        let store = store_in(&base);
        let error = store.load().expect_err("超限必须明确报错");
        let message = error.to_string();
        assert!(message.contains("1 MiB"), "{message}");
        assert!(message.contains("试问"), "提示清理旧试问证据: {message}");
    }

    #[test]
    fn corrupt_chains_file_is_explicit_error_not_empty_overwrite() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let module_dir = module_dir_of(&base);
        fs::create_dir_all(&module_dir).expect("建目录");
        fs::write(chains_file_in(&module_dir), "{ \"chains\":").expect("写损坏内容");

        let store = store_in(&base);
        let error = store
            .load()
            .expect_err("损坏必须明确报错（不能当空库覆盖）");
        assert!(error.to_string().contains("损坏"), "{}", error.to_string());
    }

    #[test]
    fn missing_file_loads_empty_library_without_side_effects() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let library = store.load().expect("读空库");
        assert!(library.chains.is_empty(), "文件缺失视为空库");
        assert!(library.active.is_none());
        assert!(
            !chains_file_in(&module_dir_of(&base)).exists(),
            "纯读取不创建主文件"
        );
        assert!(!module_dir_of(&base).exists(), "纯读取不创建目录");
    }

    #[test]
    fn library_roundtrips_through_disk() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");
        let v1 = store
            .save_version(&chain.id, &sample_cards(), "初稿")
            .expect("存版本");
        store.set_active(&chain.id, &v1.id).expect("启用");

        // 换一个单例实例（模拟重启后重新读盘）。
        let store2 = ChainLibraryStore::new(Some(base.path().to_path_buf()));
        let library = store2.load().expect("读库");
        assert_eq!(library.format_version, CHAIN_LIBRARY_FORMAT_VERSION);
        assert_eq!(library.chains.len(), 1);
        assert_eq!(library.chains[0].name, "链路甲");
        assert_eq!(library.chains[0].id, chain.id);
        assert_eq!(library.chains[0].versions.len(), 1);
        assert_eq!(library.chains[0].versions[0].cards, v1.cards);
        assert_eq!(library.chains[0].versions[0].change_note, "初稿");
        let active = library.active.clone().expect("指针经落盘保留");
        assert_eq!(active.chain_id, chain.id);
        assert_eq!(active.version_id, v1.id);

        // 惰性目录布局在首次写入后就位（写入逻辑属后续任务组）。
        assert!(conversations_dir_in(&module_dir_of(&base)).is_dir());
        assert!(trials_dir_in(&module_dir_of(&base)).is_dir());

        // serde 字段 snake_case。
        let json = serde_json::to_value(&library).expect("序列化");
        assert!(json.get("format_version").is_some());
        assert!(json.get("chains").is_some());
        assert!(json.get("active").is_some());
        assert!(json["chains"][0]["versions"][0]
            .get("change_note")
            .is_some());
        assert!(json["chains"][0]["versions"][0]["cards"][0]
            .get("trigger_desc")
            .is_some());
    }

    #[test]
    fn setting_active_with_unknown_ids_is_rejected() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain_a = store.create_chain("链路甲").expect("建甲");
        let chain_b = store.create_chain("链路乙").expect("建乙");
        let va = store
            .save_version(&chain_a.id, &sample_cards(), "甲 v1")
            .expect("甲版本");
        let vb = store
            .save_version(&chain_b.id, &sample_cards(), "乙 v1")
            .expect("乙版本");

        // 乙链路的版本不能挂到甲链路名下。
        let error = store
            .set_active(&chain_a.id, &vb.id)
            .expect_err("跨链路版本必须拒绝");
        assert!(
            error.to_string().contains("不存在指定版本"),
            "{}",
            error.to_string()
        );

        let error = store
            .set_active("chain-nope", &va.id)
            .expect_err("未知链路必须拒绝");
        assert!(
            error.to_string().contains("链路不存在"),
            "{}",
            error.to_string()
        );

        let error = store
            .save_version("chain-nope", &sample_cards(), "")
            .expect_err("向未知链路存版本必须拒绝");
        assert!(
            error.to_string().contains("链路不存在"),
            "{}",
            error.to_string()
        );
    }

    #[test]
    fn renaming_chain_only_changes_name() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");
        let v1 = store
            .save_version(&chain.id, &sample_cards(), "初稿")
            .expect("存版本");
        store.set_active(&chain.id, &v1.id).expect("启用");

        store
            .rename_chain(&chain.id, " 重命名为链路乙 ")
            .expect("重命名");

        let library = store.load().expect("读库");
        assert_eq!(library.chains[0].name, "重命名为链路乙", "名称更新并去空白");
        assert_eq!(library.chains[0].versions.len(), 1, "版本不动");
        assert!(
            library.active.is_some(),
            "启用指针不动（仍指向同一链路与版本）"
        );

        let error = store
            .rename_chain(&chain.id, "  ")
            .expect_err("空白新名称必须拒绝");
        assert!(
            error.to_string().contains("链路名称不能为空"),
            "{}",
            error.to_string()
        );
    }

    #[test]
    fn store_without_app_data_dir_reports_explicit_error() {
        let store = ChainLibraryStore::new(None);
        let error = store.load().expect_err("目录不可用必须报错");
        assert!(
            error.to_string().contains("无法访问应用本地数据目录"),
            "{}",
            error
        );
    }

    // ========== 试问证据（add-making-module-core 任务 6.4） ==========

    fn sample_trial(id: &str, chain_id: &str, version_id: &str, created: &str) -> TrialRecord {
        TrialRecord {
            id: id.to_string(),
            chain_id: chain_id.to_string(),
            chain_name: "链路甲".to_string(),
            version_id: version_id.to_string(),
            version_index: 1,
            with_card: true,
            question: "主角为什么离开？".to_string(),
            reply_text: "回复全文".to_string(),
            status: TrialStatus::Success,
            created_at: created.parse::<DateTime<Utc>>().expect("时间"),
            work_title: "试用作品".to_string(),
            focus_document_id: Some("doc-1".to_string()),
            focus_document_title: Some("第一场".to_string()),
            feedback: None,
        }
    }

    /// 试问证据往返＋serde snake_case 锚定（前端契约）＋缺失/损坏明确报错。
    #[test]
    fn trial_record_roundtrips_with_snake_case_and_explicit_errors() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let trials_dir = trials_dir_in(&module_dir_of(&base));

        let record = sample_trial("trial-1", "chain-a", "chainver-1", "2026-10-06T10:00:00Z");
        save_trial_record(&trials_dir, &record).expect("保存证据");
        let loaded = load_trial_record(&trials_dir, "trial-1").expect("读取证据");
        assert_eq!(loaded, record);

        // serde 字段名（前端契约）：snake_case 锚定。
        let json = serde_json::to_value(&loaded).expect("序列化");
        for field in [
            "id",
            "chain_id",
            "chain_name",
            "version_id",
            "version_index",
            "with_card",
            "question",
            "reply_text",
            "status",
            "created_at",
            "work_title",
            "focus_document_id",
            "focus_document_title",
            "feedback",
        ] {
            assert!(json.get(field).is_some(), "试问证据缺少字段 {field}");
        }
        assert_eq!(json["status"], "success");
        // pending→终态更新：整档重写后状态翻转、其余字段保持。
        let mut updated = loaded;
        updated.status = TrialStatus::Failed;
        updated.reply_text = String::new();
        save_trial_record(&trials_dir, &updated).expect("更新证据");
        assert_eq!(
            load_trial_record(&trials_dir, "trial-1")
                .expect("重读")
                .status,
            TrialStatus::Failed
        );

        // 缺失 / 损坏 / 无效标识：明确报错，不静默吞。
        let error = load_trial_record(&trials_dir, "trial-missing").expect_err("缺失必须明确报错");
        assert!(error.to_string().contains("不存在"), "{error}");
        fs::write(trial_record_file_in(&trials_dir, "trial-bad"), "{ not json")
            .expect("写损坏证据");
        let error = load_trial_record(&trials_dir, "trial-bad").expect_err("损坏必须明确报错");
        assert!(error.to_string().contains("损坏"), "{error}");

        // 无前缀 / 不安全标识：保存拒绝（工具路由按 trial- 前缀识别试问身份）。
        let mut no_prefix = sample_trial("nope-1", "chain-a", "chainver-1", "2026-10-06T10:00:00Z");
        no_prefix.id = "nope-1".to_string();
        let error = save_trial_record(&trials_dir, &no_prefix).expect_err("无前缀标识必须拒绝");
        assert!(error.to_string().contains("trial-"), "{error}");
        let mut unsafe_id =
            sample_trial("trial-x", "chain-a", "chainver-1", "2026-10-06T10:00:00Z");
        unsafe_id.id = "trial-../evil".to_string();
        let error = save_trial_record(&trials_dir, &unsafe_id).expect_err("不安全标识必须拒绝");
        assert!(error.to_string().contains("路径分隔符"), "{error}");
    }

    /// append_trial_ref：追加引用、同 id 幂等更新、不动 active 指针、
    /// 未知链路 / 版本明确报错。
    #[test]
    fn append_trial_ref_upserts_and_keeps_active_pointer() {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = store_in(&base);
        let chain = store.create_chain("链路甲").expect("建链路");
        let other = store.create_chain("链路乙").expect("建乙");
        let other_version = store
            .save_version(&other.id, &sample_cards(), "乙 v1")
            .expect("乙版本");
        store
            .set_active(&other.id, &other_version.id)
            .expect("启用乙（指针应保持不动）");
        let version = store
            .save_version(&chain.id, &sample_cards(), "甲 v1")
            .expect("甲版本");

        store
            .append_trial_ref(
                &chain.id,
                &version.id,
                TrialRef {
                    trial_id: "trial-1".to_string(),
                    created_at: Utc::now(),
                    with_card: true,
                },
            )
            .expect("追加引用");

        let library = store.load().expect("读库");
        let stored = library
            .chains
            .iter()
            .find(|c| c.id == chain.id)
            .expect("链路在场");
        assert_eq!(stored.versions[0].trials.len(), 1);
        assert_eq!(stored.versions[0].trials[0].trial_id, "trial-1");
        // 试问不切全局链路：指针仍指向乙。
        let active = library.active.expect("指针在场");
        assert_eq!(active.chain_id, other.id);

        // 同 id 幂等更新（重试安全）：不产生重复条目。
        store
            .append_trial_ref(
                &chain.id,
                &version.id,
                TrialRef {
                    trial_id: "trial-1".to_string(),
                    created_at: Utc::now(),
                    with_card: false,
                },
            )
            .expect("幂等更新");
        let library = store.load().expect("重读");
        let stored = library
            .chains
            .iter()
            .find(|c| c.id == chain.id)
            .expect("链路在场");
        assert_eq!(stored.versions[0].trials.len(), 1, "同 id 不得重复");
        assert!(!stored.versions[0].trials[0].with_card);

        // 未知链路 / 版本：明确报错。
        let error = store
            .append_trial_ref(
                "chain-nope",
                &version.id,
                TrialRef {
                    trial_id: "trial-2".to_string(),
                    created_at: Utc::now(),
                    with_card: true,
                },
            )
            .expect_err("未知链路必须报错");
        assert!(error.to_string().contains("链路不存在"), "{error}");
        let error = store
            .append_trial_ref(
                &chain.id,
                "chainver-nope",
                TrialRef {
                    trial_id: "trial-2".to_string(),
                    created_at: Utc::now(),
                    with_card: true,
                },
            )
            .expect_err("未知版本必须报错");
        assert!(error.to_string().contains("不存在指定版本"), "{error}");
    }
}
