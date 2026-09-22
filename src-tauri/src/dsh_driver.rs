//! 常驻 DSH 会话驱动管理器（change: resident-ai-session 任务 3.1–3.2）。
//!
//! 职责：守护一个常驻的 node 驱动子进程（`sidecar/driver/driver.mjs`），
//! 经 stdin/stdout 行分隔 JSON 协议（v1，见 design.md D2）与之通信：
//! - 懒启动：首次 AI 操作时拉起进程并等待 `ready`；进程存活且参数一致时复用。
//! - 参数变化（模型/地址/Key）：优雅重启进程。
//! - 请求级超时：超时先发 `cancel_message` 并给宽限期，再返回 Timeout。
//! - 崩溃检测：stdout EOF 视为驱动退出，所有等待中的请求立即失败；下次操作重新拉起。
//! - 优雅退出：`shutdown` 命令 + 宽限等待 + 强杀进程树兜底；宿主意外死亡时
//!   驱动侧因 stdin 关闭自行清理（防孤儿进程，驱动已实现）。
//!
//! 安全边界（任务 3.5）：协议命令面只有会话管理与文本生成，不存在任何向用户
//! 文档写入的通道；容器装配由驱动侧默认拒绝完成（见 `sidecar/driver/gen-config.mjs`）。

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::dsh_sidecar::DshRuntimePaths;
use crate::llm_config::{GenerateAiError, GenerateAiErrorCode};

pub const PROTOCOL_VERSION: u32 = 1;
/// 驱动启动（node + DSH 容器 boot）的就绪上限。
pub const READY_TIMEOUT: Duration = Duration::from_secs(60);
/// 单次生成的请求级超时（与旧一次性路径的 DSH_GENERATION_TIMEOUT 对齐）。
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
/// 会话确认（start/end/replay）的应答上限。
pub const SESSION_ACK_TIMEOUT: Duration = Duration::from_secs(30);
/// 超时触发取消后，等待驱动回终态的宽限期。
pub const CANCEL_GRACE: Duration = Duration::from_secs(10);
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

// ========== 协议类型（与 sidecar/driver/driver.mjs 的协议 v1 对应） ==========

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriverCommand {
    StartSession {
        session_id: String,
    },
    SendMessage {
        session_id: String,
        message_id: String,
        text: String,
    },
    ReplayHistory {
        session_id: String,
        turns: Vec<DriverReplayTurn>,
    },
    ReplayDone {
        session_id: String,
    },
    CancelMessage {
        session_id: String,
        message_id: String,
    },
    EndSession {
        session_id: String,
    },
    Shutdown,
    /// 宿主回填工具执行结果（add-agent-on-demand-reading 任务 5.2，设计 D2）：
    /// 驱动把结果喂回模型会话并继续挂起轮次。
    ToolResult {
        session_id: String,
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<ToolResultErrorPayload>,
    },
}

/// 工具结果的结构化拒绝负载（协议 `tool_result.error`）：只携带稳定 reason 与
/// 可选的稳定恢复路径提示（`recovery`，面向模型；batch-improvement-candidates
/// ②，design D5），绝不携带作品内容。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ToolResultErrorPayload {
    pub reason: String,
    /// 可选稳定恢复路径提示（英文常量，由宿主通道按 reason 填充）：无既定
    /// 恢复路径的拒绝不携带；序列化时无值不出现该字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

/// 崩溃恢复的历史轮次（前端显示历史的增量投影，不含任何作品文件内容）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DriverReplayTurn {
    pub role: String,
    pub text: String,
}

/// 驱动事件（驱动 → 宿主）。`Serialize` 仅供协议契约测试提取 serde 标签名
/// （与 protocol.json 单一真相源对照，见测试 `protocol_json_pins_driver_event_and_command_vocabularies`）；
/// 生产链路只做反序列化。
#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriverEvent {
    Ready {
        protocol_version: u32,
    },
    SessionStarted {
        session_id: String,
    },
    Delta {
        session_id: String,
        message_id: String,
        seq: u64,
        text: String,
    },
    /// provider 发送回执：本轮首次观测到 provider 侧回应证据时由驱动发出一次，
    /// 先于终态。只作回执通知，不满足 MessageDone/Failed 等待条件。
    MessageSent {
        session_id: String,
        message_id: String,
    },
    MessageDone {
        session_id: String,
        message_id: String,
        text: String,
    },
    MessageFailed {
        session_id: String,
        message_id: String,
        code: String,
        message: String,
    },
    ReplayOk {
        session_id: String,
    },
    SessionEnded {
        session_id: String,
    },
    /// 工具调用（驱动 → 宿主，任务 5.2，设计 D2）：模型发起的受控只读工具调用
    /// 交宿主执行；轮次挂起直到宿主回填 `tool_result`（或被停止生成取消）。
    ToolCall {
        session_id: String,
        message_id: String,
        call_id: String,
        tool: String,
        args: serde_json::Value,
    },
    Error {
        session_id: Option<String>,
        message_id: Option<String>,
        code: String,
        message: String,
    },
}

/// 流式增量回调负载：宿主把它转发给前端（Tauri event）。
#[derive(Clone, Serialize, Debug)]
pub struct DeltaPayload {
    pub session_id: String,
    pub message_id: String,
    pub seq: u64,
    pub text: String,
}

pub type DeltaSink = Arc<dyn Fn(DeltaPayload) + Send + Sync>;

/// 工具调用事件负载：宿主把它交给执行通道（story_tool_channel），
/// 并可转发前端做轻量过程呈现（Tauri 事件 `ai-tool-call`，UI 是任务组 7）。
#[derive(Clone, Serialize, Debug)]
pub struct ToolCallPayload {
    pub session_id: String,
    pub message_id: String,
    pub call_id: String,
    pub tool: String,
    pub args: serde_json::Value,
}

pub type ToolCallSink = Arc<dyn Fn(ToolCallPayload) + Send + Sync>;

/// 驱动进程的启动参数（来自用户保存的唯一 LLM 配置）。
/// `max_tokens`（任务 8.1，设计 D10）参与相等比较：配置变化时 `ensure_started`
/// 会退役旧代并按新参数重启驱动，新上限即生效。
#[derive(Clone, Debug, PartialEq)]
pub struct DriverParams {
    pub model: String,
    pub api_base_url: String,
    pub api_key: String,
    /// 可选的单次生成 max_tokens 上限；`None` 不透传 `--max-tokens`
    /// （spawn 参数与现状逐字节一致），驱动使用其默认 131072。
    pub max_tokens: Option<u64>,
}

/// 一次生成请求的成功终态：最终全文 + provider 侧发送回执。
///
/// `sent_confirmed` 仅在本轮收到 `message_sent` 回执（驱动观测到 provider 侧回应
/// 证据）时为 true；未观测到回执的轮次为 false——这表示「未确认」，不是「未发送」。
#[derive(Debug, Clone)]
pub struct MessageOutcome {
    /// 最终全文（完成事件携带的全文）。
    pub text: String,
    /// 是否收到 `message_sent` 回执（本轮观测到 provider 侧回应证据）。
    pub sent_confirmed: bool,
}

// ========== 错误映射（任务 3.2：稳定错误契约，message 固定中文不回传原文） ==========

/// 把驱动的失败码映射到稳定错误分类。`message` 一律用固定中文，不透传驱动原文，
/// 防止 API Key、请求正文或远端响应泄漏进前端。
pub fn map_driver_failure(code: &str, _raw_message: &str) -> GenerateAiError {
    let upper = code.to_uppercase();
    let (code, message) = if code == "cancelled" {
        (GenerateAiErrorCode::Timeout, "生成已取消")
    } else if upper.contains("INVALID_CREDENTIAL")
        || upper.contains("AUTH")
        || upper.contains("401")
        || upper.contains("403")
    {
        (
            GenerateAiErrorCode::Authentication,
            "认证失败：API Key 可能无效或没有权限",
        )
    } else if upper.contains("CONTEXT_WINDOW")
        || upper.contains("TOO_LARGE")
        || upper.contains("413")
    {
        (
            GenerateAiErrorCode::RequestTooLarge,
            "对话内容过长，请新建对话后重试",
        )
    } else if upper.contains("TRANSPORT")
        || upper.contains("NETWORK")
        || upper.contains("ECONNREFUSED")
        || upper.contains("ENOTFOUND")
        || upper.contains("DNS")
    {
        (
            GenerateAiErrorCode::Network,
            "无法连接到服务，请检查 API 地址是否正确",
        )
    } else if upper.contains("QUOTA") {
        (GenerateAiErrorCode::Service, "服务配额不足或已达上限")
    } else if code == "busy" {
        (
            GenerateAiErrorCode::Service,
            "当前会话已有生成中的请求，请稍候",
        )
    } else {
        (GenerateAiErrorCode::Service, "生成失败，请稍后重试")
    };
    GenerateAiError::new(code, message)
}

fn timeout_error() -> GenerateAiError {
    GenerateAiError::new(GenerateAiErrorCode::Timeout, "生成超时，请稍后重试")
}

fn service_error(message: impl Into<String>) -> GenerateAiError {
    GenerateAiError::new(GenerateAiErrorCode::Service, message)
}

/// DSH stderr 单行诊断收窄（7.3）：
/// 原始 stderr 行可能包含请求正文、文件路径或 API Key，绝不能原样写入宿主日志。
/// 这里按关键词把行映射为固定诊断分类，只记录分类与原文长度，不回显任何原文。
fn sanitize_stderr_diagnostic(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let category = if lower.contains("no api key")
        || lower.contains("missing_credential")
        || lower.contains("not configured")
    {
        "缺配置"
    } else if lower.contains("api key")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("auth")
        || lower.contains("unauthorized")
    {
        "认证失败"
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "超时"
    } else if lower.contains("context_window")
        || lower.contains("too large")
        || lower.contains("413")
    {
        "请求过长"
    } else if lower.contains("connect")
        || lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("dns")
        || lower.contains("enotfound")
    {
        "网络"
    } else {
        "其它"
    };
    format!(
        "dsh-driver stderr 诊断：类别={category}，原文 {} 字符（正文/路径/密钥不记录）",
        raw.chars().count()
    )
}

// ========== 管理器 ==========

