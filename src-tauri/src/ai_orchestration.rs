//! AI 生成请求装配与调度编排（审计 P2-1：自 `lib.rs` 纯移动拆出，行为零变化）。
//!
//! 职责：请求解析与选区来源身份校验、选区授权（受控只读准入）、常规取材
//! 调用（关注文档现场材料 + 目录投影 + 跨文档检索）、生成请求编排与结果
//! 回填。会话与驱动生命周期见 [`crate::ai_host`]；作品领域逻辑在
//! `project` / `conversation_store`，本模块只做编排接线。

use std::path::PathBuf;

use tauri::Manager;

use crate::llm_config::{self, GenerateAiResult};
use crate::project::{self, ProjectLocks};

// ========== 单次生成命令（ai-thinking-panel） ==========

/// 使用唯一保存配置，围绕选区原文生成一次真实 AI 思考材料
#[tauri::command]
pub(crate) async fn generate_ai_thinking(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<GenerateAiResult, String> {
    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();

    let locks = app.state::<ProjectLocks>().inner().clone();
    let authorized = match authorize_request_selection(&request, locks).await {
        Ok(material) => material,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };

    Ok(generate_ai_result_for_request_with_material(
        &dir,
        resource_dir.as_deref(),
        request,
        authorized.as_ref(),
    )
    .await)
}

// ========== 选区授权（受控只读准入，controlled-story-read-visibility） ==========

fn selection_identity_error(
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    project_path: Option<&str>,
    document_id: Option<&str>,
    document_version: Option<&str>,
) -> Result<(), llm_config::GenerateAiError> {
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    let has_snapshot = snapshot
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    // 无选区且无快照（无选区直接提问）不要求来源身份。
    if !has_selection && !has_snapshot {
        return Ok(());
    }
    // 有选区或有快照时必须携带完整来源身份（作品 / 文档 / 版本），裸材料拒绝。
    if [project_path, document_id, document_version]
        .iter()
        .any(|value| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        })
    {
        return Err(llm_config::GenerateAiError::new(
            llm_config::GenerateAiErrorCode::InvalidResponse,
            "AI 请求内容无效，请重试",
        ));
    }
    Ok(())
}

/// 从原始 JSON 请求提取选区身份字段并执行授权，返回受控材料；失败关闭。
async fn authorize_request_selection(
    request: &serde_json::Value,
    locks: ProjectLocks,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    let selected_text = request
        .get("selected_text")
        .and_then(serde_json::Value::as_str);
    let snapshot = request.get("snapshot").and_then(serde_json::Value::as_str);
    let project_path = request
        .get("project_path")
        .and_then(serde_json::Value::as_str);
    let document_id = request
        .get("document_id")
        .and_then(serde_json::Value::as_str);
    let document_version = request
        .get("document_version")
        .and_then(serde_json::Value::as_str);
    authorize_selection(
        project_path,
        document_id,
        document_version,
        selected_text,
        snapshot,
        Some(locks),
    )
    .await
}

/// 异步授权入口：在阻塞线程内完成「作品锁 + 受控只读读取」（见 [`authorize_selection_sync`]）。
/// 返回授权后的受控材料；无选区且无快照时返回 `None`（无选区直接提问不携带材料）。
async fn authorize_selection(
    project_path: Option<&str>,
    document_id: Option<&str>,
    document_version: Option<&str>,
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    locks: Option<ProjectLocks>,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    selection_identity_error(
        selected_text,
        snapshot,
        project_path,
        document_id,
        document_version,
    )?;
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    let has_snapshot = snapshot
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    if !has_selection && !has_snapshot {
        return Ok(None);
    }
    let project_path = project_path
        .expect("selection identity checked")
        .to_string();
    let document_id = document_id.expect("selection identity checked").to_string();
    let document_version = document_version
        .expect("selection identity checked")
        .to_string();
    let selected_text = selected_text.map(str::to_string);
    let snapshot = snapshot.map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        authorize_selection_sync(
            &project_path,
            &document_id,
            &document_version,
            selected_text.as_deref(),
            snapshot.as_deref(),
            locks.as_ref(),
        )
    })
    .await
    .map_err(|_| invalid_selection_error())?
}

/// 同步授权核心：把选区材料身份映射为 `ReadMaterialRequest`，在作品锁保护下调用
/// `read_material` 校验作品 / 文档 / 可见性 / 版本 / 快照身份，并确认选区文本落在
/// 授权材料正文内。返回授权后的受控材料；失败关闭，绝不返回正文。
///
/// `snapshot`（前端规范化 Tiptap JSON 字符串）被映射为 [`project::MaterialSnapshot`]，
/// 其 work_id / document_id / version 与请求身份一致，由 `read_material` 统一校验；
/// 生成层只能使用授权后的材料内容，不得回读原始 `selected_text` 字段。
/// `locks` 为 `None` 时跳过取锁（测试路径，单线程无并发）。
fn authorize_selection_sync(
    project_path: &str,
    document_id: &str,
    document_version: &str,
    selected_text: Option<&str>,
    snapshot: Option<&str>,
    locks: Option<&ProjectLocks>,
) -> Result<Option<project::StoryMaterial>, llm_config::GenerateAiError> {
    let canonical = std::path::Path::new(project_path)
        .canonicalize()
        .map_err(|_| invalid_selection_error())?;
    let work_id = canonical.to_string_lossy().to_string();
    let request = project::ReadMaterialRequest {
        work_id: work_id.clone(),
        document_id: document_id.to_string(),
        range: None,
        expected_version: Some(document_version.to_string()),
        snapshot: snapshot.map(|content| project::MaterialSnapshot {
            work_id: work_id.clone(),
            document_id: document_id.to_string(),
            version: document_version.to_string(),
            content: content.to_string(),
        }),
    };
    let root = PathBuf::from(project_path);
    let _guard = locks
        .map(|locks| locks.acquire(&root))
        .transpose()
        .map_err(|_| invalid_selection_error())?;
    let material = project::read_material(&root, &request).map_err(|denial| {
        if matches!(
            denial.reason,
            project::MaterialDenialReason::RecoveryRequired
        ) {
            story_recovery_required_error()
        } else {
            invalid_selection_error()
        }
    })?;
    if let Some(selection) = selected_text.map(str::trim).filter(|text| !text.is_empty()) {
        if !material.content.contains(selection) {
            return Err(invalid_selection_error());
        }
    }
    Ok(Some(material))
}

fn invalid_selection_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::InvalidResponse,
        "AI 请求内容无效，请重试",
    )
}

/// 从已授权的结构化材料中提取请求声明的选区。返回值来自受控材料，
/// 而不是直接复用请求中的原始字符串；未找到时失败关闭。
fn authorized_selection_from_material(
    material: &project::StoryMaterial,
    requested_selection: &str,
) -> Option<String> {
    let selection = requested_selection.trim();
    if selection.is_empty() {
        return None;
    }
    let start = material.content.find(selection)?;
    let end = start.checked_add(selection.len())?;
    material.content.get(start..end).map(str::to_string)
}

/// 由已授权材料提取请求声明的选区内容；返回值必须来自受控材料的正文子串，
/// 绝不直接复用原始 `selected_text` 字段。无选区（直接提问 / 追问）时返回
/// `Ok(None)`；有选区但无授权材料、或选区未落在授权材料正文内时失败关闭。
fn authorized_selection_text(
    material: Option<&project::StoryMaterial>,
    selected_text: Option<&str>,
) -> Result<Option<String>, llm_config::GenerateAiError> {
    let has_selection = selected_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some();
    if !has_selection {
        return Ok(None);
    }
    let selection = selected_text.expect("has_selection checked above");
    match material {
        Some(material) => authorized_selection_from_material(material, selection)
            .map(Some)
            .ok_or_else(invalid_selection_error),
        None => Err(invalid_selection_error()),
    }
}

