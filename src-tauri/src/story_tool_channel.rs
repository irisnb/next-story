//! 宿主工具调用通道（change: add-agent-on-demand-reading 任务组 5/6，设计
//! D1/D2/D4/D5/D8/D9/D12/D13）。
//!
//! 职责：把驱动的 `tool_call` 事件路由到受控执行与授权流程——
//! - 三个读取工具：经 [`crate::story_tools`] 执行（内置作品身份 / 回收站 /
//!   可见性 / 版本 / 待恢复事务逐次校验 + 档案授权），结果以 `tool_result`
//!   回填驱动，原轮继续。
//! - `story-request-reading`（控制工具，设计 D1）：宿主拦截。已授权讨论直接回
//!   「无需再请求」；未授权讨论转为面向前端的授权请求事件（`ai-reading-request`），
//!   该轮挂起、不产生模型请求，用户决定经 [`StoryToolChannel::resolve_reading_request`]
//!   以工具结果（granted / denied）回填继续。授权卡 UI 是任务组 7，本模块只定义
//!   事件与命令接口，且全部可在无 UI 情况下被 Rust 测试直接调用。
//! - 及时召唤首轮硬门禁（设计 D13，任务 5.5）：路由上下文携带 `hard_gate` 时，
//!   全部补读工具调用（含授权请求）一律结构化拒绝（`on_demand_reading_unauthorized`）。
//! - 拒绝恢复提示（batch-improvement-candidates ②，design D5）：未授权系与补读
//!   停止两类拒绝回填携带稳定英文恢复路径提示（协议 `error.recovery`，指向
//!   `story-request-reading` 与讨论面板授权，不指向不存在的开关）；用户「本次
//!   不允许」的 `{granted:false}` 结果内附同一恢复串。
//! - 迟到丢弃（任务 5.3）：讨论 / 会话身份失效或轮次已取消时，迟到的授权决定由
//!   驱动侧拒绝（`tool_call_not_found`），不污染其他讨论；宿主侧待决表只认
//!   call_id + 会话身份双重匹配。
//! - 轮内监管（任务组 6，状态全部在本通道，执行器保持无状态）：
//!   版本固定表（D4，首次成功读取固定该轮版本，失配 `story_version_changed`
//!   本轮停读）、同轮同版去重（D9，重复返回「已提供过」附出处，跨轮不屏蔽）、
//!   按轮累计的阅读程度判定（D12，写入讨论档案出处）、宿主侧保险丝（D5，
//!   按轮调用计数 + 累计时长超阈值后该轮后续补读一律 `reading_stopped`）。
//!   轮身份 =（讨论, register_round 序号）：同一讨论同一轮请求周期内共享状态，
//!   新一轮 / 重启后旧轮状态作废（固定语义只活在一轮之内，不持久化）。
//!
//! 本模块不读写用户作品正文（执行走 story_tools 只读面）；授权与出处的写入只经
//! 既有讨论档案原子保存。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::conversation_store::{
    read_conversation, save_conversation, OnDemandReadingProvenance, ReadingDepth,
};
use crate::dsh_driver::{DshDriverManager, ToolCallPayload};
use crate::project::{MaterialRange, ProjectPaths, SearchResult, SearchStatus};
use crate::story_tools::{
    execute_story_tool, grant_on_demand_reading, resolve_conversation_authorization,
    AuthorizationResolution, DiskStoryReader, ProvidedHint, ReadingRequestOutcome, StoryToolCall,
    StoryToolDenialReason, StoryToolOutcome,
};

/// 按轮补读保险丝配置（设计 D5，任务 6.4）。单一配置源：默认值在此，测试与
/// 真实链路校准（任务 9.5）只改这里 / 注入新值——不是散落的魔法数字。
/// 数值为内部初始值，需真实效果验证，非产品效果承诺，也不向用户呈现配额。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadingFuseConfig {
    /// 每轮补读工具调用（story-list / story-read / story-search 到达）次数上限。
    pub max_tool_calls: u64,
    /// 每轮补读工具累计执行时长上限（只计工具执行，不含授权等待——等待以分钟
    /// 计且由用户驱动，不是异常循环信号）。
    pub max_accumulated_duration: Duration,
}

impl Default for ReadingFuseConfig {
    fn default() -> Self {
        Self {
            // 内部初始值：正常一轮（目录 + 若干读取 / 检索）远低于此；异常循环
            // （DSH 框架无总步数上限，设计 D5 风险）会被截停。校准归任务 9.5。
            max_tool_calls: 24,
            max_accumulated_duration: Duration::from_secs(120),
        }
    }
}

/// 一轮的工具路由上下文：`ai_send_message` 随轮次注册（讨论身份 + 作品根）。
#[derive(Debug, Clone)]
pub struct ToolRoutingContext {
    pub conversation_id: String,
    pub project_root: PathBuf,
    /// 及时召唤首轮（设计 D13 硬门禁）：全部补读工具调用一律按未授权拒绝。
    pub hard_gate: bool,
    /// 本轮序号（进程内按讨论递增；出处轮次的跨重启对齐由任务组 6 落实）。
    pub turn_index: u32,
}

/// 面向前端的授权请求事件载荷（Tauri 事件 `ai-reading-request`；UI 是任务组 7）。
/// 只携带身份与模型提供的请求原因，不携带任何作品数据（设计 D1）。
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ReadingRequestEvent {
    pub session_id: String,
    pub message_id: String,
    pub call_id: String,
    pub conversation_id: String,
    /// 模型提供的请求原因（透传）。
    pub reason: String,
}

/// 授权请求事件回调（Tauri 层转发为前端事件；测试注入收集器）。
pub type ReadingRequestSink = Arc<dyn Fn(ReadingRequestEvent) + Send + Sync>;

/// 待决授权请求（挂起的 story-request-reading 调用；D1：恢复 = 工具结果返回）。
#[derive(Debug, Clone)]
struct PendingAuthorization {
    session_id: String,
    message_id: String,
    conversation_id: String,
    project_root: PathBuf,
}

// ========== 轮内监管状态（任务组 6：固定表 / 去重 / 覆盖累计 / 熔断） ==========

/// 一篇文档在该轮的覆盖累计（设计 D12）：按版本记录已读字节区间与全文长度，
/// 版本变化即重置（旧区间的字节不再对应新正文）。
#[derive(Debug, Default, Clone)]
struct DocCoverage {
    version: Option<String>,
    total_len: Option<usize>,
    /// 已合并排序的覆盖区间（字节，左闭右开）。
    intervals: Vec<(usize, usize)>,
}

impl DocCoverage {
    /// 记录一次读取覆盖；版本变化重置累计。
    fn record(&mut self, version: &str, range: MaterialRange, total_len: Option<usize>) {
        if self.version.as_deref() != Some(version) {
            self.version = Some(version.to_string());
            self.intervals.clear();
            self.total_len = total_len;
        } else if self.total_len.is_none() {
            self.total_len = total_len;
        }
        self.intervals.push((range.start, range.end));
        self.intervals.sort_unstable();
        let mut merged: Vec<(usize, usize)> = Vec::with_capacity(self.intervals.len());
        for (start, end) in self.intervals.drain(..) {
            match merged.last_mut() {
                Some(last) if start <= last.1 => last.1 = last.1.max(end),
                _ => merged.push((start, end)),
            }
        }
        self.intervals = merged;
    }

    fn covered_len(&self) -> usize {
        self.intervals
            .iter()
            .map(|(s, e)| e.saturating_sub(*s))
            .sum()
    }

    /// 是否覆盖全文：需要已知全文长度且区间全覆盖（长度未知时不冒充完整）。
    fn is_full(&self) -> bool {
        match self.total_len {
            Some(total) => total > 0 && self.covered_len() >= total,
            None => false,
        }
    }
}

/// 读取前的轮内决策（固定表 / 去重 / 停读）。
#[derive(Debug)]
enum ReadPreparation {
    /// 结构化拒绝（版本失配等）。
    Denied(StoryToolDenialReason),
    /// 同轮同版同范围已提供过：返回简短提示（设计 D9）。
    AlreadyProvided(ProvidedHint),
    /// 放行执行；`version` 为经固定表改写后的期望版本（已固定文档强制携带）。
    Execute { version: Option<String> },
}

/// 已提供键（设计 D9）：（文档 id, 版本, 请求范围）。
type ProvidedKey = (String, String, Option<(usize, usize)>);

/// 一轮的补读监管状态：register_round 时整体重置（跨轮不共享；旧轮状态作废）。
#[derive(Debug, Default, Clone)]
struct RoundReadingState {
    /// 版本固定表（设计 D4）：文档 → 该轮固定版本（首次成功读取固定）。
    pinned: HashMap<String, String>,
    /// 本轮停读的文档（版本失配后；下一轮自然恢复）。
    blocked: HashSet<String>,
    /// 已提供（文档, 版本, 请求范围）→ 首次提供的有效范围（设计 D9）。
    provided: HashMap<ProvidedKey, MaterialRange>,
    /// 文档名（去重提示的出处用）。
    names: HashMap<String, String>,
    /// 按轮累计的读取覆盖（设计 D12）。
    coverage: HashMap<String, DocCoverage>,
    /// 仅检索命中的文档（无读取覆盖时阅读程度为搜索片段，设计 D12）。
    search_only: HashMap<String, String>,
    /// 本轮补读工具调用到达计数（保险丝，设计 D5）。
    reading_calls: u64,
    /// 本轮补读工具累计执行时长（不含授权等待）。
    accumulated: Duration,
    /// 保险丝是否已触发（触发后该轮后续补读一律拒绝）。
    fused: bool,
    /// 本轮出处是否有更新（决定是否写档案）。
    provenance_dirty: bool,
}

