## Why

GitHub 依赖告警 #19（GHSA-q2hr-2g5m-vwhr）指向根目录开发依赖 `brace-expansion` 5.0.9。root `npm audit` 判定 `4.0.0 – 5.0.11` 区间为 high 级漏洞，同一区间共挂三条 GHSA（q2hr-2g5m-vwhr 二次方时间展开 CPU 拒绝服务；qhr7-859c-m2p7、6j4f-fj2g-mc7p 嵌套递归栈耗尽），当前报 1 条 high。官方补丁版 5.0.12 已发布（2026-09-14，registry 确认为当前 latest），且落在上游声明范围 `^5.0.8` 之内，可以最小代价消除整条告警。

## What Changes

- 根目录 `package-lock.json` 中 `node_modules/brace-expansion` 由 5.0.9 定向更新到 5.0.12（`npm update brace-expansion`；仅锁文件条目变化，`package.json` 不动）。
- 不引入 `overrides`，不执行批量 `npm audit fix`，不升级 eslint / minimatch 等其他依赖；若实际操作引发任何额外包变动，停止并检查，不扩大范围。
- 不改产品功能、不改任何规格行为、不动 sidecar 依赖（sidecar 无此依赖）。
- 补充验证证据：锁一致性、root 与 sidecar 的 `npm ls`、`npm audit` 告警消除（与 GHSA 官方修复版本对照）、`npm run check` 全门禁。
- 远端告警关闭不在本轮宣称：本轮不提交不推送；须另经授权 commit / push 且 GitHub 复扫后才能确认。

## Capabilities

### New Capabilities

- `root-dev-dependency-hygiene`: 根目录开发依赖（不随产品分发的工具链依赖）在册安全警报的修复纪律——有范围内修复版时定向最小更新锁文件、不引入 overrides、不批量 audit fix、以全门禁与审计对照为完成判据、远端告警状态如实报告。本 change 是该纪律的首次落地实例。

### Modified Capabilities

（无——不改变任何既有规格的 Requirements。`sidecar-dependency-hygiene` 只约束 sidecar 运行时依赖，`ci-pipeline` 只约束 Dependabot 巡逻与 CI 门禁集合，均不覆盖 root 开发依赖的修复流程，故不改动。）

## Impact

- **依赖与暴露面**：`brace-expansion` 在 root lock 中为 dev 依赖（`dev: true`），经 eslint 10.8.1 →（@eslint/config-array、@typescript-eslint/typescript-estree 等）→ minimatch 10.2.6（声明 `brace-expansion: ^5.0.8`）传递引入。lint 的 glob / 模式匹配是其直接消费路径，属开发工具链理论暴露面；据实不宣称绝对零攻击面。
- **不随产品分发**：sidecar 目录 grep 零命中；`src-tauri/tauri.conf.json` 的 `resources` 仅打包 `../sidecar/node_modules/`，root `node_modules` 不进安装包，终端用户安装包不含该包。
- **文件**：预期仅根目录 `package-lock.json` 变化。`package.json`、`sidecar/`、产品代码（前端 / Rust）均不动。
- **告警性质**：#19 是 dependabot 告警条目，不是可合并的 PR；本 change 是本地锁文件定向更新加验证证据，不声称「合并修复 PR」，也不声称修复已最终完成。
