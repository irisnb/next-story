//! 使用唯一保存配置，通过 DSH headless 生成 AI 思考材料。
//!
//! 只接收选区原文（含可选方向与追问轮次），由本模块集中组装固定首版思考任务，
//! 序列化为单个 task 字符串交给 DSH。前端不传入 API Key，也不持有任何写入
//! 草稿本或正文本的入口。

use std::path::{Path, PathBuf};

use super::{
    load_llm_config, validate_llm_config, FollowUpOrigin, GenerateAiError, GenerateAiErrorCode,
    GenerateAiMessageRole, GenerateAiRequest, GenerateAiResult, LlmConfig,
};
use crate::dsh_driver::{DriverParams, DriverReplayTurn};
use crate::dsh_sidecar;
use crate::dsh_version::DshVersionLayout;

/// 提示词入口：本轮请求以哪种方式发起，决定入口层立场句。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptEntry {
    /// 直接提问：用户问题为主，选区为可选重点材料。
    DirectQuestion,
    /// 及时召唤：只有冻结选区材料，没有用户问题。
    Summon,
}

/// 红线层：两块旧碑文的边界条款逐字合并，每次组装照抄，一条不删。
/// 这是铁律 2/3 在提示词层的落地，不得在组装中弱化或省略。
fn constitution_prompt() -> &'static str {
    "你是陪剧本创作者思考的助手。不直接改草稿本或正文本，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
不能声称读取或使用选区前后文；不能声称读取或使用当前本子全文；不能声称读取或使用摘要；不能声称读取或使用作品元数据；不能声称读取或使用AI 内容库；不能声称读取或使用历史会话；不能声称读取或使用记忆；不能声称读取或使用用户确认的作品事实。\
追问仍锚定首次冻结选区；只把已有轮次当作当前临时线性对话，不当作持久历史，不当作作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。"
}

/// 入口层：按入口给出本轮请求的立场句（含本轮可见材料的静态描述）。
fn entry_stance(entry: PromptEntry) -> &'static str {
    match entry {
        PromptEntry::DirectQuestion => {
            "当前请求提供用户直接提出的问题，以及用户可选的选区重点材料。\
若提供了重点材料，把它当作用户希望重点参考的片段，而不是作品事实或最终判断。\
先区分从材料里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。"
        }
        PromptEntry::Summon => {
            "当前请求只提供冻结选区原文，没有用户问题。\
把这段选区当作用户希望继续探索的材料，而不是作品事实或最终判断。\
先区分从文字里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。"
        }
    }
}

/// 语境层：本轮可见材料的动态描述。当前随入口层静态表达（材料描述已并入
/// 入口层立场句），此处先立结构留空，未来动态化时在此填入。
fn context_clause(_entry: PromptEntry) -> &'static str {
    ""
}

/// 三层组装系统提示词：红线层 + 入口层 + 语境层。
///
/// 组装职责集中在后端生成用例，不散落在 DOM 事件、前端桥接或底层 HTTP 模块。
pub fn compose_system_prompt(entry: PromptEntry) -> String {
    let mut prompt = String::from(constitution_prompt());
    prompt.push_str(entry_stance(entry));
    prompt.push_str(context_clause(entry));
    prompt
}

/// 使用唯一保存配置，围绕选区原文发起一次真实非流式生成（DSH headless）。
///
/// 使用 DSH 默认 home 与开发目录；测试路径使用本函数，生产命令入口使用
/// [`generate_ai_thinking_in_dir`]（版本隔离 home + 资源目录）。
pub async fn generate_ai_thinking(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
) -> Result<String, GenerateAiError> {
    let request = request.into();
    generate_with_dsh(config, &request, None, None).await
}

/// 从应用数据目录与资源目录生成：用版本隔离的 DSH_HOME（`<base_dir>/dsh/homes/<current>`）
/// 与打包后的资源目录解析 sidecar。生产命令入口使用本函数。
pub async fn generate_ai_thinking_in_dir(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
    base_dir: &Path,
    resource_dir: Option<&Path>,
) -> Result<String, GenerateAiError> {
    let request = request.into();
    generate_with_dsh(
        config,
        &request,
        Some(versioned_dsh_home(base_dir)),
        resource_dir,
    )
    .await
}

