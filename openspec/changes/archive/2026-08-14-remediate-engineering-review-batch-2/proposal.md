## Why

工程审查报告（第二批）还有几个已确认的问题未处理：API Key 明文保存（P2-02）、CSP 允许未使用的 `unsafe-inline` 与 `wasm-unsafe-eval`（P2-05）、依赖版本宽范围（P2-06）、缺少 ESLint 与依赖审计（P2-07）；此外用户确认补上两个架构项——项目版本迁移框架（P2-01）、AI 面板状态显式状态机（P3-01）。本 change 一次性闭合这些项。

## What Changes

- API Key 从明文 `llm-config.json` 迁移到操作系统凭据存储（keyring，跨 Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service），配置文件只留非敏感字段，旧明文配置自动迁移。
- CSP 去掉 `script-src 'unsafe-inline'` 与 `'wasm-unsafe-eval'`（Tauri 的 IPC 脚本由系统原生注入、不受 CSP 约束；前端无内联脚本、eval 或 WASM）。
- 依赖版本：关键桌面框架（Tauri、plugin-dialog、Vite、@tauri-apps/api、@tauri-apps/cli）钉到 minor；新增 Dependabot 周检。
- 新增 ESLint 门禁（范围对齐 tsconfig 的 `src/`），修复发现的问题，接入 CI。
- 修复 npm 两个高危传递依赖（nanoid、postcss）。
- 新增项目版本迁移框架：识别版本、逐级迁移、迁移前备份、迁移后校验、失败回滚；当前生产注册零迁移步骤（版本 2 即当前版，团队有意不迁移旧 v1 `.txt` 项目）。
- 把 `AiPanelState` 重构成显式 reducer / 状态机（纯 `(state, event) -> state`），公开 API 与可观察行为不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `llm-configuration`: API Key 存入系统凭据存储，不落盘明文。
- `desktop-project-lifecycle`: 项目结构版本迁移框架。
- `tauri-security-baseline`: CSP 收紧到实际需要。
- `ai-panel-state-structure`: 状态迁移显式化（reducer）。

## Impact

- 后端：`llm_config` 新增 `secret_store.rs`（`SecretStore` trait + keyring 实现）；`project` 新增 `migration.rs`。
- 前端：`ai-panel-state` 拆出纯 reducer（`ai-panel-reducer.ts`），`AiPanelState` 瘦身为 facade，`ai-panel-conversation` 改为不可变纯函数。
- 工程：CSP、依赖版本、ESLint、Dependabot、CI lint 步骤。
- 文档：index.html 与 README 的密钥存储文案同步。
- 边界不变：AI 仍只进面板，不写草稿本/正文本；保存仍为三文件同世代事务。
