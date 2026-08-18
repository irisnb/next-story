//! DSH headless adapter：DSH 版本相关细节的唯一边界。
//!
//! 产品层（[`crate::llm_config`]）只通过 [`generate_via_dsh`] 与 DSH 交互，
//! 不感知 `node` 路径、`bin.js` 入口、patch 生成、环境变量注入、退出码或
//! stderr 关键词。这些全部关在本模块里，升级 DSH 只改这里。
//!
//! 一次性任务模型：`node <bin.js> --profile headless --patch <临时patch> <task>`，
//! 退出码 0 = 成功（stdout 为最终答案），非 0 = 失败（stderr 为错误）。
//!
//! 注入机制（每次 spawn 临时生成，不持久化）：
//! - 模型名 → 临时 patch 覆盖 `agent-default-model` 行（DSH 无模型名 CLI/env 通道）。
//! - API 地址 → 临时 patch 覆盖 `llm-deepseek` 行的 `baseURL`。
//! - API Key → `DEEPSEEK_API_KEY` 环境变量（DSH 官方 per-run override，env 优先）。
//! - 禁工具 → 同一个临时 patch 里 `disabled: true` 掉全部文件/命令/联网/子 agent 行，
//!   守铁律 1（见 [`crate::capability_gateway::FORBIDDEN_TOOL_IDS`]）。

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::capability_gateway::FORBIDDEN_TOOL_IDS;
use crate::llm_config::{GenerateAiError, GenerateAiErrorCode};

/// DSH 生成超时。DSH agent（思考模式关闭后仍比单次 HTTP 慢），先放宽到 180s。
pub const DSH_GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// 一次 DSH 生成的运行参数，由宿主从用户保存的 LLM 配置解析后在 spawn 时注入。
#[derive(Debug, Clone)]
pub struct DshGenerationParams {
    pub model: String,
    pub api_base_url: String,
    pub api_key: String,
}

/// DSH sidecar 的本地路径（打包后从应用资源目录解析；开发期指向 sidecar 目录）。
#[derive(Debug, Clone)]
pub struct DshRuntimePaths {
    pub node_bin: PathBuf,
    pub bin_js: PathBuf,
    /// 应用自有的 DSH_HOME（版本隔离）；`None` 表示沿用 DSH 默认 home。
    pub dsh_home: Option<PathBuf>,
}

/// YAML 单引号标量：单引号内用 `''` 转义字面单引号，安全嵌入任意不含控制字符的字符串。
fn yaml_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// 生成每次 spawn 用的临时 patch YAML：
/// 覆盖默认模型与端点、关闭思考模式（对齐现有 Rust 直连的非思考行为、并解决超时坑）、
/// 禁用全部文件/命令/联网/子 agent 工具行。
pub fn build_runtime_patch(model: &str, api_base_url: &str) -> String {
    let mut patch = String::new();
    patch.push_str("- id: agent-default-model\n  config:\n");
    patch.push_str("    provider: deepseek-official\n");
    patch.push_str(&format!("    model: {}\n", yaml_quote(model)));
    patch.push_str("- id: llm-deepseek\n  config:\n");
    patch.push_str(&format!("    baseURL: {}\n", yaml_quote(api_base_url)));
    patch.push_str("    thinking: disabled\n");
    for tool_id in FORBIDDEN_TOOL_IDS {
        patch.push_str(&format!("- id: {tool_id}\n  disabled: true\n"));
    }
    patch
}

