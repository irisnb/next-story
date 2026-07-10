use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use next_story_lib::llm_config::{
    load_llm_config, save_llm_config, test_llm_connection, validate_llm_config, LlmConfig,
    LlmConfigError,
};
use tempfile::TempDir;

fn sample_config(api_base_url: String) -> LlmConfig {
    LlmConfig {
        api_base_url,
        api_key: "test-key".to_string(),
        model: "test-model".to_string(),
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
