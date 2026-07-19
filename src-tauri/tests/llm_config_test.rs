use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use next_story_lib::llm_config::{
    app_data_dir_failure_result, generate_ai_result_in, generate_ai_thinking,
    generate_ai_thinking_with_timeout, load_llm_config, save_llm_config, test_llm_connection,
    validate_llm_config, GenerateAiError, GenerateAiErrorCode, GenerateAiMessage,
    GenerateAiMessageRole, GenerateAiRequest, LlmConfig, LlmConfigError,
    CONNECTION_TEST_TIMEOUT_SECS, GENERATION_TIMEOUT_SECS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};
use tempfile::TempDir;

fn sample_config(api_base_url: String) -> LlmConfig {
    LlmConfig {
        api_base_url,
        api_key: "test-key".to_string(),
        model: "test-model".to_string(),
    }
}

fn first_request(selected_text: impl Into<String>) -> GenerateAiRequest {
    GenerateAiRequest::First {
        selected_text: selected_text.into(),
    }
}

fn message(role: GenerateAiMessageRole, content: &str) -> GenerateAiMessage {
    GenerateAiMessage {
        role,
        content: content.to_string(),
    }
}

fn follow_up_request(
    selected_text: impl Into<String>,
    messages: Vec<GenerateAiMessage>,
) -> GenerateAiRequest {
    GenerateAiRequest::FollowUp {
        selected_text: selected_text.into(),
        messages,
    }
}

/// 启动一个最小 mock HTTP 服务，处理一次请求后返回给定状态码与响应体。
/// 返回监听地址，便于构造 API base URL。
fn start_mock(status: u16, body: &'static str) -> String {
    start_mock_with_headers(status, body, Vec::new())
}

fn start_mock_with_headers(
    status: u16,
    body: &'static str,
    headers: Vec<(String, String)>,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let addr = listener.local_addr().expect("local addr");
    let base = format!("http://{}", addr);
    let owned_body = body.to_string();

    thread::spawn(move || {
        for mut stream in listener.incoming().take(1).flatten() {
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);

            let reason = if status == 200 { "OK" } else { "ERR" };
            let extra_headers = headers
                .iter()
                .map(|(name, value)| format!("{}: {}\r\n", name, value))
                .collect::<String>();
            let response = format!(
                "HTTP/1.1 {} {}\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                reason,
                extra_headers,
                owned_body.len(),
                owned_body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });

    base
}

fn start_capturing_mock(body: String) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let base = format!("http://{}", listener.local_addr().expect("local addr"));
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let size = stream.read(&mut buffer).expect("read request");
            bytes.extend_from_slice(&buffer[..size]);
            let text = String::from_utf8_lossy(&bytes);
            let header_end = text.find("\r\n\r\n");
            let content_length = text.lines().find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")?
                    .parse::<usize>()
                    .ok()
            });
            if header_end.is_some_and(|end| {
                content_length.is_some_and(|length| bytes.len() >= end + 4 + length)
            }) {
                break;
            }
        }
        let request = String::from_utf8(bytes).expect("utf8 request");
        let _ = sender.send(request);
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        stream
            .write_all(response.as_bytes())
            .expect("write response");
    });
    (base, receiver)
}

fn start_partial_body_mock(
    declared_length: usize,
    body_prefix: &'static [u8],
    body_delay: Duration,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind partial mock");
    let base = format!("http://{}", listener.local_addr().expect("local addr"));
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut request = [0u8; 4096];
        let _ = stream.read(&mut request);
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            declared_length
        );
        stream.write_all(headers.as_bytes()).expect("write headers");
        stream.flush().expect("flush headers");
        thread::sleep(body_delay);
        let _ = stream.write_all(body_prefix);
        let _ = stream.flush();
    });
    base
}

#[test]
fn save_and_reload_preserves_config_and_touches_no_notebooks() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let config = sample_config("https://api.example.com/v1".to_string());

    save_llm_config(&base, &config).expect("save config");

    // 配置是应用级，不应触碰用户笔记本文件夹
    assert!(!base.join("作品文本").exists());

    let loaded = load_llm_config(&base)
        .expect("load config")
        .expect("config should exist");
    assert_eq!(loaded.api_base_url, config.api_base_url);
    assert_eq!(loaded.api_key, config.api_key);
    assert_eq!(loaded.model, config.model);
}

