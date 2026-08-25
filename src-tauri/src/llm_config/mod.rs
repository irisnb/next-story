use std::fs;
use std::io::{Read, Write};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub mod secret_store;
pub use secret_store::{KeyringStore, SecretStore, KEYRING_ACCOUNT, KEYRING_SERVICE};

const CONFIG_FILE_NAME: &str = "llm-config.json";
/// LLM 配置文件读取大小上限，防止损坏或被替换为巨型文件时无界分配内存。
const MAX_CONFIG_BYTES: u64 = 64 * 1024;

/// 应用级 LLM 配置（API Key 存操作系统钥匙串，磁盘文件不落明文）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    /// OpenAI-compatible API base URL
    pub api_base_url: String,
    /// API Key（保存在操作系统钥匙串中）。
    /// 前端掩码模式下未输入新密钥时省略该字段；缺省视为「沿用钥匙串旧密钥」。
    #[serde(default)]
    pub api_key: String,
    /// 模型名
    pub model: String,
}

/// 磁盘持久化的 LLM 配置：只含非敏感字段，API Key 单独存操作系统钥匙串。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfigStored {
    /// OpenAI-compatible API base URL
    pub api_base_url: String,
    /// 模型名
    pub model: String,
}

impl LlmConfigStored {
    /// 与从钥匙串读出的 API Key 拼回完整配置
    fn with_api_key(self, api_key: String) -> LlmConfig {
        LlmConfig {
            api_base_url: self.api_base_url,
            api_key,
            model: self.model,
        }
    }
}

impl From<&LlmConfig> for LlmConfigStored {
    fn from(config: &LlmConfig) -> Self {
        LlmConfigStored {
            api_base_url: config.api_base_url.clone(),
            model: config.model.clone(),
        }
    }
}

/// 加载配置的前端契约：不含明文 API Key，只含非敏感字段与
/// `has_api_key` 布尔值（钥匙串是否已有已保存密钥，前端据此显示固定掩码）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfigSummary {
    /// OpenAI-compatible API base URL
    pub api_base_url: String,
    /// 模型名
    pub model: String,
    /// 钥匙串中是否已保存 API Key。
    pub has_api_key: bool,
}

/// LLM 配置错误
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmConfigError {
    /// 缺少 API 地址
    MissingApiBaseUrl,
    /// 缺少 API Key
    MissingApiKey,
    /// 缺少模型名
    MissingModel,
    /// API 地址格式无效
    InvalidApiBaseUrl(String),
    /// 远程 API 地址使用了明文 HTTP
    InsecureRemoteApiUrl(String),
    /// 读取失败
    ReadError(String),
    /// 写入失败
    WriteError(String),
    /// 系统钥匙串访问失败
    SecretStoreError(String),
    /// 连接测试失败
    TestConnectionFailed(String),
}

impl std::fmt::Display for LlmConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmConfigError::MissingApiBaseUrl => write!(f, "请填写 API 地址"),
            LlmConfigError::MissingApiKey => write!(f, "请填写 API Key"),
            LlmConfigError::MissingModel => write!(f, "请填写模型名"),
            LlmConfigError::InvalidApiBaseUrl(url) => write!(f, "API 地址格式无效: {}", url),
            LlmConfigError::InsecureRemoteApiUrl(url) => {
                write!(f, "远程 API 地址必须使用 HTTPS: {}", url)
            }
            LlmConfigError::ReadError(msg) => write!(f, "读取配置失败: {}", msg),
            LlmConfigError::WriteError(msg) => write!(f, "保存配置失败: {}", msg),
            LlmConfigError::SecretStoreError(msg) => write!(f, "访问系统钥匙串失败: {}", msg),
            LlmConfigError::TestConnectionFailed(msg) => write!(f, "连接测试失败: {}", msg),
        }
    }
}

impl std::error::Error for LlmConfigError {}

// ========== AI 思考生成错误契约 ==========