/// 用已授权材料替换请求中声明的选区文本：`First` / `FollowUp` / `DirectQuestion`
/// 的 `selected_text` 都由 `authorized_selection_text` 重写为受控材料提取值，
/// 提示词组装只看到授权后的内容。无选区（直接提问 / 追问）保持原样。
fn apply_authorized_selection(
    request: llm_config::GenerateAiRequest,
    material: Option<&project::StoryMaterial>,
) -> Result<llm_config::GenerateAiRequest, llm_config::GenerateAiError> {
    match request {
        llm_config::GenerateAiRequest::First {
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
            thinking_direction,
        } => {
            let authorized = authorized_selection_text(material, Some(&selected_text))?;
            Ok(llm_config::GenerateAiRequest::First {
                selected_text: authorized.unwrap_or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
                thinking_direction,
            })
        }
        llm_config::GenerateAiRequest::FollowUp {
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
            thinking_direction,
            origin,
            messages,
        } => {
            let authorized = authorized_selection_text(material, Some(&selected_text))?;
            Ok(llm_config::GenerateAiRequest::FollowUp {
                selected_text: authorized.unwrap_or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
                thinking_direction,
                origin,
                messages,
            })
        }
        llm_config::GenerateAiRequest::DirectQuestion {
            question,
            selected_text,
            document_id,
            project_path,
            document_version,
            snapshot,
        } => {
            let authorized = authorized_selection_text(material, selected_text.as_deref())?;
            Ok(llm_config::GenerateAiRequest::DirectQuestion {
                question,
                selected_text: authorized.or(selected_text),
                document_id,
                project_path,
                document_version,
                snapshot,
            })
        }
    }
}

// ========== 生成请求编排 ==========

/// 生产命令入口：解析请求、校验来源身份，并用已授权材料替换请求中声明的选区
/// 文本，确保提示词只使用受控材料内容，绝不直接使用原始 `selected_text` 字段。
async fn generate_ai_result_for_request_with_material(
    base_dir: &std::path::Path,
    resource_dir: Option<&std::path::Path>,
    request: serde_json::Value,
    material: Option<&project::StoryMaterial>,
) -> GenerateAiResult {
    let request = match llm_config::parse_generate_ai_request(request) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    if let Err(error) = validate_parsed_selection_identity(&request) {
        return GenerateAiResult::failure(error);
    }

    let request = match apply_authorized_selection(request, material) {
        Ok(request) => request,
        Err(error) => return GenerateAiResult::failure(error),
    };

    llm_config::generate_ai_result_in_with_resource(base_dir, resource_dir, request).await
}