#[test]
fn load_returns_none_when_config_absent() {
    let temp = TempDir::new().expect("create temp dir");
    let loaded = load_llm_config(temp.path()).expect("load config");
    assert!(loaded.is_none());
}

#[test]
fn validation_rejects_missing_fields_and_bad_url() {
    let missing_url = LlmConfig {
        api_base_url: "".to_string(),
        api_key: "k".to_string(),
        model: "m".to_string(),
    };
    assert!(matches!(
        validate_llm_config(&missing_url),
        Err(LlmConfigError::MissingApiBaseUrl)
    ));

    let missing_key = LlmConfig {
        api_base_url: "https://x".to_string(),
        api_key: "".to_string(),
        model: "m".to_string(),
    };
    assert!(matches!(
        validate_llm_config(&missing_key),
        Err(LlmConfigError::MissingApiKey)
    ));

    let missing_model = LlmConfig {
        api_base_url: "https://x".to_string(),
        api_key: "k".to_string(),
        model: "".to_string(),
    };
    assert!(matches!(
        validate_llm_config(&missing_model),
        Err(LlmConfigError::MissingModel)
    ));

    let bad_url = LlmConfig {
        api_base_url: "ftp://x".to_string(),
        api_key: "k".to_string(),
        model: "m".to_string(),
    };
    assert!(matches!(
        validate_llm_config(&bad_url),
        Err(LlmConfigError::InvalidApiBaseUrl(_))
    ));
}

#[test]
fn validation_rejects_urls_without_a_host() {
    for api_base_url in ["https://", "http://", "http:///v1"] {
        let config = sample_config(api_base_url.to_string());
        assert!(
            matches!(
                validate_llm_config(&config),
                Err(LlmConfigError::InvalidApiBaseUrl(_))
            ),
            "应拒绝缺少主机名的地址: {api_base_url}"
        );
    }
}

#[test]
fn validation_rejects_remote_http_but_allows_loopback_http() {
    let remote = sample_config("http://example.com/v1".to_string());
    let error = validate_llm_config(&remote).expect_err("远程 HTTP 必须被拒绝");
    assert!(error.to_string().contains("远程 API 地址必须使用 HTTPS"));

    for api_base_url in [
        "http://localhost:8080/v1",
        "http://127.0.0.1:8080/v1",
        "http://[::1]:8080/v1",
    ] {
        let loopback = sample_config(api_base_url.to_string());
        assert!(
            validate_llm_config(&loopback).is_ok(),
            "应允许本机地址: {api_base_url}"
        );
    }
}

#[test]
fn validation_rejects_ambiguous_or_complete_endpoint_urls() {
    for api_base_url in [
        "https://user@example.com/v1",
        "https://example.com/v1?token=x",
        "https://example.com/v1#fragment",
        "https://example.com/v1/chat/completions",
    ] {
        let config = sample_config(api_base_url.to_string());
        assert!(matches!(
            validate_llm_config(&config),
            Err(LlmConfigError::InvalidApiBaseUrl(_))
        ));
    }
}

#[tokio::test]
async fn test_connection_succeeds_against_mock_server() {
    let base = start_mock(
        200,
        "{\"id\":\"x\",\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"OK\"}}]}",
    );
    let config = sample_config(base);
    assert!(validate_llm_config(&config).is_ok());
    assert!(test_llm_connection(&config).await.is_ok());
}

#[tokio::test]
async fn test_connection_rejects_success_status_without_a_valid_model_result() {
    for body in [
        "<html>login</html>",
        "{\"error\":\"model unavailable\"}",
        "{\"choices\":[]}",
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"\"}}]}",
    ] {
        let base = start_mock(200, body);
        let config = sample_config(base);
        assert!(matches!(
            test_llm_connection(&config).await,
            Err(LlmConfigError::TestConnectionFailed(_))
        ));
    }
}

#[tokio::test]
async fn test_connection_rejects_empty_204_response() {
    let base = start_mock(204, "");
    let config = sample_config(base);
    assert!(matches!(
        test_llm_connection(&config).await,
        Err(LlmConfigError::TestConnectionFailed(_))
    ));
}