/// 生成错误的稳定分类码。前端只依据 `code` 切换状态，不解析 `message`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerateAiErrorCode {
    /// 缺少或未保存完整 LLM 配置
    ConfigurationRequired,
    /// 认证失败（API Key 无效或无权）
    Authentication,
    /// 连接超时
    Timeout,
    /// 无法连接（地址错误、服务未启动）
    Network,
    /// 请求内容过长（如 413）
    RequestTooLarge,
    /// 服务拒绝或内部错误（4xx / 5xx）
    Service,
    /// 响应不是有效 JSON，或没有合法 assistant 回复
    InvalidResponse,
}

/// 生成错误的稳定契约。
/// `message` 为安全清洗后的中文说明，绝不包含 API Key、Authorization、请求正文或完整远端响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerateAiError {
    pub code: GenerateAiErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerateAiMessageRole {
    User,
    Assistant,
}

/// 追问来源：`selection`（AI 及时召唤 / 思维扩展）或 `direct_question`（直接提问）。
/// 缺省视为 `selection`，维持既有校验与提示词语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FollowUpOrigin {
    Selection,
    DirectQuestion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerateAiMessage {
    pub role: GenerateAiMessageRole,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerateAiRequest {
    First {
        selected_text: String,
        /// 思维扩展可选方向；缺省或空白表示空方向开始。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking_direction: Option<String>,
    },
    FollowUp {
        selected_text: String,
        /// 追问复用首次思维扩展方向；缺省或空白表示普通召唤或空方向开始。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking_direction: Option<String>,
        /// 追问来源；缺省视为 `selection`（AI 及时召唤 / 思维扩展）。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        origin: Option<FollowUpOrigin>,
        messages: Vec<GenerateAiMessage>,
    },
    /// 常驻面板直接提问：必填问题 + 可选选区重点材料。
    DirectQuestion {
        question: String,
        /// 可选选区重点材料；缺省或空白表示无选区直接提问。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selected_text: Option<String>,
    },
}

pub fn parse_generate_ai_request(
    value: serde_json::Value,
) -> Result<GenerateAiRequest, GenerateAiError> {
    serde_json::from_value(value).map_err(|_| {
        GenerateAiError::new(
            GenerateAiErrorCode::InvalidResponse,
            "AI 请求内容无效，请重试",
        )
    })
}

impl From<&str> for GenerateAiRequest {
    fn from(selected_text: &str) -> Self {
        GenerateAiRequest::First {
            selected_text: selected_text.to_string(),
            thinking_direction: None,
        }
    }
}

impl From<&String> for GenerateAiRequest {
    fn from(selected_text: &String) -> Self {
        GenerateAiRequest::from(selected_text.as_str())
    }
}

impl From<&GenerateAiRequest> for GenerateAiRequest {
    fn from(request: &GenerateAiRequest) -> Self {
        request.clone()
    }
}

impl GenerateAiError {
    pub fn new(code: GenerateAiErrorCode, message: impl Into<String>) -> Self {
        GenerateAiError {
            code,
            message: message.into(),
        }
    }
}

/// `generate_ai_thinking` 命令的窄返回。命令始终成功返回该结构，
/// 便于前端在不依赖 Tauri 错误序列化细节的情况下区分成功与失败。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateAiResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<GenerateAiError>,
}

impl GenerateAiResult {
    pub fn success(content: String) -> Self {
        GenerateAiResult {
            ok: true,
            content: Some(content),
            error: None,
        }
    }

    pub fn failure(error: GenerateAiError) -> Self {
        GenerateAiResult {
            ok: false,
            content: None,
            error: Some(error),
        }
    }
}

pub mod generate;
pub use generate::{generate_ai_thinking, generate_ai_thinking_in_dir};

mod http;

pub fn app_data_dir_failure_result() -> GenerateAiResult {
    GenerateAiResult::failure(GenerateAiError::new(
        GenerateAiErrorCode::ConfigurationRequired,
        "无法访问 LLM 配置目录，请重启应用后重试",
    ))
}

