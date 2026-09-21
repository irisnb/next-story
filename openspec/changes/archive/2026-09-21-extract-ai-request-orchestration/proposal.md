# 提案：extract-ai-request-orchestration（审计队列 8a-2·请求编排中心拆分）

## Why

`setupAiFeature`（`src/ai-feature.ts`，现 921 行）里还剩最后一块功能逻辑聚集地：请求编排中心聚类（~223 行：coordinator 六回调、scheduler 构造、materialDispatchGuard、scheduleTracked、三个 sender、stop/close/retry 家族），外加材料组装 31 行与内联在 `buildAiDockActions` 里的 `onRetryStoppedFollowUp`。8a（`extract-ai-logic-seams`，已归档）验证了「显式依赖参数」提取模式成本可控；本 change 按 8a 归档 design D7 立据的刀法草案，趁测试网新鲜把中心拆掉。刀法依据 2026-09-21 复察实数（见 design）对 D7 做了三处修正：材料组装提前当热身刀、context 改访问器式、还账范围扩大。

## What Changes

- **编排直测还账（组合级，先行）**：三层单元测试（协调器 17 / 调度器 11 / reducer 排队族）都很厚，缺的是中间胶水的组合级覆盖。经 `maxConcurrent` / `transport` / `loadConfig` 三个既有注入缝为 `setupAiFeature` 补最小集组合测试：快车道并发（常规生成中召唤独立发起）、达上限排队与窗口排队显示、停止排队中请求、`materialDispatchGuard` 的 anchor 回落语义、`waitTiming` 四点接线。
- **第一刀（热身）：材料组装独立**——`withFocusDocumentIdentity`（L577–607，编排聚类中唯一不写共享可变绑定的函数）→ 聚焦模块，复验 8a 模式。
- **`AiFeatureContext` 访问器化**：把现存的 8 个核心共享可变绑定（state / projectToken / destroyed / transport / scheduler / coordinator / selectionEntry / aiDock）收拢为访问器式上下文对象（字段为 getter/访问器函数，禁快照）——纯准备，零行为变化。
- **请求网关**：三个同构 sender（首轮/追问/直接提问）按三根轴（材料注入开关 / kind 标签来源 / coordinator 方法）参数化合并，吸收 `scheduleTracked` 与 `materialDispatchGuard`。
- **请求生命周期**：`stopGeneration` / `closeWindow`（尾钩参数化：persist vs closeWindow）/ `retryFirstRound` 收进模块，并吸收内联在 `buildAiDockActions` 的 `onRetryStoppedFollowUp`。
- **明确不做**：事件订阅与崩溃恢复块（56 行）、dock 接线（31 行）、reset/destroy 留在组合根——「事件订阅/恢复」如需再瘦另立 change；不改任何行为、协议、Tauri 命令面；`AiFeatureWiring` / `AiDockActions` 契约签名不动。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `ai-module-boundaries`：新增两条持续要求——①请求派发经统一网关（生产代码不得在网关外编排 scheduler 准入与 coordinator 调用组合）；②组合根装配边界（`setupAiFeature` 限于依赖创建、模块装配与事件接线，派发/生命周期/材料规则住在聚焦模块）。既有四条要求不变。

## Impact

- **代码**：`src/ai-feature.ts`（921 → 预计 ~740–780，按 8a 实测 ~40% 胶水回填折扣如实预估）；新增 `ai-feature-request-materials.ts`、`ai-feature-context.ts`、`ai-feature-request-gateway.ts`、`ai-feature-request-lifecycle.ts`（最终命名以 design 为准）。
- **测试**：新增组合级编排测试（最小集 5 场景）；既有全部测试零语义修改通过（仅允许 import 路径调整）。
- **无后端改动、无依赖变化、无存储/协议变化。**
- **验证**：全量离线矩阵 + typecheck + ESLint + 生产构建；`cargo check --all-targets` 不涉（无 Rust 改动）。
- **勘误**：归档时修正审计文档补充十的 8a 行数记录（891→921，统计方法误差）。