#[tokio::test]
async fn test_connection_does_not_follow_redirects() {
    let target = TcpListener::bind("127.0.0.1:0").expect("bind redirect target");
    target
        .set_nonblocking(true)
        .expect("set redirect target nonblocking");
    let target_url = format!(
        "http://{}/stolen",
        target.local_addr().expect("target address")
    );
    let (sender, receiver) = mpsc::channel();

    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            match target.accept() {
                Ok((mut stream, _)) => {
                    let mut buf = [0u8; 4096];
                    let size = stream.read(&mut buf).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..size]);
                    let saw_bearer = request.contains("Authorization: Bearer test-key");
                    let body = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"redirected\"}}]}";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    let _ = sender.send(saw_bearer);
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
        let _ = sender.send(false);
    });

    let base = start_mock_with_headers(302, "", vec![("Location".to_string(), target_url)]);
    let config = sample_config(base);
    assert!(matches!(
        test_llm_connection(&config).await,
        Err(LlmConfigError::TestConnectionFailed(_))
    ));
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(2)),
        Ok(false),
        "客户端不得跟随重定向并发送 Bearer API Key"
    );
}

#[tokio::test]
async fn test_connection_fails_with_readable_error_on_401() {
    let base = start_mock(401, "{\"error\":\"unauthorized\"}");
    let config = sample_config(base);
    let result = test_llm_connection(&config).await;
    match result {
        Err(LlmConfigError::TestConnectionFailed(msg)) => {
            assert!(
                msg.contains("认证失败"),
                "错误信息应提示认证失败，实际: {}",
                msg
            );
        }
        other => panic!("应返回 TestConnectionFailed，实际: {:?}", other),
    }
}

// ========== AI 思考生成用例 ==========

#[tokio::test]
async fn generate_returns_assistant_content_from_mock() {
    let base = start_mock(
        200,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"换个视角会不会更好？\"}}]}",
    );
    let config = sample_config(base);
    let content = generate_ai_thinking(&config, "背叛")
        .await
        .expect("生成应成功");
    assert_eq!(content, "换个视角会不会更好？");
}

#[tokio::test]
async fn generate_rejects_2xx_without_valid_reply() {
    for body in [
        "<html>login</html>",
        "{\"error\":\"model unavailable\"}",
        "{\"choices\":[]}",
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"\"}}]}",
    ] {
        let base = start_mock(200, body);
        let config = sample_config(base);
        let result = generate_ai_thinking(&config, "x").await;
        assert!(
            matches!(
                result,
                Err(GenerateAiError {
                    code: GenerateAiErrorCode::InvalidResponse,
                    ..
                })
            ),
            "应因无效响应失败，实际: {:?}",
            result
        );
    }
}

#[tokio::test]
async fn generate_maps_401_to_authentication_error_without_leaking_secrets() {
    let base = start_mock(401, "{\"error\":\"unauthorized\"}");
    let config = sample_config(base);
    let error = generate_ai_thinking(&config, "x")
        .await
        .expect_err("应失败");
    assert_eq!(error.code, GenerateAiErrorCode::Authentication);
    assert!(!error.message.contains("Bearer"));
    assert!(!error.message.contains("test-key"));
    assert!(!error.message.contains("Authorization"));
}

#[tokio::test]
async fn generate_maps_413_to_request_too_large() {
    let base = start_mock(413, "too large");
    let config = sample_config(base);
    let error = generate_ai_thinking(&config, "x")
        .await
        .expect_err("应失败");
    assert_eq!(error.code, GenerateAiErrorCode::RequestTooLarge);
}

#[tokio::test]
async fn generate_rejects_incomplete_config_as_configuration_required() {
    let config = LlmConfig {
        api_base_url: "".to_string(),
        api_key: "k".to_string(),
        model: "m".to_string(),
    };
    let error = generate_ai_thinking(&config, "x")
        .await
        .expect_err("应失败");
    assert_eq!(error.code, GenerateAiErrorCode::ConfigurationRequired);
}

#[tokio::test]
async fn generate_reports_network_error_without_leaking_secrets() {
    // 指向一个未监听的端口，触发连接失败
    let config = sample_config("http://127.0.0.1:1/v1".to_string());
    let error = generate_ai_thinking(&config, "x")
        .await
        .expect_err("应失败");
    assert_eq!(error.code, GenerateAiErrorCode::Network);
    assert!(!error.message.contains("test-key"));
}

#[tokio::test]
async fn generate_does_not_append_context_to_the_request_body() {
    // 仅验证后端组装的请求体就是固定 Prompt + 选区原文，不含任何前后文/全文/摘要。
    let base = start_mock(
        200,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}",
    );
    let config = sample_config(base);
    let content = generate_ai_thinking(&config, "选区原文")
        .await
        .expect("生成应成功");
    assert_eq!(content, "ok");
}