pub async fn generate_ai_result_in(
    base_dir: &Path,
    request: impl Into<GenerateAiRequest>,
) -> GenerateAiResult {
    generate_ai_result_in_with_resource(base_dir, None, request).await
}

/// 生产命令入口：额外接收打包后的资源目录（解析 sidecar），
/// 其余逻辑与 [`generate_ai_result_in`] 相同。
pub async fn generate_ai_result_in_with_resource(
    base_dir: &Path,
    resource_dir: Option<&Path>,
    request: impl Into<GenerateAiRequest>,
) -> GenerateAiResult {
    let request = request.into();
    if let Err(error) = generate::validate_generate_ai_request(&request) {
        return GenerateAiResult::failure(error);
    }

    // 同步目录/文件/钥匙串读取放入阻塞线程，避免占住异步执行线程。
    let base_dir = base_dir.to_path_buf();
    let config_base_dir = base_dir.clone();
    let loaded = tauri::async_runtime::spawn_blocking(move || load_llm_config(&base_dir)).await;

    let config = match loaded {
        Ok(Ok(Some(config))) => config,
        Ok(Ok(None)) => {
            return GenerateAiResult::failure(GenerateAiError::new(
                GenerateAiErrorCode::ConfigurationRequired,
                "缺少 LLM 配置，请先到设置中填写并保存 API 地址、Key 与模型名",
            ));
        }
        Ok(Err(_)) => {
            return GenerateAiResult::failure(GenerateAiError::new(
                GenerateAiErrorCode::ConfigurationRequired,
                "LLM 配置无法读取，请重新保存配置",
            ));
        }
        Err(_) => {
            return GenerateAiResult::failure(GenerateAiError::new(
                GenerateAiErrorCode::ConfigurationRequired,
                "LLM 配置目录读取任务执行失败，请重启应用后重试",
            ));
        }
    };

    match generate_ai_thinking_in_dir(&config, request, &config_base_dir, resource_dir).await {
        Ok(content) => GenerateAiResult::success(content),
        Err(error) => GenerateAiResult::failure(error),
    }
}

/// 计算应用级 LLM 配置文件路径
pub fn config_path_in(base_dir: &Path) -> PathBuf {
    base_dir.join(CONFIG_FILE_NAME)
}

/// 校验配置
pub fn validate_llm_config(config: &LlmConfig) -> Result<(), LlmConfigError> {
    if config.api_base_url.trim().is_empty() {
        return Err(LlmConfigError::MissingApiBaseUrl);
    }
    if config.api_key.trim().is_empty() {
        return Err(LlmConfigError::MissingApiKey);
    }
    if config.model.trim().is_empty() {
        return Err(LlmConfigError::MissingModel);
    }

    parse_api_base_url(&config.api_base_url)?;

    Ok(())
}

/// 配置保存互斥：串行化并发保存，避免两个保存交错写钥匙串与磁盘文件。
static CONFIG_SAVE_LOCK: Mutex<()> = Mutex::new(());

/// 保存阶段边界（测试故障注入用；生产路径恒传恒成功闭包）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)] // After* 前缀是故障注入边界的语义，非冗余
pub enum ConfigSavePhase {
    /// 钥匙串已更新，磁盘文件尚未原子替换。
    AfterKeyringUpdate,
}

/// 保存配置：API Key 写入系统钥匙串，非敏感字段原子写入磁盘文件。
///
/// 事务顺序为「读旧密钥+旧磁盘配置 → 写磁盘临时文件 → 更新钥匙串 →
/// 原子替换磁盘文件」，任一步失败按相反顺序回滚（临时文件直接丢弃，
/// 钥匙串恢复为旧值），杜绝「旧地址 + 新密钥」的分裂状态。
/// 并发保存被进程内互斥串行化。
pub fn save_llm_config(base_dir: &Path, config: &LlmConfig) -> Result<(), LlmConfigError> {
    save_llm_config_with_store(base_dir, config, &KeyringStore)
}

