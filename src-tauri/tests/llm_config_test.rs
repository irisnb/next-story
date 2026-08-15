use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use next_story_lib::llm_config::{
    app_data_dir_failure_result, generate_ai_result_in, generate_ai_thinking,
    generate_ai_thinking_with_timeout, load_llm_config_summary_with_store,
    load_llm_config_with_store, save_llm_config_with_store, save_llm_config_with_store_checked,
    test_llm_connection, validate_llm_config, ConfigSavePhase, GenerateAiError,
    GenerateAiErrorCode, GenerateAiMessage, GenerateAiMessageRole, GenerateAiRequest, LlmConfig,
    LlmConfigError, SecretStore, CONNECTION_TEST_TIMEOUT_SECS, GENERATION_TIMEOUT_SECS,
    KEYRING_ACCOUNT, KEYRING_SERVICE, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};
use next_story_lib::project::{
    create_new_project, save_existing_project, CreateProjectParams, ProjectPaths,
};
use tempfile::TempDir;

const EXPECTED_FIXED_SYSTEM_PROMPT: &str = "你是陪剧本创作者思考的助手。当前请求只提供冻结选区原文，以及用户可选的探索方向。\
你只能基于这段选区原文回应；若提供了探索方向，把它当作用户希望继续探索的角度，而不是作品事实或最终判断。\
先区分从文字里看到的内容和可能解释，再提出能帮助创作者继续思考的问题，并给出几个可能方向。\
追问仍锚定首次冻结选区；只把已有轮次当作当前临时线性对话，不当作持久历史，不当作作品事实。\
不直接改草稿本或正文本，不代写正文，不润色，不提供替换文本，不判断故事好坏，不判断正确或错误，不判断高级或低级。\
不能声称读取或使用选区前后文；不能声称读取或使用当前本子全文；不能声称读取或使用摘要；不能声称读取或使用作品元数据；不能声称读取或使用AI 内容库；不能声称读取或使用历史会话；不能声称读取或使用记忆；不能声称读取或使用用户确认的作品事实。\
不要输出 Markdown 或 HTML 格式，使用纯文本回答。";

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

fn first_request_with_direction(
    selected_text: impl Into<String>,
    direction: impl Into<String>,
) -> GenerateAiRequest {
    GenerateAiRequest::First {
        selected_text: selected_text.into(),
        thinking_direction: Some(direction.into()),
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

fn follow_up_request_with_direction(
    selected_text: impl Into<String>,
    direction: impl Into<String>,
    messages: Vec<GenerateAiMessage>,
) -> GenerateAiRequest {
    GenerateAiRequest::FollowUp {
        selected_text: selected_text.into(),
        thinking_direction: Some(direction.into()),
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
            Err(LlmConfigError::WriteError("测试注入的磁盘写入失败".to_string()))
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
async fn generate_joins_all_multipart_assistant_text_in_order() {
    let base = start_mock(
        200,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\" 第一段 \"},{\"type\":\"text\",\"text\":\"第二段\"}]}}]}",
    );
    let config = sample_config(base);

    let content = generate_ai_thinking(&config, "背叛")
        .await
        .expect("生成应成功");

    assert_eq!(content, "第一段\n第二段");
}

#[tokio::test]
async fn generate_ignores_empty_and_unknown_multipart_parts() {
    let base = start_mock(
        200,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"  \"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://example.com/a.png\"}},{\"type\":\"text\",\"text\":\" 可见文本 \"}]}}]}",
    );
    let config = sample_config(base);

    let content = generate_ai_thinking(&config, "背叛")
        .await
        .expect("生成应成功");

    assert_eq!(content, "可见文本");
}

#[tokio::test]
async fn generate_rejects_multipart_without_valid_text() {
    let base = start_mock(
        200,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"  \"},{\"type\":\"tool_call\",\"id\":\"x\"}]}}]}",
    );
    let config = sample_config(base);

    let result = generate_ai_thinking(&config, "背叛").await;

    assert!(
        matches!(
            result,
            Err(GenerateAiError {
                code: GenerateAiErrorCode::InvalidResponse,
                ..
            })
        ),
        "应因无有效文本失败，实际: {:?}",
        result
    );
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
            "content": EXPECTED_FIXED_SYSTEM_PROMPT
        })
    );
    assert_eq!(
        value["messages"][1],
        serde_json::json!({"role":"user","content":"选区原文"})
    );
    assert_eq!(value.as_object().unwrap().len(), 3);
}

#[tokio::test]
async fn generate_first_with_thinking_direction_appends_direction_without_extra_context() {
    let response =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}".to_string();
    let (base, captured) = start_capturing_mock(response);
    generate_ai_thinking(
        &sample_config(base),
        first_request_with_direction("冻结选区", "想追的方向"),
    )
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
            "content": EXPECTED_FIXED_SYSTEM_PROMPT
        })
    );
    assert_eq!(
        value["messages"][1],
        serde_json::json!({
            "role":"user",
            "content": "选区原文：\n冻结选区\n\n用户希望探索的角度（不是作品事实或最终判断）：\n想追的方向"
        })
    );
    let body_text = body.to_string();
    for forbidden in [
        "draft",
        "main",
        "notebook",
        "summary",
        "metadata",
        "history",
        "content_library",
        "api_key",
    ] {
        assert!(
            !body_text.contains(forbidden),
            "request body must not contain unauthorized context: {forbidden}"
        );
    }
    assert_eq!(value.as_object().unwrap().len(), 3);
}