#[test]
fn generate_error_codes_serialize_as_snake_case() {
    assert_eq!(
        serde_json::to_string(&GenerateAiErrorCode::ConfigurationRequired).unwrap(),
        "\"configuration_required\""
    );
    assert_eq!(
        serde_json::to_string(&GenerateAiErrorCode::RequestTooLarge).unwrap(),
        "\"request_too_large\""
    );
    assert_eq!(
        serde_json::to_string(&GenerateAiErrorCode::InvalidResponse).unwrap(),
        "\"invalid_response\""
    );
}

#[test]
fn app_data_dir_failure_is_a_safe_stable_result() {
    let result = app_data_dir_failure_result();
    assert!(!result.ok);
    let error = result.error.expect("failure error");
    assert_eq!(error.code, GenerateAiErrorCode::ConfigurationRequired);
    assert_eq!(error.message, "无法访问 LLM 配置目录，请重启应用后重试");
}

#[tokio::test]
async fn corrupted_saved_config_returns_stable_failure_result() {
    let temp = TempDir::new().expect("temp dir");
    std::fs::write(temp.path().join("llm-config.json"), "{broken").expect("write corrupt config");
    let result = generate_ai_result_in(temp.path(), "选区").await;
    assert!(!result.ok);
    assert_eq!(
        result.error.expect("failure error").code,
        GenerateAiErrorCode::ConfigurationRequired
    );
}

#[tokio::test]
async fn generate_sends_exact_fixed_messages_without_context() {
    let response =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}".to_string();
    let (base, captured) = start_capturing_mock(response);
    generate_ai_thinking(&sample_config(base), "选区原文")
        .await
        .expect("generate");
    let request = captured
        .recv_timeout(Duration::from_secs(2))
        .expect("captured request");
    let body = request.split_once("\r\n\r\n").expect("request body").1;
    let value: serde_json::Value = serde_json::from_str(body).expect("json body");
    assert_eq!(value["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        value["messages"][0],
        serde_json::json!({
            "role":"system",
            "content":"你是陪剧本创作者思考的助手。请围绕用户选中的剧本文字，提出能够帮助其继续思考的问题，并给出几个可能的思考方向。不要代写正文，不要输出 Markdown 或 HTML 格式，使用纯文本回答。"
        })
    );
    assert_eq!(
        value["messages"][1],
        serde_json::json!({"role":"user","content":"选区原文"})
    );
    assert_eq!(value.as_object().unwrap().len(), 3);
}

#[tokio::test]
async fn generate_follow_up_sends_exact_full_conversation_once_without_extra_context() {
    let response =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}".to_string();
    let (base, captured) = start_capturing_mock(response);
    let request = follow_up_request(
        "冻结选区",
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::User, "问题一"),
            message(GenerateAiMessageRole::Assistant, "回答一"),
            message(GenerateAiMessageRole::User, "当前问题"),
        ],
    );

    generate_ai_thinking(&sample_config(base), &request)
        .await
        .expect("follow-up generate");

    let request = captured
        .recv_timeout(Duration::from_secs(2))
        .expect("captured request");
    let body = request.split_once("\r\n\r\n").expect("request body").1;
    let value: serde_json::Value = serde_json::from_str(body).expect("json body");
    assert_eq!(
        value["messages"],
        serde_json::json!([
            {
                "role":"system",
                "content":"你是陪剧本创作者思考的助手。请围绕用户选中的剧本文字，提出能够帮助其继续思考的问题，并给出几个可能的思考方向。不要代写正文，不要输出 Markdown 或 HTML 格式，使用纯文本回答。"
            },
            {"role":"user","content":"冻结选区"},
            {"role":"assistant","content":"首次回应"},
            {"role":"user","content":"问题一"},
            {"role":"assistant","content":"回答一"},
            {"role":"user","content":"当前问题"}
        ])
    );
    assert_eq!(body.matches("当前问题").count(), 1);
    for absent in [
        "附近上下文",
        "本子全文",
        "自动摘要",
        "作品信息",
        "AI 内容库",
    ] {
        assert!(!body.contains(absent));
    }
    assert_eq!(value["stream"], false);
}

