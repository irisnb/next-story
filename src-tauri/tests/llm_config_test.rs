use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use next_story_lib::llm_config::{
    app_data_dir_failure_result, generate_ai_result_in, generate_ai_thinking,
    load_llm_config_summary_with_store, load_llm_config_with_store, save_llm_config_with_store,
    save_llm_config_with_store_checked, test_llm_connection, validate_llm_config, ConfigSavePhase,
    GenerateAiErrorCode, GenerateAiMessage, GenerateAiMessageRole, GenerateAiRequest, LlmConfig,
    LlmConfigError, SecretStore, KEYRING_ACCOUNT, KEYRING_SERVICE,
};
use next_story_lib::project::{
    create_new_project, save_document, CreateProjectParams, ProjectPaths,
};
use tempfile::TempDir;

fn sample_config(api_base_url: String) -> LlmConfig {
    LlmConfig {
        api_base_url,
        api_key: "test-key".to_string(),
        model: "test-model".to_string(),
    }
}

/// 内存版密钥存储：测试专用，绝不触碰真实操作系统钥匙串。
#[derive(Default)]
struct MockStore {
    secrets: RefCell<HashMap<(String, String), String>>,
}

impl MockStore {
    fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MockStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, LlmConfigError> {
        Ok(self
            .secrets
            .borrow()
            .get(&(service.to_string(), account.to_string()))
            .cloned())
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), LlmConfigError> {
        let _ = self.secrets.borrow_mut().insert(
            (service.to_string(), account.to_string()),
            secret.to_string(),
        );
        Ok(())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), LlmConfigError> {
        let _ = self
            .secrets
            .borrow_mut()
            .remove(&(service.to_string(), account.to_string()));
        Ok(())
    }
}

fn first_request(selected_text: impl Into<String>) -> GenerateAiRequest {
    GenerateAiRequest::First {
        selected_text: selected_text.into(),
        thinking_direction: None,
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
        thinking_direction: None,
        messages,
    }
}

/// 生成一段合法格式版本 1 的本子 JSON 字符串（每行一个正文段落）。
fn notebook_json(text: &str) -> String {
    let content: Vec<serde_json::Value> = text
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                serde_json::json!({ "type": "paragraph" })
            } else {
                serde_json::json!({
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": line }]
                })
            }
        })
        .collect();
    let value = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 1,
        "document": { "type": "doc", "content": content }
    });
    serde_json::to_string_pretty(&value).expect("serialize notebook")
}

/// 启动一个最小 mock HTTP 服务，处理一次请求后返回给定状态码与响应体。
/// 返回监听地址，便于构造 API base URL。连接测试仍走 Rust 直连 HTTP，故保留。
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
    let store = MockStore::new();

    save_llm_config_with_store(&base, &config, &store).expect("save config");

    // 配置是应用级，不应触碰用户笔记本文件夹
    assert!(!base.join("作品文本").exists());

    let loaded = load_llm_config_with_store(&base, &store)
        .expect("load config")
        .expect("config should exist");
    assert_eq!(loaded.api_base_url, config.api_base_url);
    assert_eq!(loaded.api_key, config.api_key);
    assert_eq!(loaded.model, config.model);
}

#[test]
fn load_returns_none_when_config_absent() {
    let temp = TempDir::new().expect("create temp dir");
    let store = MockStore::new();
    let loaded = load_llm_config_with_store(temp.path(), &store).expect("load config");
    assert!(loaded.is_none());
}

#[test]
fn load_rejects_oversized_config_file() {
    let temp = TempDir::new().expect("create temp dir");
    std::fs::write(temp.path().join("llm-config.json"), "x".repeat(65 * 1024))
        .expect("write oversized config");

    let store = MockStore::new();
    let result = load_llm_config_with_store(temp.path(), &store);
    assert!(matches!(result, Err(LlmConfigError::ReadError(_))));
}