/// 保存配置（可注入密钥存储，测试走内存实现，生产走系统钥匙串）。
pub fn save_llm_config_with_store(
    base_dir: &Path,
    config: &LlmConfig,
    store: &dyn SecretStore,
) -> Result<(), LlmConfigError> {
    save_llm_config_transaction(base_dir, config, store, |_| Ok(()))
}

/// 带阶段检查点的保存入口：测试注入「钥匙串成功后、磁盘替换前」故障用；
/// 生产路径请使用 [`save_llm_config_with_store`]。
pub fn save_llm_config_with_store_checked(
    base_dir: &Path,
    config: &LlmConfig,
    store: &dyn SecretStore,
    checkpoint: impl FnMut(ConfigSavePhase) -> Result<(), LlmConfigError>,
) -> Result<(), LlmConfigError> {
    save_llm_config_transaction(base_dir, config, store, checkpoint)
}

/// 掩码模式兼容：api_key 为空表示沿用钥匙串中的旧密钥，不覆盖。
fn resolve_effective_key(
    config: &LlmConfig,
    store: &dyn SecretStore,
) -> Result<String, LlmConfigError> {
    if config.api_key.trim().is_empty() {
        store
            .get(KEYRING_SERVICE, KEYRING_ACCOUNT)?
            .ok_or(LlmConfigError::MissingApiKey)
    } else {
        Ok(config.api_key.clone())
    }
}

/// 解析前端传入配置的有效形态：api_key 为空时复用钥匙串中的旧密钥。
/// 供 `test_llm_connection` 等命令在调用底层用例前补齐密钥。
pub fn resolve_effective_config(config: &LlmConfig) -> Result<LlmConfig, LlmConfigError> {
    let api_key = resolve_effective_key(config, &KeyringStore)?;
    Ok(LlmConfig {
        api_base_url: config.api_base_url.clone(),
        api_key,
        model: config.model.clone(),
    })
}

fn save_llm_config_transaction(
    base_dir: &Path,
    config: &LlmConfig,
    store: &dyn SecretStore,
    mut checkpoint: impl FnMut(ConfigSavePhase) -> Result<(), LlmConfigError>,
) -> Result<(), LlmConfigError> {
    // 并发保存串行化：整个事务（读旧值 → 临时文件 → 钥匙串 → 原子替换）持锁。
    let _serialize = CONFIG_SAVE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let effective_key = resolve_effective_key(config, store)?;

    let effective_config = LlmConfig {
        api_base_url: config.api_base_url.clone(),
        api_key: effective_key.clone(),
        model: config.model.clone(),
    };
    validate_llm_config(&effective_config)?;

    // 1. 读旧密钥（回滚用）与旧磁盘配置（回滚失败时上报用）。
    let old_key = store.get(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    let old_disk = read_disk_config_or_none(base_dir);

    // 2. 写磁盘临时文件（不触碰任何可见文件；失败直接丢弃临时文件）。
    fs::create_dir_all(base_dir).map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    let path = config_path_in(base_dir);
    let stored = LlmConfigStored::from(config);
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    let mut temp_file = tempfile::NamedTempFile::new_in(base_dir)
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    temp_file
        .write_all(json.as_bytes())
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    temp_file
        .flush()
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;

    // 3. 更新钥匙串；失败时钥匙串未变，无需回滚。
    store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, &effective_key)?;

    // 故障注入点：钥匙串已更新、磁盘尚未替换。
    if let Err(error) = checkpoint(ConfigSavePhase::AfterKeyringUpdate) {
        return finish_save_with_keyring_rollback(store, old_key, old_disk, error);
    }

    // 4. 原子替换磁盘文件（提交点）；失败则回滚钥匙串为旧值。
    if let Err(error) = temp_file.persist(&path) {
        return finish_save_with_keyring_rollback(
            store,
            old_key,
            old_disk,
            LlmConfigError::WriteError(error.error.to_string()),
        );
    }

    Ok(())
}