/// 通过 DSH 生成一次回复（resident-ai-session 改造后）。
///
/// legacy 命令入口（`generate_ai_thinking`）仍走本函数：把固定系统提示词、选区
/// 原文与追问轮次组装成单个消息文本，经常驻驱动以**临时会话**发送（start →
/// send → end），对前端保持一次性和非流式的旧契约。流式与增量由新的
/// `ai_send_message` 命令族承接（见下方常驻会话编排函数）。
///
/// `dsh_home` 为版本隔离的 DSH_HOME；`None` 表示沿用 DSH 默认 home（仅测试路径）。
/// `resource_dir` 为打包后的资源目录；`None` 表示开发目录回退。
async fn generate_with_dsh(
    config: &LlmConfig,
    request: &GenerateAiRequest,
    dsh_home: Option<PathBuf>,
    resource_dir: Option<&Path>,
) -> Result<String, GenerateAiError> {
    let task = build_task_string(request)?;

    validate_llm_config(config).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置不完整，请检查 API 地址、Key 与模型名",
        )
    })?;

    let paths = dsh_sidecar::resolve_paths(dsh_home, resource_dir)?;
    let params = DriverParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
    };
    let manager = crate::dsh_driver::global_driver_manager().clone();

    tauri::async_runtime::spawn_blocking(move || {
        manager.ensure_started(&params, &paths)?;
        let session_id = format!("legacy-{}", crate::dsh_driver::next_id());
        let message_id = format!("legacy-msg-{}", crate::dsh_driver::next_id());
        manager.start_session(&session_id)?;
        let text = match manager.send_message_and_wait(
            &session_id,
            &message_id,
            &task,
            crate::dsh_driver::REQUEST_TIMEOUT,
        ) {
            Ok(text) => text,
            Err(error) => {
                let _ = manager.end_session(&session_id);
                return Err(error);
            }
        };
        let _ = manager.end_session(&session_id);
        Ok(text)
    })
    .await
    .map_err(|join_error| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("DSH 生成任务执行失败: {join_error}"),
        )
    })?
}

/// 从应用数据目录派生版本隔离的 DSH_HOME（`<base_dir>/dsh/homes/<current_version>`）。
fn versioned_dsh_home(base_dir: &Path) -> PathBuf {
    DshVersionLayout::new(base_dir.join("dsh")).current_home()
}

// ========== 常驻会话编排（resident-ai-session 任务 3.3–3.4） ==========

/// 常驻会话消息种类：首轮（后端组装系统提示词与材料）或追问（只发增量问题）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiMessageKind {
    /// 首轮（直接提问）：组装系统提示词 + 用户问题 + 可选选区重点材料。
    First,
    /// 追问：只发送本次新增的问题，历史由常驻会话维护。
    FollowUp,
    /// 召唤首轮（及时召唤）：没有用户问题，只有冻结选区材料，
    /// 任务由后端按召唤语义组装（线上值为 `summon_first`）。
    SummonFirst,
}

/// 加载已保存的唯一 LLM 配置（阻塞读取放阻塞线程）。
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

