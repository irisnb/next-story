# CI 恢复绿灯与 Dependabot 治理（fix-ci-timezone-and-dependabot-hygiene）

## Why

2026-08-15 引入 GitHub Actions CI 与 Dependabot 后，97 次 CI 运行中 70 次失败：8 月中下旬挂在 Rust 格式检查（提交前未跑 rustfmt），2026-09-09 起挂在同一个时区依赖的前端测试（`tests/ai-panel-conversation-list.test.ts` 用北京时间月初零点造数据，在 GitHub 的 UTC 环境跨月，导致连纯文档提交也必挂），且本地从未执行 clippy 造成 14 处告警累积。CI 长期全红使 GitHub 持续向用户发送失败邮件，也让修复队列失去绿色验证门；同时 Dependabot 以每周频率递出 10 张 PR（其中 5 张为 Tiptap 2→3、reqwest 0.12→0.13 大版本换代），与「钉死版本、单人开发」的项目策略相悖，形成通知噪音。本 change 修复全部已知失败项恢复 CI 绿灯，并把 Dependabot 调教为「保小弃大、降频、合并、限量」策略。

## What Changes

- **修复时区依赖测试**：`tests/ai-panel-conversation-list.test.ts` 中「更早」分组月份断言的测试数据从「+08:00 月初零点」改为「月中时刻」，使断言在任何运行时区下都不跨月。仅改测试数据，不改产品分组行为（按用户本地时区显示月份是正确行为，保持不变）。
- **全量 `cargo fmt`**：使 `cargo fmt --check` 通过（队列 3a 修复在 `dsh_driver.rs` 等处的格式遗留；纯格式化，不改逻辑）。
- **修复 clippy 14 处告警**：全部为测试代码中的 `needless_borrows_for_generic_args` 冗余借用（`story_search.rs` 等），机械改动，不改行为。
- **Dependabot 策略调整**（重写 `.github/dependabot.yml`）：巡逻频率 weekly→monthly；忽略所有 semver-major 大版本更新（想换大版本时用户手动主导）；npm 与 cargo 依赖各自分组递单；限制同时在途 PR 数量。
- **关闭现存 10 张 Dependabot 旧 PR**：GitHub 平台操作，不涉代码；按新策略该来的更新会自动重新递单。
- **（机动项）**：若推送后 Windows 作业再现 `jetscii` 依赖缓存错误（2026-08-27 曾发生，非代码问题），清理对应 Actions 缓存后重跑。

## Capabilities

### New Capabilities

- `ci-pipeline`：CI 门禁与环境无关性契约——CI 必须在 Linux 与 Windows 双平台执行类型检查、lint、前端测试、生产构建、Rust 格式检查、clippy（`-D warnings`）与 Rust 测试；测试不得依赖运行环境时区等本地条件；Dependabot 以月度频率、仅非大版本、分组递单策略运行。

### Modified Capabilities

（无——本 change 不改任何产品行为；`conversation-list` 的分组显示行为不变。）

## Impact

- **测试**：`tests/ai-panel-conversation-list.test.ts`（时间戳数据）；`src-tauri` 若干测试文件 clippy 冗余借用修复。
- **格式化**：`src-tauri` 全量 `cargo fmt` 产物（多文件，纯空白与换行变化）。
- **配置**：`.github/dependabot.yml` 重写。
- **GitHub 平台操作**：关闭 10 张 Dependabot PR；必要时清 Actions rust-cache 缓存。
- **不改**：任何产品行为、驱动协议、存储格式、UI 布局、AI 链路；`.github/workflows/ci.yml` 不动（现有门禁步骤保持）。
- **明确不做**（留后续）：依赖大版本升级（Tiptap 3、reqwest 0.13 等由用户未来手动决策）、CI workflow 结构性重构、Node 20 弃用警告的 actions 版本升级。
