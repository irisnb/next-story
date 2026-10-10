//! 制作模块·试问机制（change: add-making-module-core 任务组 6，design D5 方案二）。
//!
//! 试问＝走**真实日常陪想管线**的单轮常规轮次：story 种类驱动会话＋日常信封
//! （[`session_system_prompt`] 纯常量，逐字同源）＋常规取材（试用作品＋关注文档，
//! 已保存正文口径，镜像 `ai_send_message` 的作品状态解析）＋按需补读授权照旧。
//! 与日常轮的差别只有三点：
//!
//! 1. **不产生讨论档案**（方案二单一真相源）：不经 `conversation_save`、不写
//!    任何作品讨论目录字段（provenance / 授权 / 链路记录均不写）——问答全文
//!    只存全局侧 `making-module/trials/<id>.json` 的 [`TrialRecord`]，跟链路
//!    走；因无档案而天然不进日常会话列表。本模块结构上不引用
//!    `conversation_store` 的任何保存路径（零讨论档案写入由结构保证）。
//! 2. **卡文本用所试版本**：直接取 `chain_id + version_id` 的卡（不走 `active`
//!    指针、不切全局链路）；`with_card=false` 为对照轮（不带卡）。
//! 3. **补读授权在试问区呈现且不持久化**：授权请求经 `trial-authorization-request`
//!    事件发出（载荷 `{trial_id, reason}`），应答经 `trial_authorization_respond`；
//!    决定只存内存（试问会话生命周期，见 `story_tool_channel` 的 grant 源），
//!    绝不写入任何讨论档案；挂起轮不设时限（对齐日常授权等待豁免）。
//!
//! 流式增量经 `trial-message-event` 事件呈现；试问单轮：完成即 end_session、
//! 清工具路由（不可追问，想继续＝新试问）。并发：走
//! [`DshDriverManager::send_message_with_cards_and_wait`] 即进入既有全局同时
//! 生成上限准入。崩溃 / 失败：在途轮如实记录终态（failed / cancelled），
//! 不自动重发。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::chain_library::{
    is_safe_id_component, load_trial_record, making_module_dir_in, save_trial_record,
    trial_record_exists, trials_dir_in, ChainLibraryStore, TrialListResult, TrialRecord, TrialRef,
    TrialStatus,
};
use crate::dsh_driver::{
    next_id, DriverParams, DshDriverManager, MessageOutcome, SessionKind, REQUEST_TIMEOUT,
};
use crate::dsh_version::DshVersionLayout;
use crate::llm_config::{
    app_data_dir_failure_result, load_llm_config, session_system_prompt, validate_llm_config,
    GenerateAiError, GenerateAiErrorCode, GenerateAiResult, LlmConfig,
};
use crate::project::ProjectLocks;

// ========== 试问身份与驱动会话 id ==========

/// 试问证据 id 的固定前缀：工具路由按此前缀识别试问身份（授权旁路、出处
/// 跳档），前端生成的试问 id **必须**携带此前缀（后端校验拒绝无前缀 id）。
pub const TRIAL_ID_PREFIX: &str = "trial-";

/// 试问车道在驱动会话 id 上的保留前缀：试问会话的驱动 id 一律为
/// `trial-<试问 id>-<进程内序号>`（试问 id 自带 `trial-` 前缀，故呈
/// `trial-trial-…-<序号>` 双前缀形态）——增量事件分发的判据，且与日常 /
/// 制作会话 id 永不碰撞。
pub const TRIAL_DRIVER_SESSION_PREFIX: &str = "trial-";

/// 会话身份（工具路由的 discussion 槽位）是否属于试问车道。
pub fn is_trial_conversation(conversation_id: &str) -> bool {
    conversation_id.starts_with(TRIAL_ID_PREFIX)
}

/// 驱动会话 id 是否属于试问车道；是则返回其试问 id 部分（剥前缀与序号后缀）。
fn trial_id_of_driver_session(session_id: &str) -> Option<&str> {
    let rest = session_id.strip_prefix(TRIAL_DRIVER_SESSION_PREFIX)?;
    let cut = rest.rfind('-')?;
    Some(&rest[..cut])
}

// ========== 试问会话注册表（进程内，镜像 making_session 形态） ==========

/// 试问会话注册表（AppState 单例）：试问 id → 当前驱动会话 id。兼作「同试问
/// 不可重复轮次」的在场守卫；轮次终态（含失败 / 取消）即除名。驱动重启后
/// 条目失效——试问单轮不重放（不自动重发），残条目经 `trial_cancel_message`
/// 或新试问自然绕开。
#[derive(Clone, Default)]
pub struct TrialSessionRegistry {
    inner: Arc<Mutex<HashMap<String, String>>>,
}

impl TrialSessionRegistry {
    fn locked(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// ========== 前端事件（任务 6.5 / 锁定契约） ==========

/// 试问流式增量事件名（载荷与 `ai-delta` 同构，`trial_id` 已剥驱动前缀）。
pub const TRIAL_MESSAGE_EVENT: &str = "trial-message-event";

/// 试问按需补读授权请求事件名（载荷 `{trial_id, reason}`，不携带任何作品数据）。
pub const TRIAL_AUTHORIZATION_EVENT: &str = "trial-authorization-request";

/// `trial-message-event` 载荷（锁定契约形状）。
#[derive(Clone, Debug, Serialize)]
pub struct TrialMessageEvent {
    pub trial_id: String,
    pub message_id: String,
    pub seq: u64,
    pub text: String,
}

/// `trial-authorization-request` 载荷（锁定契约形状）。
#[derive(Clone, Debug, Serialize)]
pub struct TrialAuthorizationEvent {
    pub trial_id: String,
    pub reason: String,
}

/// 试问事件桥（lib.rs setup 内安装，**必须**在 `install_driver_event_bridge` 与
/// `install_making_event_bridge` 之后）：
/// - 流式增量：替换式 sink 全量分发——`trial-` 前缀会话改发
///   [`TRIAL_MESSAGE_EVENT`]；`making-` 前缀维持 `making-message-event`（解析
///   与 `install_making_event_bridge` 同构，两处须同步维护）；其余（日常会话）
///   保持 `ai-delta` 事件名与载荷逐字不变。
/// - 授权请求：包装既有 sink（ai_host 安装的 `ai-reading-request` 转发）——
///   试问身份改发 [`TRIAL_AUTHORIZATION_EVENT`]，其余委托旧回调（日常零变化）。
pub(crate) fn install_trial_event_bridge(app: &tauri::AppHandle) {
    let handle = app.clone();
    crate::dsh_driver::global_driver_manager().set_sink(Arc::new(move |payload| {
        if let Some(trial_id) = trial_id_of_driver_session(&payload.session_id) {
            let _ = handle.emit(
                TRIAL_MESSAGE_EVENT,
                &TrialMessageEvent {
                    trial_id: trial_id.to_string(),
                    message_id: payload.message_id.clone(),
                    seq: payload.seq,
                    text: payload.text.clone(),
                },
            );
        } else if let Some(making_id) =
            making_conversation_id_of_driver_session(&payload.session_id)
        {
            let _ = handle.emit(
                crate::making_session::MAKING_MESSAGE_EVENT,
                &crate::dsh_driver::DeltaPayload {
                    session_id: making_id.to_string(),
                    message_id: payload.message_id.clone(),
                    seq: payload.seq,
                    text: payload.text.clone(),
                },
            );
        } else {
            let _ = handle.emit("ai-delta", &payload);
        }
    }));

    let channel = crate::story_tool_channel::global_story_tool_channel();
    let previous = channel.take_reading_request_sink();
    let request_handle = app.clone();
    channel.set_reading_request_sink(Arc::new(move |event| {
        if is_trial_conversation(&event.conversation_id) {
            let _ = request_handle.emit(
                TRIAL_AUTHORIZATION_EVENT,
                &TrialAuthorizationEvent {
                    trial_id: event.conversation_id.clone(),
                    reason: event.reason.clone(),
                },
            );
        } else if let Some(previous) = previous.as_ref() {
            previous(event);
        }
    }));
}

/// 与 `making_session::making_conversation_id_of_driver_session` 同构的制作会话
/// id 解析（试问分发 sink 的兜底分支用；该函数在 making_session 私有，此处
/// 复制实现——两处须同步维护）。
fn making_conversation_id_of_driver_session(session_id: &str) -> Option<&str> {
    let rest = session_id.strip_prefix(crate::making_session::MAKING_DRIVER_SESSION_PREFIX)?;
    let cut = rest.rfind('-')?;
    Some(&rest[..cut])
}

// ========== 发起前解析（链路 / 作品环境 / user 文本） ==========

/// 发起前解析的所试链路版本快照（链路库读取；不走 `active` 指针）。
pub(crate) struct ResolvedTrialChain {
    pub chain_name: String,
    pub version_index: u32,
    pub cards: Vec<crate::chain_library::RequirementCard>,
}

/// 解析所试链路版本（阻塞，链路库锁内经 `store.load`）：链路或版本不存在时
/// 明确报错（防悬空指针）；不读、不动 `active` 指针（试问不切全局链路）。
pub(crate) fn resolve_trial_chain(
    store: &ChainLibraryStore,
    chain_id: &str,
    version_id: &str,
) -> Result<ResolvedTrialChain, crate::chain_library::ChainLibraryError> {
    let library = store.load()?;
    let chain = library
        .chains
        .iter()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| crate::chain_library::ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    let version = chain
        .versions
        .iter()
        .find(|version| version.id == version_id)
        .ok_or_else(
            || crate::chain_library::ChainLibraryError::VersionNotFound {
                chain_id: chain_id.to_string(),
                version_id: version_id.to_string(),
            },
        )?;
    Ok(ResolvedTrialChain {
        chain_name: chain.name.clone(),
        version_index: version.index,
        cards: version.cards.clone(),
    })
}

/// 试用环境（作品锁内解析）：作品名快照＋关注文档标题快照＋常规取材语境。
pub(crate) struct TrialEnvironment {
    pub work_title: String,
    pub focus_document_title: Option<String>,
    /// 注入 user 文本的取材语境（无关注文档时为 `None`）。
    pub context_text: Option<String>,
}

// 以下三条固定文案与 ai_orchestration 的私有错误函数逐字一致（该模块按任务
// 边界不可复用导出）；试问镜像同一文案，防两处漂移靠测试钉住关键句。

/// 取材锁不可得（镜像 ai_orchestration::context_lock_unavailable_error）。
fn trial_lock_unavailable_error() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::Service,
        "作品读取暂时不可用，本次请求未发送。",
    )
}

