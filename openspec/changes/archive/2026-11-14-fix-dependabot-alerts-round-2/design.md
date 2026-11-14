# Design：清偿 Dependabot 第二轮安全警报

## Context

2026-11-14 GitHub 开放警报 11 个，全部经 API 与本地锁文件逐一对账（manifest、范围、首修版本），并对照三份既有依赖卫生规格（sidecar／root-dev／rust，2026-11-12 前建立）核实合规路径：

| 包 | 警报数 | 清单 | 现解析 | 首修 | 引入路径 | 处置 |
|---|---|---|---|---|---|---|
| hono | 5 | sidecar 锁 | 4.13.13 | 4.13.16 | dsh 传递（覆盖钉 ^4.13.5） | ✅ 升覆盖 |
| @hono/node-server | 2 | sidecar 锁 | 2.1.5 | 2.1.6 | dsh 传递（无覆盖） | ✅ 新增覆盖 |
| minimatch | 1 | 根锁（dev） | 10.2.6 | 11.0.1 | eslint 10.8.1／@eslint/config-array 0.23.5／@typescript-eslint/typescript-estree 8.67.0 三方锁 `^10` | 📌 挂账＋补规格分支 |
| zip | 3 | Cargo.lock | 4.6.1 | ≥9.0.5 | 仅 tauri-plugin-updater 2.11.0（要求 zip ^4） | 📌 挂账＋补规格分支 |

关键查证（2026-11-14，flaky 网络下多次重试所得）：

- `cargo update -p tauri-plugin-updater --dry-run`：`~2.11.0` 线内 0 可更新；crates.io 该插件最高稳定即 2.11.x，之上只有 **3.0.0-alpha.3** 预发布。
- `npm view`：eslint 最新 10.15.0 已要求 minimatch `^11.0.5`、@eslint/config-array 0.23.6 同；**typescript-estree 最新 8.72.2 仍要求 `^10.2.2`**——即便升 eslint，锁文件仍必残留 minimatch 10.2.6，警报不消。
- docx-rs crates.io 官方最高仍 0.4.22 → 2026-11-12 定下的切回条件未满足，git 钉 rev ad7fede6a7 继续有效（其 zip 已在 9.x，与本轮无关）。
- 更新插件源码实证（tauri-plugin-updater-2.11.0 `src/updater.rs`）：`:740` `verify_signature` 先于 `:841` `extract`；`:1080` 注释「we extract our **signed** archive」——zip 4.6.1 的输入只可能是先通过 minisign 验签的自家更新包。

## Goals / Non-Goals

**Goals:** sidecar 7 警报清偿（audit 归零）；zip×3、minimatch×1 有据挂账（规格分支＋账本＋复评条件）；发布前实弹验证 sidecar 通信。

**Non-Goals:** 不升 DSH／tauri／插件栈、不动 Rust 依赖树；不 `[patch]` 强改、不上 alpha；不用 overrides 动根树（root 规格明文禁止）；不升 eslint（对消警无益，纯漂移）。

## Decisions

### D1 sidecar 钉版（完全沿既有纪律，零新决策）

`sidecar/package.json`：hono 覆盖改 `^4.13.16`、新增 `"@hono/node-server": "^2.1.6"`（范围式，非死版本）；`npm install --prefix sidecar` 只再解析被改子树。验收：`sidecar/ npm audit` 0 漏洞；`@deepseek-ai/dsh` 仍 0.1.2-rc.1；锁 diff 无无关漂移；双树 `npm ci` 通过。

### D2 root minimatch：挂账＋`root-dev-dependency-hygiene` 新增要求

事实链：首修 11.0.1 跨大版本；三条消费链全部 `^10`；唯一可升的 eslint 链升完仍剩 typescript-estree 链锁 10.2.6。既有两要求（范围内锁文件定向更新／跨大版本显式提升 package.json）都只覆盖**直接依赖**，本情形（纯传递、上游未跟进）无路径可走——按 sidecar 规格既有先例补「无路径时挂账」分支：新增要求规定登记要素（包、警报、证据、暴露面、复评条件）、禁止 overrides 绕行、上游跟进后随显式升级收敛。minimatch 挂账：dev 作用域、不随产品分发、仅在开发者本机与 CI 运行，实际暴露面极低；复评触发＝typescript-eslint 发布要求 minimatch ^11 的版本（届时升 eslint 链即全树收敛，`^` 范围自然满足）。

### D3 rust zip×3：挂账＋`rust-dependency-security-hygiene` 修复路径补第三分支

既有修复路径两分支（范围内定向更新／上游锁死时钉含修复的 git 提交并提下限统一）在本情形穷尽：无范围内修复版（zip<9 全系有 CVE）、无含 zip 9 的 2.x 兼容主线提交（上游稳定线止步 2.11.x，3.0 属预发布且面向下一代）。修订该要求补第三分支：路径穷尽时 SHALL 有据挂账（证据链＋暴露面评估＋复评触发），MUST NOT 强 `[patch]` 跨 major 编译赌博、MUST NOT 采用预发布、MUST NOT 静默容忍。zip 挂账暴露面评估：输入仅自家固定端点（HTTPS GitHub Releases）＋先验签后解压（源码行号证据），攻击者须先破 HTTPS／GitHub 再伪造离线保管的 minisign 私钥签名；复评触发＝插件稳定版要求 zip ≥9，或项目决定升 tauri 2.12 栈（AGENTS 既有约定：随升并重测）。

### D4 docx-rs 切回条件复核（零改动记录）

crates.io 仍 0.4.22，切回条件未满足；账本既有挂账保持，本轮不动。

### D5 验证口径

1. sidecar `npm audit` 归零；解析版本断言（hono ≥4.13.16、node-server ≥2.1.6、dsh 不变）。
2. 双树 `npm ci` 复验。
3. `npm run check` 总门禁全绿（Rust 无改动照跑证无连带）。
4. 真机 AI 冒烟（发布 v0.2.2 前置，用户参与）：hono/@hono/node-server 是宿主与 DSH sidecar 的本地通信框架，必须实弹过一条真实对话（提问→流式回复→追问一轮）；冒烟不过＝回退覆盖钉回旧版重估。
5. 推送后复扫 GitHub 警报实数（预期 11→4），据实记录，不提前宣称。

## Risks / Trade-offs

- [锁再生成无关漂移] → dsh 版本断言＋diff 人工核对。
- [hono 小版本回归] → 真机 AI 冒烟实弹把关。
- [挂账被误读为无视严重警报] → 规格分支＋账本写全证据链（先验签后解压、上游现状、复评触发），发布说明如实措辞。
- [上游突然出修复版] → 复评条件已定，届时按分支收敛即可，不构成本轮返工。

## Migration Plan

纯依赖版本＋文档／规格修复，无行为迁移；回滚＝还原 sidecar/package.json＋锁文件。
