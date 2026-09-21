# 提案：extract-ai-logic-seams（审计队列 8a·巨石拆缝）

## Why

前端 AI 逻辑层的两份文件是全项目仅有的持续膨胀热点：`ai-feature.ts` 从审计基线 589 行涨至 **1026 行**，`ai-panel-reducer.ts` 从 773 行涨至 **1252 行**（修复队列 4/5/6/7 的每一轮都往这两份文件加码）。事项 9（UI 全量更新）与事项 10（编辑器体验整顿）的大改造将直接压在编排层与唯一状态源上；在继续膨胀的地基上开发，改动面会越来越难审。当前离线测试网最厚（前端 813 / Rust 单元 261＋集成 80）、行为冻结点最新（阶段 6 今日刚归档），是零行为拆缝的最低危窗口。本 change 对应 `方向/全量地基审计-2026-09-14.md` 队列 8a（P2-2 ＋捎带 P2-12）。

## What Changes

- **`ai-feature.ts` 两刀提取**（闭包变量显式化为依赖参数，新模块不引 DOM，遵循 editor-module-boundaries 既有惯例）：
  - 按需补读授权交互块（约 L410–471）＋配套类型 → `ai-feature-on-demand-reading.ts`；
  - 删除＋撤销机制（`pendingUndo` 计时器家族约 L473–532 ＋ 纯函数 `summaryToRecord`）→ 独立模块。
  - `AiFeatureWiring` / `AiDockActions` 对外契约签名**不变**，只改实现来源。
- **`ai-panel-reducer.ts` 类型层拆分**：`AiPanelEvent` 联合类型与 `PendingReadingRequest` / `ReadingProgress` 抽到独立事件类型模块并由原文件 re-export；reducer switch 本体**不动**（在补齐直测前不物理拆 switch）。
- **安全网欠账先行**：为 reducer 新建直接测试文件（45 个 case 的迁移语义，含拒绝路径返回同一引用的契约）——这是后续任何 reducer 拆分的前置，本 change 还账。
- **P2-12 捎带**：`ProjectLocks` 由 `Box::leak` 永不回收改为 `Weak` 可回收；guard 自持问题拟用 `parking_lot::lock_arc`（已在依赖树内），见 design 决策。
- **明确不做**（防止范围蔓延）：
  - 不动 `ai-dock.ts`（纯渲染布线，无业务规则，命运与事项 9 相绑，届时一并重排）；
  - 不动 `operations.rs`（未膨胀；恢复与提交共享同一套清单/前滚机制，强行拆会制造假边界）；
  - 不拆 `setupAiFeature` 内请求编排中心聚类（与 coordinator/scheduler/transport 交叉最深的 ~225 行，待新模块模式被本 change 验证后再议）；
  - 不改任何用户可见行为、协议、Tauri 命令面、AI 请求语义、存储格式。

## Capabilities

### New Capabilities
- `ai-module-boundaries`：AI 面板与编排前端模块的结构边界规则——reducer 迁移逻辑仅经 `AiPanelState` 外观消费、编排聚焦模块不引 DOM 只收显式依赖、dock 与 feature 单向通信（feature → dock，仅经 `AiDockActions` 动作对象）、面板事件类型单一事实源。参照 `editor-module-boundaries` 先例，把本次拆分确立的边界固化为可校验要求。

### Modified Capabilities
<!-- 无：本 change 为零行为重构，所有既有规格的 Requirement 均不变化；锁回收亦无规格可见行为差异（同路径互斥语义由既有并发测试锁定不变）。 -->

## Impact

- **代码**：`src/ai-feature.ts`、`src/ai-panel-reducer.ts`；新增 `src/ai-feature-on-demand-reading.ts`、删除撤销模块、事件类型模块（最终命名以 design 为准）；`src-tauri/src/project/mod.rs`（ProjectLocks）。
- **测试**：新增 reducer 直测与新模块聚焦测试；**既有全部测试（前端 813 / Rust 单元 261＋集成 80 / 驱动 12 / 离线验证 76 / 可靠性 89）必须零语义修改通过**——仅允许调整 import 路径，这是「零行为变化」的验收判据。
- **依赖**：`parking_lot` 由传递依赖提为直接依赖（Cargo.lock 已在册，不引入新的外部代码与体积）——此项连同锁方案备选见 design 决策，需用户确认。
- **验证**：typecheck、ESLint、生产构建、全量离线套件；`cargo check --all-targets` 收尾（吸取 2026-09-21 教训：`cargo test` 不显示编译警告）。
