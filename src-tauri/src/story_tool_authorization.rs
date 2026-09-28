//! 按需补读授权流（fix-story-tool-channel-failures-and-split D3 自
//! story_tool_channel 拆分，纯移动；原 change add-agent-on-demand-reading
//! 任务 5.1/5.2，设计 D1/D2）：
//! - 待决授权表条目（挂起的 `story-request-reading` 调用；D1：恢复 = 工具结果
//!   返回）与面向前端的授权请求事件（`ai-reading-request`，只携带身份与模型
//!   提供的请求原因，不携带任何作品数据）。授权卡 UI 是任务组 7。
//! - 「等待授权」分支：授权请求无接收通道（装配降级，设计 D2-2）时不插入
//!   待决、不进入等待，立即回填结构化拒绝；有接收通道时登记待决并发事件，
//!   轮次挂起——不回填 tool_result、不产生模型请求，直到用户决定。
//! - 用户决定的决定回填（设计 D2-1）：granted → 写授权档案 + 回填
//!   `{granted: true}`；denied（或授权档案写入失败）→ 回填
//!   `{granted: false, recovery}`——拒绝是合法结果，模型继续有限回答，
//!   轮次不悬挂。
//!
//! 通道编排与接线（工具事件如何进入这些流程、结果如何进出驱动）在
//! `crate::story_tool_channel`（门面）；本模块经门面 re-export 对外。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::dsh_driver::{DshDriverManager, ToolCallPayload};
use crate::story_tool_channel::RECOVERY_READING_UNAUTHORIZED;
use crate::story_tools::grant_on_demand_reading;

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
pub(crate) struct PendingAuthorization {
    pub(crate) session_id: String,
    pub(crate) message_id: String,
    pub(crate) conversation_id: String,
    pub(crate) project_root: PathBuf,
}

/// 等待授权的工具结果处理（设计 D1，自 `story_tool_channel` 的
/// `ReadingRequested` 分支迁入，纯移动）：有接收通道时登记待决授权、构造授权
/// 请求事件发给前端，轮次挂起——不回填 tool_result、不产生模型请求，直到
/// 用户决定经 [`resolve_reading_request`] 回填继续。
pub(crate) fn suspend_waiting_for_authorization(
    driver: &DshDriverManager,
    pending: &Mutex<HashMap<String, PendingAuthorization>>,
    sink_slot: &Mutex<Option<ReadingRequestSink>>,
    payload: &ToolCallPayload,
    conversation_id: &str,
    project_root: &Path,
    reason: &str,
) {
    // 授权请求无接收通道（装配降级路径，设计 D2-2）：请求无法
    // 呈现给用户，等待永远不会被决定——不插入待决、不进入等待，
    // 立即回填结构化拒绝（与用户拒绝同构：拒绝是合法结果，模型
    // 继续有限回答，轮次不悬挂）。
    let sink = lock(sink_slot).clone();
    let Some(sink) = sink else {
        eprintln!(
            "story_tool_channel: 授权请求无接收通道（装配缺失），已立即回填未授权拒绝（conversation={}）",
            conversation_id
        );
        let result = serde_json::json!({
            "granted": false,
            "recovery": RECOVERY_READING_UNAUTHORIZED,
        });
        let _ = driver.send_tool_result(
            &payload.session_id,
            &payload.message_id,
            &payload.call_id,
            true,
            Some(result),
            None,
            None,
        );
        return;
    };
    lock(pending).insert(
        payload.call_id.clone(),
        PendingAuthorization {
            session_id: payload.session_id.clone(),
            message_id: payload.message_id.clone(),
            conversation_id: conversation_id.to_string(),
            project_root: project_root.to_path_buf(),
        },
    );
    let event = ReadingRequestEvent {
        session_id: payload.session_id.clone(),
        message_id: payload.message_id.clone(),
        call_id: payload.call_id.clone(),
        conversation_id: conversation_id.to_string(),
        reason: reason.to_string(),
    };
    sink(event);
}