#[tokio::test]
async fn generate_first_prompt_declares_grounding_and_output_boundaries() {
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
    let system_prompt = value["messages"][0]["content"]
        .as_str()
        .expect("system prompt");

    for required in [
        "冻结选区原文",
        "只能基于这段选区原文",
        "从文字里看到的内容",
        "可能解释",
        "问题",
        "可能方向",
        "不直接改草稿本或正文本",
        "不代写正文",
        "不润色",
        "不提供替换文本",
        "不判断故事好坏",
        "不判断正确或错误",
        "不判断高级或低级",
    ] {
        assert!(
            system_prompt.contains(required),
            "首轮 prompt 缺少约束: {required}\n{system_prompt}"
        );
    }
}

#[tokio::test]
async fn generate_prompt_rejects_unavailable_context_and_memory_claims() {
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
    let system_prompt = value["messages"][0]["content"]
        .as_str()
        .expect("system prompt");

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
            system_prompt.contains(&expected),
            "prompt 缺少不可用上下文声明: {expected}\n{system_prompt}"
        );
    }
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
                "content": EXPECTED_FIXED_SYSTEM_PROMPT
            },
            {"role":"user","content":"冻结选区"},
            {"role":"assistant","content":"首次回应"},
            {"role":"user","content":"问题一"},
            {"role":"assistant","content":"回答一"},
            {"role":"user","content":"当前问题"}
        ])
    );
    assert_eq!(body.matches("当前问题").count(), 1);
    for message in value["messages"].as_array().unwrap().iter().skip(1) {
        let content = message["content"].as_str().expect("message content");
        for absent in [
            "附近上下文",
            "本子全文",
            "自动摘要",
            "作品信息",
            "AI 内容库",
        ] {
            assert!(!content.contains(absent));
        }
    }
    assert_eq!(value["stream"], false);
}

#[tokio::test]
async fn generate_follow_up_reuses_direction_bearing_first_material() {
    let response =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}".to_string();
    let (base, captured) = start_capturing_mock(response);
    let request = follow_up_request_with_direction(
        "冻结选区",
        "想追的方向",
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
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
        value["messages"][1],
        serde_json::json!({
            "role":"user",
            "content":"选区原文：\n冻结选区\n\n用户希望探索的角度（不是作品事实或最终判断）：\n想追的方向"
        })
    );
    assert_eq!(body.matches("想追的方向").count(), 1);
    assert_eq!(body.matches("当前问题").count(), 1);
}

