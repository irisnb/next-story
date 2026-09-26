## Context

复核报告（`方向/开发前全面工程复核-2026-09-23.md`）F04/F07/F09 的三处缺陷在三次 change 归档后仍原样存在，本次修复：

- **F04**：`ResidentAiSessionTransport.ensureSessionStarted`（`src/ai-session-transport.ts:197-207`）在 `await startSession` 期间不注册任何状态；此时 `cancelMessage`（`:292`）找不到在途目标、`endSession`/`endAllSessions`（`:299-311`）找不到会话，均为 no-op。启动完成后照常 `sessions.set` 并发送。`replaySession`（`:317-338`）在启动与重放期间同病。调用链：停止/关窗经 `ai-feature-request-lifecycle.ts:78-81`（`detachRequest`），作品切换与销毁经 `resetProjectScopedAi`/`destroy`（`ai-feature.ts:813-842`）。
- **F07**：`persistDiscussion`（`ai-feature.ts:347-385`）以 `void saveConversation(...)` 发起保存、不追踪；`destroy()`（`:822`）返回 void；`main.ts:124-134` 的销毁器随即销毁编辑器与窗口，前端排队、尚未 invoke 的后续保存没有退出屏障。
- **F09**：`createApplicationDestroyer`（`close-guard.ts:22-35`）缓存 `pending`，失败后不清空——第一次关闭失败后，后续关闭拿到同一个已拒绝的 Promise，永远无法重试（复现：两次调用实际只尝试一次）。

已经具备、不再重复的机制：`AiRequestCoordinator.cancel` 的取消戳与 `releaseStaleRequestOwnership` 的释放代次会丢弃迟到结果（`ai-request.ts:79-84`、`:164-181`、`:197-219`）；`CloseCoordinator.pending` 已在 settle 后清空（`close-guard.ts:90-92`）——重试阻塞点在销毁器而非协调器；`leave-safety.test.ts` 已有销毁顺序、失败保留窗口、重复请求共享等基线测试。

约束：遵循 AGENTS.md（不新增写回路径；停止/关闭语义已有规格）；一次一个 change（本项为第 10 节排定第 4 次）；纯前端运行期改动，不落盘、不改档案格式。

## Goals / Non-Goals

**Goals:**

- 会话启动与重放窗口内的停止/离开/销毁可真正止损：不发请求、不留下复活会话、不覆盖「已停止」终态。
- 关闭窗口前等待在途讨论保存排空落盘；失败可见且不先销毁。
- 关闭失败（如窗口销毁临时失败）可重试：不重复已完成阶段，失败后定义清楚界面状态。
- F04/F09 审计复现转为仓库正式回归测试。

**Non-Goals:**

- 不改停止生成与「已停止」终态本身的既有语义与文案；不新增强制关闭/强制丢弃保存的通道。
- 不处理生成中途退出应用时未完成轮次的既有中断语义（已由 resident-ai-session 规定）。
- 不追踪非讨论保存的异步写入（标题/置顶/删除的窄更新不在排空范围；其本身有各自的错误路径）。
- 不处理 F10–F14（Change 5）；不涉及后端 Rust。

## Decisions

### D1：传输层用「尝试级失效令牌」，不提前注册会话

`ResidentAiSessionTransport` 新增 `startingAttempts: Map<conversationId, { invalidated: boolean }>`：

- `ensureSessionStarted`：进入时登记 attempt（已有会话直接复用，不登记）；`await startSession` 完成后检查——已失效 → `void endSession(sessionId)`、清理 attempt、抛结构化取消错误（不注册映射）；未失效 → 正常注册并清理 attempt。
- `cancelMessage`：无在途流式目标但存在启动中 attempt → 标记失效（停止语义）。
- `endSession` / `endAllSessions`：同时标记对应/全部启动中 attempt 失效（离开、切换、销毁语义）。
- `replaySession`：登记同一 attempt；`startSession`、`replayHistory`、`replayDone` 每个 await 之后检查失效——失效即结束会话并抛错，绝不 `sessions.set`。
- 迟到结果的归属：取消戳（停止/关窗）与释放代次（切换/销毁）已在协调器层丢弃迟到结果，传输层只需保证「不发 + 会话立即结束」，不新增终态契约。

被否决的替代：提前把生成的 sessionId 写入 `sessions` 映射再启动，让 `endSession` 能直接命中。它会对尚未启动完成的会话调用后端 `end_session`（行为依赖后端对未知会话的容忍），且启动失败时映射残留需要另一套清理；失效令牌语义更内聚。