/// 钥匙串已更新但磁盘替换失败时，按相反顺序回滚钥匙串为旧值；
/// 回滚本身失败时显式上报（配置以磁盘为准，下次加载自愈），不静默。
fn finish_save_with_keyring_rollback(
    store: &dyn SecretStore,
    old_key: Option<String>,
    old_disk: Option<String>,
    primary: LlmConfigError,
) -> Result<(), LlmConfigError> {
    let rollback = match old_key {
        Some(key) => store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, &key),
        None => store.delete(KEYRING_SERVICE, KEYRING_ACCOUNT),
    };

    match rollback {
        Ok(()) => Err(primary),
        Err(rollback_error) => Err(LlmConfigError::SecretStoreError(format!(
            "保存配置失败: {primary}；恢复旧密钥也失败: {rollback_error}。当前磁盘配置为 {}，请重新保存配置",
            old_disk.unwrap_or_else(|| "（无磁盘配置）".to_string()),
        ))),
    }
}

/// 读取旧磁盘配置的原文（仅用于回滚失败时的错误上报；读取失败视为无旧配置）。
fn read_disk_config_or_none(base_dir: &Path) -> Option<String> {
    let path = config_path_in(base_dir);
    if !path.is_file() {
        return None;
    }
    read_config_bounded(&path).ok()
}

/// 加载配置；文件不存在返回 None
pub fn load_llm_config(base_dir: &Path) -> Result<Option<LlmConfig>, LlmConfigError> {
    load_llm_config_with_store(base_dir, &KeyringStore)
}

/// 加载配置（可注入密钥存储，测试走内存实现，生产走系统钥匙串）。
/// 兼容旧格式：若磁盘文件仍含明文 `api_key`，会把它迁移进钥匙串，
/// 并把文件改写为不含 key 的新格式。
pub fn load_llm_config_with_store(
    base_dir: &Path,
    store: &dyn SecretStore,
) -> Result<Option<LlmConfig>, LlmConfigError> {
    let path = config_path_in(base_dir);
    if !path.exists() {
        return Ok(None);
    }

    let json = read_config_bounded(&path)?;
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;

    if value.get("api_key").is_some() {
        return load_legacy_config_with_store(&path, value, store).map(Some);
    }

    let stored: LlmConfigStored =
        serde_json::from_value(value).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;
    let api_key = store
        .get(KEYRING_SERVICE, KEYRING_ACCOUNT)?
        .ok_or_else(|| {
            LlmConfigError::SecretStoreError(
                "配置已保存，但系统钥匙串中缺少 API Key，请重新保存配置".to_string(),
            )
        })?;
    Ok(Some(stored.with_api_key(api_key)))
}

/// 加载配置的脱敏摘要：不含明文 API Key，只含非敏感字段与
/// `has_api_key`（钥匙串是否取到密钥）。前端据此显示固定掩码，不回填明文。
pub fn load_llm_config_summary(
    base_dir: &Path,
) -> Result<Option<LlmConfigSummary>, LlmConfigError> {
    load_llm_config_summary_with_store(base_dir, &KeyringStore)
}

/// 加载配置摘要（可注入密钥存储，测试走内存实现，生产走系统钥匙串）。
/// 兼容旧格式：若磁盘文件仍含明文 `api_key`，会把它迁移进钥匙串并改写文件。
pub fn load_llm_config_summary_with_store(
    base_dir: &Path,
    store: &dyn SecretStore,
) -> Result<Option<LlmConfigSummary>, LlmConfigError> {
    let path = config_path_in(base_dir);
    if !path.exists() {
        return Ok(None);
    }

    let json = read_config_bounded(&path)?;
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;

    if value.get("api_key").is_some() {
        let legacy = load_legacy_config_with_store(&path, value, store)?;
        return Ok(Some(LlmConfigSummary {
            api_base_url: legacy.api_base_url,
            model: legacy.model,
            has_api_key: true,
        }));
    }

    let stored: LlmConfigStored =
        serde_json::from_value(value).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;
    let has_api_key = store.get(KEYRING_SERVICE, KEYRING_ACCOUNT)?.is_some();
    Ok(Some(LlmConfigSummary {
        api_base_url: stored.api_base_url,
        model: stored.model,
        has_api_key,
    }))
}

