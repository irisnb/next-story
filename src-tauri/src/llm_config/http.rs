use std::time::Duration;

use serde_json::{json, Value};

use super::{is_loopback_url, GenerateAiError, GenerateAiErrorCode, LlmConfig, LlmConfigError};

pub const CONNECTION_TEST_TIMEOUT_SECS: u64 = 20;
pub const GENERATION_TIMEOUT_SECS: u64 = 60;
pub const MAX_REQUEST_BYTES: usize = 256 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

pub(crate) fn chat_completions_url(mut base: reqwest::Url) -> Result<reqwest::Url, LlmConfigError> {
    let original = base.as_str().to_string();
    {
        let mut segments = base
            .path_segments_mut()
            .map_err(|_| LlmConfigError::InvalidApiBaseUrl(original))?;
        segments.pop_if_empty();
        segments.push("chat");
        segments.push("completions");
    }
    Ok(base)
}

fn build_client(
    base: &reqwest::Url,
    total_timeout: Duration,
) -> Result<reqwest::Client, LlmConfigError> {
    let mut builder = reqwest::Client::builder()
        .timeout(total_timeout)
        .redirect(reqwest::redirect::Policy::none());

    // 本机模型服务不应被系统代理劫持；远程服务仍保留用户的代理环境。
    if is_loopback_url(base) {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|e| LlmConfigError::TestConnectionFailed(format!("创建请求客户端失败: {}", e)))
}

/// 发起一次最小 chat-completions 请求，返回解析后的 JSON 响应体。
///
/// 连接测试与生成共用同一安全基础：HTTPS/loopback 规则、禁止重定向、超时、
/// 本机无代理。网络、超时、HTTP 状态与重定向规则统一在此处理。
pub(crate) async fn post_chat_completions(
    config: &LlmConfig,
    base_url: reqwest::Url,
    messages: Value,
    total_timeout: Duration,
) -> Result<Value, GenerateAiError> {
    let client = build_client(&base_url, total_timeout).map_err(|e| match e {
        LlmConfigError::TestConnectionFailed(msg) => {
            GenerateAiError::new(GenerateAiErrorCode::Service, msg)
        }
        other => GenerateAiError::new(GenerateAiErrorCode::Service, other.to_string()),
    })?;

    let body = json!({
        "model": config.model,
        "messages": messages,
        "stream": false,
    });
    let body_bytes = serde_json::to_vec(&body)
        .map_err(|_| GenerateAiError::new(GenerateAiErrorCode::Service, "无法组装模型请求"))?;
    if body_bytes.len() > MAX_REQUEST_BYTES {
        return Err(GenerateAiError::new(
            GenerateAiErrorCode::RequestTooLarge,
            "请求内容过长，请减少选中的文字",
        ));
    }

    let response = client
        .post(
            chat_completions_url(base_url)
                .map_err(|e| GenerateAiError::new(GenerateAiErrorCode::Service, e.to_string()))?,
        )
        .bearer_auth(&config.api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body_bytes)
        .send()
        .await;

    let mut response = match response {
        Ok(response) => response,
        Err(error) => {
            if error.is_timeout() {
                return Err(GenerateAiError::new(
                    GenerateAiErrorCode::Timeout,
                    "连接超时，请检查 API 地址或网络",
                ));
            }
            if error.is_connect() {
                return Err(GenerateAiError::new(
                    GenerateAiErrorCode::Network,
                    "无法连接到服务，请检查 API 地址是否正确",
                ));
            }
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::Network,
                format!("网络错误: {}", error),
            ));
        }
    };

    let status = response.status();
    if !status.is_success() {
        return Err(map_status_error(status.as_u16()));
    }

    let mut response_bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            GenerateAiError::new(GenerateAiErrorCode::Timeout, "读取模型响应超时，请稍后重试")
        } else {
            GenerateAiError::new(
                GenerateAiErrorCode::InvalidResponse,
                "服务响应传输中断，请稍后重试",
            )
        }
    })? {
        if response_bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::InvalidResponse,
                "服务响应过长，已拒绝处理",
            ));
        }
        response_bytes.extend_from_slice(&chunk);
    }

    let value: Value = serde_json::from_slice(&response_bytes).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "服务返回成功状态，但响应不是有效 JSON",
        )
    })?;

    Ok(value)
}

fn map_status_error(status_code: u16) -> GenerateAiError {
    let message = match status_code {
        401 | 403 => "认证失败：API Key 可能无效或没有权限".to_string(),
        404 => "API 地址不正确，或该服务不支持 chat/completions".to_string(),
        413 => "请求内容过长，请减少选中的文字".to_string(),
        400..=499 => format!("请求被拒绝（HTTP {}）", status_code),
        500..=599 => format!("服务内部错误（HTTP {}）", status_code),
        _ => format!("生成失败（HTTP {}）", status_code),
    };
    let code = match status_code {
        401 | 403 => GenerateAiErrorCode::Authentication,
        413 => GenerateAiErrorCode::RequestTooLarge,
        400..=599 => GenerateAiErrorCode::Service,
        _ => GenerateAiErrorCode::Service,
    };
    GenerateAiError::new(code, message)
}

/// 校验响应是否包含合法非空的 assistant 回复（连接测试与生成共用）。
pub(crate) fn has_valid_choice(value: &Value) -> bool {
    value
        .get("choices")
        .and_then(Value::as_array)
        .is_some_and(|choices| {
            choices.iter().any(|choice| {
                let Some(message) = choice.get("message") else {
                    return false;
                };
                if message.get("role").and_then(Value::as_str) != Some("assistant") {
                    return false;
                }

                let Some(content) = message.get("content") else {
                    return false;
                };
                let has_content = content.as_str().is_some_and(|text| !text.trim().is_empty())
                    || content.as_array().is_some_and(|parts| {
                        parts.iter().any(|part| {
                            part.get("text")
                                .and_then(Value::as_str)
                                .is_some_and(|text| !text.trim().is_empty())
                        })
                    });

                has_content
            })
        })
}

/// 从响应体提取第一个合法非空的 assistant 文本。
pub(crate) fn extract_assistant_text(value: &Value) -> Option<String> {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| {
            choices.iter().find_map(|choice| {
                let message = choice.get("message")?;
                if message.get("role").and_then(Value::as_str) != Some("assistant") {
                    return None;
                }
                let content = message.get("content")?;
                if let Some(text) = content.as_str() {
                    if !text.trim().is_empty() {
                        return Some(text.to_string());
                    }
                    return None;
                }
                if let Some(parts) = content.as_array() {
                    for part in parts {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                return Some(text.to_string());
                            }
                        }
                    }
                }
                None
            })
        })
}

/// 发起一次最小 chat-completions 请求，验证模型是否真实可调用。
pub async fn test_connection(
    config: &LlmConfig,
    base_url: reqwest::Url,
) -> Result<(), LlmConfigError> {
    let messages = json!([{ "role": "user", "content": "Reply with OK" }]);

    match post_chat_completions(
        config,
        base_url,
        messages,
        Duration::from_secs(CONNECTION_TEST_TIMEOUT_SECS),
    )
    .await
    {
        Ok(value) => {
            if has_valid_choice(&value) {
                Ok(())
            } else {
                Err(LlmConfigError::TestConnectionFailed(
                    "服务返回成功状态，但没有有效的模型回复".to_string(),
                ))
            }
        }
        Err(error) => Err(LlmConfigError::TestConnectionFailed(error.message)),
    }
}
