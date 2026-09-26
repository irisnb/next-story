## 1. 传输层：启动/重放窗口失效（F04）

- [x] 1.1 `ResidentAiSessionTransport` 新增启动中尝试记录（`startingAttempts`：conversationId → 失效标记）；`ensureSessionStarted` 登记尝试，`await startSession` 完成后检查失效——已失效则立即 `endSession(sessionId)`、清理尝试并抛结构化取消错误，未失效才注册会话映射
- [x] 1.2 `cancelMessage`：无在途流式目标但存在启动中尝试时标记失效（停止语义）；`endSession` / `endAllSessions`：标记对应/全部启动中尝试失效（离开、切换、销毁语义）
- [x] 1.3 `replaySession` 纳入同一尝试机制：`startSession` / `replayHistory` / `replayDone` 每个 await 之后检查失效，失效即结束会话并抛错，绝不注册会话
- [x] 1.4 转正 F04 审计复现为 `tests/ai-session-transport.test.ts` 正式用例：延迟启动 → 停止 → 放行后 `sendMessage` 调用为 0 且迟到启动产生 `endSession`；`endAllSessions`（切换/销毁）版本；`replaySession` 版本；失效后不覆盖「已停止」终态（协调器取消戳语义保持）

## 2. 退出前保存排空（F07）

- [x] 2.1 `ai-feature.ts` 追踪在途讨论保存：`pendingSaves` 集合登记 `persistDiscussion` 的保存 Promise、落定即移除；新增 `drainPendingSaves(): Promise<void>`（等待全部落定，任一失败以首个错误拒绝）并加入对外接口
- [x] 2.2 `main.ts` 关闭接线：销毁器新增 `drainSaves` 首阶段（`drainSaves → destroyAi → destroyEditor → destroyWindow`）；排空失败时不进入任何销毁阶段
- [x] 2.3 编排测试（`tests/ai-feature-persistence.test.ts` 或 leave 流程测试）：有在途保存时关闭等待全部落定；保存失败 → 保留窗口、无销毁、错误可见；重试后成功完成

## 3. 关闭失败可重试（F09）

- [x] 3.1 `close-guard.ts` 的 `createApplicationDestroyer` 改为分阶段记忆化：记录已完成阶段；进行中的关闭共享同一 Promise；settle 后清空缓存；重试只执行未完成阶段，已完成阶段不重复
- [x] 3.2 `tests/leave-safety.test.ts`：转正 F09 复现（首次 window 阶段失败 → 第二次仅重试 window 并成功关闭）；已完成阶段不重复的有害副作用断言；既有「成功销毁仅一次」「失败保留窗口」用例保持通过
- [x] 3.3 失败后界面状态与错误可见性复核（`main.ts` reportError 路径）：注释如实写明「窗口保留、已完成阶段保持完成、重试仅完成剩余阶段」

## 4. 验证与收尾

- [x] 4.1 门禁全绿：`npm run check`、`npm run test:validation`（含新增前端测试）
- [x] 4.2 `verification/validation.md`：记录 F04/F07/F09 转正测试证据、门禁结果与如实边界（应用级真机场景是否执行；真实模型链路不在范围）
- [ ] 4.3 归档前核对：规格 delta 完整（MODIFIED 全文、场景 4 级标题格式）；更新《开发前全面工程复核-2026-09-23.md》第 10 节 Change 4 行为 ✅（附归档 change 名与日期）；确认 Change 5 边界未被本 change 提前覆盖