#[test]
fn saved_config_file_never_contains_api_key() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let config = sample_config("https://api.example.com/v1".to_string());
    let store = MockStore::new();

    save_llm_config_with_store(&base, &config, &store).expect("save config");

    // API Key 不得落盘：文件只含非敏感字段
    let json = std::fs::read_to_string(base.join("llm-config.json")).expect("read config file");
    let value: serde_json::Value = serde_json::from_str(&json).expect("valid json");
    assert!(
        value.get("api_key").is_none(),
        "磁盘文件不得含 api_key: {json}"
    );
    assert_eq!(value["api_base_url"], config.api_base_url);
    assert_eq!(value["model"], config.model);

    // Key 进入密钥存储，且使用约定的 service / account
    assert_eq!(
        store
            .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .expect("store get"),
        Some(config.api_key)
    );
}

#[test]
fn api_key_round_trips_through_secret_store() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let config = sample_config("https://api.example.com/v1".to_string());
    let store = MockStore::new();

    save_llm_config_with_store(&base, &config, &store).expect("save config");
    let loaded = load_llm_config_with_store(&base, &store)
        .expect("load config")
        .expect("config should exist");
    assert_eq!(loaded.api_base_url, config.api_base_url);
    assert_eq!(loaded.api_key, config.api_key);
    assert_eq!(loaded.model, config.model);
}

#[test]
fn load_summary_never_returns_plaintext_key_and_reports_has_api_key() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let config = sample_config("https://api.example.com/v1".to_string());
    let store = MockStore::new();

    // 未保存时返回 None
    assert!(load_llm_config_summary_with_store(&base, &store)
        .expect("load summary")
        .is_none());

    save_llm_config_with_store(&base, &config, &store).expect("save config");

    let summary = load_llm_config_summary_with_store(&base, &store)
        .expect("load summary")
        .expect("summary should exist");
    // 非敏感字段与 has_api_key，绝不回传明文密钥
    assert_eq!(summary.api_base_url, config.api_base_url);
    assert_eq!(summary.model, config.model);
    assert!(summary.has_api_key);
    let json = serde_json::to_value(&summary).expect("serialize summary");
    assert!(json.get("api_key").is_none(), "summary 不得含 api_key 字段");

    // 钥匙串丢失密钥 → has_api_key: false（而非报错）
    let summary_without_key = load_llm_config_summary_with_store(&base, &MockStore::new())
        .expect("load summary without key")
        .expect("summary should still exist");
    assert!(!summary_without_key.has_api_key);
    assert_eq!(summary_without_key.api_base_url, config.api_base_url);
}

#[test]
fn save_with_empty_api_key_reuses_existing_keyring_secret() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let store = MockStore::new();

    let original = sample_config("https://api.example.com/v1".to_string());
    save_llm_config_with_store(&base, &original, &store).expect("save original config");

    // 掩码模式：只改服务地址，api_key 传空 → 后端复用钥匙串旧密钥，不覆盖。
    let url_only = LlmConfig {
        api_base_url: "https://new.example.com/v1".to_string(),
        api_key: "".to_string(),
        model: "test-model".to_string(),
    };
    save_llm_config_with_store(&base, &url_only, &store).expect("save url-only config");

    assert_eq!(
        store
            .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .expect("store get"),
        Some(original.api_key.clone()),
        "空密钥保存不得覆盖钥匙串中的旧密钥"
    );

    let loaded = load_llm_config_with_store(&base, &store)
        .expect("load config")
        .expect("config exists");
    assert_eq!(loaded.api_base_url, "https://new.example.com/v1");
    assert_eq!(loaded.api_key, original.api_key, "密钥应仍是旧的");
}

