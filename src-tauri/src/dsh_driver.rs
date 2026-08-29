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

use std::collections::HashMap;
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
    StartSession { session_id: String },
    SendMessage { session_id: String, message_id: String, text: String },
    ReplayHistory { session_id: String, turns: Vec<DriverReplayTurn> },
    ReplayDone { session_id: String },
    CancelMessage { session_id: String, message_id: String },
    EndSession { session_id: String },
    Shutdown,
}

/// 崩溃恢复的历史轮次（前端显示历史的增量投影，不含任何作品文件内容）。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DriverReplayTurn {
    pub role: String,
    pub text: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriverEvent {
    Ready { protocol_version: u32 },
    SessionStarted { session_id: String },
    Delta { session_id: String, message_id: String, seq: u64, text: String },
    MessageDone { session_id: String, message_id: String, text: String },
    MessageFailed { session_id: String, message_id: String, code: String, message: String },
    ReplayOk { session_id: String },
    SessionEnded { session_id: String },
    Error { session_id: Option<String>, message_id: Option<String>, code: String, message: String },
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

/// 驱动进程的启动参数（来自用户保存的唯一 LLM 配置）。
#[derive(Clone, Debug, PartialEq)]
pub struct DriverParams {
    pub model: String,
    pub api_base_url: String,
    pub api_key: String,
}

// ========== 错误映射（任务 3.2：稳定错误契约，message 固定中文不回传原文） ==========

/// 把驱动的失败码映射到稳定错误分类。`message` 一律用固定中文，不透传驱动原文，
/// 防止 API Key、请求正文或远端响应泄漏进前端。
pub fn map_driver_failure(code: &str, _raw_message: &str) -> GenerateAiError {
    let upper = code.to_uppercase();
    let (code, message) = if code == "cancelled" {
        (
            GenerateAiErrorCode::Timeout,
            "生成已取消",
        )
    } else if upper.contains("INVALID_CREDENTIAL")
        || upper.contains("AUTH")
        || upper.contains("401")
        || upper.contains("403")
    {
        (
            GenerateAiErrorCode::Authentication,
            "认证失败：API Key 可能无效或没有权限",
        )
    } else if upper.contains("CONTEXT_WINDOW") || upper.contains("TOO_LARGE") || upper.contains("413") {
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
        (
            GenerateAiErrorCode::Service,
            "服务配额不足或已达上限",
        )
    } else if code == "busy" {
        (
            GenerateAiErrorCode::Service,
            "当前会话已有生成中的请求，请稍候",
        )
    } else {
        (
            GenerateAiErrorCode::Service,
            "生成失败，请稍后重试",
        )
    };
    GenerateAiError::new(code, message)
}

fn timeout_error() -> GenerateAiError {
    GenerateAiError::new(GenerateAiErrorCode::Timeout, "生成超时，请稍后重试")
}

fn service_error(message: impl Into<String>) -> GenerateAiError {
    GenerateAiError::new(GenerateAiErrorCode::Service, message)
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

struct Inner {
    state: Mutex<Option<LiveProcess>>,
    pending: Mutex<HashMap<String, Sender<DriverEvent>>>,
    sink: Mutex<Option<DeltaSink>>,
    loss_sink: Mutex<Option<LossSink>>,
    spawn_lock: Mutex<()>,
}

/// 驱动进程丢失回调（崩溃或重启）：前端据此进入恢复流程（重放显示历史）。
pub type LossSink = Arc<dyn Fn() + Send + Sync>;

impl Inner {
    fn deliver(&self, key: &str, event: DriverEvent) -> bool {
        let sender = self.pending.lock().unwrap().remove(key);
        match sender {
            Some(tx) => {
                let _ = tx.send(event);
                true
            }
            None => false,
        }
    }

    fn route(&self, event: DriverEvent) {
        match &event {
            DriverEvent::Delta { session_id, message_id, seq, text } => {
                let sink = self.sink.lock().unwrap().clone();
                if let Some(sink) = sink {
                    sink(DeltaPayload {
                        session_id: session_id.clone(),
                        message_id: message_id.clone(),
                        seq: *seq,
                        text: text.clone(),
                    });
                }
            }
            DriverEvent::Ready { .. } => {
                self.deliver("ready", event);
            }
            DriverEvent::MessageDone { message_id, .. } | DriverEvent::MessageFailed { message_id, .. } => {
                let key = format!("msg:{message_id}");
                if !self.deliver(&key, event) {
                    eprintln!("dsh_driver: 无等待者的消息终态（{}）", key);
                }
            }
            DriverEvent::SessionStarted { session_id } => {
                self.deliver(&format!("session:{session_id}:start"), event);
            }
            DriverEvent::ReplayOk { session_id } => {
                self.deliver(&format!("session:{session_id}:replay"), event);
            }
            DriverEvent::SessionEnded { session_id } => {
                self.deliver(&format!("session:{session_id}:end"), event);
            }
            DriverEvent::Error { session_id, message_id, code, .. } => {
                let delivered = message_id
                    .as_ref()
                    .map(|mid| self.deliver(&format!("msg:{mid}"), event.clone()))
                    .unwrap_or(false)
                    || session_id
                        .as_ref()
                        .map(|sid| {
                            ["start", "replay", "end"]
                                .iter()
                                .any(|suffix| self.deliver(&format!("session:{sid}:{suffix}"), event.clone()))
                        })
                        .unwrap_or(false);
                if !delivered {
                    eprintln!("dsh_driver: 无等待者的错误事件（code={code}）");
                }
            }
        }
    }

    fn fail_all_pending(&self, reason: &str) {
        let mut pending = self.pending.lock().unwrap();
        for (_, tx) in pending.drain() {
            let _ = tx.send(DriverEvent::Error {
                session_id: None,
                message_id: None,
                code: "driver_died".to_string(),
                message: reason.to_string(),
            });
        }
    }

    fn mark_dead(&self) {
        let had_process = {
            let mut state = self.state.lock().unwrap();
            state.take().map(|mut live| {
                let _ = live.child.kill();
                let _ = live.child.wait();
            })
        };
        // 仅当确实有进程丢失时通知（幂等防重入）；前端据此进入恢复流程。
        if had_process.is_some() {
            let loss = self.loss_sink.lock().unwrap().clone();
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
    pub fn new() -> Self {
        DshDriverManager {
            inner: Arc::new(Inner {
                state: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                sink: Mutex::new(None),
                loss_sink: Mutex::new(None),
                spawn_lock: Mutex::new(()),
            }),
        }
    }

    /// 注册流式增量回调（Tauri 层转发为前端事件；测试可注入收集器）。
    pub fn set_sink(&self, sink: DeltaSink) {
        *self.inner.sink.lock().unwrap() = Some(sink);
    }

    /// 注册驱动进程丢失回调（崩溃或参数变化重启；前端据此触发历史重放恢复）。
    pub fn set_loss_sink(&self, sink: LossSink) {
        *self.inner.loss_sink.lock().unwrap() = Some(sink);
    }

    // ---- 进程生命周期（任务 3.1）----

    /// 确保驱动进程存活且以 `params` 启动。进程存活且参数一致时复用；
    /// 参数变化时优雅重启；进程已死时重新拉起。
    pub fn ensure_started(&self, params: &DriverParams, paths: &DshRuntimePaths) -> Result<(), GenerateAiError> {
        let _guard = self.inner.spawn_lock.lock().unwrap();
        {
            let mut state = self.inner.state.lock().unwrap();
            if let Some(live) = state.as_mut() {
                if live.is_alive() {
                    if live.params == *params {
                        return Ok(());
                    }
                    // 参数变化：优雅重启
                    live.graceful_stop();
                } else {
                    // 已退出：回收
                    let _ = live.child.wait();
                }
                *state = None;
            }
        }
        self.spawn_locked(params, paths)
    }

    fn spawn_locked(&self, params: &DriverParams, paths: &DshRuntimePaths) -> Result<(), GenerateAiError> {
        if !paths.driver_entry.exists() {
            return Err(service_error(
                "常驻驱动脚本缺失，请确认 sidecar/driver 目录完整",
            ));
        }
        if let Some(home) = &paths.dsh_home {
            std::fs::create_dir_all(home)
                .map_err(|e| service_error(format!("无法创建 DSH 运行目录: {e}")))?;
        }

        // 先注册 ready 等待者，再启动读线程，避免 ready 事件竞态丢失。
        let ready_rx = self.register("ready");

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
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("dsh-driver: {line}");
                }
            });
        }

        let inner = self.inner.clone();
        std::thread::spawn(move || reader_loop(inner, stdout));

        *self.inner.state.lock().unwrap() = Some(LiveProcess {
            child,
            stdin,
            params: params.clone(),
        });

        match ready_rx.recv_timeout(READY_TIMEOUT) {
            Ok(DriverEvent::Ready { protocol_version }) if protocol_version == PROTOCOL_VERSION => Ok(()),
            Ok(DriverEvent::Ready { protocol_version }) => {
                self.kill_current();
                self.unregister("ready");
                Err(service_error(format!(
                    "常驻驱动协议版本不匹配: {protocol_version}（期望 {PROTOCOL_VERSION}）"
                )))
            }
            Ok(_) => {
                self.unregister("ready");
                Ok(())
            }
            Err(_) => {
                self.unregister("ready");
                self.kill_current();
                Err(service_error("常驻驱动启动超时或意外退出"))
            }
        }
    }

    /// 优雅关闭（应用退出钩子调用）。尽力而为：先发 shutdown，超时强杀。
    pub fn shutdown_best_effort(&self) {
        let mut state = self.inner.state.lock().unwrap();
        if let Some(live) = state.as_mut() {
            live.graceful_stop();
        }
        *state = None;
    }

    fn kill_current(&self) {
        let mut state = self.inner.state.lock().unwrap();
        if let Some(mut live) = state.take() {
            let _ = live.child.kill();
            let _ = live.child.wait();
        }
    }

    // ---- 协议操作 ----

    fn register(&self, key: &str) -> std::sync::mpsc::Receiver<DriverEvent> {
        let (tx, rx) = channel();
        self.inner.pending.lock().unwrap().insert(key.to_string(), tx);
        rx
    }

    fn unregister(&self, key: &str) {
        self.inner.pending.lock().unwrap().remove(key);
    }

    fn write_command(&self, cmd: &DriverCommand) -> Result<(), GenerateAiError> {
        let mut line = serde_json::to_string(cmd)
            .map_err(|e| service_error(format!("协议序列化失败: {e}")))?;
        line.push('\n');
        let mut state = self.inner.state.lock().unwrap();
        let live = state.as_mut().ok_or_else(|| service_error("常驻驱动进程未启动"))?;
        live.write_line(&line)
            .map_err(|e| service_error(format!("向驱动写入命令失败: {e}")))
    }

    // ---- 会话操作（任务 3.2）----

    pub fn start_session(&self, session_id: &str) -> Result<(), GenerateAiError> {
        let rx = self.register(&format!("session:{session_id}:start"));
        if let Err(e) = self.write_command(&DriverCommand::StartSession { session_id: session_id.to_string() }) {
            self.unregister(&format!("session:{session_id}:start"));
            return Err(e);
        }
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::SessionStarted { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            Ok(_) => Ok(()),
            Err(_) => {
                self.unregister(&format!("session:{session_id}:start"));
                Err(timeout_error())
            }
        }
    }

    /// 发送消息并等待终态。流式增量经 sink 转发；返回最终全文。
    pub fn send_message_and_wait(
        &self,
        session_id: &str,
        message_id: &str,
        text: &str,
        timeout: Duration,
    ) -> Result<String, GenerateAiError> {
        let key = format!("msg:{message_id}");
        let rx = self.register(&key);
        let cmd = DriverCommand::SendMessage {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            text: text.to_string(),
        };
        if let Err(e) = self.write_command(&cmd) {
            self.unregister(&key);
            return Err(e);
        }
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                // 请求级超时：先取消，给宽限期回收终态（design.md D9）
                let _ = self.cancel_message(session_id, message_id);
                let outcome = rx.recv_timeout(CANCEL_GRACE);
                self.unregister(&key);
                return match outcome {
                    // 取消前恰好完成：仍算成功
                    Ok(DriverEvent::MessageDone { text, .. }) => Ok(text),
                    _ => Err(timeout_error()),
                };
            }
            match rx.recv_timeout(remaining) {
                Ok(DriverEvent::MessageDone { text, .. }) => {
                    self.unregister(&key);
                    return Ok(text);
                }
                Ok(DriverEvent::MessageFailed { code, .. }) => {
                    self.unregister(&key);
                    return Err(map_driver_failure(&code, ""));
                }
                Ok(DriverEvent::Error { code, message, .. }) => {
                    self.unregister(&key);
                    return Err(map_driver_failure(&code, &message));
                }
                Ok(_) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    self.unregister(&key);
                    return Err(service_error("驱动应答通道关闭"));
                }
            }
        }
    }

    /// 取消进行中的生成。进程未启动时为无操作（幂等）。
    pub fn cancel_message(&self, session_id: &str, message_id: &str) -> Result<(), GenerateAiError> {
        {
            let state = self.inner.state.lock().unwrap();
            if state.is_none() {
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
            let state = self.inner.state.lock().unwrap();
            if state.is_none() {
                return Ok(());
            }
        }
        let rx = self.register(&format!("session:{session_id}:end"));
        if self
            .write_command(&DriverCommand::EndSession { session_id: session_id.to_string() })
            .is_err()
        {
            self.unregister(&format!("session:{session_id}:end"));
            // 写失败多半是进程已死：会话随之消失，视为已结束
            return Ok(());
        }
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::SessionEnded { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            Ok(_) => Ok(()),
            Err(_) => {
                self.unregister(&format!("session:{session_id}:end"));
                Err(timeout_error())
            }
        }
    }

    /// 注入崩溃恢复历史（增量轮次）。需要进程存活（崩溃后由本方法前先 ensure_started）。
    pub fn replay_history(&self, session_id: &str, turns: Vec<DriverReplayTurn>) -> Result<(), GenerateAiError> {
        self.write_command(&DriverCommand::ReplayHistory { session_id: session_id.to_string(), turns })
    }

    /// 历史注入完成：驱动以 seed 建会话并确认。
    pub fn replay_done(&self, session_id: &str) -> Result<(), GenerateAiError> {
        let rx = self.register(&format!("session:{session_id}:replay"));
        if let Err(e) = self.write_command(&DriverCommand::ReplayDone { session_id: session_id.to_string() }) {
            self.unregister(&format!("session:{session_id}:replay"));
            return Err(e);
        }
        match rx.recv_timeout(SESSION_ACK_TIMEOUT) {
            Ok(DriverEvent::ReplayOk { .. }) => Ok(()),
            Ok(DriverEvent::Error { code, .. }) => Err(map_driver_failure(&code, "")),
            Ok(_) => Ok(()),
            Err(_) => {
                self.unregister(&format!("session:{session_id}:replay"));
                Err(timeout_error())
            }
        }
    }
}