/// 解析 DSH sidecar 的本地路径。
///
/// sidecar 根目录优先取应用资源目录（`<resource>/sidecar/`，打包后），
/// 否则回退到开发目录（`CARGO_MANIFEST_DIR/../sidecar`）。Node 运行时优先用
/// vendored 的 `sidecar/node-runtime/<node>`，不存在时回退到系统 PATH 的 `node`。
///
/// `dsh_home` 为版本隔离的 DSH_HOME；传 `None` 表示沿用 DSH 默认 home（仅测试用）。
pub fn resolve_paths(
    dsh_home: Option<PathBuf>,
    resource_dir: Option<&Path>,
) -> Result<DshRuntimePaths, GenerateAiError> {
    let sidecar_root = match resource_dir {
        Some(dir) => dir.join("sidecar"),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar"),
    };

    let vendored_node = sidecar_root.join("node-runtime").join(node_exe_name());
    let node_bin = if vendored_node.exists() {
        vendored_node
    } else {
        PathBuf::from("node")
    };

    let bin_js = sidecar_root
        .join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("lib")
        .join("bin.js");
    if !bin_js.exists() {
        return Err(GenerateAiError::new(
            GenerateAiErrorCode::Service,
            "DSH sidecar 未安装，请先在 sidecar 目录运行 npm install",
        ));
    }
    Ok(DshRuntimePaths {
        node_bin,
        bin_js,
        dsh_home,
    })
}

#[cfg(windows)]
fn node_exe_name() -> &'static str {
    "node.exe"
}

#[cfg(not(windows))]
fn node_exe_name() -> &'static str {
    "node"
}

/// 通过 DSH headless 生成一次 AI 回复。
///
/// - 直接 spawn `node` + DSH 的 `bin.js`，绕开 `.cmd` shim（其进程树异常会导致 `try_wait` 卡住）。
/// - 并发排空 stdout/stderr，防管道写满死锁。
/// - 超时强制终止并返回 `Timeout`。
/// - 退出码非 0 时按 stderr 关键词映射稳定错误，`message` 绝不回传 stderr 原文。
pub fn generate_via_dsh(
    task: &str,
    params: &DshGenerationParams,
    paths: &DshRuntimePaths,
) -> Result<String, GenerateAiError> {
    let patch = build_runtime_patch(&params.model, &params.api_base_url);

    // 临时 patch 文件必须存活到子进程启动完毕（DSH 在 profile boot 阶段读取它）。
    let mut patch_file = tempfile::NamedTempFile::new().map_err(|e| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("无法创建临时 patch 文件: {e}"),
        )
    })?;
    patch_file
        .write_all(patch.as_bytes())
        .and_then(|_| patch_file.flush())
        .map_err(|e| {
            GenerateAiError::new(
                GenerateAiErrorCode::Service,
                format!("无法写入临时 patch 文件: {e}"),
            )
        })?;
    let patch_path = patch_file.path().to_string_lossy().to_string();

    let mut command = Command::new(&paths.node_bin);
    command
        .args([
            paths.bin_js.to_string_lossy().as_ref(),
            "--profile",
            "headless",
            "--patch",
            &patch_path,
            task,
        ])
        .env("DEEPSEEK_API_KEY", &params.api_key)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = &paths.dsh_home {
        // 确保版本隔离的 DSH_HOME 存在，否则 DSH 可能启动失败或回退到默认 home。
        std::fs::create_dir_all(home).map_err(|e| {
            GenerateAiError::new(
                GenerateAiErrorCode::Service,
                format!("无法创建 DSH 运行目录: {e}"),
            )
        })?;
        command.env("DSH_HOME", home);
    }

    let mut child = command.spawn().map_err(|e| {
        GenerateAiError::new(
            GenerateAiErrorCode::Service,
            format!("无法启动 DSH 进程: {e}"),
        )
    })?;

    // 并发排空 stdout/stderr：DSH 流式写输出，若等子进程退出再读会死锁。
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