### D2：关闭流程图新增「保存排空」阶段，失败不进入销毁

- `ai-feature` 追踪在途讨论保存：`persistDiscussion` 生成的保存 Promise 登记进 `pendingSaves` 集合，settle 时移除；新增 `drainPendingSaves(): Promise<void>`——等待集合排空，任一保存失败时以首个错误拒绝；成功清零。所有保存入口（接受即存、终态更新、停止终态、重试持久化）都经 `persistDiscussion`，天然覆盖。
- `createApplicationDestroyer` 增加可选首阶段 `drainSaves`，阶段顺序：**drainSaves → destroyAi → destroyEditor → destroyWindow**。排空失败 → 抛出 → `orchestrateCloseRequest` 保持窗口并 `reportError`（既有 alert 路径），**销毁阶段一律未开始**，满足「不可先销毁再问用户」。
- `main.ts` 接线：`drainSaves: () => ai?.drainPendingSaves() ?? Promise.resolve()`。
- 失败后的用户路径：窗口保留；讨论面板已有的「保存失败」状态继续可见；再次关闭会再次排空（重试）。本变更不提供「绕过排空强制关闭」的通道——与守卫语义一致，列为已知限制。

被否决的替代：把排空塞进 `guardLeave`。它把「后台保存失败」与「文档未保存确认」两种用户交互混在一起，且取消关闭会连带重试后台保存；独立阶段职责清晰。

### D3：销毁器分阶段记忆化，失败可重试且不重复已完成阶段

`createApplicationDestroyer` 改为：

- 内部阶段数组（drain / ai / editor / window），`completedStages` 记录已成功阶段；每个阶段成功后标记。
- 进行中的关闭请求共享同一 Promise（保持现语义，防重入）；settle 后清空 pending（成功或失败）。
- 失败：已完成阶段保持完成；再次调用只执行未完成阶段（重试窗口销毁即只重试 window 阶段）。
- 失败后的界面状态如实约定：窗口保留、错误可见；已完成销毁的阶段保持销毁（可能部分界面失效）——重试只完成剩余阶段，MUST NOT 重新执行已完成阶段。

被否决的替代：失败后清空 pending 并整体重跑。它会重复已经成功的阶段（重复销毁、重复会话结束），与「幂等销毁」不同——幂等只保证无有害副作用，重复执行仍无必要，且无法如实定义失败后的中间状态。

### D4：测试转正与基线更新

- F04 复现（延迟 `startSession` → cancel/endAll → 放行）转为 `tests/ai-session-transport.test.ts` 正式用例：停止后 `sendMessage` 调用次数为 0、迟到启动产生 `endSession` 调用、映射不注册。
- F09 复现（两次关闭仅尝试一次）转为 `tests/leave-safety.test.ts` 用例：第一次 window 阶段失败 → 第二次仅重试 window 且成功关闭；已完成阶段不重复。
- F07 新增编排用例：有在途保存时关闭 → 保存落定前不销毁、落定后按序销毁；保存失败 → 保留窗口、无销毁、错误可见；重试后成功。

## Risks / Trade-offs

- [保存失败让关闭被永久阻塞] → 失败提示可见、已落盘的最后一份档案可正常重开；不提供强制关闭是本轮明确取舍（Risks 如实记录，后续可按真实需求立项）。
- [停止与启动完成恰好同刻] → 启动完成后的注册与发送在同一同步段（await 之后无第二个 await），失效标记只有「先到」才能生效；用例覆盖两种顺序。
- [销毁后迟到启动] → 失效令牌 + `destroySessionEventRouting` 代次；用例覆盖。
- [部分销毁后重试的界面可用性] → 仅承诺「关闭可重试完成」，不承诺部分销毁后可继续正常写作；X 记录于本设计，避免过度承诺。
- [排空范围外的窄更新在途] → 标题/置顶/删除等不在排空集合；它们各自有用户可见的错误路径，退出时短暂在途的窗口极小且不属 F07 范畴（如实记录，不扩范围）。

## Migration Plan

- 无数据迁移、无档案格式变化；回滚即代码回退。
- 规格与实现同一 change 内完成；归档时同步 `resident-ai-session` 与 `project-reliability-boundaries` 并更新第 10 节状态行。

## Open Questions

- 无阻塞性未知项。验证方式按项目惯例：仓库门禁（`npm run check`、`npm run test:validation`）＋ F04/F07/F09 转正回归测试；不涉及真实模型链路与后端。