impl RoundReadingState {
    /// story-read 的轮内前置决策：停读 / 固定表改写与失配拒绝 / 同轮去重。
    fn prepare_read(
        &mut self,
        turn_index: u32,
        document_id: &str,
        version: Option<String>,
        range: Option<MaterialRange>,
    ) -> ReadPreparation {
        // 本轮已停读：任何后续读取一律版本失配拒绝（下一轮读最新版）。
        if self.blocked.contains(document_id) {
            return ReadPreparation::Denied(StoryToolDenialReason::StoryVersionChanged);
        }
        // 版本固定表（D4）：未固定时透传请求版本；已固定时强制该轮版本，
        // 请求他版即失配（本轮停读该文档）。
        let effective_version = match self.pinned.get(document_id) {
            Some(pinned) => {
                if version.as_deref().is_some_and(|v| v != pinned) {
                    self.blocked.insert(document_id.to_string());
                    return ReadPreparation::Denied(StoryToolDenialReason::StoryVersionChanged);
                }
                Some(pinned.clone())
            }
            None => version,
        };
        // 同轮同版去重（D9）：请求范围按 None / 字节区间归一比较；跨轮不屏蔽
        // （状态随轮重置）。整篇（None）与显式区间视为不同请求。
        let key = (
            document_id.to_string(),
            effective_version.clone().unwrap_or_default(),
            range.map(|r| (r.start, r.end)),
        );
        if let Some(&effective_range) = self.provided.get(&key) {
            return ReadPreparation::AlreadyProvided(ProvidedHint {
                document_id: document_id.to_string(),
                document_name: self.names.get(document_id).cloned().unwrap_or_default(),
                version: effective_version.unwrap_or_default(),
                range: effective_range,
                turn_index,
            });
        }
        ReadPreparation::Execute {
            version: effective_version,
        }
    }

    /// story-read 成功后记账：固定版本、记已提供、累计覆盖（D12）。
    fn record_read_success(
        &mut self,
        document_id: &str,
        document_name: &str,
        version: String,
        requested_range: Option<MaterialRange>,
        material_range: MaterialRange,
        total_len: Option<usize>,
    ) {
        self.pinned
            .entry(document_id.to_string())
            .or_insert_with(|| version.clone());
        self.names
            .insert(document_id.to_string(), document_name.to_string());
        let key = (
            document_id.to_string(),
            version.clone(),
            requested_range.map(|r| (r.start, r.end)),
        );
        self.provided.entry(key).or_insert(material_range);
        self.search_only.remove(document_id);
        self.coverage
            .entry(document_id.to_string())
            .or_default()
            .record(&version, material_range, total_len);
        self.provenance_dirty = true;
    }

    /// story-read 被执行器以 `version_unavailable` 拒绝后的映射（D4「读到一半出新
    /// 版本」）：该文档本轮已固定版本时，映射为 `story_version_changed` 并停读。
    /// 返回是否映射。
    fn note_read_version_unavailable(&mut self, document_id: &str) -> bool {
        if self.pinned.contains_key(document_id) {
            self.blocked.insert(document_id.to_string());
            true
        } else {
            false
        }
    }

    /// story-search 结果的轮内后处理：本轮停读或版本已漂移的文档过滤其命中
    /// （避免一次回答拼接两个版本），并把保留的命中记为「仅检索命中」。
    fn filter_search(&mut self, result: &mut SearchResult) {
        result.snippets.retain(|snippet| {
            if self.blocked.contains(&snippet.document_id) {
                return false;
            }
            if let Some(pinned) = self.pinned.get(&snippet.document_id) {
                if pinned != &snippet.version {
                    // 检索发现该文档已保存为新版：本轮停读（D4）。
                    self.blocked.insert(snippet.document_id.clone());
                    return false;
                }
            }
            self.search_only
                .entry(snippet.document_id.clone())
                .or_insert_with(|| snippet.version.clone());
            true
        });
        if result.snippets.is_empty() {
            result.status = SearchStatus::NotFound;
        }
        self.provenance_dirty = true;
    }

    /// 本轮出处的累计视图（D12）：读取覆盖三档判定 + 仅检索命中文档为搜索片段。
    fn cumulative_updates(&self) -> Vec<(String, String, ReadingDepth)> {
        let mut updates = Vec::new();
        for (document_id, coverage) in &self.coverage {
            if let Some(version) = &coverage.version {
                let depth = if coverage.is_full() {
                    ReadingDepth::Full
                } else {
                    ReadingDepth::Partial
                };
                updates.push((document_id.clone(), version.clone(), depth));
            }
        }
        for (document_id, version) in &self.search_only {
            if !self.coverage.contains_key(document_id) {
                updates.push((
                    document_id.clone(),
                    version.clone(),
                    ReadingDepth::SearchSnippet,
                ));
            }
        }
        updates
    }

    /// 一次补读工具调用收尾（保险丝记账，D5）：累计执行时长并在越过阈值后
    /// 触发熔断（对该轮**后续**补读调用生效；本调用结果照常返回）。
    fn note_reading_arrival_completed(&mut self, elapsed: Duration, config: &ReadingFuseConfig) {
        self.accumulated += elapsed;
        if self.reading_calls >= config.max_tool_calls
            || self.accumulated >= config.max_accumulated_duration
        {
            self.fused = true;
        }
    }
}

/// 读取一篇文档当前已保存正文的字节长度（仅长度，不取内容；用于 D12 覆盖判定）。
fn saved_document_length(project_root: &Path, document_id: &str) -> Option<usize> {
    std::fs::metadata(ProjectPaths::new(project_root.to_path_buf()).document_file(document_id))
        .ok()
        .map(|meta| meta.len() as usize)
}

/// 宿主工具调用通道：会话 → 路由上下文 + 待决授权表 + 各讨论的当前轮监管状态。
pub struct StoryToolChannel {
    driver: Mutex<Option<DshDriverManager>>,
    routing: Mutex<HashMap<String, ToolRoutingContext>>,
    turn_counters: Mutex<HashMap<String, u32>>,
    pending: Mutex<HashMap<String, PendingAuthorization>>,
    reading_request_sink: Mutex<Option<ReadingRequestSink>>,
    /// 各讨论的当前轮监管状态（讨论 → 轮状态；register_round 重置）。
    rounds: Mutex<HashMap<String, RoundReadingState>>,
    /// 讨论档案出处的读改写串行锁：同一讨论的多个工具调用线程并发 upsert 时，
    /// 保证每次读改写都基于最新档案（防后写者用过期快照覆盖前写者）。
    provenance_write_lock: Mutex<()>,
    fuse_config: ReadingFuseConfig,
}

static CHANNEL: LazyLock<Arc<StoryToolChannel>> =
    LazyLock::new(|| Arc::new(StoryToolChannel::new()));

/// 全局通道（生产：ai_host 安装时绑定全局驱动管理器）。返回 Arc——工具执行
/// 在独立线程完成，线程闭包需要通道的 'static 共享句柄。
pub fn global_story_tool_channel() -> Arc<StoryToolChannel> {
    CHANNEL.clone()
}

impl StoryToolChannel {
    pub fn new() -> Self {
        Self::with_fuse_config(ReadingFuseConfig::default())
    }

    /// 测试 / 校准构造：注入保险丝阈值（任务 9.5 真实链路校准经此或改默认值）。
    pub fn with_fuse_config(fuse_config: ReadingFuseConfig) -> Self {
        Self {
            driver: Mutex::new(None),
            routing: Mutex::new(HashMap::new()),
            turn_counters: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            reading_request_sink: Mutex::new(None),
            rounds: Mutex::new(HashMap::new()),
            provenance_write_lock: Mutex::new(()),
            fuse_config,
        }
    }

    /// 绑定驱动管理器（回填 tool_result 用）。
    pub fn attach_driver(&self, manager: DshDriverManager) {
        *lock(&self.driver) = Some(manager);
    }

    /// 注册授权请求事件回调（Tauri 层转发前端；测试注入收集器）。
    pub fn set_reading_request_sink(&self, sink: ReadingRequestSink) {
        *lock(&self.reading_request_sink) = Some(sink);
    }

    /// 注册一轮的工具路由上下文（ai_send_message 调用；返回本轮序号）。
    /// 覆盖该会话旧路由；开启新一轮——旧轮的监管状态（固定表 / 去重 / 覆盖 /
    /// 熔断）整体作废（D4/D9：固定与去重只活在一轮之内，跨轮不屏蔽）、旧轮的
    /// 待决授权一并作废（旧轮已收束，迟到决定由驱动拒绝）。
    pub fn register_round(
        &self,
        session_id: &str,
        conversation_id: &str,
        project_root: PathBuf,
        hard_gate: bool,
    ) -> u32 {
        let turn_index = {
            let mut counters = lock(&self.turn_counters);
            let next = counters.get(conversation_id).copied().unwrap_or(0);
            counters.insert(conversation_id.to_string(), next + 1);
            next
        };
        lock(&self.routing).insert(
            session_id.to_string(),
            ToolRoutingContext {
                conversation_id: conversation_id.to_string(),
                project_root,
                hard_gate,
                turn_index,
            },
        );
        lock(&self.rounds).insert(conversation_id.to_string(), RoundReadingState::default());
        {
            let mut pending = lock(&self.pending);
            pending.retain(|_, request| request.session_id != session_id);
        }
        turn_index
    }

    /// 会话结束（end_session / 讨论关闭）：清路由、轮状态与待决授权，迟到调用失败关闭。
    pub fn clear_session(&self, session_id: &str) {
        let conversation = lock(&self.routing)
            .get(session_id)
            .map(|context| context.conversation_id.clone());
        lock(&self.routing).remove(session_id);
        if let Some(conversation) = conversation {
            lock(&self.rounds).remove(&conversation);
        }
        let mut pending = lock(&self.pending);
        pending.retain(|_, request| request.session_id != session_id);
    }

