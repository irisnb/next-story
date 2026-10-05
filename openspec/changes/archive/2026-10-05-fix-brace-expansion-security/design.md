## Context

- root `package-lock.json` 现状：`node_modules/brace-expansion` 5.0.9（`dev: true`）。依赖链：eslint 10.8.1 →（@eslint/config-array / @typescript-eslint/typescript-estree 等）→ minimatch 10.2.6（声明 `brace-expansion: ^5.0.8`）→ brace-expansion 5.0.9。
- root `npm audit` 基线：`brace-expansion 4.0.0 - 5.0.11`，high，1 条；三条 GHSA——GHSA-q2hr-2g5m-vwhr（`{a},b}` 重写二次方时间展开导致 CPU 拒绝服务）、GHSA-qhr7-859c-m2p7 与 GHSA-6j4f-fj2g-mc7p（嵌套 brace 组递归栈耗尽）；提示 `fix available via npm audit fix`。
- registry 只读核验（`npm view`）：5.0.12 已发布（2026-09-14T21:59Z）且为当前 latest；满足 `^5.0.8`，无需改动上游声明。
- sidecar 无该依赖（grep 零命中）；`tauri.conf.json` `resources` 仅打包 `../sidecar/node_modules/`，root 开发依赖不进安装包。

## Goals / Non-Goals

**Goals:**

- root lock 中 brace-expansion 升至 5.0.12，root `npm audit` 该条目整条消除（三条 GHSA 一并覆盖）。
- 变更最小且可审计：`git diff` 可确认只有 brace-expansion 相关锁条目变化。
- 留下可复核的验证证据（锁一致、npm ls、audit 对照、全门禁）。

**Non-Goals:**

- 不改产品功能，不改任何 spec 行为。
- 不使用 `overrides`、`npm audit fix --force` 或批量升级。
- 不动 sidecar 依赖与其既有 `overrides`。
- 本轮不 commit / push，不宣称 GitHub 远端告警已关闭。
- 不宣称绝对零攻击面：开发工具链（lint 等）对模式串的消费仍有理论暴露，本 change 只消除在册漏洞。

## Decisions

- **优先用 `npm update brace-expansion`（root 目录）定向更新**：目标版本为 5.0.12，实际变动必须经差异审查确认，不能假定指定包名就不会连带刷新其他条目。不使用 `npm audit fix` 作为回退：其影响面更宽，只有一条告警也不意味着等价定向；若定向更新无法保持范围，停止并重新评估。禁止 `--force`。
- **不引入 overrides**：5.0.12 天然满足 `^5.0.8`，无钉版必要。overrides 是长期钉版工具（见 sidecar-dependency-hygiene 的哲学），不该用于一次性补丁升级。
- **不升级 minimatch / eslint**：会扩大变更面，违背最小修复；升级工具链留给独立 change。
- **`git diff` 作为第一道闸**：更新后先审查 `git diff -- package-lock.json package.json`，确认仅 brace-expansion 相关条目变化、`package.json` 零变化；出现任何额外变动即停止、还原、重新评估。

## Risks / Trade-offs

- [npm 解析顺带刷新其他锁条目] → `git diff` 逐条审查；有额外变动则还原并停下检查，不扩大范围。
- [5.0.12 行为差异影响 lint 等工具] → `npm run check` 全门禁回归，lint 是直接消费路径、重点看；不全绿不归档。
- [远端告警仍在引发误解] → 文档与验证记录明确：GitHub 复扫须待授权提交推送后另行确认，本轮不提交不推送、不宣称关闭。
- [sidecar 间接影响] → 理论为零（零依赖命中），仍以 sidecar `npm ls` / `npm audit` 复核为零回归。