fn validate_parsed_selection_identity(
    request: &llm_config::GenerateAiRequest,
) -> Result<(), llm_config::GenerateAiError> {
    let (selected_text, snapshot, project_path, document_id, document_version) = match request {
        llm_config::GenerateAiRequest::First {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            Some(selected_text.as_str()),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
        llm_config::GenerateAiRequest::FollowUp {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            Some(selected_text.as_str()),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
        llm_config::GenerateAiRequest::DirectQuestion {
            selected_text,
            snapshot,
            project_path,
            document_id,
            document_version,
            ..
        } => (
            selected_text.as_deref(),
            snapshot.as_deref(),
            project_path.as_deref(),
            document_id.as_deref(),
            document_version.as_deref(),
        ),
    };
    selection_identity_error(
        selected_text,
        snapshot,
        project_path,
        document_id,
        document_version,
    )
}

// ========== 常驻会话消息命令（resident-ai-session 任务 3.4） ==========

/// 常驻会话：发送消息并等待终态；流式增量经 `ai-delta` 事件转发前端。
/// 常规首轮 / 追问（`First` / `FollowUp`）在提供关注文档身份时，后端统一组装
/// 关注文档现场材料 + 目录投影 + 跨文档检索片段随请求注入；及时召唤不经过常规取材。
// 参数超限定点豁免：Tauri 命令入参与前端调用面一一对应，结构性收拢归审计 P2-1/P2-2 处理。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn ai_send_message(
    app: tauri::AppHandle,
    session_id: String,
    message_id: String,
    kind: llm_config::AiMessageKind,
    question: String,
    selected_text: Option<String>,
    document_id: Option<String>,
    project_path: Option<String>,
    document_version: Option<String>,
    snapshot: Option<String>,
    focus_document_id: Option<String>,
    focus_project_path: Option<String>,
    focus_document_version: Option<String>,
    focus_snapshot: Option<String>,
    conversation_id: Option<String>,
    conversation_project_path: Option<String>,
) -> Result<GenerateAiResult, String> {
    // 任务 5.2/5.5（add-agent-on-demand-reading）：注册本轮工具路由上下文——
    // 讨论身份 + 作品根 + 召唤首轮硬门禁标识；驱动侧 tool_call 据此路由执行与授权。
    // 未携带讨论身份的会话清路由（补读调用一律失败关闭为未授权拒绝）。
    match (
        conversation_id.as_deref(),
        conversation_project_path.as_deref(),
    ) {
        (Some(conversation_id), Some(project_path))
            if !conversation_id.trim().is_empty() && !project_path.trim().is_empty() =>
        {
            crate::story_tool_channel::global_story_tool_channel().register_round(
                &session_id,
                conversation_id,
                PathBuf::from(project_path),
                matches!(kind, llm_config::AiMessageKind::SummonFirst),
            );
        }
        _ => {
            crate::story_tool_channel::global_story_tool_channel().clear_session(&session_id);
        }
    }

    let dir = match app.path().app_local_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Ok(llm_config::app_data_dir_failure_result()),
    };
    let resource_dir = app.path().resource_dir().ok();
    let authorized = match authorize_selection(
        project_path.as_deref(),
        document_id.as_deref(),
        document_version.as_deref(),
        selected_text.as_deref(),
        snapshot.as_deref(),
        Some(app.state::<ProjectLocks>().inner().clone()),
    )
    .await
    {
        Ok(material) => material,
        Err(error) => return Ok(GenerateAiResult::failure(error)),
    };
    // 生成层只使用授权通过后的选区材料内容：由已授权的 StoryMaterial 提取实际
    // 材料（受控读取的正文子串），绝不回读原始 selected_text 字段；无选区
    // （直接提问 / 追问）时为 None。有选区却提取失败时失败关闭。
    let authorized_selection =
        match authorized_selection_text(authorized.as_ref(), selected_text.as_deref()) {
            Ok(selection) => selection,
            Err(error) => return Ok(GenerateAiResult::failure(error)),
        };

    // 链路卡冻结（add-making-module-core 任务 3.2，design D6）：在 kind 分流
    // 之前执行，三入口（常规首轮 / 召唤首轮 / 追问）共覆盖；轮内只读一次
    // 快照，在途轮不受打扰（冻结后不再读指针）。未启用为 None——发送路径
    // 省略 chain_cards 字段，与无链路现状逐字节一致；读取失败明确报错，
    // 不静默无卡发起。
    let chain_store = app
        .state::<crate::chain_library::ChainLibraryStore>()
        .inner()
        .clone();
    let freeze_conversation_id = conversation_id.clone();
    let freeze_project_path = conversation_project_path.clone();
    let frozen_chain = match tauri::async_runtime::spawn_blocking(move || {
        freeze_chain_round_blocking(
            &chain_store,
            kind,
            freeze_conversation_id.as_deref(),
            freeze_project_path.as_deref(),
        )
    })
    .await
    {
        Ok(Ok(frozen)) => frozen,
        Ok(Err(error)) => {
            eprintln!("轮次发起冻结链路失败，本轮未发送: {error}");
            return Ok(GenerateAiResult::failure(chain_library_unavailable_error()));
        }
        Err(join_error) => {
            eprintln!("轮次发起冻结链路任务执行失败，本轮未发送: {join_error}");
            return Ok(GenerateAiResult::failure(chain_library_unavailable_error()));
        }
    };

    // 阶段五 A：常规首轮 / 追问按关注文档组装取材语境；及时召唤不经过常规取材。
    // 关注文档读取失败（不可见 / 快照非法 / 版本不可用）时失败关闭，不静默回退。
    let (context, provenance): (Option<String>, Option<Vec<project::ContextProvenance>>) =
        match kind {
            llm_config::AiMessageKind::First | llm_config::AiMessageKind::FollowUp => {
                match (focus_project_path.as_deref(), focus_document_id.as_deref()) {
                    (Some(project_path), Some(doc_id)) => {
                        let project_path = project_path.to_string();
                        let doc_id = doc_id.to_string();
                        let version = focus_document_version.clone();
                        let snapshot = focus_snapshot.clone();
                        let question_for_context = question.clone();
                        let locks = app.state::<ProjectLocks>().inner().clone();
                        let assembled = tauri::async_runtime::spawn_blocking(move || {
                            assemble_context_under_lock(
                                &locks,
                                std::path::Path::new(&project_path),
                                &doc_id,
                                version.as_deref(),
                                snapshot.as_deref(),
                                &question_for_context,
                            )
                        })
                        .await;
                        match assembled {
                            Ok(Ok(ctx)) => (Some(ctx.context_text), Some(ctx.provenance)),
                            Ok(Err(AssembleContextError::LockUnavailable)) => {
                                return Ok(GenerateAiResult::failure(
                                    context_lock_unavailable_error(),
                                ))
                            }
                            Ok(Err(AssembleContextError::Denied(denial)))
                                if matches!(
                                    denial.reason,
                                    project::MaterialDenialReason::RecoveryRequired
                                ) =>
                            {
                                return Ok(GenerateAiResult::failure(
                                    story_recovery_required_error(),
                                ))
                            }
                            Ok(Err(_)) => {
                                return Ok(GenerateAiResult::failure(invalid_story_context_error()))
                            }
                            Err(_) => {
                                return Ok(GenerateAiResult::failure(invalid_story_context_error()))
                            }
                        }
                    }
                    _ => (None, None),
                }
            }
            _ => (None, None),
        };

    let mut result = llm_config::ai_send_message_in_dir(
        &dir,
        resource_dir.as_deref(),
        session_id,
        message_id,
        kind,
        question,
        authorized_selection,
        context,
        // 当轮冻结的要求卡文本经协议字段下发（任务 3.2/3.3）：卡不进 text
        // （追问仍纯增量），无冻结值或纯姿态版本时省略字段（与现状逐字节一致）。
        frozen_chain
            .as_ref()
            .and_then(|chain| (!chain.cards_text.is_empty()).then_some(chain.cards_text.as_str())),
        // 当轮冻结的姿态段文本（add-posture-slot 任务 2.3）：与 cards_text 同一
        // 次冻结产出（同源）；无姿态卡时省略字段。
        frozen_chain
            .as_ref()
            .and_then(|chain| chain.posture_text.as_deref()),
    )
    .await;
    // 只有成功轮次才携带自动取材出处；失败轮次不附出处（无实际发送证据）。
    if result.ok {
        result.provenance = provenance;
        // 链路轮次记录（任务 4.1＋任务 A）：成功轮以发起时冻结值落档（失败 /
        // 取消轮不记，与出处行为一致），并把同一记录放入返回结果（前端「本轮
        // 用了哪条链路」活显示）——与当轮下发的卡文本同源（同一次冻结）。
        // 无讨论身份（turn_index 缺省）不落档也不进结果，既有行为零变化。
        if let (Some(chain), Some(conversation_id), Some(project_path)) = (
            frozen_chain.as_ref(),
            conversation_id.as_deref(),
            conversation_project_path.as_deref(),
        ) {
            if let Some(turn_index) = chain.turn_index {
                let round = crate::conversation_store::ChainRoundRecord {
                    turn_index,
                    chain_id: chain.chain_id.clone(),
                    chain_name: chain.chain_name.clone(),
                    version_index: chain.version_index,
                };
                result.chain_round = Some(round.clone());
                record_chain_round(project_path, conversation_id, round).await;
            }
        }
    }
    Ok(result)
}

/// 常规取材组装的错误：锁不可得（失败关闭，不调用组装）或材料拒绝（结构化）。
enum AssembleContextError {
    LockUnavailable,
    Denied(project::MaterialDenial),
}

/// 在作品锁保护下组装常规取材语境；锁获取失败时立即失败关闭，绝不调用组装。
fn assemble_context_under_lock(
    locks: &ProjectLocks,
    project_root: &std::path::Path,
    focus_document_id: &str,
    focus_document_version: Option<&str>,
    focus_snapshot: Option<&str>,
    question: &str,
) -> Result<project::RoundContext, AssembleContextError> {
    let _guard = locks
        .acquire(project_root)
        .map_err(|_| AssembleContextError::LockUnavailable)?;
    project::assemble_round_context(
        project_root,
        focus_document_id,
        focus_document_version,
        focus_snapshot,
        question,
    )
    .map_err(AssembleContextError::Denied)
}

/// 取材锁不可得时的安全错误：失败关闭，本轮请求未发送，不泄露路径或身份。
fn context_lock_unavailable_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::Service,
        "作品读取暂时不可用，本次请求未发送。",
    )
}

/// 作品存在待恢复事务现场时的安全错误：严格只读失败关闭，本轮请求未发送。
/// 固定文案，不泄露文档身份、路径或正文；用户自救路径是重新打开作品完成恢复。
fn story_recovery_required_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::StoryRecoveryRequired,
        "作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。",
    )
}

/// 关注文档现场材料组装失败时的安全错误：不泄露文档身份、路径或正文。
fn invalid_story_context_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::InvalidResponse,
        "关注文档不可用，本次请求未发送。",
    )
}

// ========== 链路卡冻结与逐轮记录（add-making-module-core 任务组 3/4，design D1/D2/D6） ==========

/// 轮次发起时冻结的启用链路：一次快照读取的产物同时供下发（`chain_cards` /
/// `posture` 协议字段）与落档（记录级 `chain_rounds`）使用——同源保证下发的
/// 卡文本与档案记录的链路版本永不漂移（design D6「冻结与档案同源」）。
#[derive(Debug)]
struct FrozenChainRound {
    chain_id: String,
    /// 链路名称快照（链路日后删除，历史记录仍可读）。
    chain_name: String,
    /// 版本序号（「第 N 版」显示用）。
    version_index: u32,
    /// 组装完成的要求卡注入文本（design D2：统一包装头＋各卡渲染）。纯姿态
    /// 版本为空串——发送路径省略 `chain_cards` 字段。
    cards_text: String,
    /// 组装完成的姿态段文本（add-posture-slot design D2/D3；2026-10-07 修订
    /// 7.2 多卡：承接句一次＋全部姿态卡正文以空行依序拼接，不做冲突调和）；
    /// `None`＝本版本无姿态卡（发送路径省略 `posture` 字段）。
    /// 与 `cards_text` 同一次冻结产出（同源）。
    posture_text: Option<String>,
    /// 本轮序号（首轮为 0，与 `MaterialProvenance::turn_index` 同一约定）；
    /// `None` 表示无讨论身份（该轮不落档，卡仍照常下发）。
    turn_index: Option<u32>,
}