    /// 处理一次驱动 tool_call 事件（由 dsh_driver 的工具回调调用）。
    ///
    /// 轻量路由在调用线程完成；执行（文件 IO + 档案读改写）转独立线程，不阻塞
    /// 驱动事件读取。所有失败路径都结构化回填 `tool_result`，绝不悬挂轮次。
    pub fn handle_tool_call(self: &Arc<Self>, payload: ToolCallPayload) {
        let driver = lock(&self.driver).clone();
        let context = lock(&self.routing).get(&payload.session_id).cloned();
        let channel = self.clone();

        std::thread::spawn(move || {
            let this = &*channel;
            let Some(driver) = driver else {
                eprintln!(
                    "story_tool_channel: 驱动未接线，工具调用被丢弃（tool={}）",
                    payload.tool
                );
                return;
            };
            let Some(context) = context else {
                // 无路由上下文（会话未注册讨论身份）：失败关闭为未授权拒绝。
                let _ = driver.send_tool_result(
                    &payload.session_id,
                    &payload.message_id,
                    &payload.call_id,
                    false,
                    None,
                    Some("on_demand_reading_unauthorized".to_string()),
                    Some(RECOVERY_READING_UNAUTHORIZED),
                );
                return;
            };
            // 设计 D13（任务 5.5）：召唤首轮硬门禁——授权请求也一律拒绝，
            // 不发起面向用户的授权提示（首轮只用选区）。
            if context.hard_gate && payload.tool == "story-request-reading" {
                let _ = driver.send_tool_result(
                    &payload.session_id,
                    &payload.message_id,
                    &payload.call_id,
                    false,
                    None,
                    Some("on_demand_reading_unauthorized".to_string()),
                    Some(RECOVERY_READING_UNAUTHORIZED),
                );
                return;
            }

            let call = match parse_story_tool_call(&payload.tool, &payload.args) {
                Ok(call) => call,
                Err(reason) => {
                    // 参数非法没有恢复路径提示（改参数重试是模型本来就会做的）。
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some(reason),
                        None,
                    );
                    return;
                }
            };
            let resolution = if context.hard_gate {
                AuthorizationResolution::ForceUnauthorized
            } else {
                AuthorizationResolution::FromArchive
            };
            let reader = match DiskStoryReader::open(&context.project_root) {
                Ok(reader) => reader,
                Err(_) => {
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some("work_mismatch".to_string()),
                        None,
                    );
                    return;
                }
            };

            // ===== 任务组 6：轮内监管（状态在本通道；执行器保持无状态） =====
            let is_reading_tool = matches!(
                call,
                StoryToolCall::List { .. }
                    | StoryToolCall::Read { .. }
                    | StoryToolCall::Search { .. }
            );
            // 阶段一（仅内存，不持锁执行 IO）：保险丝 + 读取前置决策（停读 /
            // 固定表改写与失配 / 同轮去重）。决策结果在授权解析之后才生效——
            // 未授权或已关闭讨论不得因去重提示泄露「本轮已读过」的事实。
            let preparation = if is_reading_tool {
                let mut rounds = lock(&this.rounds);
                let state = rounds.entry(context.conversation_id.clone()).or_default();
                if state.fused {
                    // D5：保险丝已触发，该轮后续补读一律结构化「补读已停止」，
                    // 附稳定恢复路径提示（基于已收集材料回答，用户可重新开启）。
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some("reading_stopped".to_string()),
                        Some(RECOVERY_READING_STOPPED),
                    );
                    return;
                }
                state.reading_calls += 1;
                match &call {
                    StoryToolCall::Read {
                        document_id,
                        version,
                        range,
                        ..
                    } => Some(state.prepare_read(
                        context.turn_index,
                        document_id,
                        version.clone(),
                        *range,
                    )),
                    _ => None,
                }
            } else {
                None
            };

            // 阶段二：授权解析（逐次读档案，D3）+ 无状态执行。
            let authorization = match resolve_conversation_authorization(
                &reader,
                &context.project_root,
                &context.conversation_id,
                resolution,
            ) {
                Ok(authorization) => authorization,
                Err(denial) => {
                    // 授权解析失败：未授权系拒绝（含硬门禁 ForceUnauthorized 与
                    // 档案无授权）携带恢复路径提示；其余原因（如待恢复事务现场）
                    // 无既定恢复常量，不携带。
                    let reason = denial_reason_label(denial.reason);
                    let recovery = recovery_hint_for_reason(&reason);
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some(reason),
                        recovery,
                    );
                    return;
                }
            };
            // 前置决策生效：停读 / 失配拒绝（D4）与去重提示（D9）都只对已授权讨论返回。
            match preparation {
                Some(ReadPreparation::Denied(reason)) => {
                    if is_reading_tool {
                        lock(&this.rounds)
                            .entry(context.conversation_id.clone())
                            .or_default()
                            .note_reading_arrival_completed(Duration::ZERO, &this.fuse_config);
                    }
                    // 前置决策拒绝（版本失配停读）：恢复动作是下一轮读最新版，
                    // 不属于既定恢复常量，不携带提示。
                    let reason = denial_reason_label(reason);
                    let recovery = recovery_hint_for_reason(&reason);
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some(reason),
                        recovery,
                    );
                    return;
                }
                Some(ReadPreparation::AlreadyProvided(hint)) => {
                    if is_reading_tool {
                        lock(&this.rounds)
                            .entry(context.conversation_id.clone())
                            .or_default()
                            .note_reading_arrival_completed(Duration::ZERO, &this.fuse_config);
                    }
                    let result = serde_json::to_value(StoryToolOutcome::AlreadyProvided(hint)).ok();
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        true,
                        result,
                        None,
                        None,
                    );
                    return;
                }
                _ => {}
            }
            // 已固定版本的文档强制携带该轮版本（D4：同轮各次读取同一版本）。
            let effective_call = match (&preparation, &call) {
                (
                    Some(ReadPreparation::Execute { version }),
                    StoryToolCall::Read {
                        document_id, range, ..
                    },
                ) => StoryToolCall::Read {
                    work_id: None,
                    document_id: document_id.clone(),
                    version: version.clone(),
                    range: *range,
                },
                _ => call.clone(),
            };
            let started = Instant::now();
            let mut outcome = execute_story_tool(&reader, authorization, effective_call);
            let elapsed = started.elapsed();

            // 阶段三（仅内存 + 受锁保护的出处落档）：轮内记账 + 结果后处理——
            // 固定版本、覆盖累计（D12）、版本失配映射（D4）、检索过滤（本轮停读 /
            // 版本漂移的文档不进结果）、保险丝收尾（D5）。
            if is_reading_tool {
                let mut rounds = lock(&this.rounds);
                let state = rounds.entry(context.conversation_id.clone()).or_default();
                match &mut outcome {
                    Ok(StoryToolOutcome::Read(material)) => {
                        let requested_range = match &call {
                            StoryToolCall::Read { range, .. } => *range,
                            _ => None,
                        };
                        // 全文长度：正文字节数（仅长度，不取内容）；整篇读取时
                        // material.range.end 即全文长度，可兜底。
                        let total_len =
                            saved_document_length(&context.project_root, &material.document_id).or(
                                if requested_range.is_none() {
                                    Some(material.range.end)
                                } else {
                                    None
                                },
                            );
                        state.record_read_success(
                            &material.document_id,
                            &material.document_name,
                            material.version.clone(),
                            requested_range,
                            material.range,
                            total_len,
                        );
                    }
                    Err(denial) if denial.reason == StoryToolDenialReason::VersionUnavailable => {
                        if let StoryToolCall::Read { document_id, .. } = &call {
                            if state.note_read_version_unavailable(document_id) {
                                denial.reason = StoryToolDenialReason::StoryVersionChanged;
                            }
                        }
                    }
                    Ok(StoryToolOutcome::Searched(result)) => {
                        state.filter_search(result);
                    }
                    _ => {}
                }
                state.note_reading_arrival_completed(elapsed, &this.fuse_config);
                if state.provenance_dirty && outcome.is_ok() {
                    let updates = state.cumulative_updates();
                    state.provenance_dirty = false;
                    // 累计视图的计算与落档都在 rounds 锁内完成（再经
                    // provenance_write_lock 串行文件读改写）：后写者的累计视图
                    // 必不旧于先写者，杜绝并发覆盖回退（局部覆盖完整）。
                    this.upsert_provenance(
                        &context.project_root,
                        &context.conversation_id,
                        context.turn_index,
                        &updates,
                    );
                }
            }

            // 回填驱动；等待授权的轮次挂起（不回填，不产生模型请求）。
            match &outcome {
                // 等待授权（设计 D1）：转为面向用户的授权请求，轮次挂起——
                // 不回填 tool_result、不产生模型请求，直到用户决定。
                Ok(StoryToolOutcome::ReadingRequested(
                    ReadingRequestOutcome::WaitingForAuthorization { reason },
                )) => {
                    lock(&this.pending).insert(
                        payload.call_id.clone(),
                        PendingAuthorization {
                            session_id: payload.session_id.clone(),
                            message_id: payload.message_id.clone(),
                            conversation_id: context.conversation_id.clone(),
                            project_root: context.project_root.clone(),
                        },
                    );
                    let event = ReadingRequestEvent {
                        session_id: payload.session_id.clone(),
                        message_id: payload.message_id.clone(),
                        call_id: payload.call_id.clone(),
                        conversation_id: context.conversation_id.clone(),
                        reason: reason.clone(),
                    };
                    let sink = lock(&this.reading_request_sink).clone();
                    if let Some(sink) = sink {
                        sink(event);
                    } else {
                        eprintln!(
                            "story_tool_channel: 授权请求无接收通道（conversation={}）",
                            context.conversation_id
                        );
                    }
                }
                Ok(outcome) => {
                    let result = serde_json::to_value(outcome).ok();
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        true,
                        result,
                        None,
                        None,
                    );
                }
                Err(denial) => {
                    // 执行器拒绝：按标签映射恢复提示（未授权系 / 补读停止有既定
                    // 常量；版本失配、参数非法等不携带）。
                    let reason = denial_reason_label(denial.reason);
                    let recovery = recovery_hint_for_reason(&reason);
                    let _ = driver.send_tool_result(
                        &payload.session_id,
                        &payload.message_id,
                        &payload.call_id,
                        false,
                        None,
                        Some(reason),
                        recovery,
                    );
                }
            }
        });
    }

    /// 出处按轮累计落档（串行读改写；见 [`upsert_on_demand_provenance`]）。
    fn upsert_provenance(
        &self,
        project_root: &Path,
        conversation_id: &str,
        turn_index: u32,
        updates: &[(String, String, ReadingDepth)],
    ) {
        let _guard = lock(&self.provenance_write_lock);
        upsert_on_demand_provenance(project_root, conversation_id, turn_index, updates);
    }

    /// 用户对授权请求的决定（任务 5.2；前端命令 `ai_resolve_reading_request`
    /// 或测试注入）。granted → 写授权档案 + 回填 `{granted: true}`；
    /// denied → 回填 `{granted: false, recovery}`（拒绝是合法结果，模型继续有限
    /// 回答；恢复路径提示与未授权系拒绝同一常量，design D5——用户可在讨论面板
    /// 主动开启，新问题可再请求）。
    ///
    /// 迟到 / 未知 call_id、会话身份不符：失败关闭，不动档案。
    /// 授权属于讨论：即使原轮已被取消，granted 仍写入档案（后续轮次生效），
    /// 只有工具结果被驱动丢弃。
    pub fn resolve_reading_request(
        &self,
        session_id: &str,
        call_id: &str,
        granted: bool,
    ) -> Result<(), String> {
        let driver = lock(&self.driver).clone();
        let Some(driver) = driver else {
            return Err("工具通道未接线".to_string());
        };
        let request = {
            let pending = lock(&self.pending);
            let Some(request) = pending.get(call_id) else {
                return Err("没有该身份的待决授权请求".to_string());
            };
            if request.session_id != session_id {
                return Err("授权请求身份不符".to_string());
            }
            request.clone()
        };
        lock(&self.pending).remove(call_id);

        if granted {
            grant_on_demand_reading(&request.project_root, &request.conversation_id)
                .map_err(|e| e.to_string())?;
        }
        // 拒绝结果是工具结果内容（ok=true 的 result），不是 error 载荷；恢复提示
        // 放在结果对象内，与 error.recovery 同一常量、同一语义。
        let result = if granted {
            serde_json::json!({ "granted": true })
        } else {
            serde_json::json!({ "granted": false, "recovery": RECOVERY_READING_UNAUTHORIZED })
        };
        driver
            .send_tool_result(
                &request.session_id,
                &request.message_id,
                call_id,
                true,
                Some(result),
                None,
                None,
            )
            .map_err(|e| e.message.clone())
    }
}