#[tokio::test]
async fn generate_rejects_blank_selection_and_blank_messages_with_safe_stable_error() {
    let cases = [
        first_request(" \n\t "),
        follow_up_request(
            "冻结选区",
            vec![
                message(GenerateAiMessageRole::Assistant, "首次回应"),
                message(GenerateAiMessageRole::User, " \n\t "),
            ],
        ),
        follow_up_request(
            "冻结选区",
            vec![
                message(GenerateAiMessageRole::Assistant, " \n\t "),
                message(GenerateAiMessageRole::User, "当前问题"),
            ],
        ),
    ];

    for request in cases {
        let error =
            generate_ai_thinking(&sample_config("http://127.0.0.1:1".to_string()), &request)
                .await
                .expect_err("invalid payload must fail before network");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
        assert!(!error.message.contains("冻结选区"));
        assert!(!error.message.contains("首次回应"));
        assert!(!error.message.contains("当前问题"));
    }
}

#[tokio::test]
async fn generate_rejects_illegal_follow_up_role_order_and_messages_after_pending_user() {
    let cases = [
        Vec::new(),
        vec![message(GenerateAiMessageRole::User, "没有首次回应")],
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::Assistant, "连续 assistant"),
            message(GenerateAiMessageRole::User, "当前问题"),
        ],
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::User, "未配对的旧问题"),
            message(GenerateAiMessageRole::User, "待回答问题后仍有消息"),
        ],
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::User, "旧问题"),
            message(GenerateAiMessageRole::Assistant, "旧回答"),
        ],
    ];

    for messages in cases {
        let request = follow_up_request("冻结选区", messages);
        let error =
            generate_ai_thinking(&sample_config("http://127.0.0.1:1".to_string()), &request)
                .await
                .expect_err("illegal order must fail before network");
        assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
        assert_eq!(error.message, "AI 请求内容无效，请重试");
    }
}

#[tokio::test]
async fn generate_rejects_oversize_follow_up_without_truncation_or_text_leak() {
    let current_question = "不能泄露的当前问题".repeat(MAX_REQUEST_BYTES / 12);
    let request = follow_up_request(
        "冻结选区",
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::User, &current_question),
        ],
    );
    let error = generate_ai_thinking(&sample_config("http://127.0.0.1:1".to_string()), &request)
        .await
        .expect_err("oversize follow-up must fail");

    assert_eq!(error.code, GenerateAiErrorCode::RequestTooLarge);
    assert_eq!(error.message, "请求内容过长，请缩短当前临时对话");
    assert!(!error.message.contains("不能泄露的当前问题"));
}

#[tokio::test]
async fn generate_rejects_oversize_request_without_truncation() {
    let config = sample_config("http://127.0.0.1:1".to_string());
    let text = "界".repeat(MAX_REQUEST_BYTES / 3 + 1);
    let error = generate_ai_thinking(&config, &text)
        .await
        .expect_err("oversize must fail");
    assert_eq!(error.code, GenerateAiErrorCode::RequestTooLarge);
}

#[tokio::test]
async fn generate_rejects_oversize_response_without_truncation() {
    let content = "x".repeat(MAX_RESPONSE_BYTES + 1);
    let body = serde_json::json!({"choices":[{"message":{"role":"assistant","content":content}}]})
        .to_string();
    let (base, _captured) = start_capturing_mock(body);
    let error = generate_ai_thinking(&sample_config(base), "x")
        .await
        .expect_err("oversize must fail");
    assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
    assert_eq!(error.message, "服务响应过长，已拒绝处理");
}

#[test]
fn generation_and_connection_test_use_distinct_total_timeouts() {
    assert_eq!(CONNECTION_TEST_TIMEOUT_SECS, 20);
    assert_eq!(GENERATION_TIMEOUT_SECS, 60);
}

#[tokio::test]
async fn delayed_response_body_maps_to_timeout_without_waiting_for_production_timeout() {
    let base = start_partial_body_mock(64, b"", Duration::from_millis(150));
    let error =
        generate_ai_thinking_with_timeout(&sample_config(base), "x", Duration::from_millis(30))
            .await
            .expect_err("delayed body must time out");

    assert_eq!(error.code, GenerateAiErrorCode::Timeout);
    assert_eq!(error.message, "读取模型响应超时，请稍后重试");
}

#[tokio::test]
async fn truncated_response_body_maps_to_distinct_interruption_error() {
    let base = start_partial_body_mock(128, b"{\"choices\":[", Duration::ZERO);
    let error =
        generate_ai_thinking_with_timeout(&sample_config(base), "x", Duration::from_secs(1))
            .await
            .expect_err("truncated body must fail");

    assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
    assert_eq!(error.message, "服务响应传输中断，请稍后重试");
}