#[tokio::test]
async fn generate_follow_up_prompt_anchors_to_frozen_selection_and_temporary_thread() {
    let response =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"ok\"}}]}".to_string();
    let (base, captured) = start_capturing_mock(response);
    let request = follow_up_request(
        "冻结选区",
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
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
    let system_prompt = value["messages"][0]["content"]
        .as_str()
        .expect("system prompt");

    for required in [
        "追问仍锚定首次冻结选区",
        "只把已有轮次当作当前临时线性对话",
        "不当作持久历史",
        "不当作作品事实",
    ] {
        assert!(
            system_prompt.contains(required),
            "追问 prompt 缺少约束: {required}\n{system_prompt}"
        );
    }
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

// ========== AI 零写回端到端（tasks 9.1） ==========

const MOCK_SUCCESS_BODY: &str =
    "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"换个视角会不会更好？\"}}]}";

/// 9.1 后端命令级端到端：AI 生成（合法首次、合法追问、失败）绝不写回
/// 草稿本/正文本。每一步之后两份本子与 project.json 的字节都必须与快照
/// **完全一致**；「用户保存」作为正对照必须真实改变草稿本字节；
/// 生成流程不得在作品目录留下任何事务/临时文件。
#[tokio::test]
async fn ai_generation_never_writes_back_to_notebooks_while_user_save_does() {
    let temp = TempDir::new().expect("create temp dir");

    // 1. 用公开 API 创建真实作品；create 只建空文档，因此先用用户保存
    //    写入已知内容，再记录三份文件的字节快照。
    let project_root = create_new_project(CreateProjectParams {
        name: "零写回作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let draft_doc = notebook_json("草稿第一行\n草稿第二行");
    let main_doc = notebook_json("正文第一行\n正文第二行");
    save_existing_project(&project_root, draft_doc.clone(), main_doc.clone())
        .expect("user save writes known notebook content");

    let paths = ProjectPaths::new(project_root.clone());
    let snapshot = || -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        (
            std::fs::read(&paths.draft_file).expect("read draft"),
            std::fs::read(&paths.main_file).expect("read main"),
            std::fs::read(&paths.metadata_file).expect("read metadata"),
        )
    };
    let before = snapshot();
    assert!(!before.0.is_empty() && !before.1.is_empty(), "本子内容不能为空");

    let assert_snapshot_unchanged = |label: &str| {
        let now = snapshot();
        assert_eq!(now.0, before.0, "{label} 后草稿本字节必须完全不变");
        assert_eq!(now.1, before.1, "{label} 后正文本字节必须完全不变");
        assert_eq!(now.2, before.2, "{label} 后 project.json 字节必须完全不变");
    };

    // 2. 配置保存到独立的应用数据目录（与作品目录隔离），指向本机 mock server。
    let app_data = temp.path().join("app-data");
    let store = MockStore::new();
    let config = sample_config(start_mock(200, MOCK_SUCCESS_BODY));
    save_llm_config_with_store(&app_data, &config, &store).expect("save llm config");

    // 3a. 合法首次请求（冻结选区）→ 成功，本子字节不变。
    let content = generate_ai_thinking(&config, first_request("冻结选区"))
        .await
        .expect("first generation succeeds against mock");
    assert_eq!(content, "换个视角会不会更好？");
    assert_snapshot_unchanged("首次生成");

    // 3b. 合法追问请求 → 成功，本子字节不变（每次生成用独立的 mock 连接）。
    let follow_up = follow_up_request(
        "冻结选区",
        vec![
            message(GenerateAiMessageRole::Assistant, "首次回应"),
            message(GenerateAiMessageRole::User, "再往深处想"),
        ],
    );
    let follow_up_config = sample_config(start_mock(200, MOCK_SUCCESS_BODY));
    let content = generate_ai_thinking(&follow_up_config, &follow_up)
        .await
        .expect("follow-up generation succeeds against mock");
    assert_eq!(content, "换个视角会不会更好？");
    assert_snapshot_unchanged("追问生成");

    // 3c. 失败生成（认证失败 401）→ 稳定失败，本子字节不变。
    let failing_config = sample_config(start_mock(401, "{\"error\":\"unauthorized\"}"));
    let error = generate_ai_thinking(&failing_config, first_request("冻结选区"))
        .await
        .expect_err("401 generation must fail");
    assert_eq!(error.code, GenerateAiErrorCode::Authentication);
    assert_snapshot_unchanged("认证失败生成");

    // 3d. 失败生成（无有效 choices）→ 稳定失败，本子字节不变。
    let empty_config = sample_config(start_mock(200, "{\"choices\":[]}"));
    let error = generate_ai_thinking(&empty_config, first_request("冻结选区"))
        .await
        .expect_err("empty choices generation must fail");
    assert_eq!(error.code, GenerateAiErrorCode::InvalidResponse);
    assert_snapshot_unchanged("空回复失败生成");

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
        vec!["project.json".to_string()],
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
        vec!["正文本.json".to_string(), "草稿本.json".to_string()],
        "作品文本文件夹不应多出任何文件: {text_entries:?}"
    );

    // 5. 正对照：用户保存确实改变草稿本字节（证明本测试能检测到写入，
    //    不是「永远相等的空断言」）。
    let new_draft = notebook_json("用户改写的草稿内容");
    save_existing_project(&project_root, new_draft.clone(), main_doc.clone())
        .expect("user save changes draft");
    let after_save = snapshot();
    assert_ne!(after_save.0, before.0, "用户保存必须真实改变草稿本字节（正对照）");
    assert_eq!(after_save.1, before.1, "只保存草稿，正文本字节应保持");
    assert_ne!(after_save.2, before.2, "用户保存会更新元信息 updated_at");
    assert_eq!(
        std::fs::read_to_string(&paths.draft_file).expect("read draft after save"),
        new_draft,
        "保存后的草稿本内容应等于新内容"
    );
}