impl Default for StoryToolChannel {
    fn default() -> Self {
        Self::new()
    }
}

/// 解析协议帧 `{tool, args}` 为执行器调用（tag 合并；参数形状不符 → 结构化拒绝）。
fn parse_story_tool_call(tool: &str, args: &serde_json::Value) -> Result<StoryToolCall, String> {
    let mut value = match args {
        serde_json::Value::Object(map) => serde_json::Value::Object(map.clone()),
        _ => serde_json::Value::Object(serde_json::Map::new()),
    };
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "tool".to_string(),
            serde_json::Value::String(tool.to_string()),
        );
    }
    serde_json::from_value::<StoryToolCall>(value)
        .map_err(|_| denial_reason_label(StoryToolDenialReason::InvalidParameters))
}

/// 拒绝原因 → 协议稳定标签（snake_case；序列化失败兜底 tool_failed）。
fn denial_reason_label(reason: StoryToolDenialReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "tool_failed".to_string())
}

/// 未授权系拒绝的稳定恢复路径提示（design D5，batch-improvement-candidates ②，
/// 逐字使用）：面向模型的英文常量，与 reason 同理不做自由文本。
const RECOVERY_READING_UNAUTHORIZED: &str = "Reading is not authorized. Call story-request-reading to request it; the user can grant it in the discussion panel, and a new question may re-request.";

/// 补读停止（保险丝）拒绝的稳定恢复路径提示（design D5，逐字使用）。
const RECOVERY_READING_STOPPED: &str = "Reading was stopped. Answer from materials already collected; the user may re-enable reading in the discussion panel.";

/// 拒绝标签 → 稳定恢复路径提示：只对有既定恢复路径的两类拒绝（未授权系 /
/// 补读停止）给提示；其余拒绝（参数非法、版本失配、作品现场待恢复等）没有
/// 可执行的自救动作，不携带提示（协议 `error.recovery` 为 opt-in）。
fn recovery_hint_for_reason(reason: &str) -> Option<&'static str> {
    match reason {
        "on_demand_reading_unauthorized" => Some(RECOVERY_READING_UNAUTHORIZED),
        "reading_stopped" => Some(RECOVERY_READING_STOPPED),
        _ => None,
    }
}

/// 出处按轮累计 upsert（设计 D12，任务 6.2）：同一（轮, 文档）只保留一条最小
/// 元数据，阅读程度随轮内累计升级（局部 → 完整）。沿用既有讨论档案原子保存；
/// 档案缺失 / 已删除时静默跳过（授权只可能来自已存在的档案）。
/// 读改写全程持 `provenance_write_lock`：同一讨论的并发工具调用线程串行落档，
/// 后写者必基于最新档案（防丢失更新）。
fn upsert_on_demand_provenance(
    project_root: &Path,
    conversation_id: &str,
    turn_index: u32,
    updates: &[(String, String, ReadingDepth)],
) {
    let Ok(mut record) = read_conversation(project_root, conversation_id) else {
        return;
    };
    let entries = record
        .on_demand_reading_provenance
        .get_or_insert_with(Vec::new);
    for (document_id, version, depth) in updates {
        if let Some(entry) = entries
            .iter_mut()
            .find(|entry| entry.turn_index == turn_index && &entry.document_id == document_id)
        {
            entry.version = version.clone();
            entry.depth = *depth;
        } else {
            entries.push(OnDemandReadingProvenance {
                document_id: document_id.clone(),
                version: version.clone(),
                depth: *depth,
                turn_index,
                entered_model_context: true,
            });
        }
    }
    let _ = save_conversation(project_root, &record);
}

/// 恢复式取锁（与 dsh_driver 一致：中毒后取内部数据，不连锁 panic）。
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation_store::{
        read_conversation, save_conversation as save_archive, ConversationRecord,
        FirstRoundMaterial, OnDemandReadingGrant as GrantEntry, ReadingDepth,
    };
    use crate::dsh_driver::{DriverParams, DshDriverManager};
    use crate::dsh_sidecar::DshRuntimePaths;
    use crate::project::{
        create_new_project, recover_then_read_content_tree, save_document, CreateProjectParams,
    };
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    fn notebook_with_text(text: &str) -> String {
        serde_json::to_string(&serde_json::json!({
            "format": "next-story-tiptap",
            "version": 2,
            "document": {
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }]
            }
        }))
        .unwrap()
    }

    fn setup_work_with_doc(
        temp: &tempfile::TempDir,
        name: &str,
        content: &str,
    ) -> (PathBuf, String) {
        let root = create_new_project(CreateProjectParams {
            name: name.to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create work");
        let tree = recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        save_document(&root, &doc_id, content).expect("save doc");
        (root, doc_id)
    }

    fn archive(conversation_id: &str, grant: Option<GrantEntry>) -> ConversationRecord {
        ConversationRecord {
            version: crate::conversation_store::CONVERSATION_VERSION,
            conversation_id: conversation_id.to_string(),
            created_at: "2026-09-20T08:00:00.000Z".to_string(),
            updated_at: "2026-09-20T08:00:00.000Z".to_string(),
            focus_document_id: None,
            focus_document_title: None,
            first_round_material: FirstRoundMaterial {
                kind: "direct_question".to_string(),
                question: "问题".to_string(),
                selection_text: None,
            },
            turns: Vec::new(),
            title: None,
            pinned: false,
            provenance: Some(vec![]),
            on_demand_reading_grant: grant,
            on_demand_reading_provenance: None,
        }
    }

    /// 假驱动夹具：echo 驱动把 tool_call→tool_result→message_done 串起来。
    /// `script` 可定制工具名与行为；返回 (TempDir, paths, params)。
    fn fake_driver(script: &str) -> (tempfile::TempDir, DshRuntimePaths, DriverParams) {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let driver_dir = temp.path().join("driver");
        std::fs::create_dir_all(&driver_dir).expect("driver dir");
        let driver_entry = driver_dir.join("driver.mjs");
        std::fs::write(&driver_entry, script).expect("write fake driver");
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

    fn tool_call(
        session: &str,
        message: &str,
        call_id: &str,
        tool: &str,
        args: serde_json::Value,
    ) -> ToolCallPayload {
        ToolCallPayload {
            session_id: session.to_string(),
            message_id: message.to_string(),
            call_id: call_id.to_string(),
            tool: tool.to_string(),
            args,
        }
    }

    // 假驱动模板共通的收尾：shutdown 命令秒退（teardown 不吃 3 秒宽限），
    // stdin 关闭即退出（与生产 driver 生命周期语义一致——测试 panic 时不泄漏进程）。
    const DRIVER_TAIL: &str = r#"
  } else if (cmd.type === 'shutdown') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
setInterval(() => {}, 1000);
"#;

    // 假驱动：send_message → message_sent → tool_call(story-read)；tool_result →
    // message_done（成功回显 result JSON / 拒绝回显 reason 与可选 recovery）。
    // doc_id 注入真实文档身份。
    fn read_bridge_driver(doc_id: &str) -> String {
        let head = r#"
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const currentMsg = new Map();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    console.log(JSON.stringify({ type: 'session_started', session_id: cmd.session_id }));
  } else if (cmd.type === 'send_message') {
    currentMsg.set(cmd.session_id, cmd.message_id);
    console.log(JSON.stringify({ type: 'message_sent', session_id: cmd.session_id, message_id: cmd.message_id }));
    console.log(JSON.stringify({ type: 'tool_call', session_id: cmd.session_id, message_id: cmd.message_id, call_id: 'call-1', tool: 'story-read', args: { document_id: "__DOC_ID__" } }));
  } else if (cmd.type === 'tool_result') {
    const mid = currentMsg.get(cmd.session_id);
    const text = cmd.ok === true
      ? JSON.stringify(cmd.result ?? {})
      : 'denied:' + (cmd.error?.reason ?? 'tool_failed') + (cmd.error?.recovery ? '|recovery:' + cmd.error.recovery : '');
    console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: mid, text }));