/// 把 DSH 失败（退出码非 0 + stderr 文本）映射到稳定错误分类。
///
/// 只按 stderr 关键词判定分类，`message` 用固定中文 + 退出码，不回传 stderr 原文。
/// 判定顺序重要：「缺 key」必须排在「key 错」之前（`no api key` 也含 `api key`）。
pub fn map_dsh_failure(exit_code: Option<i32>, stderr: &str) -> GenerateAiError {
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
        (
            GenerateAiErrorCode::Authentication,
            "认证失败：API Key 可能无效或没有权限".to_string(),
        )
    } else if lower.contains("timeout") || lower.contains("timed out") {
        (
            GenerateAiErrorCode::Timeout,
            "连接超时，请检查 API 地址或网络".to_string(),
        )
    } else if lower.contains("context_window_exceeded")
        || lower.contains("context window exceeded")
        || lower.contains("request too large")
    {
        (
            GenerateAiErrorCode::RequestTooLarge,
            "请求内容过长，请减少选中的文字".to_string(),
        )
    } else if lower.contains("connect")
        || lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("dns")
        || lower.contains("enotfound")
    {
        (
            GenerateAiErrorCode::Network,
            "无法连接到服务，请检查 API 地址是否正确".to_string(),
        )
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

    #[test]
    fn build_runtime_patch_injects_model_base_url_and_disables_tools() {
        let patch = build_runtime_patch("deepseek-chat", "https://api.deepseek.com");
        assert!(patch.contains("model: 'deepseek-chat'"));
        assert!(patch.contains("baseURL: 'https://api.deepseek.com'"));
        assert!(patch.contains("thinking: disabled"));
        // 铁律 1 测试锚点：能力网关声明的每一类危险入口都必须被禁用，缺一不可。
        for id in FORBIDDEN_TOOL_IDS {
            assert!(
                patch.contains(&format!("- id: {id}\n  disabled: true")),
                "patch 缺少禁用 {id}"
            );
        }
    }

    #[test]
    fn build_runtime_patch_escapes_single_quotes_in_model() {
        // 模型名理论上不应含单引号，但转义必须正确，防止 YAML 注入破坏 patch 结构。
        let patch = build_runtime_patch("o'brien", "https://api.deepseek.com");
        assert!(patch.contains("model: 'o''brien'"));
    }

    #[test]
    fn map_dsh_failure_classifies_each_error_family() {
        let cases = [
            (
                "401 Unauthorized: invalid api key",
                GenerateAiErrorCode::Authentication,
            ),
            ("request timed out after 60s", GenerateAiErrorCode::Timeout),
            ("ECONNREFUSED connect failed", GenerateAiErrorCode::Network),
            (
                "MISSING_CREDENTIAL: no API key",
                GenerateAiErrorCode::ConfigurationRequired,
            ),
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

    /// 真机端到端：读系统钥匙串 key → 注入 env → 跑真实 DSH headless 生成。
    /// 默认 `#[ignore]`，手动运行：`cargo test -- --ignored dsh_headless`。
    /// 需要 DSH sidecar 已装（`sidecar/node_modules`）、钥匙串已存 key、网络可达。
    /// 使用隔离临时 DSH_HOME，不碰全局 `~/.dsh`（那里有残留 settings 会覆盖 patch）。
    #[test]
    #[ignore = "需要 DSH sidecar + 钥匙串 + 网络，手动运行"]
    fn dsh_headless_generates_real_response() {
        use crate::llm_config::secret_store::{KeyringStore, SecretStore, KEYRING_ACCOUNT, KEYRING_SERVICE};

        let api_key = KeyringStore
            .get(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .expect("读钥匙串")
            .expect("钥匙串中有 API Key");

        let temp = tempfile::TempDir::new().expect("temp dir");
        let mut paths = resolve_paths(None, None).expect("解析 sidecar 路径");
        paths.dsh_home = Some(temp.path().join("dsh-home"));

        let params = DshGenerationParams {
            model: "deepseek-chat".to_string(),
            api_base_url: "https://api.deepseek.com".to_string(),
            api_key,
        };
        let task = "你是陪剧本创作者思考的助手。选区原文：『林站在天台边。』请提出两个帮助创作者继续思考的问题，纯文本回答。";
        let result = generate_via_dsh(task, &params, &paths);
        assert!(result.is_ok(), "DSH 生成失败: {:?}", result.err());
        let text = result.unwrap();
        assert!(!text.trim().is_empty(), "DSH 返回了空响应");
    }
}