/// 2.6 钥匙串成功 + 磁盘写失败：必须回滚钥匙串为旧密钥，
/// 不得留下「旧地址 A + 新密钥 B」的分裂状态。
#[test]
fn save_rolls_back_keyring_when_disk_replace_fails_after_keyring_update() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let store = MockStore::new();

    // 先保存旧配置（服务 A + Key A）
    let old = sample_config("https://api-a.example.com/v1".to_string());
    save_llm_config_with_store(&base, &old, &store).expect("save old config");

    // 注入「钥匙串更新成功后、磁盘替换前」失败
    let new = sample_config("https://api-b.example.com/v1".to_string());
    let result = save_llm_config_with_store_checked(&base, &new, &store, |phase| {
        if phase == ConfigSavePhase::AfterKeyringUpdate {
            Err(LlmConfigError::WriteError(
                "测试注入的磁盘写入失败".to_string(),
            ))
        } else {
            Ok(())
        }
    });
    assert!(matches!(result, Err(LlmConfigError::WriteError(_))));

    // 钥匙串已回滚为旧 Key A —— 不存在「旧地址 A + 新密钥 B」分裂
    let stored_key = store
        .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .expect("store get")
        .expect("旧密钥应存在");
    assert_eq!(stored_key, old.api_key, "钥匙串必须回滚为旧密钥");

    // 磁盘仍是旧配置（服务 A）
    let disk = std::fs::read_to_string(base.join("llm-config.json")).expect("read config file");
    let value: serde_json::Value = serde_json::from_str(&disk).expect("valid json");
    assert_eq!(value["api_base_url"], "https://api-a.example.com/v1");

    // 再次加载得到完整旧配置（A + Key A）
    let loaded = load_llm_config_with_store(&base, &store)
        .expect("load config")
        .expect("config exists");
    assert_eq!(loaded.api_base_url, old.api_base_url);
    assert_eq!(loaded.api_key, old.api_key);
}

#[test]
fn load_fails_clearly_when_file_exists_but_secret_store_is_empty() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let config = sample_config("https://api.example.com/v1".to_string());

    save_llm_config_with_store(&base, &config, &MockStore::new()).expect("save config");

    // 另一个空 store 模拟钥匙串丢失 key 的情况
    let result = load_llm_config_with_store(&base, &MockStore::new());
    assert!(matches!(result, Err(LlmConfigError::SecretStoreError(_))));
    let message = result.expect_err("应失败").to_string();
    assert!(
        message.contains("API Key"),
        "错误信息应提示 API Key，实际: {message}"
    );
}

