# 驱动代际与生命周期（harden-driver-generation-lifecycle）

## Why

2026-09-14 全量地基审计 P0-2（两个审计通道独立发现）：驱动进程的 reader 线程、请求等待表与进程句柄都是**无代际的全局状态**（`dsh_driver.rs:271/300`）；旧 reader 遇 EOF 会无条件清空全局 pending 并杀死当前 state 里的进程（`:793`、`:411`）。参数变化重启时，旧 reader 若晚于新进程安装而结束，会清空新请求、杀掉新进程、误报「驱动丢失」——用户看到的症状是**换配置后偶发全部讨论报错**。同时存在：启动判定过宽（除版本不符外任何 `Ok(_)` 都当成功，`:554`，ready 前退出被误判成功）、重复请求键静默覆盖（`:596`，旧等待者莫名超时）、锁中毒连锁 panic（`:313` 等 14 处 `lock().unwrap()`）、driver.mjs 不按会话串行处理命令（replay 未完成时 send 可重复创建 Agent，`driver.mjs:273/283/326`）。阶段 6 将在驱动协议上叠加工具事件与用户确认中断，这些地基缺陷会被成倍放大，必须先修。本 change 是审计修复队列第 3a 项（3b「后端生成护栏与取材锁」随后单独提出）。

## What Changes

- **驱动代际化（P0-2）**：每次 spawn 分配单调递增 generation；reader、pending 等待表、进程句柄全部绑定所属代际；事件路由、失败清空、标记死亡、就绪等待只对当前代生效；旧代迟到事件与 EOF 只清理自身资源，不触碰当前代；参数变化重启时先优雅退役旧代再启新代；流式 delta 转发增加代际检查。
- **严格启动闸门（P1-2）**：启动只接受协议版本正确的 `ready`；`error`、其他事件、EOF 或超时一律判定启动失败并回收该代进程；启动期使用该代独占的一次性信号通道，不再与消息等待表共享 `"ready"` 键。
- **等待键纪律（P1-6）**：pending 注册改用占位检查——重复键明确拒绝、绝不覆盖；注册凭据携带代际与键，注销只清理自己的注册；`start_session` / `replay_done` / `end_session` 共用会话控制键，同一会话不允许并存多个控制 ACK；控制确认与事件类型严格匹配，非预期 ACK 失败关闭（废除三处 `Ok(_) => Ok(())` 宽判）。
- **锁中毒恢复（P1-7）**：新增统一恢复式取锁助手（与作品锁 `project/mod.rs:203` 策略一致），替换 `dsh_driver.rs` 全部 `lock().unwrap()`；一处持锁 panic 后，取消与应用退出路径不再连锁崩溃。
- **driver.mjs 会话内命令串行化（P1-3）**：按 session 建立命令队列：同一会话的 start/replay/send/end 按 stdin 顺序执行，不同会话并行；`cancel_message` 绕过队列立即执行（否则会排在被取消操作之后）；`send_message` 只串行到生成启动（生成期间的同会话 send 仍由 busy 拒绝）；`shutdown` 是全局屏障。**不新增协议 ACK**。
- **测试**：旧 reader EOF 晚于新代安装、ready 前退出、错误事件冒充 ready、重复键拒绝、锁中毒后取消/退出存活、replay 期间 send 不双建 Agent（延迟 fake）。

## Capabilities

### New Capabilities

（无——本 change 不新增产品能力，只加固驱动运行时地基。）

### Modified Capabilities

- `dsh-sidecar-lifecycle`：修改「Sidecar lifecycle is owned and bounded by the host」——启动闸门严格化（仅版本正确的 ready 算启动成功）、进程与等待状态按单调代际隔离（旧代事件/EOF/清理不影响当前代）、只有已就绪的当前代意外退出才触发崩溃恢复通知、宿主锁中毒后生命周期/取消/退出路径仍能完成清理。
- `resident-ai-session`：新增「同一会话命令按序执行且身份唯一」要求——同一会话命令按接收顺序执行、replay 建立 Agent 期间到达的 send 不重复创建 Agent、重复消息身份注册明确拒绝、控制确认与事件类型严格匹配。

## Impact

- **Rust**：`src-tauri/src/dsh_driver.rs`（状态结构重构为主：`Inner.state` 改为 `Mutex<Lifecycle>`、pending 下沉到 `GenerationRuntime`）；`dsh_sidecar.rs` 接缝如受波及一并调整。
- **Node**：`sidecar/driver/driver.mjs`（会话队列接线）；队列逻辑抽为无 DSH 启动副作用的小模块，用 `node:test` 单测并在 `package.json` 接入 `npm run check`。
- **规格**：两份 delta（如上）。
- **明确不做**（留队列 3b `enforce-backend-ai-request-guards`）：后端并发硬上限与讨论级准入、取材锁失败关闭（`lib.rs:1501`）、新错误码 `conversation_busy` / `capacity_exceeded`、`ai-request-scheduling` 规格归属改写。
- 归档时同步 `方向/全量地基审计-2026-09-14.md` 队列 3a 状态。
