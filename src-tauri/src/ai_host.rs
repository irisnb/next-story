//! AI 会话与驱动生命周期编排（审计 P2-1：自 `lib.rs` 纯移动拆出，行为零变化）。
//!
//! 职责：常驻会话就绪 / 取消 / 结束、崩溃恢复 replay 历史注入、驱动进程
//! 事件接线（流式增量与驱动丢失）与应用退出时的驱动关停。
//! 生成请求装配与调度接线见 [`crate::ai_orchestration`]。

use tauri::{Emitter, Manager};

use crate::llm_config::{self, GenerateAiResult};

// ========== 常驻 AI 会话命令（resident-ai-session 任务 3.4） ==========

/// 常驻会话：启动会话（同时懒启动驱动进程）。
#[tauri::command]
pub(crate) async fn ai_start_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_start_session_in_dir(&dir, resource_dir.as_deref(), session_id).await)
}

/// 常驻会话：取消进行中的生成（幂等）。
#[tauri::command]
pub(crate) async fn ai_cancel_message(
    session_id: String,
    message_id: String,
) -> Result<GenerateAiResult, String> {
    Ok(llm_config::ai_cancel_message_in_dir(session_id, message_id).await)
}

/// 常驻会话：结束会话（新建对话 / 切换作品；幂等）。
#[tauri::command]
pub(crate) async fn ai_end_session(session_id: String) -> Result<GenerateAiResult, String> {
    // 会话身份失效：工具路由与待决授权一并失败关闭（add-agent-on-demand-reading
    // 任务 5.3：迟到工具结果 / 授权决定被丢弃，不污染后续讨论）。
    crate::story_tool_channel::global_story_tool_channel().clear_session(&session_id);
    Ok(llm_config::ai_end_session_in_dir(session_id).await)
}

/// 用户对按需补读授权请求的决定（add-agent-on-demand-reading 任务 5.2）。
/// 允许：授权写入讨论档案并以工具结果 `{granted:true}` 回填，被暂停的轮次继续
/// 原问题；拒绝：回填 `{granted:false}`，模型基于既有材料有限回答。
/// 授权卡 UI 是任务组 7；本命令是接口层，可在无 UI 情况下被直接调用。
#[tauri::command]
pub(crate) async fn ai_resolve_reading_request(
    session_id: String,
    call_id: String,
    granted: bool,
) -> Result<GenerateAiResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::story_tool_channel::global_story_tool_channel().resolve_reading_request(
            &session_id,
            &call_id,
            granted,
        )
    })
    .await;
    match result {
        Ok(Ok(())) => Ok(llm_config::GenerateAiResult::success(String::new())),
        Ok(Err(message)) => Ok(llm_config::GenerateAiResult::failure(
            llm_config::GenerateAiError::new(llm_config::GenerateAiErrorCode::Service, message),
        )),
        Err(join_error) => Ok(llm_config::GenerateAiResult::failure(
            llm_config::GenerateAiError::new(
                llm_config::GenerateAiErrorCode::Service,
                format!("授权决定任务执行失败: {join_error}"),
            ),
        )),
    }
}

/// 常驻会话：注入崩溃恢复历史（前端显示历史的增量投影，不触发再生成）。
/// `origin` 为会话来源（直接提问 / 召唤），决定重放首轮按哪种入口语义组装提示词。
#[tauri::command]
pub(crate) async fn ai_replay_history(
    app: tauri::AppHandle,
    session_id: String,
    origin: llm_config::ReplayOrigin,
    turns: Vec<crate::dsh_driver::DriverReplayTurn>,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_replay_history_in_dir(
        &dir,
        resource_dir.as_deref(),
        session_id,
        origin,
        turns,
    )
    .await)
}

/// 常驻会话：历史注入完成确认。
#[tauri::command]
pub(crate) async fn ai_replay_done(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    Ok(llm_config::ai_replay_done_in_dir(&dir, resource_dir.as_deref(), session_id).await)
}

// ========== 驱动生命周期接线（resident-ai-session 任务 3.4 / 4.4） ==========

/// 常驻驱动事件接线：流式增量 → 前端 `ai-delta` 事件（resident-ai-session 任务 3.4）；
/// 驱动进程丢失（崩溃/重启）→ 前端 `ai-driver-lost` 恢复流程触发器（任务 4.4）；
/// 工具调用（add-agent-on-demand-reading 任务 5.2）→ 宿主执行通道 + 前端
/// `ai-tool-call` 轻量过程事件（呈现 UI 是任务组 7）。
pub(crate) fn install_driver_event_bridge(app: &tauri::AppHandle) {
    let handle = app.clone();
    crate::dsh_driver::global_driver_manager().set_sink(std::sync::Arc::new(move |payload| {
        let _ = handle.emit("ai-delta", &payload);
    }));
    let loss_handle = app.clone();
    crate::dsh_driver::global_driver_manager().set_loss_sink(std::sync::Arc::new(move || {
        let _ = loss_handle.emit("ai-driver-lost", ());
    }));

    // 工具调用通道（任务 5.2）：驱动 tool_call → 通道路由（执行 / 授权挂起）；
    // 授权请求 → 前端 `ai-reading-request` 事件（授权卡 UI 是任务组 7）。
    let channel = crate::story_tool_channel::global_story_tool_channel();
    channel.attach_driver(crate::dsh_driver::global_driver_manager().clone());
    // 停滞检测的授权等待探针（fix-long-context-freeze design D2）：等待用户
    // 按需补读授权决定的轮次无期限，不判停滞——探针从待决授权表接出。
    crate::dsh_driver::global_driver_manager().set_authorization_wait_probe(std::sync::Arc::new(
        |message_id: &str| {
            crate::story_tool_channel::global_story_tool_channel()
                .has_pending_authorization_for_message(message_id)
        },
    ));
    let tool_handle = app.clone();
    crate::dsh_driver::global_driver_manager().set_tool_call_sink(std::sync::Arc::new(
        move |payload| {
            let _ = tool_handle.emit("ai-tool-call", &payload);
            crate::story_tool_channel::global_story_tool_channel().handle_tool_call(payload);
        },
    ));
    let request_handle = app.clone();
    channel.set_reading_request_sink(std::sync::Arc::new(move |event| {
        let _ = request_handle.emit("ai-reading-request", &event);
    }));
}

/// 运行应用：应用退出时优雅关闭常驻驱动进程（design.md D3 生命周期表）。
pub(crate) fn run_app_with_driver_shutdown(app: tauri::App) {
    let driver_manager = crate::dsh_driver::global_driver_manager().clone();
    app.run(move |_app, event| {
        if let tauri::RunEvent::Exit = event {
            driver_manager.shutdown_best_effort();
        }
    });
}