/// 全局单例：Tauri 与非 Tauri（测试）路径共用。
static DRIVER_MANAGER: std::sync::OnceLock<DshDriverManager> = std::sync::OnceLock::new();

pub fn global_driver_manager() -> &'static DshDriverManager {
    DRIVER_MANAGER.get_or_init(DshDriverManager::new)
}

/// 进程内自增 id（legacy 临时会话/消息命名用，不引入新依赖）。
pub fn next_id() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

struct LiveProcess {
    child: Child,
    stdin: ChildStdin,
    params: DriverParams,
}

impl LiveProcess {
    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()
    }
    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
    fn graceful_stop(&mut self) {
        let _ = self.write_line(r#"{"type":"shutdown"}"#);
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ========== 代际与生命周期（harden-driver-generation-lifecycle） ==========

/// 恢复式取锁：中毒后取出内部数据继续，杜绝 reader / 取消 / 退出路径连锁 panic
/// （与 `project::ProjectLocks` 的既有恢复策略一致）。
fn lock_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 驱动进程代际标识：每次实际 spawn 单调递增。reader、等待表与进程句柄都
/// 绑定到所属代际；旧代的迟到事件与 EOF 只清理自身资源，绝不触碰当前代。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GenerationId(u64);

/// 代际阶段：Starting（等待版本正确的 ready）→ Ready（可接收会话命令）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GenerationPhase {
    Starting,
    Ready,
}

/// 启动闸门信号：只有版本正确的 `Ready` 才能启动成功，其余一律失败回收。
enum StartupSignal {
    Ready { protocol_version: u32 },
    DriverError,
    UnexpectedEvent,
    Eof,
}

/// 请求等待键：消息终态（含回执）按消息身份；会话控制确认（start_session /
/// replay_ok / session_ended）共用会话身份——同一会话至多一个控制确认在等待。
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum PendingKey {
    Message(String),
    SessionControl(String),
}

/// 每代独立的等待运行时：启动信号通道（一次性）+ 本代请求等待表。
/// 代际身份由 reader 与 [`LiveGeneration`] 持有并在路由时作为参数传递。
struct GenerationRuntime {
    /// 启动期独占信号通道；`None` 表示已就绪（或已终止），事件转入常规路由。
    startup: Mutex<Option<Sender<StartupSignal>>>,
    /// 本代请求等待表：注册带唯一令牌，注销只清理自己的注册。
    pending: Mutex<HashMap<PendingKey, (u64, Sender<DriverEvent>)>>,
    next_token: AtomicU64,
}

/// 注册凭据：`Drop` 时只注销自己所属代际、同一令牌的注册，绝不误删后来者。
struct PendingRegistration {
    runtime: Arc<GenerationRuntime>,
    key: PendingKey,
    token: u64,
}

impl Drop for PendingRegistration {
    fn drop(&mut self) {
        let mut pending = lock_recover(&self.runtime.pending);
        let still_mine = pending
            .get(&self.key)
            .is_some_and(|(token, _)| *token == self.token);
        if still_mine {
            pending.remove(&self.key);
        }
    }
}

impl GenerationRuntime {
    fn new(startup_tx: Sender<StartupSignal>) -> Arc<Self> {
        Arc::new(GenerationRuntime {
            startup: Mutex::new(Some(startup_tx)),
            pending: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
        })
    }

    /// 注册等待者；重复键明确冲突，绝不覆盖既有等待者。
    fn register(
        self: &Arc<Self>,
        key: PendingKey,
    ) -> Result<(PendingRegistration, std::sync::mpsc::Receiver<DriverEvent>), GenerateAiError>
    {
        let (tx, rx) = channel();
        let mut pending = lock_recover(&self.pending);
        use std::collections::hash_map::Entry;
        match pending.entry(key.clone()) {
            Entry::Occupied(_) => Err(service_error("请求身份与进行中的等待冲突，请重试")),
            Entry::Vacant(slot) => {
                let token = self.next_token.fetch_add(1, Ordering::Relaxed);
                slot.insert((token, tx));
                Ok((
                    PendingRegistration {
                        runtime: self.clone(),
                        key,
                        token,
                    },
                    rx,
                ))
            }
        }
    }

    /// 投递并消费注册（终态）；返回是否确有等待者。
    fn deliver(&self, key: &PendingKey, event: DriverEvent) -> bool {
        let sender = lock_recover(&self.pending).remove(key);
        match sender {
            Some((_, tx)) => {
                let _ = tx.send(event);
                true
            }
            None => false,
        }
    }

    /// 回执通知：发送但不消费注册（终态仍由 [`Self::deliver`] 完成）。
    fn notify(&self, key: &PendingKey, event: DriverEvent) {
        let pending = lock_recover(&self.pending);
        if let Some((_, tx)) = pending.get(key) {
            let _ = tx.send(event);
        }
    }

    /// 只失败本代等待者（旧代 EOF 不得清空当前代的等待）。
    fn fail_all(&self, reason: &str) {
        let drained: Vec<_> = lock_recover(&self.pending).drain().collect();
        for (_, (_, tx)) in drained {
            let _ = tx.send(DriverEvent::Error {
                session_id: None,
                message_id: None,
                code: "driver_died".to_string(),
                message: reason.to_string(),
            });
        }
    }
}

struct Lifecycle {
    next_generation: u64,
    current: Option<LiveGeneration>,
}

struct LiveGeneration {
    id: GenerationId,
    phase: GenerationPhase,
    process: LiveProcess,
    runtime: Arc<GenerationRuntime>,
}

/// 生成准入表：会话 → 进行中的消息 id。同一讨论至多一个进行中请求；
/// 总量受全局上限约束（与前端调度器同一生效上限）。
struct Admission {
    active_by_session: HashMap<String, String>,
}

struct Inner {
    lifecycle: Mutex<Lifecycle>,
    admission: Mutex<Admission>,
    max_concurrent_generations: usize,
    sink: Mutex<Option<DeltaSink>>,
    loss_sink: Mutex<Option<LossSink>>,
    tool_call_sink: Mutex<Option<ToolCallSink>>,
    /// 工具挂起中的消息（任务 5.2/5.3，设计 D8）：挂起轮不适用请求级超时，
    /// 只由工具结果回填、终态或停止生成解除。
    suspended: Mutex<HashSet<String>>,
    spawn_lock: Mutex<()>,
}

/// 生成准入许可：`Drop` 时只释放自己登记的会话条目（消息 id 比对，防误删继任者）。
/// 作用域覆盖注册、写命令、等待、超时取消宽限期与全部错误出口——请求真正结束
/// 才释放名额，杜绝取消期间超卖。
struct GenerationPermit {
    inner: Arc<Inner>,
    session_id: String,
    message_id: String,
}

impl Drop for GenerationPermit {
    fn drop(&mut self) {
        let mut admission = lock_recover(&self.inner.admission);
        let still_mine = admission
            .active_by_session
            .get(&self.session_id)
            .is_some_and(|mid| *mid == self.message_id);
        if still_mine {
            admission.active_by_session.remove(&self.session_id);
        }
    }
}

/// 驱动进程丢失回调（崩溃或重启）：前端据此进入恢复流程（重放显示历史）。
pub type LossSink = Arc<dyn Fn() + Send + Sync>;

impl Inner {
    /// 事件路由（由 reader 携带自己的代际调用）。
    fn route_event(
        &self,
        generation: GenerationId,
        runtime: &Arc<GenerationRuntime>,
        event: DriverEvent,
    ) {
        // 启动期：startup 通道存在时，全部事件按启动信号处理（只认版本正确的 ready）。
        {
            let mut startup = lock_recover(&runtime.startup);
            if startup.is_some() {
                let signal = match &event {
                    DriverEvent::Ready { protocol_version } => StartupSignal::Ready {
                        protocol_version: *protocol_version,
                    },
                    DriverEvent::Error { .. } => StartupSignal::DriverError,
                    _ => StartupSignal::UnexpectedEvent,
                };
                if let Some(tx) = startup.take() {
                    let _ = tx.send(signal);
                }
                return;
            }
        }
        // 常规路由。等待表是代际局部的：旧代事件只会落进旧代（已失败清空的）表。
        match &event {
            DriverEvent::Delta {
                session_id,
                message_id,
                seq,
                text,
            } => {
                // 只有当前就绪代的增量才进 sink，防止旧代增量串入新讨论。
                if !self.is_current_ready(generation) {
                    return;
                }
                let sink = lock_recover(&self.sink).clone();
                if let Some(sink) = sink {
                    sink(DeltaPayload {
                        session_id: session_id.clone(),
                        message_id: message_id.clone(),
                        seq: *seq,
                        text: text.clone(),
                    });
                }
            }
            DriverEvent::MessageSent { message_id, .. } => {
                runtime.notify(&PendingKey::Message(message_id.clone()), event);
            }
            DriverEvent::MessageDone { message_id, .. }
            | DriverEvent::MessageFailed { message_id, .. } => {
                let message_id = message_id.clone();
                let key = PendingKey::Message(message_id.clone());
                // 终态送达即解除工具挂起（挂起轮随终态收束）。
                self.resume(&message_id);
                if !runtime.deliver(&key, event) {
                    eprintln!("dsh_driver: 无等待者的消息终态（{message_id}）");
                }
            }
            DriverEvent::ToolCall {
                session_id,
                message_id,
                call_id,
                tool,
                args,
            } => {
                // 只有当前就绪代的工具调用才进入执行通道（旧代调用一并丢弃）。
                if !self.is_current_ready(generation) {
                    return;
                }
                // 挂起标记先于转发：等待方在请求级超时到达时据此转为挂起等待（D8）。
                self.suspend(message_id);
                let sink = lock_recover(&self.tool_call_sink).clone();
                if let Some(sink) = sink {
                    sink(ToolCallPayload {
                        session_id: session_id.clone(),
                        message_id: message_id.clone(),
                        call_id: call_id.clone(),
                        tool: tool.clone(),
                        args: args.clone(),
                    });
                } else {
                    eprintln!("dsh_driver: 工具调用无接收通道（tool={tool}），已丢弃");
                }
            }
            DriverEvent::SessionStarted { session_id }
            | DriverEvent::ReplayOk { session_id }
            | DriverEvent::SessionEnded { session_id } => {
                runtime.deliver(&PendingKey::SessionControl(session_id.clone()), event);
            }
            DriverEvent::Error {
                session_id,
                message_id,
                code,
                ..
            } => {
                if let Some(mid) = message_id {
                    self.resume(mid);
                }
                let delivered = message_id
                    .as_ref()
                    .map(|mid| runtime.deliver(&PendingKey::Message(mid.clone()), event.clone()))
                    .unwrap_or(false)
                    || session_id
                        .as_ref()
                        .map(|sid| {
                            runtime.deliver(&PendingKey::SessionControl(sid.clone()), event.clone())
                        })
                        .unwrap_or(false);
                if !delivered {
                    eprintln!("dsh_driver: 无等待者的错误事件（code={code}）");
                }
            }
            DriverEvent::Ready { .. } => {
                // 就绪后重复到达的 ready：无启动通道，安全忽略。
            }
        }
    }

    fn is_current_ready(&self, generation: GenerationId) -> bool {
        let lifecycle = lock_recover(&self.lifecycle);
        matches!(&lifecycle.current, Some(current)
            if current.id == generation && current.phase == GenerationPhase::Ready)
    }

    /// 标记消息进入工具挂起（挂起轮不适用请求级超时，设计 D8）。
    fn suspend(&self, message_id: &str) {
        lock_recover(&self.suspended).insert(message_id.to_string());
    }

    /// 解除工具挂起（工具结果回填 / 终态送达 / 错误收束）。
    fn resume(&self, message_id: &str) {
        lock_recover(&self.suspended).remove(message_id);
    }

    /// 消息是否处于工具挂起（等待工具结果或授权决定）。
    fn is_suspended(&self, message_id: &str) -> bool {
        lock_recover(&self.suspended).contains(message_id)
    }

    /// 标记死亡：只有指定代际仍是当前代时才回收进程；只有**已就绪**的当前代
    /// 意外退出才触发崩溃恢复通知（启动失败不伪装为驱动丢失）。
    fn mark_dead_if_current(&self, generation: GenerationId) {
        let was_current_ready = {
            let mut lifecycle = lock_recover(&self.lifecycle);
            let is_current = lifecycle
                .current
                .as_ref()
                .is_some_and(|current| current.id == generation);
            if !is_current {
                return;
            }
            let was_ready = lifecycle
                .current
                .as_ref()
                .is_some_and(|current| current.phase == GenerationPhase::Ready);
            if let Some(mut live) = lifecycle.current.take() {
                let _ = live.process.child.kill();
                let _ = live.process.child.wait();
            }
            was_ready
        };
        if was_current_ready {
            let loss = lock_recover(&self.loss_sink).clone();
            if let Some(loss) = loss {
                loss();
            }
        }
    }
}

/// 常驻驱动进程守护者。Clone 廉价（内部 Arc）。
#[derive(Clone)]
pub struct DshDriverManager {
    inner: Arc<Inner>,
}

impl DshDriverManager {
    /// 与前端调度器一致的当前默认上限。这是**当前安全策略**，不是实测容量结论；
    /// 真实基线待阶段 7 实测后由前后端两个常量一起调整（前端调度器测试锚定 ≥2）。
    const DEFAULT_MAX_CONCURRENT_GENERATIONS: usize = 4;

    pub fn new() -> Self {
        Self::new_with_limit(Self::DEFAULT_MAX_CONCURRENT_GENERATIONS)
    }

    /// 测试构造：注入全局同时生成上限。
    pub fn new_with_limit(max_concurrent_generations: usize) -> Self {
        DshDriverManager {
            inner: Arc::new(Inner {
                lifecycle: Mutex::new(Lifecycle {
                    next_generation: 0,
                    current: None,
                }),
                admission: Mutex::new(Admission {
                    active_by_session: HashMap::new(),
                }),
                max_concurrent_generations,
                sink: Mutex::new(None),
                loss_sink: Mutex::new(None),
                tool_call_sink: Mutex::new(None),
                suspended: Mutex::new(HashSet::new()),
                spawn_lock: Mutex::new(()),
            }),
        }
    }

    /// 获取生成准入：同一讨论已有进行中请求 → `conversation_busy`；达到全局上限 →
    /// `capacity_exceeded`。两者都在写入驱动协议之前拒绝（后端不排队，排队属前端
    /// 调度器职责；Node 驱动的会话 busy 检查保留为最后一层防御）。
    fn acquire_generation_permit(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> Result<GenerationPermit, GenerateAiError> {
        let mut admission = lock_recover(&self.inner.admission);
        if admission.active_by_session.contains_key(session_id) {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::ConversationBusy,
                "当前讨论已有生成中的请求，请稍候",
            ));
        }
        if admission.active_by_session.len() >= self.inner.max_concurrent_generations {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::CapacityExceeded,
                "已达同时生成上限，请等待进行中的生成完成后再试",
            ));
        }
        admission
            .active_by_session
            .insert(session_id.to_string(), message_id.to_string());
        Ok(GenerationPermit {
            inner: self.inner.clone(),
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
        })
    }

    /// 注册流式增量回调（Tauri 层转发为前端事件；测试可注入收集器）。
    pub fn set_sink(&self, sink: DeltaSink) {
        *lock_recover(&self.inner.sink) = Some(sink);
    }

    /// 注册驱动进程丢失回调（已就绪代意外退出时；前端据此触发历史重放恢复）。
    pub fn set_loss_sink(&self, sink: LossSink) {
        *lock_recover(&self.inner.loss_sink) = Some(sink);
    }

    /// 注册工具调用回调（任务 5.2：驱动 tool_call 事件 → 宿主执行通道）。
    pub fn set_tool_call_sink(&self, sink: ToolCallSink) {
        *lock_recover(&self.inner.tool_call_sink) = Some(sink);
    }

    /// 回填工具结果并解除该消息的挂起（任务 5.2；D8：恢复 = 工具结果返回）。
    /// 驱动侧对未知 / 已取消的 call_id 回 `tool_call_not_found` 错误（迟到丢弃）。
    /// `recovery` 是拒绝的可选稳定恢复路径提示（协议 `error.recovery`，design
    /// D5）：随 error 载荷一起透传给模型，无恢复路径的拒绝传 `None`。
    #[allow(clippy::too_many_arguments)]
    pub fn send_tool_result(
        &self,
        session_id: &str,
        message_id: &str,
        call_id: &str,
        ok: bool,
        result: Option<serde_json::Value>,
        error_reason: Option<String>,
        recovery: Option<&str>,
    ) -> Result<(), GenerateAiError> {
        let cmd = DriverCommand::ToolResult {
            session_id: session_id.to_string(),
            call_id: call_id.to_string(),
            ok,
            result,
            error: error_reason.map(|reason| ToolResultErrorPayload {
                reason,
                recovery: recovery.map(str::to_string),
            }),
        };
        self.write_command(&cmd)?;
        self.inner.resume(message_id);
        Ok(())
    }

    // ---- 进程生命周期（代际化） ----

    /// 确保驱动进程存活且以 `params` 启动。已就绪代存活且参数一致时复用；
    /// 参数变化或已退出时退役旧代（锁外收尾）后拉起新代。
    pub fn ensure_started(
        &self,
        params: &DriverParams,
        paths: &DshRuntimePaths,
    ) -> Result<(), GenerateAiError> {
        let _guard = lock_recover(&self.inner.spawn_lock);
        let retired: Option<LiveProcess> = {
            let mut lifecycle = lock_recover(&self.inner.lifecycle);
            match lifecycle.current.as_mut() {
                Some(current) => {
                    let reusable = current.phase == GenerationPhase::Ready
                        && current.process.is_alive()
                        && current.process.params == *params;
                    if reusable {
                        return Ok(());
                    }
                    lifecycle
                        .current
                        .take()
                        .map(|generation| generation.process)
                }
                None => None,
            }
        };
        // 锁外收尾旧代：旧 reader 之后结束只清理自身资源，不影响随后安装的新代。
        if let Some(mut old) = retired {
            if old.is_alive() {
                old.graceful_stop();
            } else {
                let _ = old.child.wait();
            }
        }
        self.spawn_locked(params, paths)
    }

    fn spawn_locked(
        &self,
        params: &DriverParams,
        paths: &DshRuntimePaths,
    ) -> Result<(), GenerateAiError> {
        if !paths.driver_entry.exists() {
            return Err(service_error(
                "常驻驱动脚本缺失，请确认 sidecar/driver 目录完整",
            ));
        }
        if let Some(home) = &paths.dsh_home {
            std::fs::create_dir_all(home)
                .map_err(|e| service_error(format!("无法创建 DSH 运行目录: {e}")))?;
        }

        // 分配代际并先建立启动信号通道（先于 reader 启动，避免就绪事件竞态丢失）。
        let generation = {
            let mut lifecycle = lock_recover(&self.inner.lifecycle);
            lifecycle.next_generation += 1;
            GenerationId(lifecycle.next_generation)
        };
        let (start_tx, start_rx) = channel();
        let runtime = GenerationRuntime::new(start_tx);

        let mut command = Command::new(&paths.node_bin);
        command
            .args([
                paths.driver_entry.to_string_lossy().as_ref(),
                "--api-base",
                &params.api_base_url,
                "--model",
                &params.model,
            ])
            .env("DEEPSEEK_API_KEY", &params.api_key)
            .current_dir(&paths.driver_cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // max_tokens 可选透传（任务 8.1，设计 D10）：未配置时不追加任何参数，
        // spawn 命令行与现状逐字节一致（缺省行为不变）。
        if let Some(max_tokens) = params.max_tokens {
            command.arg("--max-tokens").arg(max_tokens.to_string());
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if let Some(home) = &paths.dsh_home {
            command.env("DSH_HOME", home);
        }

        let mut child = command
            .spawn()
            .map_err(|e| service_error(format!("无法启动常驻驱动进程: {e}")))?;
        let stdin = child.stdin.take().expect("stdin 已 piped");
        let stdout = child.stdout.take().expect("stdout 已 piped");
        // stderr 独立排空：诊断进宿主 stderr，不进协议。
        // 7.3 收窄：绝不原样回显 stderr 行（可能含正文/路径/密钥），
        // 只记录固定分类 + 长度的脱敏诊断。
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("{}", sanitize_stderr_diagnostic(&line));
                }
            });
        }

        // 安装 Starting 代，再启动携带代际身份的 reader。
        {
            let mut lifecycle = lock_recover(&self.inner.lifecycle);
            lifecycle.current = Some(LiveGeneration {
                id: generation,
                phase: GenerationPhase::Starting,
                process: LiveProcess {
                    child,
                    stdin,
                    params: params.clone(),
                },
                runtime: runtime.clone(),
            });
        }

        let inner = self.inner.clone();
        let reader_runtime = runtime.clone();
        std::thread::spawn(move || reader_loop(inner, generation, reader_runtime, stdout));

        // 启动闸门：只认版本正确的 Ready；其余（错版本 / 错误事件 / 意外事件 /
        // EOF / 超时）一律失败并回收该代，不伪装成功，也不触发崩溃恢复通知。
        match start_rx.recv_timeout(READY_TIMEOUT) {
            Ok(StartupSignal::Ready {
                protocol_version: v,
            }) if v == PROTOCOL_VERSION => {
                let transitioned = {
                    let mut lifecycle = lock_recover(&self.inner.lifecycle);
                    match lifecycle.current.as_mut() {
                        Some(current) if current.id == generation => {
                            current.phase = GenerationPhase::Ready;
                            true
                        }
                        _ => false,
                    }
                };
                if transitioned {
                    Ok(())
                } else {
                    self.retire_generation(generation);
                    Err(service_error("常驻驱动启动被并发替换，请重试"))
                }
            }
            Ok(StartupSignal::Ready {
                protocol_version: v,
            }) => {
                self.retire_generation(generation);
                Err(service_error(format!(
                    "常驻驱动协议版本不匹配: {v}（期望 {PROTOCOL_VERSION}）"
                )))
            }
            Ok(StartupSignal::DriverError) => {
                self.retire_generation(generation);
                Err(service_error("常驻驱动启动失败"))
            }
            Ok(StartupSignal::UnexpectedEvent) => {
                self.retire_generation(generation);
                Err(service_error("常驻驱动启动期间收到意外事件"))
            }
            Ok(StartupSignal::Eof) | Err(_) => {
                self.retire_generation(generation);
                Err(service_error("常驻驱动启动超时或意外退出"))
            }
        }
    }

    /// 回收指定代际（仅当它仍是当前代）：杀进程并清空 current。
    /// 语义为「启动失败 / 主动退役」，不触发崩溃恢复通知。
    fn retire_generation(&self, generation: GenerationId) {
        let retired = {
            let mut lifecycle = lock_recover(&self.inner.lifecycle);
            match lifecycle.current.as_ref() {
                Some(current) if current.id == generation => lifecycle.current.take(),
                _ => None,
            }
        };
        if let Some(mut live) = retired {
            let _ = live.process.child.kill();
            let _ = live.process.child.wait();
        }
    }

    /// 优雅关闭（应用退出钩子调用）。尽力而为：先发 shutdown，超时强杀。
    pub fn shutdown_best_effort(&self) {
        let retired = lock_recover(&self.inner.lifecycle).current.take();
        if let Some(mut live) = retired {
            live.process.graceful_stop();
        }
    }

    /// 当前就绪代的运行时（注册等待者用）；未就绪或未启动时失败关闭。
    fn current_runtime(&self) -> Result<Arc<GenerationRuntime>, GenerateAiError> {
        let lifecycle = lock_recover(&self.inner.lifecycle);
        match lifecycle.current.as_ref() {
            Some(current) if current.phase == GenerationPhase::Ready => Ok(current.runtime.clone()),
            Some(_) => Err(service_error("常驻驱动启动中，请稍后重试")),
            None => Err(service_error("常驻驱动进程未启动")),
        }
    }

    // ---- 协议操作 ----

    fn write_command(&self, cmd: &DriverCommand) -> Result<(), GenerateAiError> {
        let mut line = serde_json::to_string(cmd)
            .map_err(|e| service_error(format!("协议序列化失败: {e}")))?;
        line.push('\n');
        // 只向当前**已就绪**代写入：启动期与退役后的进程不接受会话命令。
        let mut lifecycle = lock_recover(&self.inner.lifecycle);
        let live = lifecycle
            .current
            .as_mut()
            .filter(|current| current.phase == GenerationPhase::Ready)
            .ok_or_else(|| service_error("常驻驱动进程未启动或未就绪"))?;
        live.process
            .write_line(&line)
            .map_err(|e| service_error(format!("向驱动写入命令失败: {e}")))
    }

    // ---- 会话操作（控制确认严格匹配：start / replay_done / end 共用会话控制键） ----

    pub fn start_session(&self, session_id: &str) -> Result<(), GenerateAiError> {
        let runtime = self.current_runtime()?;
        let (_registration, rx) =
            runtime.register(PendingKey::SessionControl(session_id.to_string()))?;
        self.write_command(&DriverCommand::StartSession {
            session_id: session_id.to_string(),
        })?;
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::SessionStarted { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            // 严格匹配：非预期事件不再被当作成功。
            Ok(_) => Err(service_error("启动会话期间收到意外事件")),
            Err(_) => Err(timeout_error()),
        }
    }

    /// 发送消息并等待终态。流式增量经 sink 转发；返回最终全文与发送回执。
    /// `message_sent` 回执在等待中被记录（`sent_confirmed`），但不满足等待条件——
    /// 等待只在 MessageDone / MessageFailed / Error / 超时时结束。
    pub fn send_message_and_wait(
        &self,
        session_id: &str,
        message_id: &str,
        text: &str,
        timeout: Duration,
    ) -> Result<MessageOutcome, GenerateAiError> {
        // 准入护栏最前：同讨论重复生成与全局超限都在写入协议之前拒绝；
        // 许可（RAII）覆盖本函数全部出口，请求结束才释放名额。
        let _permit = self.acquire_generation_permit(session_id, message_id)?;
        let runtime = self.current_runtime()?;
        let key = PendingKey::Message(message_id.to_string());
        let (_registration, rx) = runtime.register(key.clone())?;
        let cmd = DriverCommand::SendMessage {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            text: text.to_string(),
        };
        self.write_command(&cmd)?;
        let mut sent_confirmed = false;
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                // 工具挂起中的轮次不适用请求级超时（任务 5.2/5.3，设计 D8：等待
                // 授权期间轮次挂起、不产生模型请求，占用语义不变）：阻塞等待
                // 工具结果回填 / 授权决定 / 停止生成带来的下一个事件。
                if self.inner.is_suspended(message_id) {
                    match rx.recv() {
                        Ok(DriverEvent::MessageDone { text, .. }) => {
                            return Ok(MessageOutcome {
                                text,
                                sent_confirmed,
                            });
                        }
                        Ok(DriverEvent::MessageFailed { code, .. }) => {
                            return Err(map_driver_failure(&code, ""));
                        }
                        Ok(DriverEvent::Error { code, message, .. }) => {
                            return Err(map_driver_failure(&code, &message));
                        }
                        Ok(_) => continue,
                        Err(_) => return Err(service_error("驱动应答通道关闭")),
                    }
                }
                // 请求级超时：先取消，给宽限期回收终态（design.md D9）
                let _ = self.cancel_message(session_id, message_id);
                let outcome = rx.recv_timeout(CANCEL_GRACE);
                return match outcome {
                    // 取消前恰好完成：仍算成功
                    Ok(DriverEvent::MessageDone { text, .. }) => Ok(MessageOutcome {
                        text,
                        sent_confirmed,
                    }),
                    _ => Err(timeout_error()),
                };
            }
            match rx.recv_timeout(remaining) {
                Ok(DriverEvent::MessageDone { text, .. }) => {
                    return Ok(MessageOutcome {
                        text,
                        sent_confirmed,
                    });
                }
                Ok(DriverEvent::MessageFailed { code, .. }) => {
                    return Err(map_driver_failure(&code, ""));
                }
                Ok(DriverEvent::Error { code, message, .. }) => {
                    return Err(map_driver_failure(&code, &message));
                }
                Ok(DriverEvent::MessageSent { .. }) => {
                    // 发送回执：记录后继续等待终态（回执不满足等待条件）。
                    sent_confirmed = true;
                }
                Ok(_) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(service_error("驱动应答通道关闭"));
                }
            }
        }
    }

    /// 取消进行中的生成。进程未启动时为无操作（幂等）。
    pub fn cancel_message(
        &self,
        session_id: &str,
        message_id: &str,
    ) -> Result<(), GenerateAiError> {
        {
            let lifecycle = lock_recover(&self.inner.lifecycle);
            if lifecycle.current.is_none() {
                return Ok(());
            }
        }
        self.write_command(&DriverCommand::CancelMessage {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
        })
    }

    /// 结束会话（新建对话 / 切换作品）。进程未启动时为无操作（幂等）。
    pub fn end_session(&self, session_id: &str) -> Result<(), GenerateAiError> {
        {
            let lifecycle = lock_recover(&self.inner.lifecycle);
            if lifecycle.current.is_none() {
                return Ok(());
            }
        }
        let runtime = self.current_runtime()?;
        let (_registration, rx) =
            runtime.register(PendingKey::SessionControl(session_id.to_string()))?;
        if self
            .write_command(&DriverCommand::EndSession {
                session_id: session_id.to_string(),
            })
            .is_err()
        {
            // 写失败多半是进程已死：会话随之消失，视为已结束
            return Ok(());
        }
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::SessionEnded { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            Ok(_) => Err(service_error("结束会话期间收到意外事件")),
            Err(_) => Err(timeout_error()),
        }
    }

    /// 注入崩溃恢复历史（增量轮次）。需要进程存活（崩溃后由本方法前先 ensure_started）。
    pub fn replay_history(
        &self,
        session_id: &str,
        turns: Vec<DriverReplayTurn>,
    ) -> Result<(), GenerateAiError> {
        self.write_command(&DriverCommand::ReplayHistory {
            session_id: session_id.to_string(),
            turns,
        })
    }

    /// 历史注入完成：驱动以 seed 建会话并确认。
    pub fn replay_done(&self, session_id: &str) -> Result<(), GenerateAiError> {
        let runtime = self.current_runtime()?;
        let (_registration, rx) =
            runtime.register(PendingKey::SessionControl(session_id.to_string()))?;
        self.write_command(&DriverCommand::ReplayDone {
            session_id: session_id.to_string(),
        })?;
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::ReplayOk { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            Ok(_) => Err(service_error("恢复确认期间收到意外事件")),
            Err(_) => Err(timeout_error()),
        }
    }
}