/// 用户对授权请求的决定（任务 5.2；前端命令 `ai_resolve_reading_request`
/// 或测试注入；自 `StoryToolChannel::resolve_reading_request` 迁入，纯移动）。
/// granted → 写授权档案 + 回填 `{granted: true}`；
/// denied → 回填 `{granted: false, recovery}`（拒绝是合法结果，模型继续有限
/// 回答；恢复路径提示与未授权系拒绝同一常量，design D5——用户可在讨论面板
/// 主动开启，新问题可再请求）。granted 但授权档案写入失败 → 仍回填
/// `{granted: false, recovery}`（与用户拒绝同构：轮次不悬挂、继续有限
/// 回答），随后把写入错误如实返回前端（fix-story-tool-channel-failures-
/// and-split 设计 D2-1，不伪造授权成功）。
///
/// 迟到 / 未知 call_id、会话身份不符：失败关闭，不动档案。
/// 授权属于讨论：即使原轮已被取消，granted 仍写入档案（后续轮次生效），
/// 只有工具结果被驱动丢弃。
pub(crate) fn resolve_reading_request(
    driver: &DshDriverManager,
    pending: &Mutex<HashMap<String, PendingAuthorization>>,
    session_id: &str,
    call_id: &str,
    granted: bool,
) -> Result<(), String> {
    let request = {
        let pending = lock(pending);
        let Some(request) = pending.get(call_id) else {
            return Err("没有该身份的待决授权请求".to_string());
        };
        if request.session_id != session_id {
            return Err("授权请求身份不符".to_string());
        }
        request.clone()
    };
    lock(pending).remove(call_id);

    // 授权档案写入失败（设计 D2-1）：仍先向驱动回填结构化拒绝（与用户拒绝
    // 同构——拒绝是合法结果，模型继续有限回答，轮次不悬挂）；回填完成后把
    // 原错误如实返回前端（界面提示授权未能保存，不伪造授权成功）。
    let granted = if granted {
        match grant_on_demand_reading(&request.project_root, &request.conversation_id) {
            Ok(()) => true,
            Err(error) => {
                let result = serde_json::json!({
                    "granted": false,
                    "recovery": RECOVERY_READING_UNAUTHORIZED,
                });
                let _ = driver.send_tool_result(
                    &request.session_id,
                    &request.message_id,
                    call_id,
                    true,
                    Some(result),
                    None,
                    None,
                );
                return Err(error.to_string());
            }
        }
    } else {
        false
    };
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

/// 恢复式取锁（与 dsh_driver 一致：中毒后取内部数据，不连锁 panic）。
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation_store::{read_conversation, seed_conversation as save_archive};
    use crate::story_tool_channel::tests::{
        archive, fake_driver, notebook_with_text, request_bridge_driver, setup_work_with_doc,
        wire_channel,
    };
    use std::time::Duration;

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

    /// fix-story-tool-channel-failures-and-split 任务 1.1：用户允许但授权档案写入
    /// 失败——驱动仍收到结构化拒绝（granted:false＋恢复提示，与用户拒绝同构），
    /// 轮次走有限回答立即收束（不悬挂等待停滞看护）；resolve 如实返回 Err；
    /// 授权档案未被伪造。写入失败用删除档案文件制造（存储层对缺失档案返回
    /// NotFound）。
    #[test]
    fn grant_write_failure_backfills_denial_and_round_finishes() {
        let temp = tempfile::TempDir::new().expect("temp dir");
        let (root, _doc_id) =
            setup_work_with_doc(&temp, "授权写失败作品", &notebook_with_text("正文"));
        save_archive(&root, &archive("conv-write-fail", None)).expect("save archive");

        let (_driver_temp, paths, params) = fake_driver(&request_bridge_driver());
        let (manager, channel, _guard) = wire_channel();
        manager.ensure_started(&params, &paths).expect("驱动启动");
        manager.start_session("s1").expect("start session");
        channel.register_round("s1", "conv-write-fail", root.clone(), false);
        let events = Arc::new(Mutex::new(Vec::<ReadingRequestEvent>::new()));
        let events_for_sink = events.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events_for_sink.lock().unwrap().push(event);
        }));

        let manager_for_send = manager.clone();
        let send = std::thread::spawn(move || {
            manager_for_send.send_message_and_wait("s1", "m1", "问题", Duration::from_secs(10))
        });
        std::thread::sleep(Duration::from_millis(1500));
        assert_eq!(events.lock().unwrap().len(), 1, "授权请求已挂起");

        // 制造授权档案写入失败：删除档案文件（授权无处可写）。
        let archive_path = root
            .join("next-story-system")
            .join("conversations")
            .join("conv-write-fail.json");
        std::fs::remove_file(&archive_path).expect("remove archive");

        // 用户允许 → 写入失败：resolve 返回 Err，但驱动已收到结构化拒绝。
        let resolved = channel.resolve_reading_request("s1", "call-1", true);
        assert!(resolved.is_err(), "写入失败必须如实返回错误: {resolved:?}");

        // 轮次经拒绝回填立即收束为有限回答（10 秒请求超时内，不依赖停滞看护——
        // 回填若未生效，这里会超时响亮失败）。
        let outcome = send
            .join()
            .expect("send 线程")
            .expect("写入失败后轮次仍应经拒绝回填收束");
        assert!(
            outcome.text.starts_with("未获授权，有限回答"),
            "写入失败按未授权回填，模型转有限回答: {}",
            outcome.text
        );
        assert!(
            outcome.text.contains(RECOVERY_READING_UNAUTHORIZED),
            "写入失败的拒绝回填应携带恢复路径提示: {}",
            outcome.text
        );

        // 授权未被伪造：档案文件仍不存在。
        assert!(!archive_path.exists(), "授权档案不得在写入失败后被伪造重建");

        manager.shutdown_best_effort();
    }
}