fn reader_loop(inner: Arc<Inner>, stdout: std::process::ChildStdout) {
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
            Ok(event) => inner.route(event),
            Err(error) => eprintln!("dsh_driver: 无法解析的驱动帧: {error}"),
        }
    }
    // stdout EOF：驱动进程退出。所有等待中的请求立即失败。
    inner.fail_all_pending("驱动进程意外退出");
    inner.mark_dead();
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
            serde_json::to_value(DriverCommand::StartSession { session_id: "s".into() }).unwrap(),
            serde_json::to_value(DriverCommand::SendMessage {
                session_id: "s".into(),
                message_id: "m".into(),
                text: "t".into(),
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::ReplayHistory {
                session_id: "s".into(),
                turns: vec![DriverReplayTurn { role: "user".into(), text: "t".into() }],
            })
            .unwrap(),
            serde_json::to_value(DriverCommand::ReplayDone { session_id: "s".into() }).unwrap(),
            serde_json::to_value(DriverCommand::CancelMessage { session_id: "s".into(), message_id: "m".into() }).unwrap(),
            serde_json::to_value(DriverCommand::EndSession { session_id: "s".into() }).unwrap(),
            serde_json::to_value(DriverCommand::Shutdown).unwrap(),
        ];
        for value in commands {
            let text = value.to_string();
            for forbidden in ["draft_content", "main_content", "project_path", "file_path", "save"] {
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
            ("CONTEXT_WINDOW_EXCEEDED", GenerateAiErrorCode::RequestTooLarge),
            ("QUOTA", GenerateAiErrorCode::Service),
            ("busy", GenerateAiErrorCode::Service),
            ("internal", GenerateAiErrorCode::Service),
        ];
        for (code, expected) in cases {
            let err = map_driver_failure(code, "raw detail must not leak");
            assert_eq!(err.code, expected, "code={code}");
            assert!(!err.message.contains("raw detail"), "message 不得透传驱动原文");
        }
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
        assert!(matches!(failed, DriverEvent::MessageFailed { ref code, .. } if code == "cancelled"));
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
}