"#;
        head.replace("__DOC_ID__", doc_id) + DRIVER_TAIL
    }

    // 假驱动：send_message → tool_call(story-request-reading)；授权等待挂起，
    // 直到 tool_result（granted/denied）回填才产出终态；cancel_message → cancelled 终态。
    fn request_bridge_driver() -> String {
        let head = r#"
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const currentMsg = new Map();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    console.log(JSON.stringify({ type: 'session_started', session_id: cmd.session_id }));
  } else if (cmd.type === 'send_message') {
    currentMsg.set(cmd.session_id, cmd.message_id);
    console.log(JSON.stringify({ type: 'message_sent', session_id: cmd.session_id, message_id: cmd.message_id }));
    console.log(JSON.stringify({ type: 'tool_call', session_id: cmd.session_id, message_id: cmd.message_id, call_id: 'call-1', tool: 'story-request-reading', args: { reason: '材料不足，需要确认时间线' } }));
  } else if (cmd.type === 'cancel_message') {
    const mid = currentMsg.get(cmd.session_id) ?? cmd.message_id;
    console.log(JSON.stringify({ type: 'message_failed', session_id: cmd.session_id, message_id: mid, code: 'cancelled', message: '已取消' }));
  } else if (cmd.type === 'tool_result') {
    const mid = currentMsg.get(cmd.session_id);
    const text = cmd.result?.granted === true
      ? '授权通过，继续回答'
      : '未获授权，有限回答' + (cmd.result?.recovery ? '|recovery:' + cmd.result.recovery : '');
    console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: mid, text }));