/// 确保常驻驱动进程以当前配置启动（懒启动 / 参数变化重启 / 崩溃重启）。
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
    let paths = dsh_sidecar::resolve_paths(Some(versioned_dsh_home(base_dir)), resource_dir)?;
    let params = DriverParams {
        model: config.model.clone(),
        api_base_url: config.api_base_url.clone(),
        api_key: config.api_key.clone(),
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

/// 常驻会话：启动会话（同时懒启动驱动进程）。
pub async fn ai_start_session_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().start_session(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("会话启动任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：发送消息并等待终态。流式增量经驱动管理器的 sink 转发为前端事件。
///
/// - `First`：后端组装系统提示词 + 用户问题 + 可选选区重点材料（组装语义
///   与旧链路的 `direct_question_user_content` 完全一致）。
/// - `SummonFirst`：后端按召唤语义组装系统提示词 + 冻结选区材料，
///   不包含用户问题文本（前端传空字符串）。
/// - `FollowUp`：只发送本次新增的问题，历史由常驻会话维护。
pub async fn ai_send_message_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
    message_id: String,
    kind: AiMessageKind,
    question: String,
    selected_text: Option<String>,
) -> GenerateAiResult {
    let text = match compose_message_text(kind, &question, selected_text.as_deref()) {
        Ok(text) => text,
        Err(error) => return GenerateAiResult::failure(error),
    };
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().send_message_and_wait(
            &session_id,
            &message_id,
            &text,
            crate::dsh_driver::REQUEST_TIMEOUT,
        )
    })
    .await;
    match result {
        Ok(Ok(content)) => GenerateAiResult::success(content),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("生成任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：取消进行中的生成。进程未启动时为无操作（幂等）。
pub async fn ai_cancel_message_in_dir(session_id: String, message_id: String) -> GenerateAiResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().cancel_message(&session_id, &message_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("取消任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：结束会话（新建对话 / 切换作品）。进程未启动时为无操作（幂等）。
pub async fn ai_end_session_in_dir(session_id: String) -> GenerateAiResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().end_session(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("结束会话任务执行失败: {join_error}"),
        )),
    }
}

/// 崩溃恢复重放的会话来源：决定重放首轮按哪种入口语义组装提示词。
/// 临时对话不跨应用重启持久化，来源只存活在应用会话内存中，由前端传入。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayOrigin {
    /// 直接提问发起的对话。
    DirectQuestion,
    /// 及时召唤发起的对话。
    Summon,
}

/// 按重放来源组装首轮 user 轮的提示词前缀（纯函数，便于测试）。
fn replay_prompt_prefix(origin: ReplayOrigin) -> String {
    compose_system_prompt(match origin {
        ReplayOrigin::DirectQuestion => PromptEntry::DirectQuestion,
        ReplayOrigin::Summon => PromptEntry::Summon,
    })
}

/// 常驻会话：注入崩溃恢复历史（前端显示历史的增量投影，不触发再生成）。
///
/// 首个 user 轮由宿主按会话来源组装：把对应入口的系统提示词拼到最前
/// （恢复后的模型上下文与原会话首轮一致，陪想姿态不因恢复而丢失）；
/// 选区材料已由前端按 `direct_question_user_content` 的格式并入首轮文本。
pub async fn ai_replay_history_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
    origin: ReplayOrigin,
    mut turns: Vec<DriverReplayTurn>,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    if let Some(first) = turns.first_mut() {
        if first.role == "user" {
            first.text = format!("{}\n\n{}", replay_prompt_prefix(origin), first.text);
        }
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().replay_history(&session_id, turns)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("历史注入任务执行失败: {join_error}"),
        )),
    }
}

/// 常驻会话：历史注入完成，驱动以 seed 建会话并确认。
pub async fn ai_replay_done_in_dir(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    session_id: String,
) -> GenerateAiResult {
    let config = match load_saved_config(base_dir).await {
        Ok(config) => config,
        Err(error) => return GenerateAiResult::failure(error),
    };
    if let Err(error) = ensure_driver_started(&config, base_dir, resource_dir).await {
        return GenerateAiResult::failure(error);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::dsh_driver::global_driver_manager().replay_done(&session_id)
    })
    .await;
    match result {
        Ok(Ok(())) => GenerateAiResult::success(String::new()),
        Ok(Err(error)) => GenerateAiResult::failure(error),
        Err(join_error) => GenerateAiResult::failure(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("历史注入确认任务执行失败: {join_error}"),
        )),
    }
}

