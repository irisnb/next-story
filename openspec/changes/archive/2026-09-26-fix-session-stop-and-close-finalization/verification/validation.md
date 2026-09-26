# 停止、退出与关闭收尾·验证记录（离线不变量与门禁）

> 2026-09-26。本记录整理本次 change 的门禁结果与 F04/F07/F09 回归转正证据。
> 范围如实声明：**未执行桌面级真机关闭/退出场景**；本次验收依据为仓库正式测试（前端夹具）与全部门禁。本变更纯前端运行期生命周期，不经过模型协议、不涉及后端 Rust。

## 一、方法与范围

- **修复对象**：复核报告（`方向/开发前全面工程复核-2026-09-23.md`）F04（会话启动期间停止/离开不能阻止随后发送）、F07（退出不等待讨论保存队列排空）、F09（关闭窗口一次失败后无法重试）。对应验收：停止后不发请求、迟到启动的会话立即结束、作品切换与销毁不可使会话复活；退出前保存排空落盘、失败可见且不先销毁；关闭失败可重试且不重复已完成阶段。
- **证据形态**：复核报告的复现（人为延迟 `startSession` 后 cancel/endAll 仍发送；两次关闭实际只尝试一次）转为仓库内正式测试；另补排空编排与分阶段重试的组合用例。
- **未跑真实模型**：`real_link_*` 三项保持手动运行约定；本次修复路径不经过模型协议。

## 二、门禁结果（全部通过）

| 门禁 | 结果 | 说明 |
|---|---|---|
| `npm run check` | 通过 | typecheck / lint / 前端 1113 / 可靠性 120 / 驱动 13 / 生产构建 / Rust 302 单元＋80 集成 |
| `npm run test:validation` | 通过 | 78 项 |

## 三、F04/F07/F09 回归证据（按不变量）

### F04：启动/重放窗口失效（`tests/ai-session-transport.test.ts`，新增 14 例）

| 不变量 | 证据（测试名，参数化覆盖多入口） |
|---|---|
| 启动期间停止/结束/全部结束 → 不发送、迟到会话被结束、不注册、可重新启动 | `${action} during startup rejects the send, ends the late session, and allows a fresh start`（三类入口参数化） |
| 重放三个异步阶段中任一失效 → 拒绝恢复、绝不注册迟到会话 | `${action} during replay ${stage} rejects recovery and never registers the late session`（三阶段参数化） |
| 失效启动保留原始失败语义，且后续可正常重新尝试 | `invalidated startup preserves its original failure and allows a fresh attempt` |
| 结束迟到会话自身失败时，仍以取消错误拒绝（失败关闭） | `invalidated startup still rejects with cancellation when ending the late session fails` |

### F07：退出前保存排空（`tests/leave-safety.test.ts` ＋ `tests/ai-feature-persistence.test.ts`）

| 不变量 | 证据（测试名） |
|---|---|
| 关闭等待全部在途讨论保存落定后才销毁控制器与窗口 | `F07 close waits for every pending discussion save before destroying controllers and window` |
| 等待期间新登记的终态保存同样被覆盖 | `F07 drain includes a terminal save registered while the accepted save is pending` |
| 排空以原始保存错误拒绝（不吞错、不伪成功） | `F07 drain waits for its batch to settle and rejects with the original save error` |
| 排空失败保留窗口、未开始任何销毁；重试先排空再收尾 | `F07 drain failure keeps the window open without destruction; retry drains before cleanup` |

### F09：关闭失败可重试（`tests/leave-safety.test.ts`）

| 不变量 | 证据（测试名） |
|---|---|
| 窗口阶段失败后再次关闭只重试未完成阶段（AI/编辑器不重复销毁） | `F09 failed window destruction retries only the unfinished stage` |
| 进行中关闭共享同一 Promise，且逐个等待异步阶段 | `F09 application destroyer shares pending work and awaits each asynchronous stage` |

### 收尾修复（对账中）

- 新增必需接口 `drainPendingSaves` 后，两个既有测试文件的四个模拟控制器补充空实现（`tests/editor.test.ts`、`tests/workspace-project-flow.test.ts`，不改任何原断言）；补齐后全量门禁复跑通过。

## 四、边界与未验事项

- **未执行桌面级真机验证**（真实窗口销毁失败重试、退出应用后重启检查落盘、启动期真实点击停止）。本次不变量均在离线层以正式测试覆盖；如需，可沿用既有 CDP 仪器另行执行。
- **不提供「绕过排空强制关闭」通道**：保存失败时窗口保留、错误可见，由用户处理后重试关闭（design.md 记录的明确取舍）。
- 部分销毁后重试只承诺「完成关闭」；不承诺部分销毁后界面仍可正常写作（design.md 如实记录）。
- 标题/置顶/删除等窄更新不在排空集合（各有自身错误路径）；F07 范围以讨论内容保存为准（design 已记录）。
