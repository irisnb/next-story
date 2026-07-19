use std::time::Duration;

use serde_json::{json, Value};

use super::{
    http, parse_api_base_url, validate_llm_config, GenerateAiError, GenerateAiErrorCode,
    GenerateAiMessageRole, GenerateAiRequest, LlmConfig,
};

/// 固定首版思考任务：围绕选区提出帮助创作者继续思考的问题和几个思考方向，不代写正文。
/// 该职责集中在后端生成用例，不散落在 DOM 事件、前端桥接或底层 HTTP 模块。
const FIXED_SYSTEM_PROMPT: &str = "你是陪剧本创作者思考的助手。请围绕用户选中的剧本文字，\
提出能够帮助其继续思考的问题，并给出几个可能的思考方向。不要代写正文，\
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
        GenerateAiRequest::First { selected_text } => (selected_text, None),
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

fn build_messages(request: &GenerateAiRequest) -> Result<Value, GenerateAiError> {
    validate_generate_ai_request(request)?;

    let (selected_text, turns) = match request {
        GenerateAiRequest::First { selected_text } => (selected_text, None),
        GenerateAiRequest::FollowUp {
            selected_text,
            messages,
        } => (selected_text, Some(messages)),
    };

    let mut provider_messages = vec![
        json!({ "role": "system", "content": FIXED_SYSTEM_PROMPT }),
        json!({ "role": "user", "content": selected_text }),
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
