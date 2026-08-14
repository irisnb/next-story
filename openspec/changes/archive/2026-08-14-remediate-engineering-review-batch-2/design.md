## Context

第二批修复延续第一批（保存大小上限、CI 基线），处理剩余的已确认问题与两个用户拍板的架构项。每一项都已实现并验证，本设计记录关键决策。

## Goals / Non-Goals

**Goals:**

- 让 API Key 脱离明文磁盘文件，进入操作系统凭据存储。
- 收紧 CSP 到当前功能实际需要的范围。
- 让依赖版本可复现、升级可见。
- 建立 ESLint 门禁，修复 npm 高危传递依赖。
- 提供项目版本迁移框架与 AI 面板显式状态机。

**Non-Goals:**

- 不实现真实 v1→v2 迁移（开发期旧 `.txt` 项目仍有意不迁移）。
- 不引入 WASM / eval（因此 CSP 直接去掉这两条）。
- 不把 tests/ 纳入 lint（与 tsconfig 现状一致，tests 目前不参与类型检查）。

## Decisions

### 1. API Key 用 keyring v3 存系统凭据

磁盘 `llm-config.json` 只存 `api_base_url` 与 `model`（`LlmConfigStored`），`LlmConfig`（带 `api_key`）保留为命令/前端契约。keyring 用 v3.6.3，feature 开 `apple-native`、`windows-native`、`async-secret-service`（zbus 纯 Rust，避免 Linux CI 依赖 libdbus）、`crypto-rust`、`tokio`；keyring v3 的平台后端是 target-gated 可选依赖，三平台 feature 可同时开、任意平台安全编译。

可测试性：抽象 `SecretStore` trait，生产走 `KeyringStore`，测试走内存 `MockStore`，经 `save_llm_config_with_store` / `load_llm_config_with_store` 注入，测试绝不触碰真实钥匙串。service 用 `com.nextstory.desktop`，account 用 `llm-api-key`。旧明文配置加载时迁入钥匙串并改写文件；文件在但钥匙串无 key 时返回中文 `SecretStoreError`。

### 2. 项目迁移框架（零生产迁移）

`migration.rs` 提供 `MigrationStep { from_version, to_version, migrate }` 与 `migrate_project(project_root, migrations, target_version)`。迁移链在改动任何文件前先完整确定（缺步骤/非法定义直接拒绝、零副作用），再备份到 `next-story-system/migrations/backup-<from_version>-<时间戳>/`，逐级执行、每步后校验，失败回滚恢复原字节。生产注册表为空（`PRODUCTION_MIGRATIONS = &[]`），所以旧版本仍报「不支持的项目结构版本」，与现状一致；框架为未来 v3 预留。

### 3. AI 面板状态机

新增 `ai-panel-reducer.ts`：`AiPanelCoreState` + `AiPanelEvent`（19 种事件）+ 纯函数 `reduceAiPanelState`。非法迁移返回原状态（`next === state`），facade 据此不 emit。`TemporaryConversationState` 改为不可变纯函数。`AiPanelState` 瘦身为薄 facade，公开 API 与可观察行为零漂移，320 条前端测试零改动全绿作为契约。

### 4. CSP 收紧

Tauri 2 的 IPC 脚本是 WebView 原生 user script（`AddScriptToExecuteOnDocumentCreated` / `WKUserScript` / `UserScript`），不受页面 CSP 约束；`@tauri-apps/api` 从 `'self'` 加载；构建产物无内联脚本。因此 `script-src 'unsafe-inline'` 与 `'wasm-unsafe-eval'` 可整体删除，`script-src` 回落 `default-src 'self'`。`style-src 'unsafe-inline'` 保留（内联 style 属性需要）。

### 5. 依赖钉 minor + Dependabot

npm 用 `~`（`@tauri-apps/api ~2.11.1`、`@tauri-apps/plugin-dialog ~2.7.1`、`@tauri-apps/cli ~2.11.4`、`vite ~6.4.3`），cargo 用 `~`（`tauri ~2.11.5`、`tauri-build ~2.6.3`、`tauri-plugin-dialog ~2.7.1`、`keyring ~3.6.3`），钉到当前解析 minor、允许 patch。新增 `.github/dependabot.yml` 周检 npm 与 cargo。npm 高危传递依赖 nanoid、postcss 经 `npm audit fix` 修复。

### 6. ESLint 门禁

flat config（eslint 9 + typescript-eslint recommended），范围对齐 tsconfig 的 `src/`（忽略 `dist/`、`node_modules/`、`src-tauri/`、`tests/`），`no-unused-vars` 忽略 `_` 前缀。修掉 `src/controlled-paste.ts` 两处 `let→const`。CI 加入 `npm run lint`。

## Risks / Trade-offs

- [keyring 在 Linux headless / 无 Secret Service 环境读不到 key] → 返回明确中文错误，不静默用空 key。
- [CSP 收紧未在真实 GUI 运行时验证] → 依据官方文档与源码证据（原生注入不受 CSP 约束、官方示例无 script-src）；`npm run build` + `cargo check` 通过，真机验证留待发行前。
- [迁移框架零生产迁移，价值偏前置] → 用户明确要求；框架 + 合成迁移测试已证明备份/回滚机制可用。

## Migration Plan

旧明文 `llm-config.json` 在加载时自动迁入钥匙串并改写文件，无需手动操作。项目结构版本无变化。

## Open Questions

无。