/// 轮次发起时的链路冻结（任务 3.2）：读 `active` 指针快照（链路库单例锁内），
/// 未启用返回 `None`——发送路径省略 `chain_cards` 字段，与无链路现状逐字节
/// 一致。读取失败（链路库损坏等）明确报错失败关闭：用户启用的链路不得被
/// 静默跳过。轮内只读这一次快照，冻结后不再读指针（在途轮不受打扰）。
fn freeze_chain_round_blocking(
    store: &crate::chain_library::ChainLibraryStore,
    kind: llm_config::AiMessageKind,
    conversation_id: Option<&str>,
    conversation_project_path: Option<&str>,
) -> Result<Option<FrozenChainRound>, crate::chain_library::ChainLibraryError> {
    let Some(active) = store.snapshot_active()? else {
        return Ok(None);
    };
    // 轮次序号与卡文本同源冻结：首轮（常规 / 召唤）恒为 0；追问按档案已完成
    // 轮数推导（与前端重开派生 nextTurnId 同一语义）；无讨论身份时不落档。
    let turn_index = match kind {
        llm_config::AiMessageKind::FollowUp => match (conversation_id, conversation_project_path) {
            (Some(conversation_id), Some(project_path)) => {
                Some(crate::conversation_store::next_follow_up_turn_index(
                    std::path::Path::new(project_path),
                    conversation_id,
                ))
            }
            _ => None,
        },
        _ => Some(0),
    };
    // 卡类型分流（add-posture-slot 任务 2.3，design D2；2026-10-07 修订 7.2：
    // 姿态卡可多张）：全部姿态卡一并经 `assemble_posture` 渲染（承接句一次、
    // 各卡正文以空行依序拼接，不做冲突调和），要求卡照旧经
    // `assemble_chain_cards` 渲染——纯要求卡版本的 `cards_text` 与既有渲染
    // 逐字一致；两类文本同一次快照产出（同源）。
    let requirement_cards: Vec<crate::chain_library::RequirementCard> = active
        .cards
        .iter()
        .filter(|card| card.slot_type != crate::chain_library::SLOT_TYPE_POSTURE)
        .cloned()
        .collect();
    let posture_cards: Vec<crate::chain_library::RequirementCard> = active
        .cards
        .iter()
        .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
        .cloned()
        .collect();
    Ok(Some(FrozenChainRound {
        cards_text: llm_config::generate::assemble_chain_cards(&requirement_cards),
        posture_text: (!posture_cards.is_empty())
            .then(|| llm_config::generate::assemble_posture(&posture_cards)),
        chain_id: active.chain_id,
        chain_name: active.chain_name,
        version_index: active.version_index,
        turn_index,
    }))
}

/// 链路库读取失败时的安全错误：失败关闭，本轮请求未发送；固定文案，不泄露
/// 路径或库内容（具体错误经 stderr 记录诊断）。
fn chain_library_unavailable_error() -> llm_config::GenerateAiError {
    llm_config::GenerateAiError::new(
        llm_config::GenerateAiErrorCode::Service,
        "链路库暂时不可用，本次请求未发送；请到制作模块检查链路后重试。",
    )
}

