# 设计：extract-ai-logic-seams

## Context

阶段 6 归档后（2026-09-21），前端 AI 逻辑层两文件为全项目仅有的持续膨胀热点：`ai-feature.ts` 1026 行（`setupAiFeature` 单闭包宇宙约 714 行，~20 个共享可变绑定交叉引用）、`ai-panel-reducer.ts` 1252 行（45 个 case 的单一巨型 switch 约 918 行）。两份侦察报告（2026-09-21，explorer×2）确认：

- 各职责聚类之间不是函数调用关系，而是**全部闭包引用同一组可变绑定**——真正的工作量在「闭包变量显式化」，不在搬函数；
- reducer **没有任何直接测试**（全仓库唯一消费者是 `ai-panel-state.ts` 外观，间接覆盖）；
- `ai-dock.ts`（1169 行）约 55% 是渲染 DOM、40% 手势布线，无业务规则，从 ai-feature 只拿 `AiDockActions` 一个动作对象，依赖方向已经干净；
- `operations.rs` 实际 2955 行（生产 ~1417 + 内联测试 52%），恢复与提交共享同一套清单/前滚机制，没有不拖家带口的真缝；
- `ProjectLocks`（`project/mod.rs:172-211`）`Box::leak` 每作品路径泄漏一个 `Mutex`；guard 是不透明类型，全后端 ~30 个调用点只写 `let _guard = locks.acquire(...)?`。

## Goals / Non-Goals

**Goals:**
- 零行为变化：既有全部测试套件**零语义修改**通过（仅允许 import 路径调整）。
- 从 `ai-feature.ts` 摘出隔离度最高的两块成独立模块，验证「显式依赖参数」的提取模式。
- `ai-panel-reducer.ts` 完成类型层拆分（事件联合 → 独立类型模块），并**先还清 reducer 直测欠账**。
- 后端完成 P2-12 锁回收，调用面零改动。
- 把确立的边界固化为 `ai-module-boundaries` 规格。

**Non-Goals:**
- 不拆 `ai-dock.ts`（留给事项 9 UI 全量更新一并重排）。
- 不动 `operations.rs`。
- 不拆 `setupAiFeature` 的请求编排中心聚类（~225 行，与 coordinator/scheduler/transport 交叉最深；待本 change 验证提取模式后另议）。
- 不改 reducer switch 本体（直测补齐后的物理拆分留给后续 change）。
- 不改任何用户可见行为、协议、Tauri 命令面、AI 请求语义、存储格式。

## Decisions

### D1：提取模式＝闭包变量显式化 + 显式依赖参数
新模块导出「接收显式依赖的函数」，参照既有先例 `ai-feature-first-round.ts` / `ai-feature-follow-up.ts`（显式传 state 访问器 + 依赖回调，不引 DOM）。**备选否决**：整体类化重写——diff 面大、把纯移动变成重新设计，违背「拆缝不拆骨」。

### D2：两刀的选取与命名
- 第一刀：按需补读授权交互（原 L410–471）→ `src/ai-feature-on-demand-reading.ts`。隔离度最高（只依赖 state 的四个方法 + 三个注入的后端调用），且有整套 `agent-on-demand-reading.test.ts` 专用安全网。
- 第二刀：删除＋撤销机制（`pendingUndo` 计时器家族 L473–532 ＋ 纯函数 `summaryToRecord` L119–140）→ `src/ai-feature-delete-undo.ts`。setup 作用域里唯一自带定时器状态的闭环；`summaryToRecord` 已有直测，搬走即带走。
- 每刀独立提交、独立跑全量套件；`AiFeatureWiring`（20 回调契约）与 `AiDockActions` 签名**不动**，只改实现来源，把 diff 面压到最小。

### D3：reducer 类型层拆分＝类型模块 + 原 re-export
新建 `src/ai-panel-events.ts` 收纳 `AiPanelEvent` 联合、`PendingReadingRequest`、`ReadingProgress`；`ai-panel-reducer.ts` re-export，唯一消费者 `ai-panel-state.ts` **零改动**。**备选否决**：让消费者直接改 import 新模块——多改一个文件没有收益。switch 本体不动：在直测覆盖每个 case 之前，物理拆分是中等风险，本 change 不碰。

### D4：reducer 直测欠账先行偿还
在任何提取动手前，新建 `tests/ai-panel-reducer.test.ts`：45 个 case 各至少一个直测断言，重点锁定「未知/非法迁移返回**同一引用**」契约（引用相等断言）。这是后续任何 reducer 拆分的前置安全网，也是本 change 对 `ai-module-boundaries` 规格的可验证支撑。