/// 有界读取配置文件：打开一次句柄后 `take(max+1)` 限量读取，超限拒绝；
/// 不依赖读取前的元数据长度（消除 TOCTOU 竞态），超限内容不会被无界读入内存。
fn read_config_bounded(path: &Path) -> Result<String, LlmConfigError> {
    let file = fs::File::open(path).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;

    let mut limited = file.take(MAX_CONFIG_BYTES + 1);
    let mut content = String::new();
    limited
        .read_to_string(&mut content)
        .map_err(|e| LlmConfigError::ReadError(e.to_string()))?;

    if content.len() as u64 > MAX_CONFIG_BYTES {
        return Err(LlmConfigError::ReadError(format!(
            "配置文件过大，无法读取: {}",
            path.display()
        )));
    }

    Ok(content)
}

/// 旧格式明文配置迁移：把明文 `api_key` 写入钥匙串，并把文件改写为不含 key 的新格式。
fn load_legacy_config_with_store(
    path: &Path,
    value: serde_json::Value,
    store: &dyn SecretStore,
) -> Result<LlmConfig, LlmConfigError> {
    let legacy: LlmConfig =
        serde_json::from_value(value).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;
    store.set(KEYRING_SERVICE, KEYRING_ACCOUNT, &legacy.api_key)?;

    let stored = LlmConfigStored::from(&legacy);
    let json = serde_json::to_string_pretty(&stored)
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    write_file_atomically(path, &json)?;

    Ok(legacy)
}

/// 测试连接
pub async fn test_llm_connection(config: &LlmConfig) -> Result<(), LlmConfigError> {
    validate_llm_config(config)?;
    let base_url = parse_api_base_url(&config.api_base_url)?;
    http::test_connection(config, base_url).await
}

pub(crate) fn parse_api_base_url(raw: &str) -> Result<reqwest::Url, LlmConfigError> {
    let trimmed = raw.trim();
    if trimmed.starts_with("http:///") || trimmed.starts_with("https:///") {
        return Err(LlmConfigError::InvalidApiBaseUrl(trimmed.to_string()));
    }

    let url = reqwest::Url::parse(trimmed)
        .map_err(|_| LlmConfigError::InvalidApiBaseUrl(trimmed.to_string()))?;

    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(LlmConfigError::InvalidApiBaseUrl(trimmed.to_string()));
    }

    let host = url
        .host_str()
        .ok_or_else(|| LlmConfigError::InvalidApiBaseUrl(trimmed.to_string()))?;

    if url
        .path()
        .trim_end_matches('/')
        .ends_with("/chat/completions")
    {
        return Err(LlmConfigError::InvalidApiBaseUrl(trimmed.to_string()));
    }

    match url.scheme() {
        "https" => Ok(url),
        "http" if is_loopback_host(host) => Ok(url),
        "http" => Err(LlmConfigError::InsecureRemoteApiUrl(trimmed.to_string())),
        _ => Err(LlmConfigError::InvalidApiBaseUrl(trimmed.to_string())),
    }
}

pub(crate) fn is_loopback_url(url: &reqwest::Url) -> bool {
    url.host_str().is_some_and(is_loopback_host)
}

fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    host.trim_matches(['[', ']'])
        .parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

fn write_file_atomically(path: &Path, content: &str) -> Result<(), LlmConfigError> {
    let parent = path
        .parent()
        .ok_or_else(|| LlmConfigError::WriteError("目标文件缺少父目录".to_string()))?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    temp_file
        .flush()
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    temp_file
        .persist(path)
        .map_err(|e| LlmConfigError::WriteError(e.error.to_string()))?;

    Ok(())
}
