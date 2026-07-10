use std::time::Duration;

use serde_json::{json, Value};

use super::{is_loopback_url, LlmConfig, LlmConfigError};

const REQUEST_TIMEOUT_SECS: u64 = 20;

fn chat_completions_url(mut base: reqwest::Url) -> Result<reqwest::Url, LlmConfigError> {
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

/// 发起一次最小 chat-completions 请求，验证模型是否真实可调用
pub async fn test_connection(
    config: &LlmConfig,
    base_url: reqwest::Url,
) -> Result<(), LlmConfigError> {
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none());

    // 本机模型服务不应被系统代理劫持；远程服务仍保留用户的代理环境。
    if is_loopback_url(&base_url) {
        client_builder = client_builder.no_proxy();
    }

    let client = client_builder
        .build()
        .map_err(|e| LlmConfigError::TestConnectionFailed(format!("创建请求客户端失败: {}", e)))?;

    let body = json!({
        "model": config.model,
        "messages": [{ "role": "user", "content": "Reply with OK" }],
        "stream": false,
    });

    let response = client
        .post(chat_completions_url(base_url)?)
        .bearer_auth(&config.api_key)
        .json(&body)
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            if error.is_timeout() {
                return Err(LlmConfigError::TestConnectionFailed(
                    "连接超时，请检查 API 地址或网络".to_string(),
                ));
            }
            if error.is_connect() {
                return Err(LlmConfigError::TestConnectionFailed(
                    "无法连接到服务，请检查 API 地址是否正确".to_string(),
                ));
            }
            return Err(LlmConfigError::TestConnectionFailed(format!(
                "网络错误: {}",
                error
            )));
        }
    };

    let status = response.status();
    if status.is_success() {
        let value: Value = response.json().await.map_err(|_| {
            LlmConfigError::TestConnectionFailed(
                "服务返回成功状态，但响应不是有效 JSON".to_string(),
            )
        })?;

        if has_valid_choice(&value) {
            return Ok(());
        }

        return Err(LlmConfigError::TestConnectionFailed(
            "服务返回成功状态，但没有有效的模型回复".to_string(),
        ));
    }

    let status_code = status.as_u16();
    let detail = response
        .text()
        .await
        .unwrap_or_else(|_| "(无法读取响应内容)".to_string());

    let message = match status_code {
        401 | 403 => "认证失败：API Key 可能无效或没有权限".to_string(),
        404 => "API 地址不正确，或该服务不支持 chat/completions".to_string(),
        400..=499 => format!("请求被拒绝（HTTP {}）：{}", status_code, truncate(&detail)),
        500..=599 => format!(
            "服务内部错误（HTTP {}）：{}",
            status_code,
            truncate(&detail)
        ),
        _ => format!(
            "连接测试失败（HTTP {}）：{}",
            status_code,
            truncate(&detail)
        ),
    };

    Err(LlmConfigError::TestConnectionFailed(message))
}

fn has_valid_choice(value: &Value) -> bool {
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

fn truncate(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() > 200 {
        format!("{}…", text.chars().take(200).collect::<String>())
    } else {
        text.to_string()
    }
}