/// 作品待恢复事务现场（镜像 ai_orchestration::story_recovery_required_error）。
fn story_recovery_required_error() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::StoryRecoveryRequired,
        "作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。",
    )
}

/// 关注文档取材失败（镜像 ai_orchestration::invalid_story_context_error）。
fn invalid_focus_document_error() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::InvalidResponse,
        "关注文档不可用，本次请求未发送。",
    )
}

/// 作品打开失败（试问专用固定文案：不泄露路径或正文）。
fn work_open_failed_error() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::InvalidResponse,
        "试用作品无法打开，本次请求未发送。",
    )
}

/// 在作品锁保护下解析试用环境并完成常规取材（镜像 `ai_send_message` 的
/// 作品状态解析：锁失败→失败关闭；待恢复事务→专用码；材料拒绝→固定文案）。
/// 试问无选区授权（无选区）；关注文档按**已保存正文**口径取材（版本 / 快照
/// 恒 `None`——试问自制作页发起，不在编辑现场）。
pub(crate) fn assemble_trial_environment(
    locks: &ProjectLocks,
    work_root: &Path,
    focus_document_id: Option<&str>,
    question: &str,
) -> Result<TrialEnvironment, GenerateAiError> {
    let _guard = locks
        .acquire(work_root)
        .map_err(|_| trial_lock_unavailable_error())?;
    let opened = crate::project::open_existing_project(work_root).map_err(|error| {
        if matches!(error, crate::project::ProjectError::RecoveryRequired) {
            story_recovery_required_error()
        } else {
            work_open_failed_error()
        }
    })?;
    let focus_document_title = focus_document_id
        .and_then(|id| opened.tree.nodes.get(id))
        .map(|node| node.name.clone());
    let context_text = match focus_document_id {
        Some(document_id) => {
            match crate::project::assemble_round_context(
                work_root,
                document_id,
                None,
                None,
                question,
            ) {
                Ok(context) => Some(context.context_text),
                Err(denial) => {
                    return Err(
                        if matches!(
                            denial.reason,
                            crate::project::MaterialDenialReason::RecoveryRequired
                        ) {
                            story_recovery_required_error()
                        } else {
                            invalid_focus_document_error()
                        },
                    )
                }
            }
        }
        None => None,
    };
    Ok(TrialEnvironment {
        work_title: opened.metadata.name,
        focus_document_title,
        context_text,
    })
}

/// 组装试问首 user 文本（镜像日常 First 形态）：DirectQuestion 提示前缀＋问题
/// （无选区）＋取材语境块。前缀经 generate.rs 公开入口 `build_task_string`
/// 组装（与日常同一单一来源，无第二副本）；语境块追加方式与常驻链
/// `compose_message_text`（私有）一致：trim 非空时以空行拼接。
pub(crate) fn compose_trial_user_text(
    question: &str,
    context: Option<&str>,
) -> Result<String, GenerateAiError> {
    let request = crate::llm_config::GenerateAiRequest::DirectQuestion {
        question: question.to_string(),
        selected_text: None,
        document_id: None,
        project_path: None,
        document_version: None,
        snapshot: None,
        selection_from: None,
        selection_to: None,
    };
    let mut text = crate::llm_config::generate::build_task_string(&request)?;
    if let Some(context) = context.map(str::trim).filter(|c| !c.is_empty()) {
        text.push_str("\n\n");
        text.push_str(context);
    }
    Ok(text)
}

// ========== 试问轮发送核心（阻塞线程内执行） ==========

/// 试问单轮发送核心：注册工具路由（试问身份，hard_gate=false——补读授权照旧
/// 呈现）→ 懒建 story 种类驱动会话（`start_session_with_kind` 以
/// [`session_system_prompt`] 常量信封显式建立，与日常逐字同源）→ 发送并等待
/// 终态 → **无论终态如何**都结束会话＋注册表除名＋清工具路由（试问单轮，
/// 不可追问；迟到授权与轮内监管状态一并作废）。
///
/// `cards_text` / `posture`（add-posture-slot 任务 2.3）：带卡轮按卡类型分流的
/// 要求卡文本与姿态段文本（同一版本快照产出，同源）；对照轮两者皆 `None`
/// （线缆上省略字段，与无链路现状逐字节一致）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn send_trial_round_blocking(
    manager: &DshDriverManager,
    channel: &crate::story_tool_channel::StoryToolChannel,
    registry: &TrialSessionRegistry,
    trial_id: &str,
    work_root: &Path,
    message_id: &str,
    user_text: &str,
    cards_text: Option<&str>,
    posture: Option<&str>,
) -> Result<MessageOutcome, GenerateAiError> {
    {
        let sessions = registry.locked();
        if sessions.contains_key(trial_id) {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::ConversationBusy,
                "该试问已有进行中的轮次，请等待完成或先停止",
            ));
        }
    }
    let driver_session_id = format!("{TRIAL_DRIVER_SESSION_PREFIX}{trial_id}-{}", next_id());
    channel.register_round(&driver_session_id, trial_id, work_root.to_path_buf(), false);
    registry
        .locked()
        .insert(trial_id.to_string(), driver_session_id.clone());
    let result = (|| {
        // story 种类＋日常常量信封（试问走真实日常陪想管线，story 工具四件套
        // 照常注册给模型）。
        manager.start_session_with_kind(
            &driver_session_id,
            &session_system_prompt(),
            SessionKind::Story,
        )?;
        manager.send_message_with_cards_and_wait(
            &driver_session_id,
            message_id,
            user_text,
            cards_text,
            posture,
            REQUEST_TIMEOUT,
        )
    })();
    let _ = manager.end_session(&driver_session_id);
    registry.locked().remove(trial_id);
    channel.clear_session(&driver_session_id);
    result
}

/// 失败错误 → 试问终态：取消识别依赖既有稳定契约文案（驱动取消码经
/// `map_driver_failure` 固定映射为 `Timeout` +「生成已取消」）。
fn terminal_status_of(error: &GenerateAiError) -> TrialStatus {
    if error.code == GenerateAiErrorCode::Timeout && error.message == "生成已取消" {
        TrialStatus::Cancelled
    } else {
        TrialStatus::Failed
    }
}

/// 试问轮完整入参（阻塞核心的聚合参数；命令层组装）。
pub(crate) struct TrialRoundInput {
    pub trial_id: String,
    pub chain_id: String,
    pub version_id: String,
    pub with_card: bool,
    pub question: String,
    pub work_root: PathBuf,
    pub focus_document_id: Option<String>,
}

