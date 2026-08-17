//! DSH headless sidecar 生成通路（spike 验证用，非生产实现）。
//!
//! 一次性任务：`dsh --profile headless "<task>"`，退出码 0 = 成功（stdout 为最终答案），
//! 非 0 = 失败（stderr 为错误）。本模块只验证「Rust 能 spawn DSH、读结果、限超时、映射错误」，
//! 完整命令接线与 A/B 开关归入迁移 phase。

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::llm_config::{GenerateAiError, GenerateAiErrorCode};

/// DSH 生成超时。DSH agent（含思考模式）比原单次 HTTP 调用慢，60s 不够，先放宽到 180s；
/// 迁移时需与「关闭思考模式」一起调优。
pub const DSH_GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// 通过 `node <bin.js> --profile headless <task>` 生成一次 AI 回复。
///
/// 直接 spawn `node` + DSH 的 bin.js 入口，绕开 `.cmd` shim（其 `endLocal & goto`
/// 技巧会让进程树异常、导致 `try_wait` 卡住）。
/// - 超时强制终止子进程并返回 `Timeout`；
/// - 退出码非 0 时按 stderr 关键词映射到稳定错误分类；
/// - 错误 `message` 只含固定中文与退出码，绝不回传 stderr 原文（防泄露 Key/请求/响应）。
pub fn generate_via_dsh(task: &str, node_bin: &str, bin_js: &str) -> Result<String, GenerateAiError> {
    let mut child = Command::new(node_bin)
        .args([bin_js, "--profile", "headless", task])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            GenerateAiError::new(
                GenerateAiErrorCode::Service,
                format!("无法启动 DSH 进程: {e}"),
            )
        })?;

    // 并发排空 stdout/stderr：DSH 生成过程会流式写输出，若等子进程退出再读，
    // 管道缓冲区（约 64KB）写满后子进程阻塞、父进程永远等不到 try_wait 返回。
    let mut stdout = child.stdout.take().expect("stdout 已 piped");
    let mut stderr = child.stderr.take().expect("stderr 已 piped");
    let out_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let deadline = Instant::now() + DSH_GENERATION_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(GenerateAiError::new(
                        GenerateAiErrorCode::Timeout,
                        "生成超时，请稍后重试",
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                return Err(GenerateAiError::new(
                    GenerateAiErrorCode::Service,
                    format!("DSH 进程状态检查失败: {e}"),
                ));
            }
        }
    };

    let stdout_text = out_thread.join().unwrap_or_default();
    let stderr_text = err_thread.join().unwrap_or_default();

    if status.success() {
        let text = stdout_text.trim().to_string();
        if text.is_empty() {
            return Err(GenerateAiError::new(
                GenerateAiErrorCode::InvalidResponse,
                "模型没有返回有效的思考内容",
            ));
        }
        return Ok(text);
    }
    Err(map_dsh_failure(status.code(), &stderr_text))
}

/// 把 DSH 失败（退出码非 0 + stderr 文本）映射到稳定的错误分类。
///
/// 只按 stderr 关键词判定分类，`message` 用固定中文 + 退出码，不回传 stderr 原文。
fn map_dsh_failure(exit_code: Option<i32>, stderr: &str) -> GenerateAiError {
    let lower = stderr.to_lowercase();
    let (code, message) = if lower.contains("no api key")
        || lower.contains("missing_credential")
        || lower.contains("not configured")
    {
        (
            GenerateAiErrorCode::ConfigurationRequired,
            "缺少 LLM 配置，请先到设置中填写并保存 API 地址、Key 与模型名".to_string(),
        )
    } else if lower.contains("api key")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("auth")
        || lower.contains("unauthorized")
    {
        (GenerateAiErrorCode::Authentication, "认证失败：API Key 可能无效或没有权限".to_string())
    } else if lower.contains("timeout") || lower.contains("timed out") {
        (GenerateAiErrorCode::Timeout, "连接超时，请检查 API 地址或网络".to_string())
    } else if lower.contains("connect")
        || lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("dns")
        || lower.contains("enotfound")
    {
        (GenerateAiErrorCode::Network, "无法连接到服务，请检查 API 地址是否正确".to_string())
    } else {
        (
            GenerateAiErrorCode::Service,
            format!("生成失败（DSH 退出码 {:?}）", exit_code),
        )
    };
    GenerateAiError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真机集成测试：需要 DSH 已安装、headless profile 已挂 keyring 插件、钥匙串已存 key。
    /// 默认 `#[ignore]`，手动运行：`cargo test -- --ignored dsh_headless`。
    #[test]
    #[ignore = "需要 DSH sidecar + 钥匙串 + 网络，手动运行"]
    fn dsh_headless_generates_real_response() {
        let node_bin = "node";
        let bin_js = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js"
        );
        let task = "你是陪剧本创作者思考的助手。选区原文：『林站在天台边。』请提出两个帮助创作者继续思考的问题，纯文本回答。";
        let result = generate_via_dsh(task, node_bin, bin_js);
        assert!(result.is_ok(), "DSH 生成失败: {:?}", result.err());
        let text = result.unwrap();
        assert!(!text.trim().is_empty(), "DSH 返回了空响应");
    }

    #[test]
    fn map_dsh_failure_classifies_each_error_family() {
        let cases = [
            ("401 Unauthorized: invalid api key", GenerateAiErrorCode::Authentication),
            ("request timed out after 60s", GenerateAiErrorCode::Timeout),
            ("ECONNREFUSED connect failed", GenerateAiErrorCode::Network),
            ("MISSING_CREDENTIAL: no API key", GenerateAiErrorCode::ConfigurationRequired),
            ("unknown internal failure", GenerateAiErrorCode::Service),
        ];
        for (stderr, expected) in cases {
            let err = map_dsh_failure(Some(1), stderr);
            assert_eq!(err.code, expected, "stderr 分类不符: {stderr}");
        }
    }

    #[test]
    fn map_dsh_failure_never_leaks_stderr_into_message() {
        let err = map_dsh_failure(Some(1), "sk-secret-key-123 auth failed with 401");
        assert!(!err.message.contains("sk-secret-key-123"));
        assert!(!err.message.contains("auth failed"));
    }
}