/// 把请求序列化为单个 DSH task 字符串：固定系统提示词 + 选区原文（含可选方向）
/// + 追问轮次（按角色标注），保持无状态临时对话语义。
pub fn build_task_string(request: &GenerateAiRequest) -> Result<String, GenerateAiError> {
    validate_generate_ai_request(request)?;

    let mut task = String::new();
    match request {
        GenerateAiRequest::First {
            selected_text,
            thinking_direction,
        } => {
            task.push_str(&compose_system_prompt(PromptEntry::Summon));
            task.push_str("\n\n");
            task.push_str(&first_user_content(selected_text, thinking_direction.as_deref()));
        }
        GenerateAiRequest::FollowUp {
            selected_text,
            thinking_direction,
            origin,
            messages,
        } => {
            let is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion));
            if is_direct {
                // 直接提问来源：messages 以 user 原问题开头，选区作为可选重点材料。
                task.push_str(&compose_system_prompt(PromptEntry::DirectQuestion));
                task.push_str("\n\n");
                if let Some(first) = messages.first() {
                    task.push_str(&format!("用户问题：\n{}", first.content));
                }
                let trimmed_selection = selected_text.trim();
                if !trimmed_selection.is_empty() {
                    task.push_str(&format!("\n\n重点参考材料（可选）：\n{}", trimmed_selection));
                }
                for turn in messages.iter().skip(1) {
                    task.push_str("\n\n");
                    match turn.role {
                        GenerateAiMessageRole::User => {
                            task.push_str(&format!("用户追问：{}", turn.content))
                        }
                        GenerateAiMessageRole::Assistant => {
                            task.push_str(&format!("你的上一次回应：{}", turn.content))
                        }
                    }
                }
            } else {
                task.push_str(&compose_system_prompt(PromptEntry::Summon));
                task.push_str("\n\n");
                task.push_str(&first_user_content(selected_text, thinking_direction.as_deref()));
                for turn in messages {
                    task.push_str("\n\n");
                    match turn.role {
                        GenerateAiMessageRole::User => {
                            task.push_str(&format!("用户追问：{}", turn.content))
                        }
                        GenerateAiMessageRole::Assistant => {
                            task.push_str(&format!("你的上一次回应：{}", turn.content))
                        }
                    }
                }
            }
        }
        GenerateAiRequest::DirectQuestion {
            question,
            selected_text,
        } => {
            task.push_str(&compose_system_prompt(PromptEntry::DirectQuestion));
            task.push_str("\n\n");
            task.push_str(&direct_question_user_content(question, selected_text.as_deref()));
        }
    }

    Ok(task)
}

fn invalid_request() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::InvalidResponse,
        "AI 请求内容无效，请重试",
    )
}

pub fn validate_generate_ai_request(
    request: &GenerateAiRequest,
) -> Result<(), GenerateAiError> {
    match request {
        GenerateAiRequest::First { selected_text, .. } => {
            if selected_text.trim().is_empty() {
                return Err(invalid_request());
            }
        }
        GenerateAiRequest::FollowUp {
            selected_text,
            origin,
            messages,
            ..
        } => {
            let is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion));
            // 直接提问来源允许空 selected_text（无选区直接提问）；selection 来源仍要求非空。
            if !is_direct && selected_text.trim().is_empty() {
                return Err(invalid_request());
            }

            if messages.is_empty() {
                return Err(invalid_request());
            }

            for (index, turn) in messages.iter().enumerate() {
                if turn.content.trim().is_empty() {
                    return Err(invalid_request());
                }

                // 直接提问来源以 user 原问题开头；selection 来源以 assistant 首轮回应开头。
                let expected_role = if is_direct {
                    if index % 2 == 0 {
                        GenerateAiMessageRole::User
                    } else {
                        GenerateAiMessageRole::Assistant
                    }
                } else if index % 2 == 0 {
                    GenerateAiMessageRole::Assistant
                } else {
                    GenerateAiMessageRole::User
                };
                if turn.role != expected_role {
                    return Err(invalid_request());
                }
            }

            if messages.last().map(|turn| turn.role) != Some(GenerateAiMessageRole::User) {
                return Err(invalid_request());
            }
        }
        GenerateAiRequest::DirectQuestion { question, .. } => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
        }
    }

    Ok(())
}