#[test]
fn legacy_plaintext_config_is_migrated_into_store_and_rewritten_without_key() {
    let temp = TempDir::new().expect("create temp dir");
    let base = temp.path().to_path_buf();
    let legacy_json = serde_json::json!({
        "api_base_url": "https://api.example.com/v1",
        "api_key": "legacy-secret-key",
        "model": "legacy-model",
    });
    std::fs::write(base.join("llm-config.json"), legacy_json.to_string())
        .expect("write legacy config");

    let store = MockStore::new();
    let loaded = load_llm_config_with_store(&base, &store)
        .expect("load config")
        .expect("config should exist");
    assert_eq!(loaded.api_base_url, "https://api.example.com/v1");
    assert_eq!(loaded.api_key, "legacy-secret-key");
    assert_eq!(loaded.model, "legacy-model");

    // 明文 key 已迁进密钥存储
    assert_eq!(
        store
            .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .expect("store get"),
        Some("legacy-secret-key".to_string())
    );

    // 磁盘文件已被改写为不含 key 的新格式
    let json = std::fs::read_to_string(base.join("llm-config.json")).expect("read rewritten file");
    let value: serde_json::Value = serde_json::from_str(&json).expect("valid json");
    assert!(
        value.get("api_key").is_none(),
        "迁移后文件不得再含 api_key: {json}"
    );
    assert_eq!(value["api_base_url"], "https://api.example.com/v1");
    assert_eq!(value["model"], "legacy-model");

    // 再次加载（新格式 + 存储里有 key）仍能取回完整配置
    let reloaded = load_llm_config_with_store(&base, &store)
        .expect("reload config")
        .expect("config should exist");
    assert_eq!(reloaded.api_key, "legacy-secret-key");
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

// ========== AI 思考生成用例（DSH 路径） ==========

/// 配置不完整时，生成在 spawn DSH 之前即被拒绝为 ConfigurationRequired。
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

/// 请求校验在 spawn DSH 之前完成：空白选区/空白消息被稳定拒绝，
/// 且错误不泄露请求原文。
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

/// 追问角色顺序非法（含空消息列表、缺少首次回应、连续同角色、待回答问题后仍有消息）
/// 在 spawn DSH 之前即被稳定拒绝。
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

// ========== AI 零写回端到端 ==========

/// AI 生成命令（无论成功或失败）绝不写回草稿本/正文本。生成链路在 DSH 路径下
/// 只把选区文本交给 sidecar 子进程、不接触作品目录；本测试用「配置缺失 → 稳定失败」
/// 与「非法请求 → 稳定失败」两条路径证明生成命令级入口不改作品字节，
/// 「用户保存」作为正对照必须真实改变草稿本字节。
#[tokio::test]
async fn ai_generation_never_writes_back_to_notebooks_while_user_save_does() {
    let temp = TempDir::new().expect("create temp dir");

    // 1. 用公开 API 创建真实作品；先用户保存写入已知内容，再记录文件字节快照。
    let project_root = create_new_project(CreateProjectParams {
        name: "零写回作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let paths = ProjectPaths::new(project_root.clone());
    let tree: next_story_lib::project::ContentTree = serde_json::from_str(
        &std::fs::read_to_string(&paths.content_tree_file).expect("read content tree"),
    )
    .expect("parse content tree");
    let doc_ids: Vec<String> = tree.root_children.clone();
    assert_eq!(doc_ids.len(), 1, "根级应有一篇文档");
    let doc_id = doc_ids[0].clone();

    let draft_doc = notebook_json("草稿第一行\n草稿第二行");
    save_document(&project_root, &doc_id, &draft_doc)
        .expect("user save writes known notebook content");

    let snapshot = || -> (Vec<u8>, Vec<u8>) {
        (
            std::fs::read(paths.document_file(&doc_id)).expect("read document"),
            std::fs::read(&paths.metadata_file).expect("read metadata"),
        )
    };
    let before = snapshot();
    assert!(!before.0.is_empty(), "本子内容不能为空");

    let assert_snapshot_unchanged = |label: &str| {
        let now = snapshot();
        assert_eq!(now.0, before.0, "{label} 后文档字节必须完全不变");
        assert_eq!(now.1, before.1, "{label} 后 project.json 字节必须完全不变");
    };

    // 2. 生成命令（应用数据目录无配置 → 稳定失败）不改作品字节。
    let app_data = temp.path().join("app-data");
    let result = generate_ai_result_in(&app_data, first_request("冻结选区")).await;
    assert!(!result.ok);
    assert_eq!(
        result.error.expect("failure error").code,
        GenerateAiErrorCode::ConfigurationRequired
    );
    assert_snapshot_unchanged("配置缺失生成失败");

    // 3. 生成命令（非法请求 → 稳定失败）不改作品字节。
    let result = generate_ai_result_in(&app_data, first_request("   ")).await;
    assert!(!result.ok);
    assert_eq!(
        result.error.expect("failure error").code,
        GenerateAiErrorCode::InvalidResponse
    );
    assert_snapshot_unchanged("非法请求生成失败");

    // 4. 生成流程后：作品目录不得多出任何事务/临时文件（AI 链路零写盘）。
    let system_dir = project_root.join("next-story-system");
    assert!(
        !system_dir.join("save-transaction").exists(),
        "AI 链路不得创建保存事务目录"
    );
    let mut system_entries: Vec<String> = std::fs::read_dir(&system_dir)
        .expect("read system dir")
        .map(|entry| {
            entry
                .expect("system entry")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    system_entries.sort();
    assert_eq!(
        system_entries,
        vec!["content-tree.json".to_string(), "project.json".to_string()],
        "AI 链路不得在系统目录留下任何事务/临时文件: {system_entries:?}"
    );
    let mut text_entries: Vec<String> = std::fs::read_dir(&paths.user_text_dir)
        .expect("read user text dir")
        .map(|entry| {
            entry
                .expect("text entry")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    text_entries.sort();
    assert_eq!(
        text_entries,
        vec!["documents".to_string()],
        "作品文本文件夹不应多出任何文件: {text_entries:?}"
    );

    // 5. 正对照：用户保存确实改变文档字节（证明本测试能检测到写入，
    //    不是「永远相等的空断言」）。
    let new_draft = notebook_json("用户改写的内容");
    save_document(&project_root, &doc_id, &new_draft).expect("user save changes document");
    let after_save = snapshot();
    assert_ne!(
        after_save.0, before.0,
        "用户保存必须真实改变文档字节（正对照）"
    );
    assert_ne!(after_save.1, before.1, "用户保存会更新元信息 updated_at");
    assert_eq!(
        std::fs::read_to_string(paths.document_file(&doc_id)).expect("read document after save"),
        new_draft,
        "保存后的文档内容应等于新内容"
    );
}
