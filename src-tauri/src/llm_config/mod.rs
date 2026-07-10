use std::fs;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const CONFIG_FILE_NAME: &str = "llm-config.json";

/// 应用级 LLM 配置（包含 API Key 明文，开发期）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    /// OpenAI-compatible API base URL
    pub api_base_url: String,
    /// API Key（开发期明文保存）
    pub api_key: String,
    /// 模型名
    pub model: String,
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
            LlmConfigError::TestConnectionFailed(msg) => write!(f, "连接测试失败: {}", msg),
        }
    }
}

impl std::error::Error for LlmConfigError {}

mod http;

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

/// 保存配置（原子写）
pub fn save_llm_config(base_dir: &Path, config: &LlmConfig) -> Result<(), LlmConfigError> {
    validate_llm_config(config)?;

    fs::create_dir_all(base_dir).map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    let path = config_path_in(base_dir);
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| LlmConfigError::WriteError(e.to_string()))?;
    write_file_atomically(&path, &json)
}

/// 加载配置；文件不存在返回 None
pub fn load_llm_config(base_dir: &Path) -> Result<Option<LlmConfig>, LlmConfigError> {
    let path = config_path_in(base_dir);
    if !path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(&path).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;
    let config: LlmConfig =
        serde_json::from_str(&json).map_err(|e| LlmConfigError::ReadError(e.to_string()))?;
    Ok(Some(config))
}

/// 测试连接
pub async fn test_llm_connection(config: &LlmConfig) -> Result<(), LlmConfigError> {
    validate_llm_config(config)?;
    let base_url = parse_api_base_url(&config.api_base_url)?;
    http::test_connection(config, base_url).await
}

fn parse_api_base_url(raw: &str) -> Result<reqwest::Url, LlmConfigError> {
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
