use std::time::Duration;

use serde_json::{json, Value};

use super::{
    http, parse_api_base_url, validate_llm_config, GenerateAiError, GenerateAiErrorCode,
    GenerateAiMessageRole, GenerateAiRequest, LlmConfig,
};

/// 固定首版思考任务：围绕冻结选区提出观察、问题和可能方向，不代写正文。
/// 该职责集中在后端生成用例，不散落在 DOM 事件、前端桥接或底层 HTTP 模块。
const FIXED_SYSTEM_PROMPT: &str = "你是陪剧本创作者思考的助手。当前请求只提供冻结选区原文，以及用户可选的探索方向。\
你只能基于这段选区原文回应；若提供了探索方向，把它当作用户希望继续探索的角度，而不是作品事实或最终判断。\
先区分从文字里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。\
追问仍锚定首次冻结选区；只把已有轮次当作当前临时线性对话，不当作持久历史，不当作作品事实。\
不直接改草稿本或正文本，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
不能声称读取或使用选区前后文；不能声称读取或使用当前本子全文；不能声称读取或使用摘要；不能声称读取或使用作品元数据；不能声称读取或使用AI 内容库；不能声称读取或使用历史会话；不能声称读取或使用记忆；不能声称读取或使用用户确认的作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

/// 使用唯一保存配置，围绕选区原文发起一次真实非流式生成。
///
/// 只接收选区原文，由本用例集中组装固定首版思考任务 Prompt。后端自行加载并校验
/// 唯一 LLM 配置；前端不传入 API Key，也不持有任何写入草稿本或正文本的入口。
pub async fn generate_ai_thinking(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
) -> Result<String, GenerateAiError> {
    generate_ai_thinking_with_timeout(
        config,
        request,
        Duration::from_secs(http::GENERATION_TIMEOUT_SECS),
    )
    .await
}

pub async fn generate_ai_thinking_with_timeout(
    config: &LlmConfig,
    request: impl Into<GenerateAiRequest>,
    total_timeout: Duration,
) -> Result<String, GenerateAiError> {
    let request = request.into();
    let messages = build_messages(&request)?;

    let base_url = parse_api_base_url(&config.api_base_url).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置中的 API 地址无效",
        )
    })?;

    validate_llm_config(config).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::ConfigurationRequired,
            "LLM 配置不完整，请检查 API 地址、Key 与模型名",
        )
    })?;

    let value = http::post_chat_completions(config, base_url, messages, total_timeout)
        .await
        .map_err(|error| map_request_error(&request, error))?;

    http::extract_assistant_text(&value).ok_or_else(|| {
        GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "模型没有返回有效的思考内容",
        )
    })
}

fn invalid_request() -> GenerateAiError {
    GenerateAiError::new(
        GenerateAiErrorCode::InvalidResponse,
        "AI 请求内容无效，请重试",
    )
}

pub(crate) fn validate_generate_ai_request(
    request: &GenerateAiRequest,
) -> Result<(), GenerateAiError> {
    let (selected_text, turns) = match request {
        GenerateAiRequest::First { selected_text, .. } => (selected_text, None),
        GenerateAiRequest::FollowUp {
            selected_text,
            messages,
        } => (selected_text, Some(messages)),
    };

    if selected_text.trim().is_empty() {
        return Err(invalid_request());
    }

    if let Some(turns) = turns {
        if turns.is_empty() {
            return Err(invalid_request());
        }

        for (index, turn) in turns.iter().enumerate() {
            if turn.content.trim().is_empty() {
                return Err(invalid_request());
            }

            let expected_role = if index % 2 == 0 {
                GenerateAiMessageRole::Assistant
            } else {
                GenerateAiMessageRole::User
            };
            if turn.role != expected_role {
                return Err(invalid_request());
            }
        }

        if turns.last().map(|turn| turn.role) != Some(GenerateAiMessageRole::User) {
            return Err(invalid_request());
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

fn build_messages(request: &GenerateAiRequest) -> Result<Value, GenerateAiError> {
    validate_generate_ai_request(request)?;

    let (selected_text, thinking_direction, turns) = match request {
        GenerateAiRequest::First {
            selected_text,
            thinking_direction,
        } => (
            selected_text.as_str(),
            thinking_direction.as_deref(),
            None,
        ),
        GenerateAiRequest::FollowUp {
            selected_text,
            messages,
        } => (selected_text.as_str(), None, Some(messages)),
    };

    let mut provider_messages = vec![
        json!({ "role": "system", "content": FIXED_SYSTEM_PROMPT }),
        json!({
            "role": "user",
            "content": first_user_content(selected_text, thinking_direction),
        }),
    ];

    if let Some(turns) = turns {
        for turn in turns {
            provider_messages.push(json!({
                "role": match turn.role {
                    GenerateAiMessageRole::User => "user",
                    GenerateAiMessageRole::Assistant => "assistant",
                },
                "content": turn.content,
            }));
        }
    }

    Ok(Value::Array(provider_messages))
}

fn map_request_error(request: &GenerateAiRequest, mut error: GenerateAiError) -> GenerateAiError {
    if matches!(request, GenerateAiRequest::FollowUp { .. })
        && error.code == GenerateAiErrorCode::RequestTooLarge
    {
        error.message = "请求内容过长，请缩短当前临时对话".to_string();
    }
    error
}
