# 任务：extract-ai-request-orchestration

## 1. 组合级还账测试（先行，对现状行为织网）

- [x] 1.1 新建 `tests/ai-feature-orchestration.test.ts`：经 `maxConcurrent` / `transport` / `loadConfig` 三个既有注入缝驱动 `setupAiFeature`，先落「快车道并发——常规生成中召唤独立发起」场景（规格明文、全仓库无组合测试）
- [x] 1.2 「达上限排队＋窗口排队显示」：`maxConcurrent` 缝注入小上限，断言排队状态只在对应讨论呈现
- [x] 1.3 「停止排队中请求」：断言 stop 的外部可见效果（transport 调用序列、state 迁移、waitTiming、persist）
- [x] 1.4 `materialDispatchGuard` 来源选择：带 anchor 用 anchor、无 anchor 回落 focusDocumentId
- [x] 1.5 `waitTiming` 四点接线：submit / queued / started / complete，经 ai-timing 收集器断言
- [x] 1.6 `onRetryStoppedFollowUp` 组合基线（迁移前置保护）
- [x] 1.7 前端全量测试全绿（断言纪律：只断言外部可见效果，不引用实现内部）

## 2. 热身刀：材料组装独立

- [x] 2.1 新建 `src/ai-feature-request-materials.ts`：`withFocusDocumentIdentity` 迁移，显式依赖参数，不引 DOM
- [x] 2.2 `setupAiFeature` 改为装配调用；`ai-focus-document.test.ts`（5 直测）与全量套件通过（零语义修改）

## 3. `AiFeatureContext` 访问器化（纯准备，零行为）

- [x] 3.1 新建 `src/ai-feature-context.ts`：8 个核心绑定（state / projectToken / destroyed / transport / scheduler / coordinator / selectionEntry / aiDock）＋只读依赖＋访问器，字段一律 getter / 访问器函数（禁快照）；后置装配（在 scheduler / coordinator 构造之后成形），迁移期保持既有惰性回调
- [x] 3.2 `setupAiFeature` 内部消费统一改经 context；前端全量套件通过
- [x] 3.3 专项复核：`hiddenDocumentIds()` 等访问器保持「每次调用时求值」，context 无任何快照化

## 4. 请求网关

- [x] 4.1 新建 `src/ai-feature-request-gateway.ts`：三个 sender 按三轴（enrich 材料开关 / kind 来源 / coordinator 方法选择器）参数化合并，吸收 `scheduleTracked` 与 `materialDispatchGuard`
- [x] 4.2 coordinator 六回调随网关迁移：每个回调尾部固定四连（`waitTiming.complete → state 迁移 → persist → refreshOnDemand`）逐条对照，不得遗漏
- [x] 4.3 `AiFeatureWiring` / `AiDockActions` 契约签名不动；组 1 六场景与全量套件通过

## 5. 请求生命周期

- [x] 5.1 新建 `src/ai-feature-request-lifecycle.ts`：`stopGeneration` / `closeWindow`（尾钩参数化：persist vs closeWindow）/ `retryFirstRound`（双分支保持）
- [x] 5.2 吸收内联在 `buildAiDockActions` 的 `onRetryStoppedFollowUp`；controller 与 dock 两条进入路径都指向新模块函数；wiring 签名不动
- [x] 5.3 前端全量套件通过（零语义修改）

## 6. 边界测试与收尾

- [x] 6.1 按 `ai-module-boundaries` 新增两条要求扩展静态边界测试：请求派发组合仅出现在网关模块、组合根无编排规则实现体（按符号锁定）
- [x] 6.2 全量终验矩阵：前端全量 / 驱动 / 离线验证 / 可靠性 / typecheck / ESLint / 生产构建；Rust 无改动，跑一次确认不受影响
- [x] 6.3 行数与结构快照（预计 `ai-feature.ts` 921 → ~740–780），归档时回记审计文档 8a-2 行，并勘误补充十的 8a 行数（891→921，统计方法误差）
