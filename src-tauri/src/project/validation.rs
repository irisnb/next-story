use std::path::Path;

use super::ProjectError;

/// Windows 非法文件名字符
const INVALID_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// 验证作品名称
pub fn validate_project_name(name: &str) -> Result<(), ProjectError> {
    // 检查空名称（纯空白也算空）
    if name.trim().is_empty() {
        return Err(ProjectError::EmptyName);
    }

    // 校验针对将真正用作文件夹名的原始字符串，避免“校验用 trim、建文件夹用原始名”的不一致。
    // 首尾空格 / 结尾点号在 Windows 上会被静默处理，导致名字与实际文件夹对不上，直接拒绝，交给用户改干净。
    if name != name.trim() {
        return Err(ProjectError::InvalidNameChars(name.to_string()));
    }

    if name == "." || name == ".." || name.ends_with('.') {
        return Err(ProjectError::InvalidNameChars(name.to_string()));
    }

    if name.chars().any(char::is_control) {
        return Err(ProjectError::InvalidNameChars(name.to_string()));
    }

    // 检查非法字符
    let invalid: String = name.chars().filter(|c| INVALID_CHARS.contains(c)).collect();
    if !invalid.is_empty() {
        return Err(ProjectError::InvalidNameChars(invalid));
    }

    // Windows 保留名称
    let reserved = [
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    
    let upper_name = name.to_uppercase();
    if reserved.iter().any(|r| upper_name == *r || upper_name.starts_with(&format!("{}.", r))) {
        return Err(ProjectError::InvalidNameChars(format!("保留名称: {}", name)));
    }

    Ok(())
}

/// 验证保存位置可访问性
pub fn validate_save_location(path: &Path) -> Result<(), ProjectError> {
    // 检查父目录是否存在
    if !path.exists() {
        return Err(ProjectError::InaccessibleLocation(
            path.to_string_lossy().to_string()
        ));
    }

    if !path.is_dir() {
        return Err(ProjectError::InaccessibleLocation(
            "保存位置不是文件夹".to_string()
        ));
    }

    // 检查是否可写
    if let Ok(metadata) = path.metadata() {
        if metadata.permissions().readonly() {
            return Err(ProjectError::InaccessibleLocation(
                "目录不可写".to_string()
            ));
        }
    }

    Ok(())
}

/// 检查目标文件夹是否已存在
pub fn check_target_not_exists(parent: &Path, name: &str) -> Result<(), ProjectError> {
    let target = parent.join(name);
    if target.exists() {
        return Err(ProjectError::FolderExists(
            target.to_string_lossy().to_string()
        ));
    }
    Ok(())
}
