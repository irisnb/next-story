# 设计：extract-ai-request-orchestration

## Context

8a（`extract-ai-logic-seams`，已归档）拆走两块后，`src/ai-feature.ts` 现为 **921 行**（8a 归档记录的 891 为统计方法误差，归档本 change 时勘误审计文档）。2026-09-21 复察实数：

- `setupAiFeature`（L290–921）内待拆的编排聚类：coordinator 构造＋六回调（L465–528，每回调尾部固定四连 `waitTiming.complete → state 迁移 → persist → refreshOnDemand`）、scheduler 构造（L530–544）、`materialDispatchGuard`（L546–558）、`scheduleTracked`（L560–575）、三个 sender（L609–643）、stop/close（L719–734）、`retryFirstRound`（L736–762）——合计 **~223 行**；另有材料组装 `withFocusDocumentIdentity`（L577–607，31 行）与**内联在 `buildAiDockActions` 里的 `onRetryStoppedFollowUp`（L242–254，D7 清单漏列）**。
- 8a 之后 setup 闭包内的核心可变共享绑定收敛为 **8 个**：`state` / `projectToken` / `destroyed` / `transport` / `scheduler` / `coordinator` / `selectionEntry` / `aiDock`；其余为只读依赖与访问器。
- 三个 sender 完全同构：`(enrich?) → scheduleTracked → coordinator.Xxx → busy/queued 状态回写`；差异仅三处：是否注入材料、kind 标签来源、coordinator 方法名。成功/失败/停止处理不在 sender，集中在 coordinator 六回调与 stop/close/retry——这是「网关」与「生命周期」的天然分界。
- 测试现状：协调器 17 测、调度器 11 测、reducer 排队族（8a D4 所还）三层单元网都很厚；**缺组合级胶水覆盖**——`maxConcurrent` 注入缝全仓库零测试、快车道并发无任何层级组合测试、`materialDispatchGuard` 无直测、`waitTiming` 接线无覆盖、`onRetryStoppedFollowUp` 无基线。
- 8a 制造的接线顺序约束：`setupDeleteUndo`（L411）在 `scheduler`（L531）构造之前接线，靠惰性回调 `(id) => scheduler.cancelQueued(id)` 逃过 TDZ。

## Goals / Non-Goals

**Goals:**
- 零行为变化；既有测试零语义修改通过（仅 import 路径调整）。
- 组合级编排安全网先还账（最小集，经注入缝）。
- 材料组装、请求网关、请求生命周期三块逻辑迁入聚焦模块；`AiFeatureContext` 把 8 个核心绑定显式化。
- 两条新边界要求并入 `ai-module-boundaries` 规格。

**Non-Goals:**
- 不动事件订阅与崩溃恢复块（L773–828）、dock 接线（L830–860）、reset/destroy（L862–891）——组合根保留装配＋订阅＋恢复＋销毁；如需再瘦另立 change。
- 不改 `AiFeatureWiring` / `AiDockActions` 契约签名。
- 不改行为、协议、Tauri 命令面、后端、依赖。

## Decisions

### D1：刀序（对 D7 草案的三处修正之一）
①组合级还账测试先行（对现状行为织网，全程保持绿）→ ②材料组装热身刀（唯一不写共享绑定的函数，有 `ai-focus-document.test.ts` 5 个直测，最低风险复验 8a 模式）→ ③`AiFeatureContext` 访问器化（纯准备）→ ④请求网关 → ⑤请求生命周期（吸收 `onRetryStoppedFollowUp`）。每步全量套件绿后才进下一步。

### D2：`AiFeatureContext` 为访问器式（需用户确认）
字段为 getter / 访问器函数，**禁快照**。理由：a) 8a 的接线顺序约束（delete-undo 先于 scheduler 接线）下，急切普通对象会在构造期踩空；b) D6 红线——`hiddenDocumentIds()` 等访问器的求值时机是行为。**备选否决**：急切普通对象（构造期 TDZ 风险＋快照化倾向）；类实例（更重，无收益）。模块统一**后置装配**：context 在 scheduler/coordinator 构造之后成形，迁移期保持既有惰性回调。
> **实施修正（组 4）**：scheduler/coordinator 构造迁入网关后，context 装配点前移至绑定声明之后、网关装配之前；`getScheduler` / `getCoordinator` 改为经网关惰性读取，构造期一律不求值——D2 的实质（禁快照＋惰性）不变，模块注释已同步此措辞。

### D3：网关参数化＝三根轴
`enrich`（材料注入开关：structured / direct 开，summon 关——快车道不取材）、kind 来源（`focused.kind` vs 字面量 `"summon"`）、coordinator 方法选择器（`requestStructured` / `requestFor` / `requestDirectQuestionFor`）。busy/queued 回写同构保留。**coordinator 六回调随网关迁移**（它们是请求终态的编排规则），每个回调尾部的固定四连逐条对照迁移，不得漏 `persist` 与 `refreshOnDemand`。

### D4：生命周期模块
`stopGeneration` 与 `closeWindow` 同构（前四步相同），尾钩参数化：stop 多 `persistDiscussion`、close 多 `state.closeWindow`。`retryFirstRound` 双分支（direct_question / summon）保持。`onRetryStoppedFollowUp` 从 `buildAiDockActions` 迁入；controller 与 dock 两条进入路径都改指向新模块函数，wiring 签名不动。

### D5：还账最小集（组合级，经 `maxConcurrent` / `transport` / `loadConfig` 注入缝；需用户圈定）
①快车道并发：常规生成中召唤独立发起（规格明文场景，全仓库无组合测试）；②达上限排队＋窗口排队显示（`maxConcurrent` 缝零测试）；③停止排队中请求（含 waitTiming 与 persist 的外部可见效果）；④`materialDispatchGuard` 来源选择（带 anchor 用 anchor、无 anchor 回落 focusDocumentId）；⑤`waitTiming` 四点接线（submit/queued/started/complete，经 ai-timing 收集器断言）；⑥`onRetryStoppedFollowUp` 组合基线（迁移前置）。断言纪律：只断言外部可见效果（transport 收到的调用序列、state 迁移、timing 收集、persist 调用），不引用实现内部——防同义反复。

### D6：红线重申
`hiddenDocumentIds()` 等访问器保持「每次调用时求值」；context 字段一律访问器；新模块不引 DOM。

## Risks / Trade-offs

- [接线顺序 TDZ / 构造期踩空] → D2 访问器式＋后置装配；迁移期保持惰性回调；每步全量绿。
- [六回调迁移漏尾四连] → D3 逐条对照；persist 时机在还账测试③⑥中有外部可见断言。
- [组合测试写成同义反复] → D5 断言纪律：只经注入缝观察外部效果。
- [wiring 胶水面] → 20 回调签名不动，只改实现来源；`buildAiDockActions` 吸收迁移后仍保持外部形状。
- [行数折扣] → 按 8a 实测 ~40% 胶水回填，如实预估 921 → ~740–780，不追行数指标。
- [`ai-feature.ts` 拆后仍不算小] → 如实接受：订阅/恢复/dock/销毁留守组合根是本 change 的边界，不是失败。

## Migration Plan

纯重构，无数据迁移；回滚＝按步 git revert（每刀一交）。收尾跑全量离线矩阵（Rust 无改动，跑一次确认不受影响）。

## Open Questions（需用户拍板）

1. **`AiFeatureContext` 形状**：访问器式（推荐，理由见 D2）vs 急切普通对象。
2. **还账测试层级**：组合级最小集 6 场景（推荐——快车道并发、排队显示、停止排队只有这层能真护住）vs 仅补单元级直测（便宜但护不住组合行为）。