### D5：P2-12 锁方案＝parking_lot `lock_arc`（需用户确认）
guard 必须自持锁的所有权（std `MutexGuard` 借用 `Mutex`，与「条目可失效回收」冲突）。方案对比：

| 方案 | 判定 |
|---|---|
| **parking_lot `Mutex::lock_arc()`**（返回自持 Arc 的 `ArcMutexGuard`） | **推荐**：parking_lot 已在 Cargo.lock 依赖树内（tauri 生态传递引入），提为直接依赖**不引入任何新外部代码**；API 是为此场景设计的正解 |
| std guard + unsafe 生命周期延长 | 否决倾向：soundness 论证负担重，为卫生修复引入 unsafe 不值 |
| 保留 `Box::leak` 放弃 P2-12 | 备选：若用户不愿加直接依赖则降级为此项并记录 |

行为等价性：map 存 `Weak`，guard 自持 `Arc`——持有人在时 upgrade 必成功、互斥语义不变；全部 guard 释放后条目失效、下次 acquire 重建（无人持有时新旧 Mutex 无区别）。既有并发测试（`operations.rs` 同作品串行化 / 跨作品并行两组）直接锁定。`acquire` 公开签名不变，~30 个调用点零改动。

### D6：`hiddenDocumentIds()` 求值时机按行为保护
它在 recompute、派发前复核、恢复过滤、选区授权四处于**不同时刻求值**。新模块只接收访问器函数（每次调用现取），**禁止**在任何提取层做成快照——这是可见性红线的静默破口，列入实现 review checklist。

### D7：请求编排中心聚类的后续拆分（已立据，不在本 change）
中心聚类（约 L570–748＋824–867，~225 行：coordinator 回调、scheduler 对接、dispatchGuard、scheduleTracked、三个 sender、stop/close/retryFirst）是组合根的心脏，与前两刀性质不同——它就是编排本身。后续专项 change 的刀法草案：

1. **前置还账**：编排管道聚焦直测（排队/拒绝/忙/停止/迟到结果，对齐 `ai-request-scheduling` 与讨论隔离规格既有场景）；
2. **第一步**：引入 `AiFeatureContext`，把 ~20 个共享可变绑定收拢成显式传参的上下文对象（纯准备，零行为变化）；
3. **第二步**：三个 sender 合并为参数化「请求网关」派发管道（守卫 → 调度准入 → 发送 → 成功即存 → 补读刷新），stop/close/retry 收进「请求生命周期」模块；
4. **第三步**：材料组装（`withFocusDocumentIdentity`）独立成块；终态 `setupAiFeature` 缩回纯装配。

**时机规则（用户 2026-09-21 确认）**：本 change 顺利（模式成本低、测试全绿）→ 紧跟小 change 拆中心，趁测试网新鲜；本 change 中发现 context 化很痛 → 推迟到下一个真正改编排的功能立项前，且**必须把该待办回记 `方向/全量地基审计-2026-09-14.md`**（用户指令：这个任务不能忘掉）。无论走哪条路，归档本 change 时都须在审计文档 8a 行注明后续拆分状态。

## Risks / Trade-offs

- [闭包宇宙提取引入行为差异] → 每刀独立提交 + 全量套件立即跑；wiring 契约签名不动；diff 逐函数对照。
- [`destroy()` 清理顺序是隐式契约] → 两刀所选块中仅 `pendingUndo` 计时器涉及清理；提取后 `destroy()` 对计时器的清理由 design 逐条对照原顺序，不重排。
- [`hiddenDocumentIds` 意外快照化] → D6：只传访问器；review checklist 专项。
- [reducer 直测写成「翻译实现」的同义反复] → 断言只描述迁移前后状态与引用相等，不引用实现内部。
- [parking_lot 直接依赖被否决] → 降级为「放弃 P2-12」并回记审计文档，不退到 unsafe 方案。
- [拆完仍不够「瘦」] → 如实接受：本 change 只取干净缝（ai-feature 约减 145 行、reducer 约 230 行），中心聚类留给后续；不追行数指标。

## Migration Plan

纯重构，无数据迁移。回滚＝git revert 对应提交（每刀一交，P2-12 一交，测试一交）。收尾跑 `cargo check --all-targets`（教训：`cargo test` 不显示编译警告）。

## Open Questions

1. P2-12 采用 parking_lot 方案是否确认（唯一需要拍板的技术选择；否决则本项降级放弃）。
2. 新模块命名（`ai-feature-on-demand-reading.ts` / `ai-feature-delete-undo.ts` / `ai-panel-events.ts`）如有更好建议可在 apply 前改。
