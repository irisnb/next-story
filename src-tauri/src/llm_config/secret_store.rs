//! 系统钥匙串（凭据存储）抽象。
//!
//! 生产实现 [`KeyringStore`] 基于 `keyring` crate，映射到操作系统原生凭据存储：
//! Windows 凭据管理器 / macOS Keychain / Linux Secret Service。
//! 测试通过注入内存实现（见 `tests/llm_config_test.rs` 的 `MockStore`），
//! 保证测试绝不触碰真实操作系统钥匙串。

use crate::llm_config::LlmConfigError;

/// 钥匙串 service 标识：应用级命名空间，避免与其他应用冲突。
pub const KEYRING_SERVICE: &str = "com.nextstory.desktop";
/// API Key 在钥匙串中的 account 标识。
pub const KEYRING_ACCOUNT: &str = "llm-api-key";

/// 密钥存储抽象：生产代码与操作系统钥匙串解耦，测试可注入内存实现。
pub trait SecretStore {
    /// 读取密钥；不存在时返回 `Ok(None)`。
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, LlmConfigError>;
    /// 写入或覆盖密钥。
    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), LlmConfigError>;
    /// 删除密钥；密钥不存在时视为成功。
    fn delete(&self, service: &str, account: &str) -> Result<(), LlmConfigError>;
}

/// 基于 `keyring` crate 的系统钥匙串实现。
///
/// 编译期按目标平台选择后端：Windows 凭据管理器、macOS Keychain、
/// Linux Secret Service（zbus，纯 Rust 实现，无 C 依赖）。
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, LlmConfigError> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|e| LlmConfigError::SecretStoreError(e.to_string()))?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(LlmConfigError::SecretStoreError(e.to_string())),
        }
    }

    fn set(&self, service: &str, account: &str, secret: &str) -> Result<(), LlmConfigError> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|e| LlmConfigError::SecretStoreError(e.to_string()))?;
        entry
            .set_password(secret)
            .map_err(|e| LlmConfigError::SecretStoreError(e.to_string()))
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), LlmConfigError> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|e| LlmConfigError::SecretStoreError(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(LlmConfigError::SecretStoreError(e.to_string())),
        }
    }
}