impl Default for DshDriverManager {
    fn default() -> Self {
        Self::new()
    }
}

fn reader_loop(
    inner: Arc<Inner>,
    generation: GenerationId,
    runtime: Arc<GenerationRuntime>,
    stdout: std::process::ChildStdout,
) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.len() > MAX_FRAME_BYTES {
            eprintln!("dsh_driver: 超长帧已丢弃（{} 字节）", line.len());
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<DriverEvent>(&line) {
            Ok(event) => inner.route_event(generation, &runtime, event),
            Err(error) => eprintln!("dsh_driver: 无法解析的驱动帧: {error}"),
        }
    }
    // stdout EOF：驱动进程退出。启动期先解除启动等待；只失败本代等待者；
    // 仅当本代仍是当前代时才回收进程——旧代 EOF 绝不触碰新代。
    if let Some(tx) = lock_recover(&runtime.startup).take() {
        let _ = tx.send(StartupSignal::Eof);
    }
    runtime.fail_all("驱动进程意外退出");
    inner.mark_dead_if_current(generation);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn commands_serialize_to_driver_protocol_shapes() {
        // 协议形状锚点：与 sidecar/driver/driver.mjs 的协议 v1 对应。
        let start = serde_json::to_value(DriverCommand::StartSession {
            session_id: "s1".into(),
        })
        .unwrap();
        assert_eq!(start["type"], "start_session");
        assert_eq!(start["session_id"], "s1");

        let send = serde_json::to_value(DriverCommand::SendMessage {
            session_id: "s1".into(),
            message_id: "m1".into(),
            text: "问题".into(),
        })
        .unwrap();
        assert_eq!(send["type"], "send_message");
        assert_eq!(send["text"], "问题");

        let shutdown = serde_json::to_value(DriverCommand::Shutdown).unwrap();
        assert_eq!(shutdown["type"], "shutdown");
    }

    /// 铁律 1 锚点：协议命令面不存在任何向用户文档写入的通道。
    /// 全部命令变体序列化后不得出现作品文档写入语义的字段。
    #[test]
    fn protocol_surface_has_no_document_write_channel() {
        let commands = vec![
            serde_json::to_value(DriverCommand::StartSession {
                session_id: "s".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::SendMessage {
                session_id: "s".into(),
                message_id: "m".into(),
                text: "t".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::ReplayHistory {
                session_id: "s".into(),
                turns: vec![DriverReplayTurn {
                    role: "user".into(),
                    text: "t".into(),
                }],
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::ReplayDone {
                session_id: "s".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::CancelMessage {
                session_id: "s".into(),
                message_id: "m".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::EndSession {
                session_id: "s".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::Shutdown).unwrap(),
        ];
        for value in commands {
            let text = value.to_string();
            for forbidden in [
                "draft_content",
                "main_content",
                "project_path",
                "file_path",
                "save",
            ] {
                assert!(
                    !text.contains(forbidden),
                    "协议命令面出现疑似文档写入字段: {forbidden} in {text}"
                );
            }
        }
    }

    #[test]
    fn driver_failure_codes_map_to_stable_error_families() {
        let cases = [
            ("cancelled", GenerateAiErrorCode::Timeout),
            ("INVALID_CREDENTIAL", GenerateAiErrorCode::Authentication),
            ("TRANSPORT", GenerateAiErrorCode::Network),
            (
                "CONTEXT_WINDOW_EXCEEDED",
                GenerateAiErrorCode::RequestTooLarge,
            ),
            ("QUOTA", GenerateAiErrorCode::Service),
            ("busy", GenerateAiErrorCode::Service),
            ("internal", GenerateAiErrorCode::Service),
        ];
        for (code, expected) in cases {
            let err = map_driver_failure(code, "raw detail must not leak");
            assert_eq!(err.code, expected, "code={code}");
            assert!(
                !err.message.contains("raw detail"),
                "message 不得透传驱动原文"
            );
        }
    }

    /// 消息等待键按消息身份区分：两个不同讨论的同序号消息（带讨论身份前缀）不冲突；
    /// 会话控制键与消息键是不同命名空间，互不碰撞。
    #[test]
    fn pending_keys_isolate_messages_and_session_controls() {
        let key_a = PendingKey::Message("conv-1725-aaaa:msg-1".into());
        let key_b = PendingKey::Message("conv-1725-bbbb:msg-1".into());
        assert_ne!(key_a, key_b, "两个不同讨论的同序号消息键不得冲突");
        assert_eq!(PendingKey::Message("conv-1725-aaaa:msg-1".into()), key_a);

        let control = PendingKey::SessionControl("conv-1725-aaaa:msg-1".into());
        assert_ne!(control, key_a, "会话控制键与消息键不得碰撞");
    }

    #[test]
    fn events_deserialize_from_driver_json() {
        let delta: DriverEvent = serde_json::from_str(
            r#"{"type":"delta","session_id":"s1","message_id":"m1","seq":3,"text":"你"}"#,
        )
        .unwrap();
        assert!(matches!(delta, DriverEvent::Delta { ref seq, .. } if *seq == 3));

        let done: DriverEvent = serde_json::from_str(
            r#"{"type":"message_done","session_id":"s1","message_id":"m1","text":"答案"}"#,
        )
        .unwrap();
        assert!(matches!(done, DriverEvent::MessageDone { ref text, .. } if text == "答案"));

        let failed: DriverEvent = serde_json::from_str(
            r#"{"type":"message_failed","session_id":"s1","message_id":"m1","code":"cancelled","message":"x"}"#,
        )
        .unwrap();
        assert!(
            matches!(failed, DriverEvent::MessageFailed { ref code, .. } if code == "cancelled")
        );
    }

    /// 任务组 1.3（change: add-agent-on-demand-reading，设计 D7）：驱动协议单一真相源
    /// `sidecar/driver/protocol.json` 与本模块协议类型双向钉死——
    /// 真相源 status=active 的条目与 Rust 认识的命令/事件一一对应；planned 条目
    /// （tool_call / tool_result，工具桥接）在本 change 后续任务组落地时翻成 active。
    #[test]
    fn protocol_json_pins_driver_event_and_command_vocabularies() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar")
            .join("driver")
            .join("protocol.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("读取 protocol.json 失败：{e}"));
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("protocol.json 必须是合法 JSON");
        assert_eq!(
            value["protocol_version"].as_u64(),
            Some(u64::from(PROTOCOL_VERSION)),
            "protocol.json 的 protocol_version 必须与本模块常量一致"
        );

        fn active_names(value: &serde_json::Value, section: &str, direction: &str) -> Vec<String> {
            value[section]
                .as_array()
                .unwrap_or_else(|| panic!("{section} 必须是数组"))
                .iter()
                .filter(|e| e["direction"] == direction && e["status"] == "active")
                .map(|e| {
                    e["name"]
                        .as_str()
                        .unwrap_or_else(|| panic!("{section} 条目缺少 name"))
                        .to_string()
                })
                .collect()
        }
        fn tag_of(serializable: impl serde::Serialize) -> String {
            serde_json::to_value(serializable).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string()
        }

        // 双向：Rust 认识的事件都在协议里（active），协议 active 事件 Rust 都有变体。
        let rust_events: Vec<String> = vec![
            tag_of(DriverEvent::Ready {
                protocol_version: 1,
            }),
            tag_of(DriverEvent::SessionStarted {
                session_id: "s".into(),
            }),
            tag_of(DriverEvent::Delta {
                session_id: "s".into(),
                message_id: "m".into(),
                seq: 0,
                text: "t".into(),
            }),
            tag_of(DriverEvent::MessageSent {
                session_id: "s".into(),
                message_id: "m".into(),
            }),
            tag_of(DriverEvent::MessageDone {
                session_id: "s".into(),
                message_id: "m".into(),
                text: "t".into(),
            }),
            tag_of(DriverEvent::MessageFailed {
                session_id: "s".into(),
                message_id: "m".into(),
                code: "c".into(),
                message: "m".into(),
            }),
            tag_of(DriverEvent::ReplayOk {
                session_id: "s".into(),
            }),
            tag_of(DriverEvent::SessionEnded {
                session_id: "s".into(),
            }),
            tag_of(DriverEvent::Error {
                session_id: None,
                message_id: None,
                code: "c".into(),
                message: "m".into(),
            }),
            tag_of(DriverEvent::ToolCall {
                session_id: "s".into(),
                message_id: "m".into(),
                call_id: "call-1".into(),
                tool: "story-read".into(),
                args: serde_json::json!({}),
            }),
        ];
        let protocol_events = active_names(&value, "events", "outbound");
        assert_eq!(
            protocol_events, rust_events,
            "protocol.json 的 active 出站事件必须与 DriverEvent 变体一一对应"
        );

        // 双向：Rust 发出的命令都在协议里（active），协议 active 命令 Rust 都有变体。
        let rust_commands: Vec<String> = vec![
            tag_of(DriverCommand::StartSession {
                session_id: "s".into(),
            }),
            tag_of(DriverCommand::SendMessage {
                session_id: "s".into(),
                message_id: "m".into(),
                text: "t".into(),
            }),
            tag_of(DriverCommand::ReplayHistory {
                session_id: "s".into(),
                turns: vec![],
            }),
            tag_of(DriverCommand::ReplayDone {
                session_id: "s".into(),
            }),
            tag_of(DriverCommand::CancelMessage {
                session_id: "s".into(),
                message_id: "m".into(),
            }),
            tag_of(DriverCommand::EndSession {
                session_id: "s".into(),
            }),
            tag_of(DriverCommand::Shutdown),
            tag_of(DriverCommand::ToolResult {
                session_id: "s".into(),
                call_id: "call-1".into(),
                ok: true,
                result: Some(serde_json::json!({"granted": true})),
                error: None,
            }),
        ];
        let protocol_commands = active_names(&value, "commands", "inbound");
        assert_eq!(
            protocol_commands, rust_commands,
            "protocol.json 的 active 入站命令必须与 DriverCommand 变体一一对应"
        );

        // 工具桥接两项（tool_call / tool_result）已随任务组 5 投产：不再有 planned 条目。
        let planned: Vec<String> = value["events"]
            .as_array()
            .unwrap()
            .iter()
            .chain(value["commands"].as_array().unwrap().iter())
            .filter(|e| e["status"] == "planned")
            .map(|e| e["name"].as_str().unwrap().to_string())
            .collect();
        assert!(
            planned.is_empty(),
            "工具桥接已投产，planned 条目应为空（当前实际：{planned:?}）"
        );
    }

    /// 任务 5.2：tool_call 帧可解析；路由到工具回调并把消息标记挂起，
    /// 终态送达后解除挂起（D8：挂起轮不适用请求级超时）。
    ///
    /// 装配说明：ToolCall 路由有代际门禁（旧代 tool_call 一律丢弃，与 Delta 同理，
    /// 任务 5.3 迟到丢弃），因此本测试经真实假驱动 `ensure_started` 安装「当前就绪
    /// 代」，再取真实代际身份与运行时手动路由事件。
    #[test]
    fn tool_call_routes_to_sink_and_suspends_until_terminal() {
        let (_temp, paths, params) = fake_driver_paths(
            "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'shutdown') process.exit(0);\n\
             });\n\
             rl.on('close', () => process.exit(0));\n\
             setInterval(() => {}, 1000);\n",
        );
        let manager = DshDriverManager::new();
        let hits = Arc::new(Mutex::new(Vec::new()));
        let hits_for_sink = hits.clone();
        manager.set_tool_call_sink(Arc::new(move |payload| {
            hits_for_sink.lock().unwrap().push(payload);
        }));
        manager.ensure_started(&params, &paths).expect("驱动启动");

        // 取当前就绪代的真实身份与运行时（代际由 manager 分配，测试不猜测）。
        let (generation, runtime) = {
            let lifecycle = lock_recover(&manager.inner.lifecycle);
            let current = lifecycle
                .current
                .as_ref()
                .expect("ensure_started 后必有当前代");
            (current.id, current.runtime.clone())
        };
        let (_registration, rx) = runtime
            .register(PendingKey::Message("m1".into()))
            .expect("注册消息等待");

        let event: DriverEvent = serde_json::from_str(
            r#"{"type":"tool_call","session_id":"s1","message_id":"m1","call_id":"call-1","tool":"story-read","args":{"document_id":"doc-1"}}"#,
        )
        .unwrap();
        assert!(matches!(&event, DriverEvent::ToolCall { tool, args, .. }
            if tool == "story-read" && args["document_id"] == "doc-1"));
        manager.inner.route_event(generation, &runtime, event);

        assert!(manager.inner.is_suspended("m1"), "工具调用后消息应进入挂起");
        let payload = hits.lock().unwrap().pop().expect("sink 收到工具调用");
        assert_eq!(payload.call_id, "call-1");
        assert_eq!(payload.args["document_id"], "doc-1");

        // 终态送达：解除挂起 + 等待者收到终态。
        manager.inner.route_event(
            generation,
            &runtime,
            DriverEvent::MessageDone {
                session_id: "s1".into(),
                message_id: "m1".into(),
                text: "答案".into(),
            },
        );
        assert!(!manager.inner.is_suspended("m1"), "终态后应解除挂起");
        let outcome = rx
            .recv_timeout(Duration::from_millis(200))
            .expect("等待者收到终态");
        assert!(matches!(outcome, DriverEvent::MessageDone { .. }));

        // 非当前代的 tool_call 一律丢弃（迟到丢弃）：路由到伪造旧代不得挂起、不得进 sink。
        let stale_calls = Arc::new(Mutex::new(Vec::new()));
        let stale_for_sink = stale_calls.clone();
        manager.set_tool_call_sink(Arc::new(move |payload| {
            stale_for_sink.lock().unwrap().push(payload);
        }));
        manager.inner.route_event(
            GenerationId(999),
            &runtime,
            DriverEvent::ToolCall {
                session_id: "s1".into(),
                message_id: "m-stale".into(),
                call_id: "call-stale".into(),
                tool: "story-read".into(),
                args: serde_json::json!({}),
            },
        );
        assert!(
            !manager.inner.is_suspended("m-stale"),
            "旧代 tool_call 不得挂起任何消息"
        );
        assert!(
            stale_calls.lock().unwrap().is_empty(),
            "旧代 tool_call 不得进入执行通道"
        );

        manager.shutdown_best_effort();
    }

    /// 任务 5.2：tool_result 命令的协议形状——成功携带 result；拒绝跳过 result、
    /// 携带 error.reason 且不含任何作品内容；无恢复路径的拒绝不出现 recovery 字段。
    #[test]
    fn tool_result_command_serializes_to_protocol_shapes() {
        let ok = serde_json::to_value(DriverCommand::ToolResult {
            session_id: "s1".into(),
            call_id: "call-1".into(),
            ok: true,
            result: Some(serde_json::json!({"granted": true})),
            error: None,
        })
        .unwrap();
        assert_eq!(ok["type"], "tool_result");
        assert_eq!(ok["call_id"], "call-1");
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["result"]["granted"], true);
        assert!(ok.get("error").is_none(), "成功结果不得携带 error 字段");

        let denied = serde_json::to_value(DriverCommand::ToolResult {
            session_id: "s1".into(),
            call_id: "call-2".into(),
            ok: false,
            result: None,
            error: Some(ToolResultErrorPayload {
                reason: "on_demand_reading_unauthorized".into(),
                recovery: None,
            }),
        })
        .unwrap();
        assert_eq!(denied["ok"], false);
        assert_eq!(denied["error"]["reason"], "on_demand_reading_unauthorized");
        assert!(
            denied["error"].get("recovery").is_none(),
            "无恢复路径的拒绝不得出现 recovery 字段"
        );
        assert!(denied.get("result").is_none(), "拒绝不得携带结果字段");
        let text = denied.to_string();
        for forbidden in ["content", "body", "正文"] {
            assert!(!text.contains(forbidden), "拒绝帧不得携带作品内容: {text}");
        }
    }

    /// batch-improvement-candidates ②（design D5）：`error.recovery` 是可选字段——
    /// 含时逐字透传、不含时不出现；旧形态（无 recovery）仍可反序列化；真相源
    /// protocol.json 对 `error.recovery` 与授权拒绝结果内的 recovery 都有记录。
    #[test]
    fn tool_result_error_recovery_is_opt_in_and_documented_in_protocol() {
        const UNAUTHORIZED_RECOVERY: &str = "Reading is not authorized. Call story-request-reading to request it; the user can grant it in the discussion panel, and a new question may re-request.";

        // 含 recovery：字段出现且逐字透传（不翻译、不改写）。
        let with_recovery = serde_json::to_value(DriverCommand::ToolResult {
            session_id: "s1".into(),
            call_id: "call-1".into(),
            ok: false,
            result: None,
            error: Some(ToolResultErrorPayload {
                reason: "on_demand_reading_unauthorized".into(),
                recovery: Some(UNAUTHORIZED_RECOVERY.into()),
            }),
        })
        .unwrap();
        assert_eq!(
            with_recovery["error"]["reason"],
            "on_demand_reading_unauthorized"
        );
        assert_eq!(with_recovery["error"]["recovery"], UNAUTHORIZED_RECOVERY);

        // 不含 recovery：opt-in，不造空值。
        let without_recovery = serde_json::to_value(ToolResultErrorPayload {
            reason: "invalid_parameters".into(),
            recovery: None,
        })
        .unwrap();
        assert_eq!(without_recovery["reason"], "invalid_parameters");
        assert!(without_recovery.get("recovery").is_none());

        // 旧形态（无 recovery 的拒绝帧）仍可解析：双端灰度期不破协议。
        let legacy: ToolResultErrorPayload =
            serde_json::from_str(r#"{"reason":"reading_stopped"}"#).unwrap();
        assert_eq!(legacy.reason, "reading_stopped");
        assert_eq!(legacy.recovery, None);

        // 真相源 protocol.json：tool_result 的 error 与 result 字段说明都记录 recovery。
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar")
            .join("driver")
            .join("protocol.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("读取 protocol.json 失败：{e}"));
        let value: serde_json::Value =
            serde_json::from_str(&text).expect("protocol.json 必须是合法 JSON");
        let tool_result = value["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["name"] == "tool_result")
            .expect("protocol.json 必须记录 tool_result 命令");
        let error_doc = tool_result["fields"]["error"].as_str().unwrap_or_default();
        assert!(
            error_doc.contains("recovery"),
            "error 字段说明必须记录可选 recovery：{error_doc}"
        );
        let result_doc = tool_result["fields"]["result"].as_str().unwrap_or_default();
        assert!(
            result_doc.contains("recovery"),
            "授权拒绝结果内的 recovery 也必须在 result 字段说明中记录：{result_doc}"
        );
    }

    /// provider 发送回执（add-automatic-story-context）：`message_sent` 帧可解析；
    /// 路由时只通知等待者、不消费等待注册——回执后终态仍可送达同一等待者；
    /// 无等待者时安全丢弃。回执不满足 MessageDone/Failed 等待条件。
    #[test]
    fn message_sent_parses_and_notifies_without_consuming_wait() {
        let sent: DriverEvent =
            serde_json::from_str(r#"{"type":"message_sent","session_id":"s1","message_id":"m1"}"#)
                .unwrap();
        assert!(matches!(
            sent,
            DriverEvent::MessageSent { ref session_id, ref message_id }
                if session_id == "s1" && message_id == "m1"
        ));

        let manager = DshDriverManager::new();
        let (start_tx, _start_rx) = channel();
        let runtime = GenerationRuntime::new(start_tx);
        // 就绪后事件转入常规路由：先消费掉启动通道。
        *lock_recover(&runtime.startup) = None;
        let (_registration, rx) = runtime
            .register(PendingKey::Message("m1".into()))
            .expect("注册消息等待");
        // 回执可重复到达（轮询兜底扫描），每次都通知且不消费注册。
        manager.inner.route_event(
            GenerationId(1),
            &runtime,
            DriverEvent::MessageSent {
                session_id: "s1".into(),
                message_id: "m1".into(),
            },
        );
        manager.inner.route_event(
            GenerationId(1),
            &runtime,
            DriverEvent::MessageSent {
                session_id: "s1".into(),
                message_id: "m1".into(),
            },
        );
        // 终态随后送达同一等待者（deliver 消费注册）。
        manager.inner.route_event(
            GenerationId(1),
            &runtime,
            DriverEvent::MessageDone {
                session_id: "s1".into(),
                message_id: "m1".into(),
                text: "答案".into(),
            },
        );
        let first = rx.recv_timeout(Duration::from_millis(200)).expect("回执一");
        assert!(matches!(first, DriverEvent::MessageSent { .. }));
        let second = rx.recv_timeout(Duration::from_millis(200)).expect("回执二");
        assert!(matches!(second, DriverEvent::MessageSent { .. }));
        let third = rx.recv_timeout(Duration::from_millis(200)).expect("终态");
        assert!(matches!(third, DriverEvent::MessageDone { ref text, .. } if text == "答案"));

        // 终态后注册已被消费：迟到的回执无等待者，安全丢弃（不得 panic）。
        manager.inner.route_event(
            GenerationId(1),
            &runtime,
            DriverEvent::MessageSent {
                session_id: "s1".into(),
                message_id: "m1".into(),
            },
        );
    }

    /// 等待键纪律：同代同键的第二次注册必须明确冲突，绝不覆盖；第一次仍能收到终态。
    #[test]
    fn duplicate_pending_registration_is_rejected_not_overwritten() {
        let (start_tx, _start_rx) = channel();
        let runtime = GenerationRuntime::new(start_tx);
        *lock_recover(&runtime.startup) = None;

        let (_first_registration, first_rx) = runtime
            .register(PendingKey::Message("m1".into()))
            .expect("第一次注册必须成功");
        let second = runtime.register(PendingKey::Message("m1".into()));
        assert!(second.is_err(), "重复键必须明确冲突拒绝，绝不覆盖");

        runtime.deliver(
            &PendingKey::Message("m1".into()),
            DriverEvent::MessageDone {
                session_id: "s1".into(),
                message_id: "m1".into(),
                text: "答案".into(),
            },
        );
        let outcome = first_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("第一次注册的等待者仍能收到终态");
        assert!(matches!(outcome, DriverEvent::MessageDone { .. }));
    }

    /// 非当前就绪代的增量不进入 sink（防旧代增量串入新讨论）。
    #[test]
    fn stale_generation_delta_never_reaches_sink() {
        let manager = DshDriverManager::new();
        let hits = Arc::new(AtomicU64::new(0));
        let hits_for_sink = hits.clone();
        manager.set_sink(Arc::new(move |_| {
            hits_for_sink.fetch_add(1, Ordering::SeqCst);
        }));
        let (start_tx, _start_rx) = channel();
        let runtime = GenerationRuntime::new(start_tx);
        *lock_recover(&runtime.startup) = None;
        // current 为 None：任何代的增量都被丢弃。
        manager.inner.route_event(
            GenerationId(1),
            &runtime,
            DriverEvent::Delta {
                session_id: "s1".into(),
                message_id: "m1".into(),
                seq: 1,
                text: "旧".into(),
            },
        );
        assert_eq!(
            hits.load(Ordering::SeqCst),
            0,
            "非当前就绪代的增量不得进入 sink"
        );
    }

    /// 未知事件类型解析失败 → 读取循环安全丢弃，不影响现有等待。
    #[test]
    fn unknown_event_type_fails_to_parse_and_is_dropped() {
        assert!(serde_json::from_str::<DriverEvent>(
            r#"{"type":"future_event","session_id":"s1"}"#
        )
        .is_err());
    }

    /// 端到端（假驱动）：`send_message_and_wait` 只在收到 `message_sent` 时置
    /// `sent_confirmed = true`；无回执的成功轮次为 false（未确认，非未发送）。
    #[test]
    fn send_message_wait_records_sent_receipt_only_when_observed() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let driver_dir = temp.path().join("driver");
        std::fs::create_dir_all(&driver_dir).expect("driver dir");
        let driver_entry = driver_dir.join("driver.mjs");
        std::fs::write(
            &driver_entry,
            "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'send_message') {\n\
                 if (!cmd.text.includes('NORECEIPT')) {\n\
                   console.log(JSON.stringify({ type: 'message_sent', session_id: cmd.session_id, message_id: cmd.message_id }));\n\
                 }\n\
                 console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: '回复' }));\n\
               }\n\
             });\n\
             rl.on('close', () => process.exit(0));\n",
        )
        .expect("write fake driver");

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

        let manager = DshDriverManager::new();
        manager.ensure_started(&params, &paths).expect("驱动启动");

        let with_receipt = manager
            .send_message_and_wait("s1", "m1", "正常问题", Duration::from_secs(15))
            .expect("带回执的生成完成");
        assert_eq!(with_receipt.text, "回复");
        assert!(
            with_receipt.sent_confirmed,
            "收到 message_sent 回执必须记录为已确认发送"
        );

        let without_receipt = manager
            .send_message_and_wait("s1", "m2", "NORECEIPT 问题", Duration::from_secs(15))
            .expect("无回执的生成完成");
        assert_eq!(without_receipt.text, "回复");
        assert!(
            !without_receipt.sent_confirmed,
            "未观测到回执时保持未确认，不伪造已发送"
        );

        manager.shutdown_best_effort();
    }

    /// 集成验证（resident-ai-session 任务 6.2 的 Rust 链路段）：
    /// 驱动进程死亡（EOF）→ mark_dead → loss 回调必须触发。
    /// 假驱动打印 ready 后 300ms 自行退出（模拟崩溃），不依赖网络与钥匙串。
    #[test]
    fn driver_process_loss_fires_loss_sink() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let driver_dir = temp.path().join("driver");
        std::fs::create_dir_all(&driver_dir).expect("driver dir");
        let driver_entry = driver_dir.join("driver.mjs");
        std::fs::write(
            &driver_entry,
            "console.log(JSON.stringify({type:\"ready\",protocol_version:1}));\nsetTimeout(() => process.exit(0), 300);\n",
        )
        .expect("write fake driver");

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

        let manager = DshDriverManager::new();
        let counter = Arc::new(AtomicU64::new(0));
        let counter_for_sink = counter.clone();
        manager.set_loss_sink(Arc::new(move || {
            counter_for_sink.fetch_add(1, Ordering::SeqCst);
        }));

        manager.ensure_started(&params, &paths).expect("驱动启动");
        // 等待假驱动自退（300ms）→ EOF → mark_dead → loss 回调
        std::thread::sleep(Duration::from_secs(3));
        assert!(
            counter.load(Ordering::SeqCst) >= 1,
            "驱动进程丢失必须触发 loss 回调"
        );
    }

    /// 假驱动夹具：返回 (TempDir, 运行路径, 参数)。TempDir 必须在测试期间保持存活。
    fn fake_driver_paths(script: &str) -> (tempfile::TempDir, DshRuntimePaths, DriverParams) {
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

    /// 启动闸门：ready 前直接退出的驱动必须判启动失败，current 为空、不触发恢复通知。
    #[test]
    fn startup_gate_rejects_driver_exiting_before_ready() {
        let (_temp, paths, params) = fake_driver_paths("process.exit(0);\n");
        let manager = DshDriverManager::new();
        let counter = Arc::new(AtomicU64::new(0));
        let counter_for_sink = counter.clone();
        manager.set_loss_sink(Arc::new(move || {
            counter_for_sink.fetch_add(1, Ordering::SeqCst);
        }));

        let result = manager.ensure_started(&params, &paths);
        assert!(result.is_err(), "ready 前退出必须判启动失败");
        assert_eq!(
            counter.load(Ordering::SeqCst),
            0,
            "启动失败不得触发崩溃恢复通知"
        );
        let lifecycle = lock_recover(&manager.inner.lifecycle);
        assert!(lifecycle.current.is_none(), "失败代必须被回收");
    }

    /// 启动闸门：首帧输出错误事件的驱动必须判启动失败。
    #[test]
    fn startup_gate_rejects_error_event_before_ready() {
        let (_temp, paths, params) = fake_driver_paths(
            "console.log(JSON.stringify({type:\"error\",session_id:null,message_id:null,code:\"internal\",message:\"x\"}));\nsetInterval(() => {}, 1000);\nprocess.stdin.on('end', () => process.exit(0));\nprocess.stdin.resume();\n",
        );
        let manager = DshDriverManager::new();
        let result = manager.ensure_started(&params, &paths);
        assert!(result.is_err(), "首帧 error 必须判启动失败");
        let lifecycle = lock_recover(&manager.inner.lifecycle);
        assert!(lifecycle.current.is_none(), "失败代必须被回收");
    }

    /// 启动闸门：协议版本不符的 ready 必须判启动失败。
    #[test]
    fn startup_gate_rejects_wrong_protocol_version() {
        let (_temp, paths, params) = fake_driver_paths(
            "console.log(JSON.stringify({type:\"ready\",protocol_version:99}));\nsetInterval(() => {}, 1000);\nprocess.stdin.on('end', () => process.exit(0));\nprocess.stdin.resume();\n",
        );
        let manager = DshDriverManager::new();
        let result = manager.ensure_started(&params, &paths);
        let error = result.expect_err("版本不符必须失败");
        assert!(
            error.message.contains("版本"),
            "错误信息应说明版本不匹配: {}",
            error.message
        );
        let lifecycle = lock_recover(&manager.inner.lifecycle);
        assert!(lifecycle.current.is_none(), "失败代必须被回收");
    }

    /// 锁中毒恢复：持 lifecycle 锁 panic 后，取消与退出路径仍能完成清理而不连锁 panic。
    #[test]
    fn poisoned_locks_do_not_cascade_into_cancel_or_shutdown() {
        let manager = DshDriverManager::new();
        let manager_for_thread = manager.clone();
        let handle = std::thread::spawn(move || {
            let _guard = manager_for_thread.inner.lifecycle.lock().unwrap();
            panic!("故意中毒");
        });
        let _ = handle.join(); // 吞掉线程的 panic 负载
                               // 恢复式取锁：以下调用不得 panic（测试通过即为证明）。
        manager
            .cancel_message("s1", "m1")
            .expect("中毒后取消仍可用");
        manager.shutdown_best_effort();
    }

    /// 旧代 EOF 不影响新代（P0-2 核心场景）：gen1 是忽略 shutdown 的顽固驱动，
    /// 参数变化切到 gen2 时 gen1 被强杀、其 reader 之后结束——只清理自身：
    /// gen2 继续服务，且不触发崩溃恢复通知。
    #[test]
    fn old_generation_eof_does_not_affect_new_generation() {
        let stubborn = "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', () => { /* 忽略一切命令，包括 shutdown */ });\n\
             rl.on('close', () => process.exit(0));\n\
             setInterval(() => {}, 1000);\n";
        let (temp1, paths1, params1) = fake_driver_paths(stubborn);
        let manager = DshDriverManager::new();
        let counter = Arc::new(AtomicU64::new(0));
        let counter_for_sink = counter.clone();
        manager.set_loss_sink(Arc::new(move || {
            counter_for_sink.fetch_add(1, Ordering::SeqCst);
        }));
        manager
            .ensure_started(&params1, &paths1)
            .expect("gen1 启动");

        let normal = "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'send_message') {\n\
                 console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: '回复2' }));\n\
               } else if (cmd.type === 'shutdown') {\n\
                 process.exit(0);\n\
               }\n\
             });\n\
             rl.on('close', () => process.exit(0));\n";
        let (temp2, paths2, _) = fake_driver_paths(normal);
        let mut params2 = params1.clone();
        params2.model = "m2".to_string();
        // 参数变化：退役 gen1（约 3 秒优雅超时后强杀）并拉起 gen2。
        manager
            .ensure_started(&params2, &paths2)
            .expect("gen2 启动");

        let outcome = manager
            .send_message_and_wait("s2", "m2", "问题", Duration::from_secs(15))
            .expect("gen2 正常响应");
        assert_eq!(outcome.text, "回复2");

        // 旧代 EOF（gen1 被强杀后其 reader 结束）不得清空新代等待或触发恢复通知。
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(
            counter.load(Ordering::SeqCst),
            0,
            "旧代 EOF 不得触发 loss 回调"
        );

        manager.shutdown_best_effort();
        drop((temp1, temp2));
    }

    /// 队列 3b：后端生成准入护栏——同会话冲突与全局超限都在写入协议前拒绝；
    /// 完成后名额释放（零泄漏）。
    #[test]
    fn admission_rejects_same_session_and_over_limit_without_touching_protocol() {
        // 延迟应答假驱动：1.5 秒后才回 message_done，保证两路同时进行中。
        let slow = "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'send_message') {\n\
                 setTimeout(() => {\n\
                   console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: '慢回复' }));\n\
                 }, 1500);\n\
               } else if (cmd.type === 'shutdown') {\n\
                 process.exit(0);\n\
               }\n\
             });\n\
             rl.on('close', () => process.exit(0));\n";
        let (_temp, paths, params) = fake_driver_paths(slow);
        let manager = DshDriverManager::new_with_limit(2);
        manager.ensure_started(&params, &paths).expect("驱动启动");

        let manager_for_first = manager.clone();
        let first = std::thread::spawn(move || {
            manager_for_first
                .send_message_and_wait("s1", "m1", "问题一", Duration::from_secs(15))
                .expect("第一路完成")
        });
        let manager_for_second = manager.clone();
        let second = std::thread::spawn(move || {
            manager_for_second
                .send_message_and_wait("s2", "m2", "问题二", Duration::from_secs(15))
                .expect("第二路完成")
        });
        // 等两路真正进入等待（已写协议），再做拒绝断言。
        std::thread::sleep(Duration::from_millis(400));

        let busy = manager
            .send_message_and_wait("s1", "m1-again", "插队", Duration::from_secs(5))
            .expect_err("同会话重复必须被拒");
        assert_eq!(busy.code, GenerateAiErrorCode::ConversationBusy);
        assert_eq!(busy.message, "当前讨论已有生成中的请求，请稍候");
        assert_eq!(
            serde_json::to_value(busy.code).unwrap(),
            serde_json::json!("conversation_busy")
        );

        let over = manager
            .send_message_and_wait("s3", "m3", "第三路", Duration::from_secs(5))
            .expect_err("超限必须被拒");
        assert_eq!(over.code, GenerateAiErrorCode::CapacityExceeded);
        assert_eq!(
            over.message,
            "已达同时生成上限，请等待进行中的生成完成后再试"
        );
        assert_eq!(
            serde_json::to_value(over.code).unwrap(),
            serde_json::json!("capacity_exceeded")
        );

        assert_eq!(first.join().expect("线程一").text, "慢回复");
        assert_eq!(second.join().expect("线程二").text, "慢回复");

        // 名额已随许可释放：新请求照常成功。
        let after = manager
            .send_message_and_wait("s3", "m4", "释放后", Duration::from_secs(15))
            .expect("名额释放后新请求成功");
        assert_eq!(after.text, "慢回复");

        manager.shutdown_best_effort();
    }

    /// 队列 3b：超时路径结束后名额必须释放（许可零泄漏）。
    #[test]
    fn admission_permit_released_after_timeout() {
        // 沉默驱动：收到 send 不回应；收到 cancel 立即回 cancelled 终态（快速结束宽限期）。
        let silent = "import readline from 'node:readline';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'cancel_message') {\n\
                 console.log(JSON.stringify({ type: 'message_failed', session_id: cmd.session_id, message_id: cmd.message_id, code: 'cancelled', message: '已取消' }));\n\
               } else if (cmd.type === 'shutdown') {\n\
                 process.exit(0);\n\
               }\n\
             });\n\
             rl.on('close', () => process.exit(0));\n\
             setInterval(() => {}, 1000);\n";
        let (_temp, paths, params) = fake_driver_paths(silent);
        let manager = DshDriverManager::new_with_limit(1);
        manager.ensure_started(&params, &paths).expect("驱动启动");

        let first = manager.send_message_and_wait("s1", "m1", "问题", Duration::from_millis(300));
        assert!(first.is_err(), "唯一名额上的请求超时失败");

        // 名额已随许可 Drop 释放：同会话重试必须能再次进入等待（是超时，不是 busy）。
        let retry_err = manager
            .send_message_and_wait("s1", "m2", "再问", Duration::from_millis(300))
            .expect_err("重试同样超时");
        assert_eq!(
            retry_err.code,
            GenerateAiErrorCode::Timeout,
            "名额已释放：不得是 conversation_busy"
        );

        manager.shutdown_best_effort();
    }

    /// 7.3 收窄：DSH stderr 诊断绝不含正文、路径或密钥原文，且长度受限。
    #[test]
    fn stderr_diagnostic_never_leaks_body_path_or_key() {
        let cases = [
            "sk-abcdef1234567890 authentication failed",
            "DEEPSEEK_API_KEY=sk-secret-key-123",
            r#"error reading D:\Users\李四\Documents\绝密作品\正文.json"#,
            "request body: 林站在天台边，他决定跳下去。",
            "some unrelated diagnostic",
        ];
        for raw in cases {
            let diag = sanitize_stderr_diagnostic(raw);
            assert!(!diag.contains("sk-"), "诊断不得含密钥痕迹: {diag}");
            assert!(!diag.contains("绝密作品"), "诊断不得含路径: {diag}");
            assert!(!diag.contains("李四"), "诊断不得含路径: {diag}");
            assert!(!diag.contains("林站在天台边"), "诊断不得含正文: {diag}");
            assert!(diag.chars().count() <= 160, "诊断长度受限: {diag}");
        }
    }

    /// 任务 8.1（add-agent-on-demand-reading，设计 D10）：max_tokens 透传——
    /// 配置 `Some(4096)` 时 spawn 追加 `--max-tokens 4096`；未配置（`None`）时
    /// 不追加该参数（spawn 命令行与现状逐字节一致），驱动使用其默认 131072。
    /// 假驱动直接回报它实际收到的 argv 形态，端到端断言。
    #[test]
    fn max_tokens_is_passed_through_only_when_configured() {
        let script = "import readline from 'node:readline';\n\
             const argv = process.argv;\n\
             const i = argv.indexOf('--max-tokens');\n\
             const seen = i >= 0 ? 'passed:' + argv[i + 1] : 'absent';\n\
             console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));\n\
             const rl = readline.createInterface({ input: process.stdin });\n\
             rl.on('line', (line) => {\n\
               let cmd; try { cmd = JSON.parse(line); } catch { return; }\n\
               if (cmd.type === 'send_message') {\n\
                 console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: seen }));\n\
               } else if (cmd.type === 'shutdown') {\n\
                 process.exit(0);\n\
               }\n\
             });\n\
             rl.on('close', () => process.exit(0));\n\
             setInterval(() => {}, 1000);\n";
        let (_temp, paths, params) = fake_driver_paths(script);

        // 配置值：透传到驱动命令行。
        let configured = DriverParams {
            max_tokens: Some(4096),
            ..params.clone()
        };
        let manager = DshDriverManager::new();
        manager
            .ensure_started(&configured, &paths)
            .expect("驱动启动（已配置）");
        let outcome = manager
            .send_message_and_wait("s1", "m1", "问题", Duration::from_secs(15))
            .expect("回显（已配置）");
        assert_eq!(
            outcome.text, "passed:4096",
            "配置值必须透传 --max-tokens 4096"
        );
        manager.shutdown_best_effort();

        // 未配置：参数不出现——缺省行为与现状一致（驱动侧维持默认 131072）。
        let manager_plain = DshDriverManager::new();
        manager_plain
            .ensure_started(&params, &paths)
            .expect("驱动启动（未配置）");
        let outcome_plain = manager_plain
            .send_message_and_wait("s1", "m1", "问题", Duration::from_secs(15))
            .expect("回显（未配置）");
        assert_eq!(
            outcome_plain.text, "absent",
            "未配置时不得追加 --max-tokens 参数"
        );
        manager_plain.shutdown_best_effort();
    }
}