/// 试问轮完整核心（阻塞线程内执行；命令层只做配置加载与线程调度）：
/// 入参校验 → 链路解析（所试版本，不走 active）→ 试用环境＋常规取材（作品
/// 锁内）→ user 文本组装 → 落 pending 证据＋版本引用（失败＝本轮未发送）→
/// 发送至终态 → 终态更新证据（success 存全文；failed / cancelled 如实记录，
/// 不自动重发）。返回 `GenerateAiResult`（成功时携带回复全文与
/// `chain_round`，仅带卡轮）。
pub(crate) fn run_trial_round_blocking(
    manager: &DshDriverManager,
    channel: &crate::story_tool_channel::StoryToolChannel,
    registry: &TrialSessionRegistry,
    store: &ChainLibraryStore,
    locks: &ProjectLocks,
    trials_dir: &Path,
    input: &TrialRoundInput,
) -> GenerateAiResult {
    let invalid = |message: &str| {
        GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            message,
        ))
    };
    let service = |message: String| {
        GenerateAiResult::failure(GenerateAiError::new(GenerateAiErrorCode::Service, message))
    };

    // 入参校验：问题非空；试问编号带 trial- 前缀（工具路由的身份判据）且是
    // 安全文件名分量；同编号证据不可覆盖（证据一经产生即不可变）。
    if input.question.trim().is_empty() {
        return invalid("试问问题不能为空，请填写后再发起");
    }
    if !is_trial_conversation(&input.trial_id) || !is_safe_id_component(&input.trial_id) {
        return invalid("试问编号无效：必须以 trial- 开头，且不得包含路径分隔符或控制字符");
    }
    if trial_record_exists(trials_dir, &input.trial_id) {
        return invalid("该试问编号已有证据，不可覆盖；请以新编号重新发起");
    }
    if registry.locked().contains_key(&input.trial_id) {
        return GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::ConversationBusy,
            "该试问已有进行中的轮次，请等待完成或先停止",
        ));
    }

    // 链路解析（所试版本；不走 active 指针，不切全局链路）。
    let resolved = match resolve_trial_chain(store, &input.chain_id, &input.version_id) {
        Ok(resolved) => resolved,
        Err(error) => return service(format!("试问发起失败：{error}")),
    };

    // 试用环境＋常规取材（镜像 ai_send_message 的作品状态解析与固定文案）。
    let environment = match assemble_trial_environment(
        locks,
        &input.work_root,
        input.focus_document_id.as_deref(),
        &input.question,
    ) {
        Ok(environment) => environment,
        Err(error) => return GenerateAiResult::failure(error),
    };

    // 首 user 文本（镜像日常 First 形态：DirectQuestion 前缀＋问题＋语境块）。
    let user_text =
        match compose_trial_user_text(&input.question, environment.context_text.as_deref()) {
            Ok(text) => text,
            Err(error) => return GenerateAiResult::failure(error),
        };

    // 卡文本（add-posture-slot 任务 2.3 分流；2026-10-07 修订 7.2 多姿态卡）：
    // 带卡轮按 slot_type 分流——要求卡经 `assemble_chain_cards`（纯姿态版本无
    // 要求卡时 `chain_cards` 恒省略字段）、全部姿态卡一并经 `assemble_posture`
    // 渲染（承接句一次、依序拼接，不调和）；两字段同一版本快照产出（同源）。
    // 对照轮两字段皆 None（线缆上省略，与无链路现状逐字节一致）。
    let requirement_cards: Vec<crate::chain_library::RequirementCard> = resolved
        .cards
        .iter()
        .filter(|card| card.slot_type != crate::chain_library::SLOT_TYPE_POSTURE)
        .cloned()
        .collect();
    let posture_cards: Vec<crate::chain_library::RequirementCard> = resolved
        .cards
        .iter()
        .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
        .cloned()
        .collect();
    let (cards_text, posture_text) = if input.with_card {
        (
            (!requirement_cards.is_empty())
                .then(|| crate::llm_config::generate::assemble_chain_cards(&requirement_cards)),
            (!posture_cards.is_empty())
                .then(|| crate::llm_config::generate::assemble_posture(&posture_cards)),
        )
    } else {
        (None, None)
    };

    // 证据落盘（pending）＋版本引用：失败＝本轮未发送（证据是试问的目的，
    // 不静默继续）。
    let mut record = TrialRecord {
        id: input.trial_id.clone(),
        chain_id: input.chain_id.clone(),
        chain_name: resolved.chain_name.clone(),
        version_id: input.version_id.clone(),
        version_index: resolved.version_index,
        with_card: input.with_card,
        question: input.question.clone(),
        reply_text: String::new(),
        status: TrialStatus::Pending,
        created_at: Utc::now(),
        work_title: environment.work_title,
        focus_document_id: input.focus_document_id.clone(),
        focus_document_title: environment.focus_document_title,
        feedback: None,
    };
    let evidence = (|| -> Result<(), crate::chain_library::ChainLibraryError> {
        save_trial_record(trials_dir, &record)?;
        store.append_trial_ref(
            &input.chain_id,
            &input.version_id,
            TrialRef {
                trial_id: record.id.clone(),
                created_at: record.created_at,
                with_card: record.with_card,
            },
        )
    })();
    if let Err(error) = evidence {
        return service(format!("试问证据保存失败，本次未发送：{error}"));
    }

    // 发送至终态（阻塞；单轮）。
    let message_id = format!("trial-msg-{}", next_id());
    let outcome = send_trial_round_blocking(
        manager,
        channel,
        registry,
        &input.trial_id,
        &input.work_root,
        &message_id,
        &user_text,
        cards_text.as_deref(),
        posture_text.as_deref(),
    );

    // 终态更新证据（不自动重发）。
    match outcome {
        Ok(outcome) => {
            record.status = TrialStatus::Success;
            record.reply_text = outcome.text.clone();
            if let Err(error) = save_trial_record(trials_dir, &record) {
                return service(format!("试问已完成，但证据保存失败：{error}"));
            }
            let mut result = GenerateAiResult::success(outcome.text);
            result.sent_confirmed = Some(outcome.sent_confirmed);
            // 带卡轮携带链路轮次快照（对照轮无卡，不携带）；试问单轮 turn_index=0。
            if input.with_card {
                result.chain_round = Some(crate::conversation_store::ChainRoundRecord {
                    turn_index: 0,
                    chain_id: input.chain_id.clone(),
                    chain_name: resolved.chain_name,
                    version_index: resolved.version_index,
                });
            }
            result
        }
        Err(error) => {
            record.status = terminal_status_of(&error);
            if let Err(write_error) = save_trial_record(trials_dir, &record) {
                eprintln!(
                    "试问 {} 终态证据保存失败（状态 {:?}）: {write_error}",
                    input.trial_id, record.status
                );
            }
            GenerateAiResult::failure(error)
        }
    }
}

// ========== 证据查询与反馈（阻塞核心） ==========

/// 按版本列出试问证据（`created_at` 倒序）：引用来自链路库版本档案；引用所指
/// 文件缺失 / 损坏时跳过并如实记 stderr（不中断列表，不静默谎报成功——
/// 列表形状为锁定契约，无 skipped 字段）。
pub(crate) fn list_trials_for_version_blocking(
    store: &ChainLibraryStore,
    trials_dir: &Path,
    chain_id: &str,
    version_id: &str,
) -> Result<TrialListResult, crate::chain_library::ChainLibraryError> {
    let library = store.load()?;
    let chain = library
        .chains
        .iter()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| crate::chain_library::ChainLibraryError::ChainNotFound {
            chain_id: chain_id.to_string(),
        })?;
    let version = chain
        .versions
        .iter()
        .find(|version| version.id == version_id)
        .ok_or_else(
            || crate::chain_library::ChainLibraryError::VersionNotFound {
                chain_id: chain_id.to_string(),
                version_id: version_id.to_string(),
            },
        )?;
    let mut references = version.trials.clone();
    references.sort_by_key(|reference| std::cmp::Reverse(reference.created_at));
    let mut trials = Vec::new();
    for reference in references {
        match load_trial_record(trials_dir, &reference.trial_id) {
            Ok(record) => trials.push(record),
            Err(error) => eprintln!(
                "试问 {} 的证据读取失败，已从版本列表跳过: {error}",
                reference.trial_id
            ),
        }
    }
    Ok(TrialListResult { trials })
}

/// 补写 / 清除用户反馈（空白＝清除）；返回更新后的记录。
pub(crate) fn set_trial_feedback_blocking(
    trials_dir: &Path,
    trial_id: &str,
    feedback: &str,
) -> Result<TrialRecord, crate::chain_library::ChainLibraryError> {
    let mut record = load_trial_record(trials_dir, trial_id)?;
    let trimmed = feedback.trim();
    record.feedback = (!trimmed.is_empty()).then(|| trimmed.to_string());
    save_trial_record(trials_dir, &record)?;
    Ok(record)
}