fn first_user_content(selected_text: &str, thinking_direction: Option<&str>) -> String {
    match thinking_direction.map(str::trim).filter(|d| !d.is_empty()) {
        Some(direction) => format!(
            "选区原文：\n{selected_text}\n\n用户希望探索的角度（不是作品事实或最终判断）：\n{direction}"
        ),
        None => selected_text.to_string(),
    }
}

/// 直接提问的用户内容：必填问题 + 可选选区重点材料，二者明确区分。
fn direct_question_user_content(question: &str, selected_text: Option<&str>) -> String {
    match selected_text.map(str::trim).filter(|s| !s.is_empty()) {
        Some(selection) => format!(
            "用户问题：\n{question}\n\n重点参考材料（可选）：\n{selection}"
        ),
        None => format!("用户问题：\n{question}"),
    }
}

/// 召唤的用户内容：没有用户问题，只有冻结选区原文作为探索材料。
/// 前端不伪造默认问题文本，材料之外不加任何标签或方向。
fn summon_user_content(selected_text: &str) -> String {
    selected_text.trim().to_string()
}

/// 按消息种类校验并组装发送文本（纯函数，便于测试）。
///
/// - `First` / `FollowUp`：要求 question 非空（现状不变）。
/// - `SummonFirst`：要求 `selected_text` 非空，question 可空（前端传空字符串）。
fn compose_message_text(
    kind: AiMessageKind,
    question: &str,
    selected_text: Option<&str>,
) -> Result<String, GenerateAiError> {
    match kind {
        AiMessageKind::First => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
            Ok(format!(
                "{}\n\n{}",
                compose_system_prompt(PromptEntry::DirectQuestion),
                direct_question_user_content(question, selected_text)
            ))
        }
        AiMessageKind::SummonFirst => {
            let selection = selected_text.unwrap_or("").trim();
            if selection.is_empty() {
                return Err(invalid_request());
            }
            Ok(format!(
                "{}\n\n{}",
                compose_system_prompt(PromptEntry::Summon),
                summon_user_content(selection)
            ))
        }
        AiMessageKind::FollowUp => {
            if question.trim().is_empty() {
                return Err(invalid_request());
            }
            Ok(question.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm_config::GenerateAiMessage;

    #[test]
    fn build_task_string_for_first_includes_system_prompt_and_selection() {
        let request = GenerateAiRequest::First {
            selected_text: "林站在天台边。".to_string(),
            thinking_direction: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(
            task.contains(&compose_system_prompt(PromptEntry::Summon)),
            "必须包含召唤入口组装的系统提示词"
        );
        assert!(task.contains("林站在天台边。"), "必须包含选区原文");
    }

    #[test]
    fn build_task_string_for_follow_up_preserves_turns_and_roles() {
        let request = GenerateAiRequest::FollowUp {
            selected_text: "林站在天台边。".to_string(),
            thinking_direction: None,
            origin: None,
            messages: vec![
                GenerateAiMessage {
                    role: GenerateAiMessageRole::Assistant,
                    content: "他为什么站上天台？".to_string(),
                },
                GenerateAiMessage {
                    role: GenerateAiMessageRole::User,
                    content: "我还没想清楚。".to_string(),
                },
            ],
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains("你的上一次回应：他为什么站上天台？"));
        assert!(task.contains("用户追问：我还没想清楚。"));
        assert!(task.contains("林站在天台边。"), "追问仍锚定原选区");
    }

    #[test]
    fn build_task_string_rejects_empty_selection() {
        let request = GenerateAiRequest::First {
            selected_text: "   ".to_string(),
            thinking_direction: None,
        };
        let err = build_task_string(&request).expect_err("empty selection rejected");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
    }

    #[test]
    fn direct_question_without_selection_builds_task_with_question_only() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "这个角色为什么犹豫？".to_string(),
            selected_text: None,
        };
        let task = build_task_string(&request).expect("build task");
        assert!(
            task.contains(&compose_system_prompt(PromptEntry::DirectQuestion)),
            "必须包含直接提问入口组装的系统提示词"
        );
        assert!(task.contains("用户问题：\n这个角色为什么犹豫？"));
        assert!(!task.contains("重点参考材料"), "无选区时不得出现重点参考材料");
    }

    #[test]
    fn direct_question_with_selection_distinguishes_question_and_material() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "这段里人物在隐瞒什么？".to_string(),
            selected_text: Some("林站在天台边，没有回头。".to_string()),
        };
        let task = build_task_string(&request).expect("build task");
        assert!(task.contains("用户问题：\n这段里人物在隐瞒什么？"));
        assert!(task.contains("重点参考材料（可选）：\n林站在天台边，没有回头。"));
    }

    #[test]
    fn direct_question_rejects_blank_question() {
        let request = GenerateAiRequest::DirectQuestion {
            question: "   \n  ".to_string(),
            selected_text: Some("选区".to_string()),
        };
        let err = build_task_string(&request).expect_err("blank question rejected");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
    }

    #[test]
    fn direct_question_compose_declares_grounding_and_output_boundaries() {
        let prompt = compose_system_prompt(PromptEntry::DirectQuestion);
        for required in [
            "用户直接提出的问题",
            "用户可选的选区重点材料",
            "不直接改草稿本或正文本",
            "不代写正文",
            "不判断故事好坏",
        ] {
            assert!(
                prompt.contains(required),
                "直接提问组装提示词缺少约束: {required}"
            );
        }
        for prohibited_claim in [
            "选区前后文",
            "当前本子全文",
            "摘要",
            "作品元数据",
            "AI 内容库",
            "历史会话",
            "记忆",
            "用户确认的作品事实",
        ] {
            let expected = format!("不能声称读取或使用{prohibited_claim}");
            assert!(
                prompt.contains(&expected),
                "直接提问组装提示词缺少不可用上下文声明: {expected}"
            );
        }
    }

    /// 召唤入口组装的系统提示词必须声明召唤立场：只有冻结选区材料、
    /// 没有用户问题，把选区当作希望继续探索的材料。
    #[test]
    fn summon_compose_declares_summon_stance_and_output_boundaries() {
        let prompt = compose_system_prompt(PromptEntry::Summon);
        for required in [
            "当前请求只提供冻结选区原文，没有用户问题",
            "把这段选区当作用户希望继续探索的材料",
            "不直接改草稿本或正文本",
            "不代写正文",
            "不润色",
            "不提供替换文本",
            "不判断故事好坏",
            "不判断正确或错误",
            "不判断高级或低级",
            "追问仍锚定首次冻结选区",
            "只把已有轮次当作当前临时线性对话",
        ] {
            assert!(
                prompt.contains(required),
                "召唤组装提示词缺少约束: {required}"
            );
        }
        for prohibited_claim in [
            "选区前后文",
            "当前本子全文",
            "摘要",
            "作品元数据",
            "AI 内容库",
            "历史会话",
            "记忆",
            "用户确认的作品事实",
        ] {
            let expected = format!("不能声称读取或使用{prohibited_claim}");
            assert!(
                prompt.contains(&expected),
                "召唤组装提示词缺少不可用上下文声明: {expected}"
            );
        }
    }

    /// 红线条款完整性：两种入口的组装结果都必须逐条包含全部边界条款关键句，
    /// 一条不删。这是铁律 2/3 在提示词层的落地。
    #[test]
    fn compose_system_prompt_keeps_all_constitution_clauses_for_both_entries() {
        for prompt in [
            compose_system_prompt(PromptEntry::DirectQuestion),
            compose_system_prompt(PromptEntry::Summon),
        ] {
            for required in [
                "你是陪剧本创作者思考的助手",
                "不直接改草稿本或正文本",
                "不代写正文",
                "不润色",
                "不提供替换文本",
                "不判断故事好坏",
                "不判断正确或错误",
                "不判断高级或低级",
                "不能声称读取或使用选区前后文",
                "不能声称读取或使用当前本子全文",
                "不能声称读取或使用摘要",
                "不能声称读取或使用作品元数据",
                "不能声称读取或使用AI 内容库",
                "不能声称读取或使用历史会话",
                "不能声称读取或使用记忆",
                "不能声称读取或使用用户确认的作品事实",
                "追问仍锚定首次冻结选区",
                "只把已有轮次当作当前临时线性对话，不当作持久历史，不当作作品事实",
                "不要输出 Markdown 或 HTML 格式，使用纯文本回答",
            ] {
                assert!(
                    prompt.contains(required),
                    "组装提示词缺少红线条款: {required}"
                );
            }
        }
    }

    /// 召唤首轮组装：含选区材料、不含问题文本、含召唤入口层立场句。
    #[test]
    fn summon_first_message_composes_selection_material_without_question() {
        let text = compose_message_text(
            AiMessageKind::SummonFirst,
            "",
            Some("林站在天台边，没有回头。"),
        )
        .expect("summon first composes");
        assert!(
            text.contains("当前请求只提供冻结选区原文，没有用户问题"),
            "必须包含召唤入口层立场句"
        );
        assert!(text.contains("林站在天台边，没有回头。"), "必须包含选区材料");
        assert!(!text.contains("用户问题："), "召唤首轮不得出现直接提问的问题内容标签");
        assert!(
            !text.contains("重点参考材料"),
            "召唤首轮不得出现直接提问的重点材料标签"
        );
        assert!(
            !text.contains("用户直接提出的问题"),
            "召唤首轮不得使用直接提问入口层立场句"
        );
    }

    /// 空选区的 SummonFirst 被拒（invalid_request）：选区是召唤的前提。
    #[test]
    fn summon_first_message_rejects_empty_selection() {
        for selection in [None, Some(""), Some("   \n  ")] {
            let err = compose_message_text(AiMessageKind::SummonFirst, "", selection)
                .expect_err("empty selection rejected");
            assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);
        }
    }

    /// 重放来源两种取值分别拼出直接提问 / 召唤提示词。
    #[test]
    fn replay_prompt_prefix_follows_replay_origin() {
        let direct = replay_prompt_prefix(ReplayOrigin::DirectQuestion);
        assert!(
            direct.contains("当前请求提供用户直接提出的问题"),
            "直接提问来源必须拼直接提问入口层"
        );
        assert!(
            !direct.contains("当前请求只提供冻结选区原文"),
            "直接提问来源不得拼召唤入口层"
        );

        let summon = replay_prompt_prefix(ReplayOrigin::Summon);
        assert!(
            summon.contains("当前请求只提供冻结选区原文，没有用户问题"),
            "召唤来源必须拼召唤入口层"
        );
        assert!(
            !summon.contains("用户直接提出的问题"),
            "召唤来源不得拼直接提问入口层"
        );
    }

    /// First / FollowUp 的校验规则保持现状：question 非空。
    #[test]
    fn first_and_follow_up_still_require_non_empty_question() {
        let err = compose_message_text(AiMessageKind::First, "   ", Some("选区"))
            .expect_err("blank question rejected for First");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);

        let err = compose_message_text(AiMessageKind::FollowUp, "", None)
            .expect_err("blank question rejected for FollowUp");
        assert_eq!(err.code, GenerateAiErrorCode::InvalidResponse);

        let text = compose_message_text(AiMessageKind::First, "这个角色为什么犹豫？", None)
            .expect("first composes");
        assert!(
            text.contains("当前请求提供用户直接提出的问题"),
            "First 必须使用直接提问入口层"
        );
        assert!(text.contains("用户问题：\n这个角色为什么犹豫？"));
    }
}
