# 提案：清偿 Dependabot 第二轮安全警报（sidecar 钉版＋两项有据挂账）

## Why

GitHub 报 11 个开放依赖安全警报（1 严重、1 高危、8 中危、1 低危）。逐项对账后分三层：

- **7 个现在可修**：sidecar 的 hono ×5、@hono/node-server ×2——按 `sidecar-dependency-hygiene` 既有钉版纪律（范围式 overrides）处理即可，`npm audit` 归零。
- **3 个 zip 修不了**（含严重级）：元凶是 tauri-plugin-updater 2.11.0 硬性要求 `zip ^4`，zip <9.0.0 全系有 CVE；插件最高稳定线即 2.11.x，之上只有 3.0.0-alpha.3 预发布，无兼容修复版也无含修复的 2.x 主线提交——既有规格的修复路径穷尽。
- **1 个 minimatch 修不了**：根树 dev 作用域，消费者 eslint 10.8.1／@eslint/config-array／@typescript-eslint/typescript-estree 三方锁 `^10`；eslint 最新 10.15.0 虽已升 `^11`，但 typescript-eslint 最新 8.72.2 仍锁 `^10`，锁文件必残留 10.2.6 触发警报；硬 overrides 为既有 root 规格（2026-11-12 立）明文禁止。

## What Changes

- `sidecar/package.json`：hono 覆盖 `^4.13.5` → `^4.13.16`；新增 `@hono/node-server: ^2.1.6`；重新生成 sidecar 锁文件；`sidecar/ npm audit` 归零（**行为零改动**，DSH 本体钉 0.1.2-rc.1 不动）。
- **规格分支补充（两份）**：`rust-dependency-security-hygiene` 修复路径要求新增「上游全线无修复版时有据挂账」分支；`root-dev-dependency-hygiene` 新增「纯传递依赖、上游工具链未跟进时的挂账纪律」要求。挂账＝登记包名、警报、证据链、实际暴露面评估与复评触发条件，MUST NOT 静默容忍、MUST NOT 强 `[patch]` 或上预发布。
- **账本两条**（`方向/行动计划-2026-08-27.md`）：zip ×3（复评触发＝插件稳定版要求 zip ≥9 或升 tauri 2.12 时）；minimatch ×1（复评触发＝typescript-eslint 发布要求 minimatch ^11 的版本）。
- 顺带核实（零改动）：docx-rs 官方 crates.io 仍 0.4.22，切回条件未满足，git 钉 rev 继续有效。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `rust-dependency-security-hygiene`：修复路径要求补第三分支——既有路径穷尽（无范围内修复版、无含修复的上游主线提交、预发布不可用）时，有据挂账是唯一合规处置。
- `root-dev-dependency-hygiene`：新增要求——纯传递依赖的跨大版本警报、上游工具链尚未跟进时挂账登记，禁止 overrides 绕行；上游跟进后随显式升级收敛。

## Impact

- **文件**：`sidecar/package.json`＋锁、两份规格 delta、`方向/行动计划-2026-08-27.md`、`AGENTS.md`（一句补记）。
- **验证**：sidecar `npm audit` 归零断言＋双树 `npm ci`＋`npm run check` 总门禁＋真机 AI 冒烟（sidecar 通信框架升级后必须实弹，发布 v0.2.2 前置）。
- **发布后预期**：GitHub 警报 11 → 4（剩 zip ×3、minimatch ×1，均有账可查；Dependabot 消警有延迟，据实报告）。