"#;
        head.to_string() + DRIVER_TAIL
    }

    /// panic 兜底守卫：测试任何路径退出（含断言失败 unwind）都优雅关停驱动，
    /// 杜绝 `.tmp*\driver` 进程泄漏；正常路径与测试末尾的显式关停幂等叠加。
    struct DriverGuard(DshDriverManager);
    impl Drop for DriverGuard {
        fn drop(&mut self) {
            self.0.shutdown_best_effort();
        }
    }

    /// 组装「manager + channel」并接线（工具回调 → 通道；通道 → manager 回填），
    /// 注入保险丝配置。返回的 DriverGuard 在测试任何退出路径优雅关停驱动。
    fn wire_channel_with(
        fuse: ReadingFuseConfig,
    ) -> (Arc<DshDriverManager>, Arc<StoryToolChannel>, DriverGuard) {
        let manager = Arc::new(DshDriverManager::new());
        let channel = Arc::new(StoryToolChannel::with_fuse_config(fuse));
        channel.attach_driver((*manager).clone());
        let channel_for_sink = channel.clone();
        manager.set_tool_call_sink(Arc::new(move |payload| {
            channel_for_sink.handle_tool_call(payload);
        }));
        let guard = DriverGuard((*manager).clone());
        (manager, channel, guard)
    }

    fn wire_channel() -> (Arc<DshDriverManager>, Arc<StoryToolChannel>, DriverGuard) {
        wire_channel_with(ReadingFuseConfig::default())
    }

    /// 多步脚本驱动：send_message 的 text 是 JSON 步骤数组——
    /// `{tool, args}` 发起一次 tool_call（等 tool_result 回填后继续下一步），
    /// `{delay: ms}` 步内延迟（测试在延迟窗口内从外部保存文档出新版本），
    /// `{mark: path}` 同步创建空标记文件后立即继续下一步（向外部线程发信号），
    /// `{waitFor: path, timeoutMs}` 每 25ms 轮询标记文件，出现即继续；超时则
    /// emit message_failed（code = wait_marker_timeout）终止该轮——测试响亮失败、
    /// 可诊断。mark / waitFor / delay 步不产生结果槽位。轮内全部步骤收束后回
    /// message_done，text 为逐调用结果数组
    /// （成功 = 宿主回填的 result 对象；拒绝 = {denied: reason}）。
    fn multi_step_driver() -> String {
        r#"
import fs from 'node:fs';
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const currentMsg = new Map();
const queues = new Map();
const rl = readline.createInterface({ input: process.stdin });
function emit(msg) { console.log(JSON.stringify(msg)); }
function step(session) {
  const q = queues.get(session);
  if (!q) return;
  if (q.i >= q.steps.length) {
    emit({ type: 'message_done', session_id: session, message_id: currentMsg.get(session), text: JSON.stringify(q.acc) });
    queues.delete(session);
    return;
  }
  const s = q.steps[q.i];
  q.i += 1;
  if (s && typeof s.delay === 'number') {
    setTimeout(() => step(session), s.delay);
    return;
  }
  if (s && typeof s.mark === 'string') {
    fs.writeFileSync(s.mark, '');
    step(session);
    return;
  }
  if (s && typeof s.waitFor === 'string') {
    const deadline = Date.now() + (s.timeoutMs ?? 30000);
    const poll = () => {
      if (fs.existsSync(s.waitFor)) { step(session); return; }
      if (Date.now() >= deadline) {
        queues.delete(session);
        emit({ type: 'message_failed', session_id: session, message_id: currentMsg.get(session), code: 'wait_marker_timeout', message: '等待标记文件超时: ' + s.waitFor });
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
    return;
  }
  const callId = 'call-' + q.i;
  emit({ type: 'tool_call', session_id: session, message_id: currentMsg.get(session), call_id: callId, tool: s.tool, args: s.args ?? {} });
}
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    emit({ type: 'session_started', session_id: cmd.session_id });
  } else if (cmd.type === 'send_message') {
    currentMsg.set(cmd.session_id, cmd.message_id);
    emit({ type: 'message_sent', session_id: cmd.session_id, message_id: cmd.message_id });
    queues.set(cmd.session_id, { steps: JSON.parse(cmd.text), i: 0, acc: [] });
    step(cmd.session_id);
  } else if (cmd.type === 'tool_result') {
    const q = queues.get(cmd.session_id);
    if (!q) { emit({ type: 'error', session_id: cmd.session_id, message_id: currentMsg.get(cmd.session_id), code: 'tool_call_not_found', message: 'no pending call' }); return; }
    q.acc.push(cmd.ok === true
      ? (cmd.result ?? {})
      : { denied: cmd.error?.reason ?? 'tool_failed', ...(cmd.error?.recovery !== undefined ? { recovery: cmd.error.recovery } : {}) });
    step(cmd.session_id);
  } else if (cmd.type === 'cancel_message') {
    queues.delete(cmd.session_id);
    emit({ type: 'message_failed', session_id: cmd.session_id, message_id: cmd.message_id, code: 'cancelled', message: '已取消' });
  } else if (cmd.type === 'shutdown') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
setInterval(() => {}, 1000);
"#
        .to_string()
    }

    /// 发送一轮（步骤数组驱动）并解析逐调用结果数组。
    fn send_round(
        manager: &DshDriverManager,
        session: &str,
        message: &str,
        steps: serde_json::Value,
    ) -> serde_json::Value {
        let outcome = manager
            .send_message_and_wait(
                session,
                message,
                &steps.to_string(),
                Duration::from_secs(30),
            )
            .unwrap_or_else(|e| panic!("轮次应完成：{e:?}"));
        serde_json::from_str(&outcome.text)
            .unwrap_or_else(|e| panic!("结果应为 JSON 数组（{}）: {e}", outcome.text))
    }

    /// 把正文按 n 等分取字符边界切点（严格递增，含 0 与 len）。
    fn cut_points(content: &str, n: usize) -> Vec<usize> {
        let len = content.len();
        let mut points: Vec<usize> = (0..=n).map(|i| len * i / n.max(1)).collect();
        for point in &mut points {
            while *point < len && !content.is_char_boundary(*point) {
                *point += 1;
            }
        }
        points.dedup();
        points
    }

    fn read_step(
        document_id: &str,
        version: Option<&str>,
        range: Option<(usize, usize)>,
    ) -> serde_json::Value {
        let mut args = serde_json::json!({ "document_id": document_id });
        if let Some(version) = version {
            args["version"] = serde_json::json!(version);
        }
        if let Some((start, end)) = range {
            args["range"] = serde_json::json!({ "start": start, "end": end });
        }
        serde_json::json!({ "tool": "story-read", "args": args })
    }

    fn provenance_of(
        root: &Path,
        id: &str,
    ) -> Vec<crate::conversation_store::OnDemandReadingProvenance> {
        read_conversation(root, id)
            .expect("read archive")
            .on_demand_reading_provenance
            .expect("provenance present")
    }

    /// 端到端：授权讨论的 story-read 经通道执行，结果回填驱动，出处落档。
    #[test]
    fn authorized_read_tool_round_trips_through_channel() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let content = notebook_with_text("林晓站在天台边。");
        let (root, doc_id) = setup_work_with_doc(&temp, "通道作品", &content);
        save_archive(
            &root,
            &archive(
                "conv-1",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&read_bridge_driver(&doc_id));
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-1", root.clone(), false);

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(30))
        });
        let outcome = send.join().expect("send 线程").expect("轮次完成");
        assert!(outcome.sent_confirmed, "回执语义不变");

        // 结果文本来自驱动回填的 tool_result：包含已保存正文材料与版本。
        assert!(
            outcome.text.contains("林晓站在天台边"),
            "正文材料应回到模型: {}",
            outcome.text
        );
        assert!(
            outcome.text.contains(&doc_id),
            "文档身份应出现在材料: {}",
            outcome.text
        );

        // 出处已落档（完整阅读）。
        let record = read_conversation(&root, "conv-1").expect("read archive");
        let provenance = record.on_demand_reading_provenance.expect("出处");
        assert_eq!(provenance.len(), 1);
        assert_eq!(provenance[0].document_id, doc_id);
        assert_eq!(provenance[0].depth, ReadingDepth::Full);

        manager.shutdown_best_effort();
    }

    /// 端到端：未授权讨论的读取调用被拒，结构化拒绝回到模型，不落出处。
    #[test]
    fn unauthorized_read_tool_denied_through_channel() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, doc_id) =
            setup_work_with_doc(&temp, "未授权通道作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-2", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&read_bridge_driver(&doc_id));
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-2", root.clone(), false);

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(30))
        });
        let outcome = send.join().expect("send 线程").expect("轮次完成");
        assert!(
            outcome.text.contains("on_demand_reading_unauthorized"),
            "未授权拒绝应回到模型: {}",
            outcome.text
        );
        assert!(
            outcome.text.contains(RECOVERY_READING_UNAUTHORIZED),
            "未授权拒绝应携带稳定恢复路径提示: {}",
            outcome.text
        );

        // 拒绝不落出处、不写授权。
        let record = read_conversation(&root, "conv-2").expect("read archive");
        assert!(record.on_demand_reading_grant.is_none());
        assert!(record.on_demand_reading_provenance.is_none());

        manager.shutdown_best_effort();
    }

    /// 端到端（任务 5.2 + D8）：授权请求挂起轮次——短请求超时下不超时取消；
    /// 用户允许后自动继续原问题；拒绝后有限回答；授权写入档案。
    #[test]
    fn reading_request_suspends_round_and_resolution_continues() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, _doc_id) =
            setup_work_with_doc(&temp, "授权请求作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-3", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&request_bridge_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-3", root.clone(), false);

        let events = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let events_for_sink = events.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events_for_sink.lock().unwrap().push(event);
        }));

        // 请求级超时设为 2 秒：若挂起轮被超时取消，本测试会失败（D8 断言）。
        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(2))
        });
        std::thread::sleep(Duration::from_millis(1500));

        // 挂起期间：前端收到授权请求事件（含 reason 透传、无作品数据）；轮次未终结。
        let received = events.lock().unwrap().clone();
        assert_eq!(received.len(), 1, "应恰好发出一次授权请求事件");
        assert_eq!(received[0].call_id, "call-1");
        assert_eq!(received[0].conversation_id, "conv-3");
        assert_eq!(received[0].reason, "材料不足，需要确认时间线");
        let json = serde_json::to_string(&received[0]).unwrap();
        assert!(
            !json.contains("正文") && !json.contains("作品文本"),
            "授权事件不得携带作品数据"
        );
        assert!(!send.is_finished(), "挂起期间轮次不得因请求超时终结");

        // 等过 2 秒请求级超时线：挂起轮不受超时取消（D8），仍等待用户决定。
        std::thread::sleep(Duration::from_millis(1200));
        assert!(
            !send.is_finished(),
            "请求级超时已过，挂起轮仍必须等待授权决定而非超时取消"
        );

        // 用户允许 → 授权落档 + 工具结果回填 → 原问题继续并完成。
        channel
            .resolve_reading_request("s1", "call-1", true)
            .expect("resolve granted");
        let outcome = send.join().expect("send 线程").expect("授权后原轮完成");
        assert_eq!(outcome.text, "授权通过，继续回答");

        let record = read_conversation(&root, "conv-3").expect("read archive");
        assert!(
            record.on_demand_reading_grant.is_some(),
            "允许决定必须写入讨论档案"
        );

        // 拒绝路径：新一轮请求 → 拒绝 → 有限回答，授权状态不变（仍为已授权档案另建讨论验证）。
        save_archive(&root, &archive("conv-3b", None)).expect("save archive b");
        channel.register_round("s2", "conv-3b", root.clone(), false);
        manager.start_session("s2").expect("start s2");
        let events2 = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let events2_for_sink = events2.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events2_for_sink.lock().unwrap().push(event);
        }));
        let manager_for_send2 = manager.clone();
        let send2 = std::thread::spawn(move || {
            manager_for_send2.send_message_and_wait("s2", "m2", "问题", Duration::from_secs(2))
        });
        std::thread::sleep(Duration::from_millis(1500));
        let call2 = events2.lock().unwrap()[0].call_id.clone();
        channel
            .resolve_reading_request("s2", &call2, false)
            .expect("resolve denied");
        let outcome2 = send2.join().expect("send 线程二").expect("拒绝后有限回答");
        assert!(
            outcome2.text.starts_with("未获授权，有限回答"),
            "拒绝是合法结果，模型转有限回答: {}",
            outcome2.text
        );
        assert!(
            outcome2.text.contains(RECOVERY_READING_UNAUTHORIZED),
            "用户拒绝的回填结果应携带恢复路径提示（可在讨论面板开启、新问题可再请求）: {}",
            outcome2.text
        );
        let record_b = read_conversation(&root, "conv-3b").expect("read archive b");
        assert!(record_b.on_demand_reading_grant.is_none(), "拒绝不写授权");

        manager.shutdown_best_effort();
    }

    /// 端到端（任务 5.3）：挂起等待授权的轮次可被停止生成取消；迟到决定被丢弃
    /// （授权仍落档——授权属于讨论），轮次已按中断收束。
    #[test]
    fn suspended_round_can_be_cancelled_and_late_resolution_is_dropped() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, _doc_id) =
            setup_work_with_doc(&temp, "取消挂起作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-4", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&request_bridge_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-4", root.clone(), false);
        let events = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let events_for_sink = events.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events_for_sink.lock().unwrap().push(event);
        }));

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(30))
        });
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(events.lock().unwrap().len(), 1, "授权请求已挂起");

        // 停止生成：挂起轮取消（返回取消类错误，不回填工具结果）。
        manager.cancel_message("s1", "m1").expect("cancel");
        let cancelled = send.join().expect("send 线程");
        assert!(cancelled.is_err(), "取消的轮次不得成功");
        assert_eq!(
            cancelled.err().map(|e| e.code),
            Some(crate::llm_config::GenerateAiErrorCode::Timeout),
            "取消映射为既有取消错误族"
        );

        // 迟到的允许决定：授权写入档案（授权属于讨论），但轮次已收束——
        // 工具结果被驱动拒绝（tool_call_not_found），不产生新轮次。
        channel
            .resolve_reading_request("s1", "call-1", true)
            .expect("迟到决定仍应被处理（授权落档）");
        std::thread::sleep(Duration::from_millis(500));
        let record = read_conversation(&root, "conv-4").expect("read archive");
        assert!(
            record.on_demand_reading_grant.is_some(),
            "授权属于讨论，跨轮有效"
        );

        manager.shutdown_best_effort();
    }

    /// 任务 5.5：召唤首轮硬门禁——读取与授权请求一律结构化拒绝，不发起授权提示。
    #[test]
    fn summon_first_round_hard_gate_rejects_all_tool_calls() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, doc_id) =
            setup_work_with_doc(&temp, "硬门禁通道作品", &notebook_with_text("正文"));
        save_archive(
            &root,
            &archive(
                "conv-5",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&read_bridge_driver(&doc_id));
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        // 召唤首轮：hard_gate = true（即便档案已授权也一律拒绝）。
        channel.register_round("s1", "conv-5", root.clone(), true);

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "选区", Duration::from_secs(30))
        });
        let outcome = send.join().expect("send 线程").expect("轮次完成");
        assert!(
            outcome.text.contains("on_demand_reading_unauthorized"),
            "硬门禁拒绝应回到模型: {}",
            outcome.text
        );
        assert!(
            outcome.text.contains(RECOVERY_READING_UNAUTHORIZED),
            "硬门禁拒绝应携带恢复路径提示（后续追问可再申请授权）: {}",
            outcome.text
        );

        // 授权请求也被硬门禁拒绝（不发起面向用户的提示）。
        let request = tool_call(
            "s1",
            "m1",
            "call-x",
            "story-request-reading",
            serde_json::json!({ "reason": "需要材料" }),
        );
        let requests = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let requests_for_sink = requests.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            requests_for_sink.lock().unwrap().push(event);
        }));
        channel.handle_tool_call(request);
        std::thread::sleep(Duration::from_millis(600));
        assert!(
            requests.lock().unwrap().is_empty(),
            "硬门禁下不得发起授权请求"
        );

        // 拒绝零副作用：出处不落档。
        let record = read_conversation(&root, "conv-5").expect("read archive");
        assert!(record.on_demand_reading_provenance.is_none());
        manager.shutdown_best_effort();
    }

    /// 任务 5.3：无路由上下文（未注册讨论身份的会话）→ 失败关闭为未授权拒绝。
    #[test]
    fn tool_call_without_routing_context_fails_closed() {
        let (_driver_temp, paths, params) = fake_driver(&read_bridge_driver("doc"));
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(30))
        });
        let outcome = send.join().expect("send 线程").expect("轮次完成");
        assert!(
            outcome.text.contains("on_demand_reading_unauthorized"),
            "无路由上下文必须失败关闭: {}",
            outcome.text
        );
        assert!(
            outcome.text.contains(RECOVERY_READING_UNAUTHORIZED),
            "无路由上下文的失败关闭拒绝同样携带恢复路径提示: {}",
            outcome.text
        );
        assert!(
            channel
                .resolve_reading_request("s1", "call-1", true)
                .is_err(),
            "无待决授权时决定必须失败"
        );
        manager.shutdown_best_effort();
    }

    /// 待决授权的身份校验：会话不符 / 未知 call_id → 失败关闭，不动档案。
    #[test]
    fn pending_authorization_identity_must_match() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, _doc_id) =
            setup_work_with_doc(&temp, "身份校验作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-6", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&request_bridge_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-6", root.clone(), false);
        let events = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let events_for_sink = events.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events_for_sink.lock().unwrap().push(event);
        }));

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(30))
        });
        std::thread::sleep(Duration::from_millis(1200));

        // 会话身份不符 → 拒绝；档案不动、原请求仍待决。
        assert!(
            channel
                .resolve_reading_request("s2", "call-1", true)
                .is_err(),
            "会话身份不符必须失败"
        );
        assert!(
            channel
                .resolve_reading_request("s1", "call-none", true)
                .is_err(),
            "未知 call_id 必须失败"
        );
        let record = read_conversation(&root, "conv-6").expect("read archive");
        assert!(record.on_demand_reading_grant.is_none(), "失败路径不动档案");

        // 正确身份 → 成功，轮次继续完成。
        channel
            .resolve_reading_request("s1", "call-1", true)
            .expect("匹配身份应成功");
        let outcome = send.join().expect("send 线程").expect("轮次完成");
        assert_eq!(outcome.text, "授权通过，继续回答");

        manager.shutdown_best_effort();
    }

    /// clear_session：会话结束后路由与待决授权失败关闭（迟到调用按未授权拒绝）。
    #[test]
    fn cleared_session_fails_closed_for_late_tool_calls() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, doc_id) = setup_work_with_doc(&temp, "清会话作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-7", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&read_bridge_driver(&doc_id));
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-7", root.clone(), false);
        channel.clear_session("s1");

        // 迟到的读取调用：无路由 → 未授权拒绝，不悬挂、不落出处。
        let payload = tool_call(
            "s1",
            "m1",
            "call-1",
            "story-read",
            serde_json::json!({ "document_id": doc_id }),
        );
        channel.handle_tool_call(payload);
        std::thread::sleep(Duration::from_millis(600));
        assert!(
            channel
                .resolve_reading_request("s1", "call-1", true)
                .is_err(),
            "清会话后不得有待决授权"
        );
        let record = read_conversation(&root, "conv-7").expect("archive 仍在");
        assert!(record.on_demand_reading_grant.is_none());
        assert!(record.on_demand_reading_provenance.is_none());
        manager.shutdown_best_effort();
    }

    // ========== 任务组 6：轮内监管（版本固定 / 去重 / 阅读程度 / 熔断） ==========

    use crate::project::compute_version;

    /// 6.1 单元：版本固定表——首读固定、他版失配（本轮停读）、停读后任意读取拒绝。
    #[test]
    fn round_state_pins_version_and_blocks_on_mismatch() {
        let mut state = RoundReadingState::default();
        // 首读未固定：透传请求版本。
        match state.prepare_read(0, "d", None, None) {
            ReadPreparation::Execute { version } => assert_eq!(version, None),
            other => panic!("首读应放行，实际 {other:?}"),
        }
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            None,
            MaterialRange { start: 0, end: 10 },
            Some(10),
        );
        assert_eq!(state.pinned.get("d").map(String::as_str), Some("v1"));
        // 同轮请求他版：story_version_changed + 本轮停读。
        match state.prepare_read(0, "d", Some("v0".into()), None) {
            ReadPreparation::Denied(reason) => {
                assert_eq!(reason, StoryToolDenialReason::StoryVersionChanged)
            }
            other => panic!("他版应失配拒绝，实际 {other:?}"),
        }
        // 停读后：固定版 / 无版本一律失配拒绝（下一轮读新版由状态重置保证）。
        for version in [Some("v1".to_string()), None] {
            match state.prepare_read(0, "d", version, None) {
                ReadPreparation::Denied(reason) => {
                    assert_eq!(reason, StoryToolDenialReason::StoryVersionChanged)
                }
                other => panic!("停读文档应拒绝，实际 {other:?}"),
            }
        }
    }

    /// 6.1 单元：已固定文档读取期间正文保存为新版（执行器 version_unavailable）
    /// → 映射 story_version_changed 并停读；未固定文档保持 version_unavailable。
    #[test]
    fn round_state_maps_version_unavailable_only_when_pinned() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            None,
            MaterialRange { start: 0, end: 10 },
            Some(10),
        );
        assert!(state.note_read_version_unavailable("d"), "已固定文档应映射");
        assert!(state.blocked.contains("d"));

        let mut fresh = RoundReadingState::default();
        assert!(
            !fresh.note_read_version_unavailable("d"),
            "未固定文档保持 version_unavailable（可重试正确版本）"
        );
    }

    /// 6.3 单元：同轮同版同范围去重；不同范围 / 跨轮不屏蔽。
    #[test]
    fn round_state_dedups_same_version_and_range_only() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            Some(MaterialRange { start: 0, end: 5 }),
            MaterialRange { start: 0, end: 5 },
            Some(10),
        );
        match state.prepare_read(
            0,
            "d",
            Some("v1".into()),
            Some(MaterialRange { start: 0, end: 5 }),
        ) {
            ReadPreparation::AlreadyProvided(hint) => {
                assert_eq!(hint.document_id, "d");
                assert_eq!(hint.document_name, "文档");
                assert_eq!(hint.version, "v1");
                assert_eq!(hint.range, MaterialRange { start: 0, end: 5 });
                assert_eq!(hint.turn_index, 0);
            }
            other => panic!("同版同范围应命中去重，实际 {other:?}"),
        }
        // 不同范围、不同版本形态（None ↔ Some）不命中。
        assert!(matches!(
            state.prepare_read(
                0,
                "d",
                Some("v1".into()),
                Some(MaterialRange { start: 5, end: 10 })
            ),
            ReadPreparation::Execute { .. }
        ));
        assert!(matches!(
            state.prepare_read(0, "d", Some("v1".into()), None),
            ReadPreparation::Execute { .. }
        ));
        // 跨轮：状态整体重置，同请求不屏蔽（D9）。
        let mut fresh = RoundReadingState::default();
        assert!(matches!(
            fresh.prepare_read(
                0,
                "d",
                Some("v1".into()),
                Some(MaterialRange { start: 0, end: 5 })
            ),
            ReadPreparation::Execute { .. }
        ));
    }

    /// 6.2 单元：按轮累计的阅读程度——半篇 + 另半篇 = 完整；仅检索命中 = 搜索片段；
    /// 读取升级覆盖仅检索文档的程度；版本变化重置累计。
    #[test]
    fn round_state_judges_depth_by_cumulative_coverage() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "a",
            "甲",
            "v1".to_string(),
            Some(MaterialRange { start: 0, end: 50 }),
            MaterialRange { start: 0, end: 50 },
            Some(100),
        );
        // 另一半：区间合并且重叠合并正确 → 覆盖全文。
        state.record_read_success(
            "a",
            "甲",
            "v1".to_string(),
            Some(MaterialRange {
                start: 50,
                end: 100,
            }),
            MaterialRange {
                start: 50,
                end: 100,
            },
            Some(100),
        );
        // 仅检索命中（无读取覆盖）。
        state.search_only.insert("b".to_string(), "vb".to_string());
        let updates = state.cumulative_updates();
        let depth_of = |doc: &str| {
            updates
                .iter()
                .find(|(d, _, _)| d == doc)
                .map(|(_, _, depth)| *depth)
                .expect("应有该文档的累计条目")
        };
        assert_eq!(depth_of("a"), ReadingDepth::Full, "两半覆盖 = 完整阅读");
        assert_eq!(depth_of("b"), ReadingDepth::SearchSnippet);

        // 读取升级：b 从仅检索升级为局部 / 完整。
        state.record_read_success(
            "b",
            "乙",
            "vb".to_string(),
            None,
            MaterialRange { start: 0, end: 40 },
            None,
        );
        let updates = state.cumulative_updates();
        let depth_b = updates
            .iter()
            .find(|(d, _, _)| d == "b")
            .map(|(_, _, depth)| *depth)
            .expect("b 应保留累计条目");
        assert_eq!(depth_b, ReadingDepth::Partial, "长度未知不冒充完整");

        // 版本变化重置累计：旧区间不映射到新正文。
        state.record_read_success(
            "a",
            "甲",
            "v2".to_string(),
            Some(MaterialRange { start: 0, end: 10 }),
            MaterialRange { start: 0, end: 10 },
            Some(100),
        );
        let updates = state.cumulative_updates();
        let depth_a = updates
            .iter()
            .find(|(d, _, _)| d == "a")
            .map(|(_, _, depth)| *depth)
            .expect("a 应保留累计条目");
        assert_eq!(depth_a, ReadingDepth::Partial, "版本变化后重新累计");
    }

    /// 6.4 单元：保险丝——到达计数越过阈值或累计时长超限后触发，触发后只影响
    /// 该轮后续补读；控制工具不受影响（由通道的 is_reading_tool 分流保证）。
    #[test]
    fn round_state_fuse_trips_on_count_or_duration() {
        let config = ReadingFuseConfig {
            max_tool_calls: 2,
            max_accumulated_duration: Duration::from_millis(100),
        };
        let mut state = RoundReadingState {
            reading_calls: 1,
            ..RoundReadingState::default()
        };
        state.note_reading_arrival_completed(Duration::ZERO, &config);
        assert!(!state.fused, "未到阈值不触发");
        state.reading_calls = 2;
        state.note_reading_arrival_completed(Duration::ZERO, &config);
        assert!(state.fused, "计数达到上限即触发（后续补读停止）");

        // 时长维度独立触发。
        let mut slow = RoundReadingState {
            reading_calls: 1,
            ..RoundReadingState::default()
        };
        slow.note_reading_arrival_completed(Duration::from_millis(150), &config);
        assert!(slow.fused, "累计时长超限即触发");
    }

    /// 6.1 集成：轮内版本固定全链路——首读固定；请求旧版 / 停读后任意读取 =
    /// story_version_changed；下一轮（新轮状态）读最新已保存版。
    #[test]
    fn version_pin_round_trip_through_driver() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let content1 = notebook_with_text("第一版正文。");
        let (root, doc) = setup_work_with_doc(&temp, "固定表作品", &content1);
        save_archive(
            &root,
            &archive(
                "conv",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&multi_step_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");

        // 轮 0：首读（无版本）→ 成功并固定 v1。
        channel.register_round("s1", "conv", root.clone(), false);
        let acc = send_round(
            &manager,
            "s1",
            "m0",
            serde_json::json!([read_step(&doc, None, None)]),
        );
        assert_eq!(
            acc[0]["Read"]["version"],
            compute_version(&content1).as_str()
        );

        // 期间保存为新版。
        let content2 = notebook_with_text("第二版正文，内容不同。");
        save_document(&root, &doc, &content2).expect("save v2");

        // 轮 1（新轮状态）：读最新版 v2 并固定；随后请求旧版 / 重复读取全被
        // story_version_changed 拒绝（本轮停读该文档）。
        channel.register_round("s1", "conv", root.clone(), false);
        let v1 = compute_version(&content1);
        let v2 = compute_version(&content2);
        let acc = send_round(
            &manager,
            "s1",
            "m1",
            serde_json::json!([
                read_step(&doc, None, None),
                read_step(&doc, Some(&v1), None),
                read_step(&doc, None, None),
                read_step(&doc, Some(&v2), None),
            ]),
        );
        assert_eq!(
            acc[0]["Read"]["version"],
            v2.as_str(),
            "下一轮读最新已保存版"
        );
        for (index, result) in acc.as_array().unwrap().iter().enumerate().skip(1) {
            assert_eq!(
                result["denied"], "story_version_changed",
                "第 {index} 次读取应因版本失配停读: {result}"
            );
            assert!(
                result.get("recovery").is_none(),
                "版本失配没有既定恢复常量，不得携带提示: {result}"
            );
        }
        manager.shutdown_best_effort();
    }

    /// 6.1 集成（规格场景「读到一半出新版」）：分段补读期间文档保存为新版——
    /// 后续按固定版本读取被映射为 story_version_changed，本轮停读。
    /// 时序用文件标记握手而非固定延迟：首读完成 → 驱动创建标记 A →
    /// 保存线程等到 A 才执行 save_document、落盘后创建标记 B →
    /// 驱动等 B 出现才发起固定版读取。事件顺序由握手保证，与机器速度无关。
    #[test]
    fn mid_round_save_maps_to_story_version_changed() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let content1 = notebook_with_text("分段读取的第一版。");
        let (root, doc) = setup_work_with_doc(&temp, "中途保存作品", &content1);
        save_archive(
            &root,
            &archive(
                "conv",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        // 标记文件放测试临时目录（作品文件夹之外），驱动与保存线程共用绝对路径。
        let marker_a = temp.path().join("first-read-done.marker");
        let marker_b = temp.path().join("save-done.marker");

        let (_driver_temp, paths, params) = fake_driver(&multi_step_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv", root.clone(), false);

        // 保存线程：轮询等标记 A（首读完成）→ 保存新版本 → 创建标记 B。
        let saver_root = root.clone();
        let saver_doc = doc.clone();
        let saver_marker_a = marker_a.clone();
        let saver_marker_b = marker_b.clone();
        let saver = std::thread::spawn(move || {
            while !saver_marker_a.exists() {
                std::thread::sleep(Duration::from_millis(10));
            }
            save_document(
                &saver_root,
                &saver_doc,
                &notebook_with_text("中途保存的新版本。"),
            )
            .expect("save mid-round");
            std::fs::write(&saver_marker_b, "").expect("create marker b");
        });

        let pinned = compute_version(&content1);
        let points = cut_points(&content1, 4);
        let acc = send_round(
            &manager,
            "s1",
            "m1",
            serde_json::json!([
                read_step(&doc, None, None),
                { "mark": marker_a.to_string_lossy() },
                { "waitFor": marker_b.to_string_lossy(), "timeoutMs": 30000 },
                // 带范围（与首读的去重键不同）：真正触达执行器的版本校验。
                read_step(&doc, Some(&pinned), Some((points[0], points[1]))),
            ]),
        );
        saver.join().expect("saver");
        // mark / waitFor 步不产生结果槽位：acc = [首读结果, 固定版读取结果]。
        assert!(
            acc[0]["Read"].is_object(),
            "首读应成功并固定版本: {}",
            acc[0]
        );
        assert_eq!(
            acc[1]["denied"], "story_version_changed",
            "期间出新版：按固定版读取应映射停读: {}",
            acc[1]
        );
        manager.shutdown_best_effort();
    }

    /// 6.2 + 6.3 集成：同轮去重（提示附出处）、跨轮不屏蔽、按轮累计阅读程度
    /// 落档（两半 = 完整；仅检索命中 = 搜索片段；新轮重新累计）。
    #[test]
    fn dedup_and_cumulative_depth_round_trip() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let content = notebook_with_text("这是一篇足够长的正文，用于验证分段读取与累计覆盖判定。");
        let (root, doc_a) = setup_work_with_doc(&temp, "去重累计作品", &content);
        let doc_b = crate::project::create_document(&root, None).expect("create doc b");
        crate::project::rename_node(&root, &doc_b, "检索文档").expect("rename");
        save_document(&root, &doc_b, &notebook_with_text("这里藏着独特检索词。")).expect("save b");
        save_archive(
            &root,
            &archive(
                "conv",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&multi_step_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");

        let points = cut_points(&content, 2);
        let first = (points[0], points[1]);
        let second = (points[1], points[2]);
        let version = compute_version(&content);

        // 轮 0：读两半 + 重复第一半（去重）+ 检索命中 B。
        channel.register_round("s1", "conv", root.clone(), false);
        let acc = send_round(
            &manager,
            "s1",
            "m0",
            serde_json::json!([
                read_step(&doc_a, Some(&version), Some(first)),
                read_step(&doc_a, Some(&version), Some(second)),
                read_step(&doc_a, Some(&version), Some(first)),
                { "tool": "story-search", "args": { "query": "独特检索词" } },
            ]),
        );
        assert!(acc[0]["Read"].is_object(), "前半应成功: {}", acc[0]);
        assert!(acc[1]["Read"].is_object(), "后半应成功: {}", acc[1]);
        // 去重提示：附出处（文档 / 版本 / 范围 / 轮次），不重复装入全文。
        let hint = &acc[2]["AlreadyProvided"];
        assert!(
            hint.is_object(),
            "同轮重复请求应返回已提供过提示: {}",
            acc[2]
        );
        assert_eq!(hint["document_id"], doc_a.as_str());
        assert_eq!(hint["version"], version.as_str());
        assert_eq!(hint["range"]["start"], first.0);
        assert_eq!(hint["range"]["end"], first.1);
        assert_eq!(hint["turn_index"], 0);
        assert!(
            !acc[2].to_string().contains(&content),
            "去重提示不得重复装入全文"
        );
        // 检索命中 B（A 已固定且版本一致，命中保留）。
        assert_eq!(acc[3]["Searched"]["status"], "hit");

        // 轮 0 出处：A 两半 = 完整阅读；B 仅检索 = 搜索片段。
        let entry = |doc: &str, turn: u32| {
            provenance_of(&root, "conv")
                .into_iter()
                .find(|e| e.document_id == doc && e.turn_index == turn)
                .unwrap_or_else(|| panic!("缺 {doc}@{turn} 的出处条目"))
        };
        assert_eq!(entry(&doc_a, 0).depth, ReadingDepth::Full);
        assert_eq!(entry(&doc_b, 0).depth, ReadingDepth::SearchSnippet);

        // 轮 1（跨轮）：同请求不屏蔽，重新读取重新累计（只读半篇 = 局部）。
        channel.register_round("s1", "conv", root.clone(), false);
        let acc = send_round(
            &manager,
            "s1",
            "m1",
            serde_json::json!([read_step(&doc_a, Some(&version), Some(first))]),
        );
        assert!(acc[0]["Read"].is_object(), "跨轮重读不屏蔽: {}", acc[0]);
        assert_eq!(entry(&doc_a, 1).depth, ReadingDepth::Partial);
        manager.shutdown_best_effort();
    }

    /// 6.4 集成：保险丝触发——阈值内调用正常执行，越限后该轮后续补读一律
    /// reading_stopped（结构化拒绝回模型）；默认配置的正常补读不受打扰。
    #[test]
    fn fuse_trips_after_threshold_and_default_config_leaves_normal_round_alone() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let content = notebook_with_text("用于熔断测试的正文，需要有足够的长度切出多段。");
        let (root, doc) = setup_work_with_doc(&temp, "熔断作品", &content);
        save_archive(
            &root,
            &archive(
                "conv",
                Some(GrantEntry {
                    granted_at: "2026-09-20T08:30:00.123Z".to_string(),
                }),
            ),
        )
        .expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&multi_step_driver());

        // 紧配置：每轮 2 次补读。第 3 次起 reading_stopped。
        let (manager, channel, _guard) = wire_channel_with(ReadingFuseConfig {
            max_tool_calls: 2,
            max_accumulated_duration: Duration::from_secs(120),
        });
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        let points = cut_points(&content, 4);
        let version = compute_version(&content);
        let ranges: Vec<(usize, usize)> = points.windows(2).map(|w| (w[0], w[1])).collect();
        let steps: Vec<serde_json::Value> = ranges
            .iter()
            .map(|(s, e)| read_step(&doc, Some(&version), Some((*s, *e))))
            .collect();
        channel.register_round("s1", "conv", root.clone(), false);
        let acc = send_round(&manager, "s1", "m0", serde_json::Value::Array(steps));
        assert!(acc[0]["Read"].is_object(), "第 1 次正常执行: {}", acc[0]);
        assert!(acc[1]["Read"].is_object(), "第 2 次正常执行: {}", acc[1]);
        assert_eq!(acc[2]["denied"], "reading_stopped", "越限后停: {}", acc[2]);
        assert_eq!(
            acc[3]["denied"], "reading_stopped",
            "后续一律停: {}",
            acc[3]
        );
        assert_eq!(
            acc[2]["recovery"], RECOVERY_READING_STOPPED,
            "保险丝拒绝应携带稳定恢复路径提示: {}",
            acc[2]
        );
        assert_eq!(
            acc[3]["recovery"], RECOVERY_READING_STOPPED,
            "该轮后续补读停止同样携带提示: {}",
            acc[3]
        );
        manager.shutdown_best_effort();

        // 默认配置：同规模补读全部正常（正常路径不受打扰）。
        let (manager2, channel2, _guard2) = wire_channel();
        manager2.ensure_started(&params, &paths).expect("驱动启动");
        manager2.start_session("s2").expect("start session");
        let points = cut_points(&content, 4);
        let ranges: Vec<(usize, usize)> = points.windows(2).map(|w| (w[0], w[1])).collect();
        let steps: Vec<serde_json::Value> = ranges
            .iter()
            .map(|(s, e)| read_step(&doc, Some(&version), Some((*s, *e))))
            .collect();
        channel2.register_round("s2", "conv", root.clone(), false);
        let acc = send_round(&manager2, "s2", "m0", serde_json::Value::Array(steps));
        for (index, result) in acc.as_array().unwrap().iter().enumerate() {
            assert!(
                result["Read"].is_object(),
                "第 {index} 次不应被打扰: {result}"
            );
        }
        manager2.shutdown_best_effort();
    }
}