// ========== 配置与驱动懒启动（自建调用链，镜像 making_session 现有写法） ==========

fn versioned_dsh_home(base_dir: &Path) -> PathBuf {
    DshVersionLayout::new(base_dir.join("dsh")).current_home()
}

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

// ========== Tauri 命令（任务 6.1–6.5；锁定契约） ==========

/// 解析应用本地数据目录 → `making-module/trials/`（不可得时明确报错）。
fn trials_dir_from_app(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| trials_dir_in(&making_module_dir_in(&dir)))
        .map_err(|e| format!("无法访问应用本地数据目录: {e}"))
}

/// 试问：发起一轮真实日常陪想管线试用（阻塞至轮次终态；`content`＝回复全文）。
/// 卡文本用所试版本（不走 active 指针、不切全局链路）；`with_card=false` 为
/// 对照轮。试问不产生讨论档案；问答全文只存 `trials/<id>.json`。
/// `work_path` 为**增补参数**（锁定契约未列，见 change 报告）：试用作品路径，
/// 由前端以当前打开作品传入——后端无从自行得知「当前作品」，而 TrialRecord
/// 需要作品名快照。
// 参数超限定点豁免：Tauri 命令入参与前端调用面一一对应（对齐 ai_send_message
// 的同类豁免），结构性收拢不在本任务范围。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn trial_send_message(
    app: tauri::AppHandle,
    trial_id: String,
    chain_id: String,
    version_id: String,
    with_card: bool,
    question: String,
    focus_document_id: Option<String>,
    work_path: Option<String>,
) -> Result<GenerateAiResult, String> {
    if question.trim().is_empty() {
        return Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "试问问题不能为空，请填写后再发起",
        )));
    }
    if !is_trial_conversation(&trial_id) || !is_safe_id_component(&trial_id) {
        return Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "试问编号无效：必须以 trial- 开头，且不得包含路径分隔符或控制字符",
        )));
    }
    let Some(work) = work_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return Ok(GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "缺少试用作品：请先打开一个作品，再从制作页发起试问",
        )));
    };
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
    let store = app.state::<ChainLibraryStore>().inner().clone();
    let locks = app.state::<ProjectLocks>().inner().clone();
    let registry = app.state::<TrialSessionRegistry>().inner().clone();
    let trials_dir = trials_dir_in(&making_module_dir_in(&dir));
    let channel = crate::story_tool_channel::global_story_tool_channel();
    let input = TrialRoundInput {
        trial_id,
        chain_id,
        version_id,
        with_card,
        question,
        work_root: PathBuf::from(work),
        focus_document_id,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_trial_round_blocking(
            crate::dsh_driver::global_driver_manager(),
            &channel,
            &registry,
            &store,
            &locks,
            &trials_dir,
            &input,
        )
    })
    .await;
    Ok(match result {
        Ok(result) => result,
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("试问任务执行失败: {join_error}"),
        )),
    })
}

/// 试问：取消进行中的轮次（幂等；取消终态如实记入证据）。
#[tauri::command]
pub(crate) async fn trial_cancel_message(
    app: tauri::AppHandle,
    trial_id: String,
    message_id: String,
) -> Result<GenerateAiResult, String> {
    let registry = app.state::<TrialSessionRegistry>().inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let driver_session_id = {
            let sessions = registry.locked();
            sessions.get(&trial_id).cloned()
        };
        match driver_session_id {
            Some(driver_session_id) => crate::dsh_driver::global_driver_manager()
                .cancel_message(&driver_session_id, &message_id)
                .map(|_| ()),
            // 无注册会话＝无进行中的试问轮，幂等成功。
            None => Ok(()),
        }
    })
    .await;
    Ok(match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("取消试问任务执行失败: {join_error}"),
        )),
    })
}

/// 试问：应答按需补读授权请求（`trial-authorization-request` 事件的回执）。
/// 决定只存内存（试问会话生命周期），绝不写入任何讨论档案。
#[tauri::command]
pub(crate) async fn trial_authorization_respond(
    trial_id: String,
    grant: bool,
) -> Result<(), String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::story_tool_channel::global_story_tool_channel()
            .resolve_trial_reading_request(&trial_id, grant)
    })
    .await;
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => Err(message),
        Err(join_error) => Err(format!("试问授权应答任务执行失败: {join_error}")),
    }
}

/// 试问：读取一份证据（只读查看；不可继续追问——试问单轮，想继续＝新试问）。
#[tauri::command]
pub(crate) async fn trial_get(
    app: tauri::AppHandle,
    trial_id: String,
) -> Result<TrialRecord, String> {
    let trials_dir = trials_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_trial_record(&trials_dir, &trial_id))
        .await
        .map_err(|e| format!("读取试问记录任务执行失败: {e}"))?
        .map_err(|e| e.to_string())
}

/// 试问：按版本列出证据（`created_at` 倒序；锁定契约形状 `{"trials": […]}`）。
#[tauri::command]
pub(crate) async fn trial_list_for_version(
    app: tauri::AppHandle,
    chain_id: String,
    version_id: String,
) -> Result<TrialListResult, String> {
    let trials_dir = trials_dir_from_app(&app)?;
    let store = app.state::<ChainLibraryStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_trials_for_version_blocking(&store, &trials_dir, &chain_id, &version_id)
    })
    .await
    .map_err(|e| format!("读取试问列表任务执行失败: {e}"))?
    .map_err(|e| e.to_string())
}

