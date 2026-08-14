## Why

外部工程审查报告（基线 0f82164）在富文本改造落地前完成。核对当前代码后发现：报告对纯文本时代的 P3-03 判断已失效，但其指出的最危险缺陷仍原封不动存在——保存系统的输入上限与读取/恢复上限不一致。当任一本子超过 10 MiB 时，保存会把超限内容写入事务目录并把清单切到 `Committing`，随后替换与恢复都因按 10 MiB 读取失败，作品进入无法自动恢复的卡死状态。

此外，保存事务缺少 `sync_all`、LLM 配置读取无大小上限、未使用的 `opener` 权限仍被授予、状态订阅无法退订，且仓库没有 CI 与 rustfmt/clippy 门禁。

本 change 一次性闭合这些已确认、低风险、无需架构决策的问题，并把需要单独设计决策的项（迁移框架、密钥系统凭据存储、CSP 收紧、依赖版本策略、AI 状态机重构、错误分类细化、ESLint）留待后续。

## What Changes

- 保存入口在创建任何事务文件前，对草稿本与正文本的 UTF-8 字节数做与读取端一致的上限校验，超限返回专用的 `ContentTooLarge` 错误，不进入事务。
- 恢复逻辑对 `Staged` 超限事务安全丢弃；对 `Committing` 超限事务返回带人工恢复路径的专用错误，避免作品被永久卡死。
- 保存原子写增加 `sync_all`（关键暂存文件与清单），把崩溃一致性从进程级向断电级推进。
- LLM 配置文件读取改为有界读取（64 KiB），避免损坏或巨型文件导致无界内存分配。
- 移除未使用的 `opener` 插件、权限与依赖（前端与 Rust 侧均无调用），`dialog` 权限保留（目录选择仍在使用）。
- `AiPanelState.subscribe` 返回退订函数，供未来销毁时释放监听。
- 新增 GitHub Actions CI：typecheck、前端测试、build、Rust fmt/clippy/test，并修复现有 rustfmt/clippy 问题使门禁立即通过。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-project-lifecycle`: 保存侧大小上限与恢复行为、保存事务的持久写入。
- `llm-configuration`: 配置文件读取大小上限。
- `tauri-security-baseline`: 移除未使用的 opener 权限，收紧到实际需要。
- `ai-panel-state-structure`: 订阅可退订。

## Impact

- 后端：`project::operations` 保存/恢复路径、`ProjectError` 新增 `ContentTooLarge`、`llm_config` 有界读取与 `sync_all`。
- 前端：`AiPanelState.subscribe` 返回类型变更（唯一调用点在 `ai-panel.ts`）。
- 配置：移除 `tauri-plugin-opener`（Rust + npm 依赖、capabilities、插件初始化）。
- 工程：新增 `.github/workflows/ci.yml`，运行 `cargo fmt` 并修复 clippy 警告。
- 边界不变：AI 仍只进面板，不写草稿本/正文本；保存仍为三文件同世代事务。