/// 成功轮的链路记录落档（任务 4.1）：以窄更新追加记录级 `chain_rounds` 条目，
/// 用发起时冻结值（失败 / 取消轮不记，与自动取材出处行为一致；调用方已完成
/// turn_index 在场检查）。落档失败不失败轮次（轮次已成功；与按需补读出处
/// 落档的容错一致），如实记录 stderr。
/// await 落档完成再返回，保证先于前端终态整档保存（合并保护天然保全）。
async fn record_chain_round(
    project_path: &str,
    conversation_id: &str,
    round: crate::conversation_store::ChainRoundRecord,
) {
    let turn_index = round.turn_index;
    let root = PathBuf::from(project_path);
    let target_conversation_id = conversation_id.to_string();
    let write = tauri::async_runtime::spawn_blocking(move || {
        crate::conversation_store::upsert_chain_round(&root, &target_conversation_id, round)
    })
    .await;
    match write {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            eprintln!("讨论 {conversation_id} 第 {turn_index} 轮链路记录落档失败: {error}")
        }
        Err(join_error) => eprintln!(
            "讨论 {conversation_id} 第 {turn_index} 轮链路记录落档任务执行失败: {join_error}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::llm_config::{GenerateAiErrorCode, GenerateAiResult};

    /// 测试专用：按生产 `project::story_material::compute_version`（私有）的 FNV-1a
    /// 64-bit 算法复现内容派生版本，输出 16 位小写十六进制，格式与生产完全一致。
    /// 不放入生产 API，不放宽校验。
    fn compute_version_for_test(content: &str) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in content.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{hash:016x}")
    }

    #[tokio::test]
    async fn command_boundary_rejects_malformed_raw_requests_with_safe_results() {
        let cases = [
            serde_json::json!({
                "kind": "unknown",
                "selected_text": "选区"
            }),
            serde_json::json!({
                "kind": "first"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": "not-an-array"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant"}
                ]
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应"},
                    {"role": "system", "content": "不能进入请求"}
                ]
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应"},
                    {"role": "tool", "content": "不能进入请求"}
                ]
            }),
            serde_json::json!({
                "kind": "direct_question",
                "question": "   \n"
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request_with_material(
                Path::new("unused"),
                None,
                request,
                None,
            )
            .await;
            assert!(!result.ok);
            let error = result.error.expect("malformed request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
            assert!(!error.message.contains("选区"));
            assert!(!error.message.contains("not-an-array"));
            assert!(!error.message.contains("不能进入请求"));
        }
    }

    #[tokio::test]
    async fn command_boundary_validates_semantics_before_loading_configuration() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let cases = [
            serde_json::json!({
                "kind": "first",
                "selected_text": "   \n"
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "user", "content": "不能缺少首次回应"}
                ]
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request_with_material(
                temp.path(),
                None,
                request,
                None,
            )
            .await;
            assert!(!result.ok);
            let error = result.error.expect("invalid request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }
    }

    /// 2.7 生成命令协议白名单：注入 `draft_content`/`main_content`/`project_path`
    /// 等未声明字段（含嵌套消息内），必须稳定拒绝，且作品文件字节不变。
    #[tokio::test]
    async fn generate_command_rejects_unknown_fields_without_touching_project_files() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let project_root =
            crate::project::create_new_project(crate::project::CreateProjectParams {
                name: "白名单作品".to_string(),
                save_location: temp.path().to_string_lossy().to_string(),
            })
            .expect("create project");

        let paths = crate::project::ProjectPaths::new(project_root);
        // 版本 3 布局：内容树元数据 + 根级文档正文 + 作品元信息。
        let tree: crate::project::ContentTree = serde_json::from_str(
            &std::fs::read_to_string(&paths.content_tree_file).expect("read content tree"),
        )
        .expect("parse content tree");
        let doc_ids: Vec<String> = tree.root_children.clone();
        let mut files = vec![paths.content_tree_file.clone(), paths.metadata_file.clone()];
        for id in &doc_ids {
            files.push(paths.document_file(id));
        }
        let before: Vec<Vec<u8>> = files
            .iter()
            .map(|path| std::fs::read(path).expect("read project file before"))
            .collect();

        let cases = [
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "draft_content": "注入草稿",
            }),
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "main_content": "注入正文",
            }),
            serde_json::json!({
                "kind": "first",
                "selected_text": "选区",
                "project_path": "注入路径",
                "document_id": "文档",
            }),
            serde_json::json!({
                "kind": "follow_up",
                "selected_text": "选区",
                "messages": [
                    {"role": "assistant", "content": "首次回应", "draft_content": "嵌套注入"}
                ],
            }),
        ];

        for request in cases {
            let result = super::generate_ai_result_for_request_with_material(
                temp.path(),
                None,
                request,
                None,
            )
            .await;
            assert!(!result.ok, "未知字段请求必须被拒绝");
            let error = result.error.expect("rejected request error");
            assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
            assert_eq!(error.message, "AI 请求内容无效，请重试");
        }

        for (path, before_bytes) in files.iter().zip(before.iter()) {
            let after = std::fs::read(path).expect("read project file after");
            assert_eq!(
                &after,
                before_bytes,
                "生成命令拒绝未知字段时不得改动作品文件: {}",
                path.display()
            );
        }
    }

    fn _assert_result_type_is_stable(_: GenerateAiResult) {}

    /// 队列 3b：取材锁获取失败时失败关闭——返回 LockUnavailable，且错误先于组装。
    #[test]
    fn assemble_context_lock_unavailable_fails_closed_before_assembly() {
        let locks = crate::project::ProjectLocks::default();
        // 无法规范化取锁的路径 → LockUnavailable（组装无从被调用）。
        let result = super::assemble_context_under_lock(
            &locks,
            std::path::Path::new("Z:/definitely/not/a/real/project"),
            "doc-1",
            None,
            None,
            "问题",
        );
        assert!(matches!(
            result,
            Err(super::AssembleContextError::LockUnavailable)
        ));

        // 固定文案：安全、可读、不泄露路径或身份。
        let error = super::context_lock_unavailable_error();
        assert_eq!(error.message, "作品读取暂时不可用，本次请求未发送。");
    }

    /// enforce-strict-story-read-boundary：待恢复事务的生成链错误使用专用码与固定文案，
    /// 且错误在发起模型请求前返回（本轮未发送）。
    #[test]
    fn story_recovery_required_error_uses_dedicated_code_and_fixed_message() {
        let error = super::story_recovery_required_error();
        assert_eq!(
            error.code,
            crate::llm_config::GenerateAiErrorCode::StoryRecoveryRequired
        );
        assert_eq!(
            error.message,
            "作品有未完成的保存，请重新打开作品完成恢复后再试。本次 AI 请求未发送。"
        );
    }

    #[test]
    fn selected_material_requires_complete_source_identity() {
        let error =
            super::selection_identity_error(Some("冻结选区"), None, None, Some("doc"), None)
                .expect_err("裸选区必须拒绝");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
    }

    #[test]
    fn snapshot_without_identity_is_rejected() {
        let error = super::selection_identity_error(
            None,
            Some(
                "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\"}}",
            ),
            Some("D:\\作品"),
            None,
            None,
        )
        .expect_err("仅快照缺文档/版本身份必须拒绝");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
    }

    /// controlled-story-read-visibility：合法快照经授权后返回受控材料，
    /// 生成层据此使用授权内容；错误快照失败关闭。
    #[test]
    fn valid_snapshot_is_authorized_and_wrong_snapshot_is_rejected() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = crate::project::create_new_project(crate::project::CreateProjectParams {
            name: "快照授权测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = crate::project::recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        // 合法快照：单段落正文，选区即整段纯文本，快照为规范化 Tiptap JSON。
        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");
        assert_eq!(material.document_id, doc_id);
        assert_eq!(material.version, version);
        assert!(material.content.contains("林站在天台边。"));

        // 错误快照：不是合法 Tiptap JSON → 失败关闭，不返回正文。
        let invalid_json = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some("不是合法文档 JSON"),
            None,
        )
        .expect_err("非法快照必须拒绝");
        assert_eq!(invalid_json.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(invalid_json.message, "AI 请求内容无效，请重试");

        // 快照正文不包含选区文本 → 裸选区文本不能绕过授权。
        let mismatch = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("完全不相干的一段话"),
            Some(snapshot),
            None,
        )
        .expect_err("选区不落在快照正文内必须拒绝");
        assert_eq!(mismatch.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(mismatch.message, "AI 请求内容无效，请重试");
    }

    /// 授权通过的快照材料进入生成提示词；原始 selected_text 不得绕过授权。
    #[test]
    fn authorized_snapshot_material_enters_prompt() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = crate::project::create_new_project(crate::project::CreateProjectParams {
            name: "授权材料进提示词".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = crate::project::recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        // 生成层使用授权材料 content，而非原始 selected_text 字段。
        // 授权通过后，选区文本已被确认落在授权材料正文内，提示词只能携带该授权选区。
        assert!(
            material.content.contains("林站在天台边。"),
            "选区文本必须落在授权材料正文内"
        );
        let request = crate::llm_config::GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            document_id: Some(doc_id),
            project_path: Some(project_path),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        let task = crate::llm_config::generate::build_task_string(&request).expect("build task");
        assert!(
            task.contains("林站在天台边。"),
            "授权选区内容必须进入提示词"
        );

        let selected = super::authorized_selection_from_material(&material, "林站在天台边。")
            .expect("授权材料应能提取已验证选区");
        assert_eq!(selected, "林站在天台边。");
        assert!(
            super::authorized_selection_from_material(&material, "伪造材料").is_none(),
            "不在受控材料中的原始选区不得进入提示词"
        );
    }

    /// `authorized_selection_text` 必须从已授权材料提取选区，绝不直接复用原始
    /// `selected_text` 字段；伪造选区或缺少授权材料时失败关闭，无选区返回 `None`。
    #[test]
    fn authorized_selection_text_extracts_material_and_fails_closed() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = crate::project::create_new_project(crate::project::CreateProjectParams {
            name: "授权提取测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = crate::project::recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        // 有授权材料 + 匹配选区 → 从材料正文提取。
        let extracted = super::authorized_selection_text(Some(&material), Some("林站在天台边。"))
            .expect("授权材料应能提取选区")
            .expect("应返回选区内容");
        assert_eq!(extracted, "林站在天台边。");

        // 伪造选区（不落在授权材料正文内）→ 失败关闭，绝不进入提示词。
        assert!(
            super::authorized_selection_text(Some(&material), Some("完全不相干的一段话")).is_err(),
            "伪造选区必须失败关闭"
        );

        // 有选区却无授权材料 → 失败关闭（绝不静默回退到原始 selected_text）。
        assert!(
            super::authorized_selection_text(None, Some("林站在天台边。")).is_err(),
            "有选区却无授权材料必须失败关闭"
        );

        // 无选区（直接提问 / 追问）与空白选区 → None。
        assert_eq!(
            super::authorized_selection_text(None, None).expect("无选区应成功"),
            None
        );
        assert_eq!(
            super::authorized_selection_text(Some(&material), Some("   \n"))
                .expect("空白选区应成功"),
            None
        );
    }

    /// 生产命令路径：`apply_authorized_selection` 用授权材料重写请求中声明的选区，
    /// 使提示词组装只看到受控材料内容，原始 `selected_text` 不直接进入 DSH prompt。
    #[test]
    fn apply_authorized_selection_rewrites_request_selection_from_material() {
        let temp = tempfile::TempDir::new().expect("create temp dir");
        let root = crate::project::create_new_project(crate::project::CreateProjectParams {
            name: "重写选区测试".to_string(),
            save_location: temp.path().to_string_lossy().to_string(),
        })
        .expect("create project");
        let tree = crate::project::recover_then_read_content_tree(&root).expect("open tree");
        let doc_id = tree.root_children[0].clone();
        let project_path = root.to_string_lossy().to_string();

        let snapshot = "{\"format\":\"next-story-tiptap\",\"version\":2,\"document\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"林站在天台边。\"}]}]}}";
        let version = compute_version_for_test(snapshot);
        let material = super::authorize_selection_sync(
            &project_path,
            &doc_id,
            &version,
            Some("林站在天台边。"),
            Some(snapshot),
            None,
        )
        .expect("合法快照必须授权通过")
        .expect("应返回受控材料");

        let request = crate::llm_config::GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            document_id: Some(doc_id),
            project_path: Some(project_path),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        let rewritten = super::apply_authorized_selection(request, Some(&material))
            .expect("授权材料应能重写选区");
        match &rewritten {
            crate::llm_config::GenerateAiRequest::First { selected_text, .. } => {
                assert_eq!(selected_text, "林站在天台边。");
            }
            other => panic!("应为 First 变体，实际: {other:?}"),
        }

        // 伪造选区重写失败关闭：原始 selected_text 不会直接进入 DSH prompt。
        let forged = crate::llm_config::GenerateAiRequest::First {
            selected_text: "伪造材料".to_string(),
            document_id: Some("doc".to_string()),
            project_path: Some("project".to_string()),
            document_version: Some(version.clone()),
            snapshot: Some(snapshot.to_string()),
            thinking_direction: None,
        };
        assert!(
            super::apply_authorized_selection(forged, Some(&material)).is_err(),
            "伪造选区必须失败关闭，不得进入提示词"
        );
    }

    // ========== 链路冻结编排回归（add-making-module-core 任务 3.5，design D6） ==========

    use crate::chain_library::{CardInput, ChainLibraryStore};
    use crate::llm_config::AiMessageKind;

    /// 以临时目录充当应用本地数据目录建链路库单例。
    fn chain_store_in(base: &tempfile::TempDir) -> ChainLibraryStore {
        ChainLibraryStore::new(Some(base.path().to_path_buf()))
    }

    fn chain_cards_input(marker: &str) -> Vec<CardInput> {
        vec![CardInput {
            title: format!("测试卡{marker}"),
            trigger_desc: format!("适用：{marker} 场景。\n不适用：其他场景。"),
            body: format!("按{marker}的正文行事。"),
            slot_type: crate::chain_library::SLOT_TYPE_REQUIREMENT.to_string(),
        }]
    }

    /// 一张姿态卡入参（add-posture-slot 测试用）。
    fn posture_input(marker: &str) -> CardInput {
        CardInput {
            title: format!("姿态{marker}"),
            trigger_desc: "适用：想要这个姿态时。\n不适用：不适用情形。".to_string(),
            body: format!("【姿态{marker}】\n你以{marker}的姿态说话。"),
            slot_type: crate::chain_library::SLOT_TYPE_POSTURE.to_string(),
        }
    }

    /// 无启用链路（含从未启用与停用后）：冻结为 None——发送路径省略
    /// `chain_cards` 协议字段，与无链路现状逐字节一致（字段省略行为由
    /// dsh_driver 协议形状测试钉住）。
    #[test]
    fn chain_freeze_returns_none_without_active_chain() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);

        assert!(
            super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
                .expect("freeze")
                .is_none(),
            "从未启用链路时冻结为 None"
        );

        // 建链路、存版本但不启用：存了不等于生效。
        let chain = store.create_chain("链路甲").expect("create");
        let version = store
            .save_version(&chain.id, &chain_cards_input("甲"), "初稿")
            .expect("save version");
        assert!(
            super::freeze_chain_round_blocking(&store, AiMessageKind::FollowUp, None, None)
                .expect("freeze")
                .is_none(),
            "保存版本不等于启用，冻结仍为 None"
        );

        // 启用后停用：下一轮起回到 None（停用下一轮生效）。
        store.set_active(&chain.id, &version.id).expect("activate");
        store.deactivate().expect("deactivate");
        assert!(
            super::freeze_chain_round_blocking(&store, AiMessageKind::SummonFirst, None, None)
                .expect("freeze")
                .is_none(),
            "停用后冻结为 None"
        );
    }

    /// 有启用链路：冻结携带组装文本（与 `assemble_chain_cards` 同一渲染源）与
    /// 链路标识快照；下发文本与落档字段来自同一次冻结（同源）。轮次序号：
    /// 首轮恒为 0；追问按档案已完成轮数推导；无讨论身份的追问不落档。
    #[test]
    fn chain_freeze_assembles_cards_and_derives_turn_index() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);
        let chain = store.create_chain("链路甲").expect("create");
        let version = store
            .save_version(&chain.id, &chain_cards_input("甲"), "初稿")
            .expect("save version");
        store.set_active(&chain.id, &version.id).expect("activate");
        let snapshot = store.snapshot_active().expect("snapshot").expect("active");

        // 首轮（常规 / 召唤）：序号 0，组装文本与冻结卡同一渲染源。
        for kind in [AiMessageKind::First, AiMessageKind::SummonFirst] {
            let frozen = super::freeze_chain_round_blocking(&store, kind, None, None)
                .expect("freeze")
                .expect("frozen");
            assert_eq!(frozen.turn_index, Some(0), "首轮序号为 0");
            assert_eq!(frozen.chain_id, chain.id);
            assert_eq!(frozen.chain_name, "链路甲", "名称快照随冻结携带");
            assert_eq!(frozen.version_index, version.index);
            assert_eq!(
                frozen.cards_text,
                crate::llm_config::generate::assemble_chain_cards(&snapshot.cards),
                "下发文本与冻结卡同源（同一组装函数）"
            );
            assert!(frozen.cards_text.contains("【测试卡甲】"));
            assert!(frozen.cards_text.contains("以下是用户提供的陪想要求"));
            assert!(frozen.posture_text.is_none(), "纯要求卡版本冻结不带姿态段");
        }

        // 无讨论身份的追问：卡照常冻结，但不落档（序号 None）。
        let follow_up =
            super::freeze_chain_round_blocking(&store, AiMessageKind::FollowUp, None, None)
                .expect("freeze")
                .expect("frozen");
        assert_eq!(follow_up.turn_index, None, "无讨论身份不落档");
        assert!(
            follow_up.cards_text.contains("【测试卡甲】"),
            "卡仍照常下发"
        );

        // 有讨论身份的追问：序号按档案已完成轮数推导（首轮为 0 的同一约定）。
        let work = tempfile::tempdir().expect("work dir");
        let record = crate::conversation_store::ConversationRecord {
            version: crate::conversation_store::CONVERSATION_VERSION,
            conversation_id: "conv-1".to_string(),
            created_at: "2026-10-06T10:00:00+00:00".to_string(),
            updated_at: "2026-10-06T10:30:00+00:00".to_string(),
            focus_document_id: None,
            focus_document_title: None,
            first_round_material: crate::conversation_store::FirstRoundMaterial {
                kind: "direct_question".to_string(),
                question: "问题".to_string(),
                selection_text: None,
            },
            turns: vec![
                crate::conversation_store::ConversationTurn {
                    role: "user".to_string(),
                    text: "问题".to_string(),
                    status: "done".to_string(),
                },
                crate::conversation_store::ConversationTurn {
                    role: "assistant".to_string(),
                    text: "首轮".to_string(),
                    status: "done".to_string(),
                },
                crate::conversation_store::ConversationTurn {
                    role: "user".to_string(),
                    text: "追问一".to_string(),
                    status: "done".to_string(),
                },
                crate::conversation_store::ConversationTurn {
                    role: "assistant".to_string(),
                    text: "回答一".to_string(),
                    status: "done".to_string(),
                },
            ],
            title: None,
            pinned: false,
            provenance: None,
            on_demand_reading_grant: None,
            on_demand_reading_provenance: None,
            chain_rounds: None,
            restriction: None,
        };
        crate::conversation_store::seed_conversation(work.path(), &record).expect("seed");

        let frozen = super::freeze_chain_round_blocking(
            &store,
            AiMessageKind::FollowUp,
            Some("conv-1"),
            Some(work.path().to_str().expect("utf8 path")),
        )
        .expect("freeze")
        .expect("frozen");
        assert_eq!(
            frozen.turn_index,
            Some(2),
            "追问序号＝档案已完成追问对数（1）＋1"
        );
        assert_eq!(
            frozen.cards_text,
            crate::llm_config::generate::assemble_chain_cards(&snapshot.cards),
            "同源：下发的文本与可落档的冻结值来自同一次读取"
        );
    }

    /// 切换下一轮生效：每次发起重新读指针冻结；已冻结的值不再受后续切换
    /// 影响（在途轮不受打扰）。同轮冻结值既定下发文本又定落档字段。
    #[test]
    fn chain_switch_takes_effect_next_round_and_frozen_value_is_stable() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);
        let chain = store.create_chain("链路甲").expect("create");
        let v1 = store
            .save_version(&chain.id, &chain_cards_input("一"), "v1")
            .expect("v1");
        let v2 = store
            .save_version(&chain.id, &chain_cards_input("二"), "v2")
            .expect("v2");
        store.set_active(&chain.id, &v1.id).expect("activate v1");

        // 第一轮按 v1 冻结。
        let round_one =
            super::freeze_chain_round_blocking(&store, AiMessageKind::First, Some("conv-x"), None)
                .expect("freeze")
                .expect("frozen");
        assert_eq!(round_one.version_index, 1);
        assert!(round_one.cards_text.contains("按一的正文行事。"));

        // 生成中切换到 v2：在途轮（round_one 已冻结）不受打扰；下一轮按 v2。
        store.set_active(&chain.id, &v2.id).expect("switch to v2");
        assert_eq!(
            round_one.version_index, 1,
            "已冻结的值不因切换改变（在途轮沿用发起时版本）"
        );
        assert!(round_one.cards_text.contains("按一的正文行事。"));

        let round_two = super::freeze_chain_round_blocking(
            &store,
            AiMessageKind::FollowUp,
            Some("conv-x"),
            None,
        )
        .expect("freeze")
        .expect("frozen");
        assert_eq!(round_two.version_index, 2, "切换下一轮生效");
        assert!(round_two.cards_text.contains("按二的正文行事。"));
        assert!(
            !round_two.cards_text.contains("按一的正文行事。"),
            "新轮冻结不再携带旧版本卡"
        );
        assert_eq!(round_two.turn_index, None, "无作品路径不落档（卡仍下发）");

        // 停用：下一轮起回到 None。
        store.deactivate().expect("deactivate");
        assert!(
            super::freeze_chain_round_blocking(
                &store,
                AiMessageKind::FollowUp,
                Some("conv-x"),
                None
            )
            .expect("freeze")
            .is_none(),
            "停用下一轮生效：新发起轮次不带卡"
        );
    }

    /// add-posture-slot 任务 2.3/2.6（2026-10-07 修订 7.2）：冻结按 slot_type
    /// 分流且两字段同源——姿态卡（可多张）只进 posture_text、要求卡只进
    /// cards_text；纯姿态版本 cards_text 为空（发送路径省略字段）；纯要求卡
    /// 版本的 cards_text 与「把全部卡当要求卡渲染」的既有算法逐字一致
    /// （存量链路行为不变锚点）。
    #[test]
    fn chain_freeze_splits_posture_and_requirement_from_same_snapshot() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);
        let chain = store.create_chain("链路甲").expect("create");

        // 混合版本：一张要求卡＋一张姿态卡（次序故意姿态在前，分流不受次序影响）。
        let mixed_input = {
            let mut cards = chain_cards_input("甲");
            cards.push(posture_input("傲娇"));
            cards
        };
        let mixed = store
            .save_version(&chain.id, &mixed_input, "混合 v1")
            .expect("save mixed");
        store.set_active(&chain.id, &mixed.id).expect("activate");
        let snapshot = store.snapshot_active().expect("snapshot").expect("active");

        let frozen = super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
            .expect("freeze")
            .expect("frozen");
        let requirement_only: Vec<crate::chain_library::RequirementCard> = snapshot
            .cards
            .iter()
            .filter(|card| card.slot_type != crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        let posture_only: Vec<crate::chain_library::RequirementCard> = snapshot
            .cards
            .iter()
            .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        // 同源：cards_text 与 posture_text 都可从同一快照重算得出。
        assert_eq!(
            frozen.cards_text,
            crate::llm_config::generate::assemble_chain_cards(&requirement_only),
            "cards_text 只含要求卡（与同快照要求卡同一渲染源）"
        );
        assert_eq!(
            frozen.posture_text.as_deref(),
            Some(crate::llm_config::generate::assemble_posture(&posture_only).as_str()),
            "posture_text 与同快照全部姿态卡同一渲染源"
        );
        // 分流互不污染：姿态正文不进要求卡文本，要求卡标记不进姿态段。
        assert!(
            !frozen.cards_text.contains("你以傲娇的姿态说话"),
            "姿态卡正文不得进入 cards_text"
        );
        let posture_text = frozen.posture_text.expect("姿态段在场");
        assert!(
            !posture_text.contains("【测试卡甲】"),
            "要求卡标记不得进入 posture_text"
        );
        assert!(
            posture_text.contains("你以傲娇的姿态说话"),
            "姿态段携带姿态卡正文（标题行已剥去）"
        );

        // 多姿态卡版本（修订 7.2）：全部姿态卡正文入 posture_text（承接句一次、
        // 依序拼接），cards_text 不含任何姿态内容——多张不做冲突调和。
        let multi_posture_input = vec![
            posture_input("傲娇"),
            chain_cards_input("甲").remove(0),
            posture_input("冷静"),
        ];
        let multi_posture = store
            .save_version(&chain.id, &multi_posture_input, "多姿态 v2")
            .expect("save multi posture");
        store
            .set_active(&chain.id, &multi_posture.id)
            .expect("activate v2");
        let frozen = super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
            .expect("freeze")
            .expect("frozen");
        let posture_text = frozen.posture_text.clone().expect("多姿态段在场");
        // 同源：两字段都可从库内该版本卡数据重算得出。
        let stored_multi = snapshot_cards_of(&store, &multi_posture.id);
        let multi_requirement: Vec<crate::chain_library::RequirementCard> = stored_multi
            .iter()
            .filter(|card| card.slot_type != crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        let multi_posture_cards: Vec<crate::chain_library::RequirementCard> = stored_multi
            .iter()
            .filter(|card| card.slot_type == crate::chain_library::SLOT_TYPE_POSTURE)
            .cloned()
            .collect();
        assert_eq!(multi_posture_cards.len(), 2, "多姿态版本确实含两张姿态卡");
        assert_eq!(
            frozen.posture_text.as_deref(),
            Some(crate::llm_config::generate::assemble_posture(&multi_posture_cards).as_str()),
            "posture_text 与同快照全部姿态卡同一渲染源（承接句一次、依序拼接）"
        );
        let tsundere_at = posture_text.find("你以傲娇的姿态说话").expect("傲娇正文");
        let calm_at = posture_text.find("你以冷静的姿态说话").expect("冷静正文");
        assert!(tsundere_at < calm_at, "多姿态正文按版本内既定次序拼接");
        assert_eq!(
            frozen.cards_text,
            crate::llm_config::generate::assemble_chain_cards(&multi_requirement),
            "cards_text 仍只含要求卡（与多姿态无关）"
        );
        assert!(
            !frozen.cards_text.contains("的姿态说话"),
            "任何姿态卡正文不得进入 cards_text"
        );

        // 纯姿态版本：cards_text 为空（发送路径据此省略 chain_cards 字段）。
        let pure_posture = store
            .save_version(&chain.id, &[posture_input("冷静")], "纯姿态 v3")
            .expect("save pure posture");
        store
            .set_active(&chain.id, &pure_posture.id)
            .expect("activate v3");
        let frozen = super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
            .expect("freeze")
            .expect("frozen");
        assert!(
            frozen.cards_text.is_empty(),
            "纯姿态版本的 cards_text 为空（省略协议字段）"
        );
        assert!(frozen.posture_text.is_some());
        assert!(
            frozen
                .posture_text
                .expect("姿态段")
                .contains("你以冷静的姿态说话"),
            "纯姿态版本只带姿态段"
        );

        // 纯要求卡版本：cards_text 与改前算法（全部卡经 assemble_chain_cards）
        // 逐字一致——存量链路最终 system 文本不变（chain-assembly 规格）。
        let pure_requirement = store
            .save_version(&chain.id, &chain_cards_input("乙"), "纯要求 v4")
            .expect("save pure requirement");
        store
            .set_active(&chain.id, &pure_requirement.id)
            .expect("activate v4");
        let frozen = super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
            .expect("freeze")
            .expect("frozen");
        assert_eq!(
            frozen.cards_text,
            crate::llm_config::generate::assemble_chain_cards(&snapshot_cards_of(
                &store,
                &pure_requirement.id
            )),
            "纯要求卡版本的组装文本与既有渲染逐字一致"
        );
        assert!(frozen.posture_text.is_none());
    }

    /// 以链路库单例读回指定版本的卡数据（测试辅助：绕开私有中间结构）。
    fn snapshot_cards_of(
        store: &ChainLibraryStore,
        version_id: &str,
    ) -> Vec<crate::chain_library::RequirementCard> {
        let library = store.load().expect("读库");
        library
            .chains
            .iter()
            .flat_map(|chain| chain.versions.iter())
            .find(|version| version.id == version_id)
            .expect("版本在场")
            .cards
            .clone()
    }

    /// add-posture-slot 任务 2.6（崩溃重放姿态语义）：start_session 常量不含
    /// 姿态（generate.rs 侧锚定），重放 turns 结构上只有 role/text——不从历史
    /// chain_rounds 复原旧姿态；恢复后首轮按当前指针重新冻结（换指针即换姿态，
    /// 已冻结的旧轮不受打扰）。
    #[test]
    fn posture_recovery_re_freezes_by_pointer_not_history() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);
        let chain = store.create_chain("链路甲").expect("create");

        let v1_input = {
            let mut cards = chain_cards_input("甲");
            cards.push(posture_input("傲娇"));
            cards
        };
        let v1 = store.save_version(&chain.id, &v1_input, "v1").expect("v1");
        let v2_input = {
            let mut cards = chain_cards_input("甲");
            cards.push(posture_input("冷静"));
            cards
        };
        let v2 = store.save_version(&chain.id, &v2_input, "v2").expect("v2");
        store.set_active(&chain.id, &v1.id).expect("activate v1");

        // 第一轮按 v1 冻结（姿态＝傲娇）。
        let round_one =
            super::freeze_chain_round_blocking(&store, AiMessageKind::First, Some("conv-x"), None)
                .expect("freeze")
                .expect("frozen");
        assert!(round_one
            .posture_text
            .as_deref()
            .expect("姿态段")
            .contains("你以傲娇的姿态说话"));

        // 崩溃恢复语义：重放 turns 是显示历史的纯投影——结构上不存在姿态/
        // 卡片字段（serde 钉死），旧姿态不可能从历史复原。
        let replay_turn = crate::dsh_driver::DriverReplayTurn {
            role: "user".to_string(),
            text: "问题".to_string(),
        };
        let replay_json = serde_json::to_value(&replay_turn).expect("序列化");
        assert_eq!(
            replay_json,
            serde_json::json!({"role": "user", "text": "问题"}),
            "重放 turn 只有 role/text 两个字段（无 posture / chain_cards）"
        );

        // 恢复后首轮按**当前指针**重新冻结：换到 v2 后新轮带「冷静」，
        // 已冻结的 round_one 仍持「傲娇」（在途轮不受打扰）。
        store.set_active(&chain.id, &v2.id).expect("switch to v2");
        let round_two = super::freeze_chain_round_blocking(
            &store,
            AiMessageKind::FollowUp,
            Some("conv-x"),
            None,
        )
        .expect("freeze")
        .expect("frozen");
        assert!(
            round_two
                .posture_text
                .as_deref()
                .expect("姿态段")
                .contains("你以冷静的姿态说话"),
            "恢复后首轮按当前指针重新冻结（新姿态）"
        );
        assert!(
            round_one
                .posture_text
                .as_deref()
                .expect("姿态段")
                .contains("你以傲娇的姿态说话"),
            "已冻结轮次的姿态不因指针切换改变"
        );
    }

    /// 链路库读取失败（损坏）：冻结失败关闭，本轮未发送——用户启用的链路
    /// 不得被静默跳过；错误为固定安全文案。
    #[test]
    fn chain_freeze_fails_closed_on_corrupt_library() {
        let base = tempfile::tempdir().expect("temp dir");
        let store = chain_store_in(&base);
        let chain = store.create_chain("链路甲").expect("create");
        let version = store
            .save_version(&chain.id, &chain_cards_input("甲"), "初稿")
            .expect("save version");
        store.set_active(&chain.id, &version.id).expect("activate");

        // 直接破坏主文件（模拟手工编辑损坏）。
        std::fs::write(
            crate::chain_library::making_module_dir_in(base.path()).join("chains.json"),
            "{ not json",
        )
        .expect("corrupt chains file");

        let error = super::freeze_chain_round_blocking(&store, AiMessageKind::First, None, None)
            .expect_err("链路库损坏必须报错，不能静默无卡发起");
        assert!(
            error.to_string().contains("损坏"),
            "底层错误如实分类: {error}"
        );

        // 编排层映射为固定安全错误：失败关闭、本轮未发送。
        let mapped = super::chain_library_unavailable_error();
        assert_eq!(mapped.code, GenerateAiErrorCode::Service);
        assert_eq!(
            mapped.message,
            "链路库暂时不可用，本次请求未发送；请到制作模块检查链路后重试。"
        );
    }
}