/// 试问：补写 / 清除用户反馈（空白＝清除；可后补）。
#[tauri::command]
pub(crate) async fn trial_set_feedback(
    app: tauri::AppHandle,
    trial_id: String,
    feedback: String,
) -> Result<(), String> {
    let trials_dir = trials_dir_from_app(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        set_trial_feedback_blocking(&trials_dir, &trial_id, &feedback)
    })
    .await
    .map_err(|e| format!("保存试问反馈任务执行失败: {e}"))?
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ========== 单元测试（任务 6；假驱动端到端镜像 making_session 测试形态） ==========

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain_library::{CardInput, TrialStatus};
    use crate::project::ProjectLocks;
    use crate::story_tool_channel::tests::{
        fake_driver, notebook_with_text, setup_work_with_doc, DriverGuard,
    };
    use crate::story_tool_channel::StoryToolChannel;
    use std::sync::Mutex as StdMutex;

    // ---------- 夹具 ----------

    /// 以临时目录充当应用本地数据目录：链路（含一个版本）＋证据目录。
    fn chain_setup(
        name: &str,
    ) -> (
        tempfile::TempDir,
        ChainLibraryStore,
        String,
        String,
        PathBuf,
    ) {
        let base = tempfile::tempdir().expect("创建应用数据目录");
        let store = ChainLibraryStore::new(Some(base.path().to_path_buf()));
        let chain = store.create_chain(name).expect("建链路");
        let version = store
            .save_version(
                &chain.id,
                &[CardInput {
                    title: "节奏紧张时先问动机".to_string(),
                    trigger_desc: "适用：冲突密集的段落。\n不适用：日常过渡。".to_string(),
                    body: "先指出人物动机，再给两种走向。".to_string(),
                    slot_type: crate::chain_library::SLOT_TYPE_REQUIREMENT.to_string(),
                }],
                "初稿",
            )
            .expect("存版本");
        let trials_dir = trials_dir_in(&making_module_dir_in(base.path()));
        (base, store, chain.id, version.id, trials_dir)
    }

    /// 组装「manager + 本地工具通道」并接线（工具回调 → 通道；通道 → manager
    /// 回填）——镜像 story_tool_channel::tests::wire_channel 形态。
    fn wire_local_channel(manager: &Arc<DshDriverManager>) -> Arc<StoryToolChannel> {
        let channel = Arc::new(StoryToolChannel::new());
        channel.attach_driver(manager.as_ref().clone());
        let channel_for_sink = channel.clone();
        manager.set_tool_call_sink(Arc::new(move |payload| {
            channel_for_sink.handle_tool_call(payload);
        }));
        channel
    }

    fn input_for(
        trial_id: &str,
        chain_id: &str,
        version_id: &str,
        with_card: bool,
        work_root: &Path,
        focus: Option<&str>,
    ) -> TrialRoundInput {
        TrialRoundInput {
            trial_id: trial_id.to_string(),
            chain_id: chain_id.to_string(),
            version_id: version_id.to_string(),
            with_card,
            question: "主角为什么在这一场离开？".to_string(),
            work_root: work_root.to_path_buf(),
            focus_document_id: focus.map(str::to_string),
        }
    }

    fn parse_observation(result: &GenerateAiResult) -> serde_json::Value {
        assert!(result.ok, "试问应成功: {:?}", result.error);
        serde_json::from_str(result.content.as_deref().expect("回复全文"))
            .expect("假驱动回显必须是 JSON")
    }

    /// 观测驱动：记录每个会话的 session_kind 与信封；send_message 回显全部
    /// 观测（kind / prompt / chainCards / posture / text / sessionId）。
    fn observing_driver_script() -> String {
        let script = r#"
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const kinds = new Map();
const prompts = new Map();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    kinds.set(cmd.session_id, Object.hasOwn(cmd, 'session_kind') ? cmd.session_kind : '(absent)');
    prompts.set(cmd.session_id, cmd.system_prompt);
    console.log(JSON.stringify({ type: 'session_started', session_id: cmd.session_id }));
  } else if (cmd.type === 'send_message') {
    console.log(JSON.stringify({ type: 'message_sent', session_id: cmd.session_id, message_id: cmd.message_id }));
    console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: cmd.message_id, text: JSON.stringify({
      kind: kinds.get(cmd.session_id) ?? null,
      prompt: prompts.get(cmd.session_id) ?? null,
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
"#;
        script.to_string()
    }

    /// 授权两步驱动：send → story-request-reading（挂起等 tool_result）→
    /// 允许后 story-read 真实文档 → 回填后 message_done（回显两次结果）；
    /// 拒绝 → 有限回答收束；cancel → cancelled 终态。
    fn authorization_driver_script(doc_id: &str) -> String {
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
    console.log(JSON.stringify({ type: 'tool_call', session_id: cmd.session_id, message_id: cmd.message_id, call_id: 'call-auth', tool: 'story-request-reading', args: { reason: '材料不足，需要确认时间线' } }));
  } else if (cmd.type === 'tool_result') {
    if (cmd.call_id === 'call-auth' && cmd.result?.granted === true) {
      console.log(JSON.stringify({ type: 'tool_call', session_id: cmd.session_id, message_id: currentMsg.get(cmd.session_id), call_id: 'call-read', tool: 'story-read', args: { document_id: "__DOC_ID__" } }));
    } else {
      const mid = currentMsg.get(cmd.session_id);
      const text = cmd.call_id === 'call-auth'
        ? '未获授权，有限回答'
        : '读取材料:' + JSON.stringify(cmd.result ?? {});
      console.log(JSON.stringify({ type: 'message_done', session_id: cmd.session_id, message_id: mid, text }));
    }
  } else if (cmd.type === 'cancel_message') {
    const mid = currentMsg.get(cmd.session_id) ?? cmd.message_id;
    console.log(JSON.stringify({ type: 'message_failed', session_id: cmd.session_id, message_id: mid, code: 'cancelled', message: '已取消' }));
  } else if (cmd.type === 'end_session') {
    console.log(JSON.stringify({ type: 'session_ended', session_id: cmd.session_id }));
  } else if (cmd.type === 'shutdown') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
setInterval(() => {}, 1000);
"#;
        head.replace("__DOC_ID__", doc_id)
    }

    /// 失败驱动：send_message 直接 message_failed（service_error）——终态
    /// failed 的最短路径。
    fn failing_driver_script() -> String {
        r#"
import readline from 'node:readline';
console.log(JSON.stringify({ type: 'ready', protocol_version: 1 }));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd; try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === 'start_session') {
    console.log(JSON.stringify({ type: 'session_started', session_id: cmd.session_id }));
  } else if (cmd.type === 'send_message') {
    console.log(JSON.stringify({ type: 'message_failed', session_id: cmd.session_id, message_id: cmd.message_id, code: 'service_error', message: 'boom' }));
  } else if (cmd.type === 'end_session') {
    console.log(JSON.stringify({ type: 'session_ended', session_id: cmd.session_id }));
  } else if (cmd.type === 'shutdown') {
    process.exit(0);
  }
});
rl.on('close', () => process.exit(0));
setInterval(() => {}, 1000);
"#
        .to_string()
    }

    // ---------- 纯函数 ----------

    /// 前缀解析：试问车道可识别、日常 / 制作会话不误判。
    #[test]
    fn driver_session_prefix_routes_trial_only() {
        assert_eq!(
            trial_id_of_driver_session("trial-trial-abc-1-7"),
            Some("trial-abc-1")
        );
        assert_eq!(trial_id_of_driver_session("trial-"), None);
        assert_eq!(
            trial_id_of_driver_session("conv-1725-aaaa:msg-1"),
            None,
            "日常会话 id 不得被误判为试问车道"
        );
        assert_eq!(
            trial_id_of_driver_session("making-mc-1-7"),
            None,
            "制作会话 id 不得被误判为试问车道"
        );
        assert!(is_trial_conversation("trial-abc"));
        assert!(!is_trial_conversation("conv-abc"));
    }

    /// user 文本组装：镜像日常 First 形态（DirectQuestion 前缀＋问题＋语境块；
    /// 无选区材料标签）。
    #[test]
    fn trial_user_text_mirrors_daily_first_shape() {
        let text = compose_trial_user_text(
            "主角为什么离开？",
            Some("关注文档《第一场》正文：\n林晓站在天台边。"),
        )
        .expect("组装");
        assert!(
            text.contains(&crate::llm_config::generate::compose_system_prompt(
                crate::llm_config::generate::PromptEntry::DirectQuestion
            )),
            "必须携带日常 DirectQuestion 入口前缀（同一来源）"
        );
        assert!(text.contains("用户问题：\n主角为什么离开？"));
        assert!(text.contains("关注文档《第一场》正文："));
        assert!(
            !text.contains("重点参考材料"),
            "试问无选区，不得出现选区材料标签"
        );
        // 无语境：无尾部空行拼接。
        let bare = compose_trial_user_text("问题", None).expect("组装");
        assert!(bare.ends_with("问题"));
    }

    // ---------- 端到端（假驱动） ----------

    /// 任务 6.1/6.2/6.4：带卡试问走 story 会话＋日常信封逐字同源＋卡文本注入
    /// 所试版本；证据终态落盘（含版本引用）；**作品讨论目录零写入**。
    #[test]
    fn trial_round_runs_story_session_with_daily_envelope_and_persists_evidence() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        let work_temp = tempfile::tempdir().expect("work dir");
        let content = notebook_with_text("林晓站在天台边，风吹起衣角。");
        let (work_root, doc_id) = setup_work_with_doc(&work_temp, "试问作品", &content);

        let (_driver_temp, paths, params) = fake_driver(&observing_driver_script());
        let manager = Arc::new(DshDriverManager::new());
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let channel = wire_local_channel(&manager);
        let registry = TrialSessionRegistry::default();
        let locks = ProjectLocks::default();
        let _guard = DriverGuard(manager.as_ref().clone());

        let input = input_for(
            "trial-run-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            Some(&doc_id),
        );
        let result = run_trial_round_blocking(
            &manager,
            &channel,
            &registry,
            &store,
            &locks,
            &trials_dir,
            &input,
        );
        let observed = parse_observation(&result);

        // story 种类＝session_kind 字段省略（与日常会话帧逐字节一致）；
        // 信封与纯常量逐字同源；会话 id 带试问车道前缀。
        assert_eq!(observed["kind"], "(absent)", "试问必须是 story 种类会话");
        assert_eq!(
            observed["prompt"],
            session_system_prompt(),
            "试问信封必须与日常纯常量信封逐字一致"
        );
        assert!(
            observed["sessionId"]
                .as_str()
                .expect("sessionId")
                .starts_with("trial-trial-run-1-"),
            "驱动会话 id 必须带试问车道保留前缀"
        );

        // 卡文本＝所试版本的组装文本（不走 active 指针）。
        let library = store.load().expect("读库");
        let version = &library
            .chains
            .iter()
            .find(|c| c.id == chain_id)
            .expect("链路")
            .versions[0];
        assert_eq!(
            observed["chainCards"],
            crate::llm_config::generate::assemble_chain_cards(&version.cards),
            "带卡轮必须注入所试版本的卡文本"
        );
        assert_eq!(
            observed["posture"],
            serde_json::Value::Null,
            "纯要求卡版本的试问线缆上不得出现 posture 字段"
        );

        // user 文本＝问题＋取材语境（镜像日常 First）。
        let observed_text = observed["text"].as_str().expect("text");
        assert!(observed_text.contains("用户问题：\n主角为什么在这一场离开？"));
        assert!(
            observed_text.contains("林晓站在天台边"),
            "常规取材语境必须随轮注入"
        );

        // 证据终态落盘：success＋回复全文＋环境快照；版本内存引用。
        let record = load_trial_record(&trials_dir, "trial-run-1").expect("证据必须落盘");
        assert_eq!(record.status, TrialStatus::Success);
        assert_eq!(record.reply_text, result.content.clone().expect("全文"));
        assert_eq!(record.chain_name, "链路甲");
        assert_eq!(record.version_index, 1);
        assert!(record.with_card);
        assert_eq!(record.work_title, "试问作品");
        assert_eq!(record.focus_document_id.as_deref(), Some(doc_id.as_str()));
        assert!(record.feedback.is_none());
        let library = store.load().expect("读库");
        assert_eq!(
            library.chains[0].versions[0].trials.len(),
            1,
            "版本必须存证据引用"
        );
        assert_eq!(
            library.chains[0].versions[0].trials[0].trial_id,
            "trial-run-1"
        );

        // 方案二：作品讨论目录零写入（无任何讨论档案）。
        let conversations_dir = work_root.join("next-story-system").join("conversations");
        if conversations_dir.is_dir() {
            let count = std::fs::read_dir(&conversations_dir)
                .expect("读讨论目录")
                .count();
            assert_eq!(count, 0, "试问轮不得在作品讨论目录产生任何档案");
        }

        // 成功结果携带回执与（带卡轮）链路快照。
        assert_eq!(result.sent_confirmed, Some(true));
        let chain_round = result.chain_round.expect("带卡轮携带链路快照");
        assert_eq!(chain_round.chain_id, chain_id);
        assert_eq!(chain_round.chain_name, "链路甲");
        assert_eq!(chain_round.version_index, 1);
        assert_eq!(chain_round.turn_index, 0);

        manager.shutdown_best_effort();
    }

    /// 任务 6.3：对照轮（with_card=false）线缆上无 chain_cards、结果不带链路
    /// 快照；默认单跑（后端不自动追加对照）；**不切全局链路**（active 指针不动）。
    #[test]
    fn control_round_omits_cards_and_keeps_global_active_pointer() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        // 启用另一条链路：试问不得改写全局指针。
        let other = store.create_chain("链路乙").expect("建乙");
        let other_version = store
            .save_version(&other.id, &sample_cards(), "乙 v1")
            .expect("乙版本");
        store
            .set_active(&other.id, &other_version.id)
            .expect("启用乙");

        let work_temp = tempfile::tempdir().expect("work dir");
        let (work_root, _doc_id) =
            setup_work_with_doc(&work_temp, "对照作品", &notebook_with_text("正文。"));

        let (_driver_temp, paths, params) = fake_driver(&observing_driver_script());
        let manager = Arc::new(DshDriverManager::new());
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let channel = wire_local_channel(&manager);
        let registry = TrialSessionRegistry::default();
        let _guard = DriverGuard(manager.as_ref().clone());

        let input = input_for(
            "trial-ctrl-1",
            &chain_id,
            &version_id,
            false,
            &work_root,
            None,
        );
        let result = run_trial_round_blocking(
            &manager,
            &channel,
            &registry,
            &store,
            &ProjectLocks::default(),
            &trials_dir,
            &input,
        );
        let observed = parse_observation(&result);
        assert_eq!(
            observed["chainCards"],
            serde_json::Value::Null,
            "对照轮线缆上不得出现 chain_cards 字段"
        );
        assert_eq!(
            observed["posture"],
            serde_json::Value::Null,
            "对照轮线缆上不得出现 posture 字段（两字段皆空）"
        );
        assert!(
            result.chain_round.is_none(),
            "对照轮结果不携带链路快照（无卡可显示）"
        );

        let record = load_trial_record(&trials_dir, "trial-ctrl-1").expect("证据必须落盘");
        assert!(!record.with_card, "证据必须记录对照（不带卡）");

        // 不切全局：指针仍指向乙·乙 v1；只跑了一轮（后端不自动追加对照）。
        let active = store.snapshot_active().expect("快照").expect("指针在场");
        assert_eq!(active.chain_id, other.id, "试问不得切全局链路");
        assert_eq!(active.version_id, other_version.id);
        assert_eq!(
            store.load().expect("读库").chains[0].versions[0]
                .trials
                .len(),
            1,
            "一次发起只产生一份证据（对照为显式动作）"
        );

        manager.shutdown_best_effort();
    }

    /// add-posture-slot 任务 2.3/2.6（2026-10-07 修订 7.2）：姿态卡试问走真实
    /// 日常链路并按类型分流——姿态＋要求并存版本两字段都注入（同一次版本快照
    /// 产出）；多姿态卡版本全部姿态正文经同一渲染路径自然流通；纯姿态版本
    /// 只带 `posture`（线缆上省略 `chain_cards`）。
    #[test]
    fn trial_round_splits_posture_from_requirement_cards() {
        let (_base, store, chain_id, _v1, trials_dir) = chain_setup("链路甲");
        // 混合版本：一张要求卡＋一张姿态卡。
        let mut mixed = sample_cards();
        mixed.push(CardInput {
            title: "傲娇搭档".to_string(),
            trigger_desc: "适用：想要嘴硬心软的语气。\n不适用：需要冷静复盘。".to_string(),
            body: "【傲娇搭档】\n你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。".to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
        });
        let mixed_version = store
            .save_version(&chain_id, &mixed, "混合")
            .expect("存混合版本");
        // 多姿态版本（修订 7.2）：一张要求卡＋两张姿态卡并存（不调和）。
        let mut multi = sample_cards();
        multi.push(CardInput {
            title: "傲娇搭档".to_string(),
            trigger_desc: "适用：想要嘴硬心软的语气。\n不适用：需要冷静复盘。".to_string(),
            body: "【傲娇搭档】\n你嘴硬心软，可以毒舌，但毒舌后必须跟实打实的想法。".to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
        });
        multi.push(CardInput {
            title: "冷静读者".to_string(),
            trigger_desc: "适用：想要冷静读者视角。\n不适用：其他。".to_string(),
            body: "你看剧本时先找人物动机，再谈感受。".to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
        });
        let multi_posture_version = store
            .save_version(&chain_id, &multi, "多姿态")
            .expect("存多姿态版本（可多张并存）");
        // 纯姿态版本。
        let pure_posture_version = store
            .save_version(
                &chain_id,
                &[CardInput {
                    title: "冷静读者".to_string(),
                    trigger_desc: "适用：想要冷静读者姿态。\n不适用：其他。".to_string(),
                    body: "你以冷静读者的姿态看剧本。".to_string(),
                    slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
                }],
                "纯姿态",
            )
            .expect("存纯姿态版本");

        let work_temp = tempfile::tempdir().expect("work dir");
        let (work_root, _doc_id) = setup_work_with_doc(
            &work_temp,
            "姿态试问作品",
            &notebook_with_text("林晓站在天台边。"),
        );

        let (_driver_temp, paths, params) = fake_driver(&observing_driver_script());
        let manager = Arc::new(DshDriverManager::new());
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let channel = wire_local_channel(&manager);
        let registry = TrialSessionRegistry::default();
        let locks = ProjectLocks::default();
        let _guard = DriverGuard(manager.as_ref().clone());

        // 混合版本带卡轮：chain_cards 只含要求卡、posture 为承接句＋姿态正文
        // （标题行已剥去），两字段与库内重算逐字一致（同源）。
        let input = input_for(
            "trial-posture-1",
            &chain_id,
            &mixed_version.id,
            true,
            &work_root,
            None,
        );
        let result = run_trial_round_blocking(
            &manager,
            &channel,
            &registry,
            &store,
            &locks,
            &trials_dir,
            &input,
        );
        let observed = parse_observation(&result);
        let library = store.load().expect("读库");
        let stored_mixed = library
            .chains
            .iter()
            .flat_map(|chain| chain.versions.iter())
            .find(|version| version.id == mixed_version.id)
            .expect("混合版本在场");
        let requirement_cards: Vec<crate::chain_library::RequirementCard> = stored_mixed
            .cards
            .iter()
            .filter(|card| card.slot_type != crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        let posture_cards: Vec<crate::chain_library::RequirementCard> = stored_mixed
            .cards
            .iter()
            .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        assert_eq!(
            observed["chainCards"],
            crate::llm_config::generate::assemble_chain_cards(&requirement_cards),
            "chain_cards 只含要求卡（同一组装源）"
        );
        assert_eq!(
            observed["posture"],
            crate::llm_config::generate::assemble_posture(&posture_cards),
            "posture 与库内全部姿态卡同一渲染源（承接句＋正文，标题行剥去）"
        );
        assert!(
            !observed["chainCards"]
                .as_str()
                .expect("chainCards 文本")
                .contains("你嘴硬心软"),
            "姿态正文不得混入 chain_cards"
        );

        // 多姿态版本带卡轮（修订 7.2）：两张姿态卡全部经同一渲染路径注入
        // （承接句一次、依序拼接），与库内全部姿态卡重算逐字一致。
        let input = input_for(
            "trial-posture-multi",
            &chain_id,
            &multi_posture_version.id,
            true,
            &work_root,
            None,
        );
        let result = run_trial_round_blocking(
            &manager,
            &channel,
            &registry,
            &store,
            &locks,
            &trials_dir,
            &input,
        );
        let observed = parse_observation(&result);
        let library = store.load().expect("读库");
        let stored_multi = library
            .chains
            .iter()
            .flat_map(|chain| chain.versions.iter())
            .find(|version| version.id == multi_posture_version.id)
            .expect("多姿态版本在场");
        let multi_posture_cards: Vec<crate::chain_library::RequirementCard> = stored_multi
            .cards
            .iter()
            .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        assert_eq!(multi_posture_cards.len(), 2, "多姿态版本确实含两张姿态卡");
        assert_eq!(
            observed["posture"],
            crate::llm_config::generate::assemble_posture(&multi_posture_cards),
            "多姿态卡试问与库内全部姿态卡同一渲染源（多卡自然流通）"
        );
        let posture_text = observed["posture"].as_str().expect("posture 文本");
        let tsundere_at = posture_text.find("你嘴硬心软").expect("首张姿态正文在场");
        let motive_at = posture_text.find("先找人物动机").expect("次张姿态正文在场");
        assert!(tsundere_at < motive_at, "多姿态正文按版本内既定次序注入");
        assert!(
            !observed["chainCards"]
                .as_str()
                .expect("chainCards 文本")
                .contains("你嘴硬心软"),
            "多姿态正文仍不得混入 chain_cards"
        );

        // 纯姿态版本带卡轮：只带 posture，线缆上无 chain_cards 字段。
        let input = input_for(
            "trial-posture-2",
            &chain_id,
            &pure_posture_version.id,
            true,
            &work_root,
            None,
        );
        let result = run_trial_round_blocking(
            &manager,
            &channel,
            &registry,
            &store,
            &locks,
            &trials_dir,
            &input,
        );
        let observed = parse_observation(&result);
        assert_eq!(
            observed["chainCards"],
            serde_json::Value::Null,
            "纯姿态版本试问线缆上不得出现 chain_cards 字段"
        );
        assert_eq!(
            observed["posture"],
            format!(
                "{}\n\n你以冷静读者的姿态看剧本。",
                crate::llm_config::generate::POSTURE_WRAPPER_HEADER
            ),
            "纯姿态版本注入承接句＋正文"
        );

        manager.shutdown_best_effort();
    }

    fn sample_cards() -> Vec<CardInput> {
        vec![CardInput {
            title: "示例卡".to_string(),
            trigger_desc: "适用：测试。\n不适用：其他。".to_string(),
            body: "正文。".to_string(),
            slot_type: crate::chain_library::SLOT_TYPE_REQUIREMENT.to_string(),
        }]
    }

    /// 任务 6.5：授权旁路端到端——story-request-reading 挂起轮次（试问身份的
    /// 授权请求事件经 sink 发出）；应答写内存 grant 后原轮继续、story-read 按
    /// 内存授权执行（读取真实正文）；**全程零讨论档案写入**（无授权档案、无
    /// 出处档案）。
    #[test]
    fn trial_authorization_suspends_resumes_via_memory_and_writes_no_archive() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        let work_temp = tempfile::tempdir().expect("work dir");
        let (work_root, doc_id) = setup_work_with_doc(
            &work_temp,
            "授权作品",
            &notebook_with_text("这里藏着试问补读才可见的正文。"),
        );

        let (_driver_temp, paths, params) = fake_driver(&authorization_driver_script(&doc_id));
        let manager = Arc::new(DshDriverManager::new());
        manager.ensure_started(&params, &paths).expect("驱动启动");
        let channel = wire_local_channel(&manager);
        let registry = TrialSessionRegistry::default();
        let _guard = DriverGuard(manager.as_ref().clone());

        let events = Arc::new(StdMutex::new(Vec::<
            crate::story_tool_channel::ReadingRequestEvent,
        >::new()));
        let events_for_sink = events.clone();
        channel.set_reading_request_sink(Arc::new(move |event| {
            events_for_sink.lock().unwrap().push(event);
        }));

        let input = input_for(
            "trial-auth-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        );
        let manager_for_send = manager.clone();
        let channel_for_send = channel.clone();
        let registry_for_send = registry.clone();
        let store_for_send = store.clone();
        let trials_dir_for_send = trials_dir.clone();
        let locks = ProjectLocks::default();
        let send = std::thread::spawn(move || {
            run_trial_round_blocking(
                &manager_for_send,
                &channel_for_send,
                &registry_for_send,
                &store_for_send,
                &locks,
                &trials_dir_for_send,
                &input,
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(1500));

        // 挂起期间：授权请求事件以试问身份发出（reason 透传、无作品数据）；
        // 轮次未终结（无时限挂起，等待用户决定）。
        let received = events.lock().unwrap().clone();
        assert_eq!(received.len(), 1, "应恰好发出一次授权请求事件");
        assert_eq!(received[0].conversation_id, "trial-auth-1");
        assert_eq!(received[0].reason, "材料不足，需要确认时间线");
        assert!(!send.is_finished(), "等待授权期间轮次不得终结");

        // 试问应答：允许 → 内存 grant（试问会话生命周期）→ 原轮继续。
        channel
            .resolve_trial_reading_request("trial-auth-1", true)
            .expect("应答成功");
        let result = send.join().expect("send 线程");
        assert!(result.ok, "授权后轮次应完成: {:?}", result.error);
        let reply = result.content.expect("回复全文");
        // 允许回填生效的证明链：驱动只在 granted:true 后才发起 story-read，
        // 终态文本因此是读取材料（含真实正文）——内存授权对补读工具真实放行。
        assert!(
            reply.contains("\"Read\""),
            "允许后应有真实读取材料回填模型: {reply}"
        );
        assert!(
            reply.contains("试问补读才可见的正文"),
            "允许后的 story-read 必须按内存授权读到真实正文: {reply}"
        );

        // 零讨论档案：作品讨论目录不出现任何文件（授权 / 出处均不落档）。
        let conversations_dir = work_root.join("next-story-system").join("conversations");
        if conversations_dir.is_dir() {
            let count = std::fs::read_dir(&conversations_dir)
                .expect("读讨论目录")
                .count();
            assert_eq!(count, 0, "试问授权 / 出处不得写入任何讨论档案");
        }

        // 证据终态：success＋回复全文。
        let record = load_trial_record(&trials_dir, "trial-auth-1").expect("证据必须落盘");
        assert_eq!(record.status, TrialStatus::Success);

        // 会话已清：无待决授权（迟到应答失败关闭）。
        let payload = crate::dsh_driver::ToolCallPayload {
            session_id: "trial-trial-auth-1-999".to_string(),
            message_id: "m".to_string(),
            call_id: "late".to_string(),
            tool: "story-read".to_string(),
            args: serde_json::json!({ "document_id": doc_id }),
        };
        channel.handle_tool_call(payload);
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert!(
            channel
                .resolve_trial_reading_request("trial-auth-1", true)
                .is_err(),
            "轮次收束后不得有待决授权"
        );

        manager.shutdown_best_effort();
    }

    /// 崩溃 / 失败如实记录：失败终态 failed、取消终态 cancelled；均不自动重发
    /// （注册表除名，可重新以新编号发起）。
    #[test]
    fn trial_failure_and_cancel_record_terminal_states() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        let work_temp = tempfile::tempdir().expect("work dir");
        let (work_root, doc_id) =
            setup_work_with_doc(&work_temp, "终态作品", &notebook_with_text("正文。"));

        // 失败终态：驱动直接 message_failed。
        let (_t1, paths1, params1) = fake_driver(&failing_driver_script());
        let manager1 = Arc::new(DshDriverManager::new());
        manager1.ensure_started(&params1, &paths1).expect("启动");
        let channel1 = wire_local_channel(&manager1);
        let _guard1 = DriverGuard(manager1.as_ref().clone());
        let result = run_trial_round_blocking(
            &manager1,
            &channel1,
            &TrialSessionRegistry::default(),
            &store,
            &ProjectLocks::default(),
            &trials_dir,
            &input_for(
                "trial-fail-1",
                &chain_id,
                &version_id,
                true,
                &work_root,
                None,
            ),
        );
        assert!(!result.ok, "失败轮必须以失败结果返回");
        let record = load_trial_record(&trials_dir, "trial-fail-1").expect("失败也要落证据");
        assert_eq!(record.status, TrialStatus::Failed);
        assert_eq!(record.reply_text, "");
        manager1.shutdown_best_effort();

        // 取消终态：授权挂起期间停止生成 → cancelled（识别既有取消契约文案）。
        let (_t2, paths2, params2) = fake_driver(&authorization_driver_script(&doc_id));
        let manager2 = Arc::new(DshDriverManager::new());
        manager2.ensure_started(&params2, &paths2).expect("启动");
        let channel2 = wire_local_channel(&manager2);
        let registry2 = TrialSessionRegistry::default();
        let _guard2 = DriverGuard(manager2.as_ref().clone());
        let events2 = Arc::new(StdMutex::new(Vec::<
            crate::story_tool_channel::ReadingRequestEvent,
        >::new()));
        let events2_for_sink = events2.clone();
        channel2.set_reading_request_sink(Arc::new(move |event| {
            events2_for_sink.lock().unwrap().push(event);
        }));

        let input = input_for(
            "trial-cancel-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        );
        let manager_for_send = manager2.clone();
        let channel_for_send = channel2.clone();
        let registry_for_send = registry2.clone();
        let store_for_send = store.clone();
        let trials_dir_for_send = trials_dir.clone();
        let locks = ProjectLocks::default();
        let send = std::thread::spawn(move || {
            run_trial_round_blocking(
                &manager_for_send,
                &channel_for_send,
                &registry_for_send,
                &store_for_send,
                &locks,
                &trials_dir_for_send,
                &input,
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(1500));
        assert_eq!(events2.lock().unwrap().len(), 1, "授权请求已挂起");
        // 从注册表取驱动会话 id 发停止生成。
        let driver_session = registry2
            .locked()
            .get("trial-cancel-1")
            .cloned()
            .expect("注册表应有在场条目");
        manager2
            .cancel_message(&driver_session, "trial-cancel-msg")
            .expect("取消");
        let cancelled = send.join().expect("send 线程");
        assert!(!cancelled.ok, "取消的轮次不得成功");
        let record = load_trial_record(&trials_dir, "trial-cancel-1").expect("取消也要落证据");
        assert_eq!(record.status, TrialStatus::Cancelled);
        assert!(
            registry2.locked().get("trial-cancel-1").is_none(),
            "终态后注册表必须除名（不自动重发）"
        );
        manager2.shutdown_best_effort();
    }

    /// 入参守卫：无前缀 / 不安全编号、同编号重复发起、未知链路、空白问题、
    /// 关注文档不存在全部明确拒绝；拒绝不落任何证据。
    #[test]
    fn trial_round_rejects_invalid_input_explicitly() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        let work_temp = tempfile::tempdir().expect("work dir");
        let (work_root, _doc) =
            setup_work_with_doc(&work_temp, "守卫作品", &notebook_with_text("正文。"));

        let (_driver_temp, paths, params) = fake_driver(&observing_driver_script());
        let manager = Arc::new(DshDriverManager::new());
        manager.ensure_started(&params, &paths).expect("启动");
        let channel = wire_local_channel(&manager);
        let registry = TrialSessionRegistry::default();
        let locks = ProjectLocks::default();
        let _guard = DriverGuard(manager.as_ref().clone());

        let run = |input: &TrialRoundInput| {
            run_trial_round_blocking(
                &manager,
                &channel,
                &registry,
                &store,
                &locks,
                &trials_dir,
                input,
            )
        };

        // 空白问题。
        let mut input = input_for("trial-x", &chain_id, &version_id, true, &work_root, None);
        input.question = "   ".to_string();
        let result = run(&input);
        assert!(!result.ok);
        assert!(result
            .error
            .as_ref()
            .expect("err")
            .message
            .contains("问题不能为空"));

        // 无前缀编号。
        let result = run(&input_for(
            "nope-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        ));
        assert!(!result.ok);
        assert!(result
            .error
            .as_ref()
            .expect("err")
            .message
            .contains("trial-"));

        // 未知链路。
        let result = run(&input_for(
            "trial-x",
            "chain-nope",
            &version_id,
            true,
            &work_root,
            None,
        ));
        assert!(!result.ok);
        let message = result.error.as_ref().expect("err").message.clone();
        assert!(
            message.contains("链路不存在"),
            "未知链路错误应如实传达: {message}"
        );

        // 同编号重复发起：第一次成功后，第二次被证据不可覆盖拒绝。
        let first = run(&input_for(
            "trial-dup-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        ));
        assert!(first.ok, "首轮应成功");
        let second = run(&input_for(
            "trial-dup-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        ));
        assert!(!second.ok, "同编号不得覆盖证据");
        assert!(second
            .error
            .as_ref()
            .expect("err")
            .message
            .contains("不可覆盖"));

        // 注册表在场守卫：手动占位后拒绝重复轮次。
        registry.locked().insert(
            "trial-busy-1".to_string(),
            "trial-trial-busy-1-1".to_string(),
        );
        let result = run(&input_for(
            "trial-busy-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            None,
        ));
        assert!(!result.ok);
        assert_eq!(
            result.error.as_ref().expect("err").code,
            GenerateAiErrorCode::ConversationBusy
        );
        registry.locked().remove("trial-busy-1");

        // 关注文档不存在：取材失败关闭（本轮未发送）。
        let result = run(&input_for(
            "trial-doc-1",
            &chain_id,
            &version_id,
            true,
            &work_root,
            Some("doc-missing"),
        ));
        assert!(!result.ok);
        assert_eq!(
            result.error.as_ref().expect("err").message,
            "关注文档不可用，本次请求未发送。"
        );

        // 被拒绝的发起不落证据文件。
        assert!(!crate::chain_library::trial_record_exists(
            &trials_dir,
            "trial-x"
        ));
        assert!(!crate::chain_library::trial_record_exists(
            &trials_dir,
            "nope-1"
        ));
        assert!(!crate::chain_library::trial_record_exists(
            &trials_dir,
            "trial-busy-1"
        ));
        assert!(!crate::chain_library::trial_record_exists(
            &trials_dir,
            "trial-doc-1"
        ));

        manager.shutdown_best_effort();
    }

    /// 证据查询与反馈：列表按 created_at 倒序；反馈可后补、空白清除。
    #[test]
    fn trial_list_orders_desc_and_feedback_roundtrip() {
        let (_base, store, chain_id, version_id, trials_dir) = chain_setup("链路甲");
        let earlier = sample_record("trial-early", "2026-10-06T08:00:00Z");
        let mut later = sample_record("trial-late", "2026-10-06T12:00:00Z");
        save_trial_record(&trials_dir, &earlier).expect("保存早");
        save_trial_record(&trials_dir, &later).expect("保存晚");
        store
            .append_trial_ref(
                &chain_id,
                &version_id,
                TrialRef {
                    trial_id: "trial-early".to_string(),
                    created_at: earlier.created_at,
                    with_card: true,
                },
            )
            .expect("引用早");
        store
            .append_trial_ref(
                &chain_id,
                &version_id,
                TrialRef {
                    trial_id: "trial-late".to_string(),
                    created_at: later.created_at,
                    with_card: false,
                },
            )
            .expect("引用晚");

        let list = list_trials_for_version_blocking(&store, &trials_dir, &chain_id, &version_id)
            .expect("列出");
        assert_eq!(
            list.trials
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["trial-late", "trial-early"],
            "按 created_at 倒序"
        );

        // 反馈：补写（去空白）→ 清除。
        set_trial_feedback_blocking(&trials_dir, "trial-late", "  挺有用  ").expect("补反馈");
        later.feedback = Some("挺有用".to_string());
        assert_eq!(
            load_trial_record(&trials_dir, "trial-late").expect("重读"),
            later
        );
        set_trial_feedback_blocking(&trials_dir, "trial-late", "   ").expect("清反馈");
        assert!(load_trial_record(&trials_dir, "trial-late")
            .expect("重读")
            .feedback
            .is_none());

        // 未知版本明确报错。
        let error =
            list_trials_for_version_blocking(&store, &trials_dir, &chain_id, "chainver-nope")
                .expect_err("未知版本必须报错");
        assert!(error.to_string().contains("不存在指定版本"), "{error}");
    }

    fn sample_record(id: &str, created: &str) -> TrialRecord {
        TrialRecord {
            id: id.to_string(),
            chain_id: "chain-any".to_string(),
            chain_name: "链路甲".to_string(),
            version_id: "chainver-any".to_string(),
            version_index: 1,
            with_card: true,
            question: "问题".to_string(),
            reply_text: "回复".to_string(),
            status: TrialStatus::Success,
            created_at: created.parse::<chrono::DateTime<Utc>>().expect("时间"),
            work_title: "作品".to_string(),
            focus_document_id: None,
            focus_document_title: None,
            feedback: None,
        }
    }
}
