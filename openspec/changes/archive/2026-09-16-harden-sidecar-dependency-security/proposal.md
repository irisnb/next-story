# 提案：sidecar 传递依赖安全整备

## Why

2026-09-15 开启仓库 Dependabot 安全警报后，sidecar 的 DSH SDK 传递依赖暴露 **11 条在册安全警报（6 high / 5 medium）**，涉及 fast-uri（4 条 high）、js-yaml（1 条 high）、sharp（1 条 high）、hono（3 条 medium）、qs（2 条 medium）共 5 个包。实际可利用性评估为中低（sidecar 是本地无监听端口的 headless 进程，流量仅限用户自己的配置/内容与已鉴权的 LLM API 响应，上述漏洞路径均需外部触达面），但阶段 6 将在这条链路上动工，带着已知漏洞版本开工属于地基未清。实测 5 个包**全部存在修复版**，整备体量小、收益高。

同时，用户明确提出约束：整备**不得妨碍未来 DSH SDK 的版本升级**。钉版必须用「范围」而非死版本，且 DSH 升级路径需要被正式文档化，落在纸面上。

对应审计队列第 3c 项（`方向/全量地基审计-2026-09-14.md` 第八节）。

## What Changes

- 在 `sidecar/package.json` 增加 `overrides` 字段，把 5 个有警报的传递依赖钉到**修复版范围**（fast-uri ≥3.1.6、js-yaml ≥4.3.2、sharp ≥0.35.4、hono ≥4.13.5、qs ≥6.16.0），重新生成 `sidecar/package-lock.json`，使 `npm audit` 归零。
- 钉版一律使用语义化范围（如 `^4.3.2`），**不钉死单个版本号**：DSH 未来升级自带修复版分包商时条款自动满足，届时可平滑移除多余 overrides。
- 全量离线回归（驱动队列 `test:driver`、可靠性 `test:reliability`、离线协议验证 `test:validation`）+ 真实链路验证（智谱 `glm-5.3-flash` smoke），确认换包未破坏 AI 生成功能。
- 新增 DSH 升级路径文档 `sidecar/UPGRADING.md`：把「改版本号一行 → 重装依赖 → 全量回归 → `npm audit` 复查 → 清理或保留 overrides」写成正式流程，明确 overrides 与 DSH 本身版本正交、升级不受锁。
- 无修复版可钉的包须记录已接受风险与理由（当前实测 5/5 均有修复版，此步骤预期为空集确认，但规则要立住，防未来新警报无章可循）。

### 不做什么（Non-Goals）

- **不改 DSH SDK 本身版本**（`0.1.0-rc.7` 保持不变），本 change 只整备它带进来的分包商。
- **不处理 `@tiptap/core` 警报**（第 12 条，GHSA-cp6q-959q-f8rh）：需编辑器内核 2→3 大版本迁移，已排入队列 5b，不在本 change 范围。
- 不在 CI 加 `npm audit` 硬门禁（避免外部新警报随机打红 CI；监测职责已由 Dependabot 告警承担）。
- 不改 driver 代码、Rust 代码、前端代码。

## Capabilities

### New Capabilities

- `sidecar-dependency-hygiene`：sidecar 运行时传递依赖的已知漏洞整备规则——有修复版的必须钉修复版范围；无修复版的必须记录已接受风险与理由；DSH SDK 版本升级须遵循文档化路径并保持上述不变量。

### Modified Capabilities

（无——CI 流程、`dsh-sidecar-lifecycle`、`dsh-headless-generation` 等现有规格的行为均不变；CI 的 `npm ci` 按锁文件安装，自动获得新内容。）

## Impact

- **文件**：`sidecar/package.json`（新增 `overrides`）、`sidecar/package-lock.json`（重新生成）、新增 `sidecar/UPGRADING.md`。
- **CI**：`.github/workflows/ci.yml` 无需改动（`npm ci` 按锁文件安装，双平台现有步骤自动覆盖）。
- **验证**：`npm run test:driver`、`npm run test:reliability`、`npm run test:validation`、`sidecar` 目录内 `npm audit` 归零断言、真实链路 smoke（需已配置的智谱密钥）。
- **风险**：低。若某包钉版后与 DSH 运行时行为冲突（如 sharp 原生二进制变化导致加载失败），以回归测试当场暴露，回退方式是删除对应 override 行并记录接受理由。
