# 设计：驱动代际与生命周期

## Context

- 现状（审计 + ora-2 设计图核实）：`dsh_driver.rs` 的 `Inner` 持全局 `state`（进程）与全局 `pending` 表（`:271/300`）；每次 spawn 起 reader 线程（`:546`）无身份；reader EOF 无条件 `fail_all_pending()` + `mark_dead()`（`:793`），`mark_dead()` 杀当前 state 进程（`:411`）；`"ready"` 与消息共用等待键命名空间（`:351/399`）；启动判定 `Ok(_) => Ok(())`（`:554`）；pending `HashMap::insert` 静默覆盖（`:596`）；start/replay_done/end 的 ACK 宽判（`:632/749/781`）；14 处 `lock().unwrap()`。
- driver.mjs：每行直接起异步 `handleCommand()`（`:326`）；`replay_done` 等待 `createAgentFor()` 期间，后续 `send_message` 可再次创建 Agent（`:273/283`）；不同讨论必须并行（`ai-request-scheduling` 规格），不能全局队列。
- 本 change 不改对外协议（不新增 ACK、不改命令/事件字段），只收紧内部时序与失败语义。

## Goals / Non-Goals

**Goals:**
- 旧代 reader 的 EOF/事件在任何时序下都不能影响当前代（进程、等待、就绪、通知）。
- 启动成功当且仅当收到版本正确的 `ready`；失败路径全部回收进程。
- 重复身份注册显式冲突；控制 ACK 严格匹配；等待者不被静默覆盖。
- 锁中毒只损失一瞬一致性，不再连锁 panic；取消/退出路径始终可完成清理。
- driver.mjs 同会话命令严格按序，replay 期间 send 不双建 Agent；跨会话并行保持。

**Non-Goals:**
- 不做后端并发上限与讨论级准入（3b）。
- 不改协议消息面（无新 ACK、无字段变化）。
- 不动前端调度器与传输层（`ai-session-transport.ts` 无需改动；恢复命令 `ok` 检查属队列第 6 项）。
- 不做 `StrictStoryReader` 或工具协议（阶段 6）。

## Decisions

1. **代际类型（ora-2 草图）**：`GenerationId(u64)` 单调递增，分配在 `spawn_lock` 保护下（不引入额外原子）；`Inner.state` 改为 `Mutex<Lifecycle>`，`Lifecycle { next_generation, current: Option<LiveGeneration> }`；`LiveGeneration { id, phase(Starting|Ready), process, runtime: Arc<GenerationRuntime> }`；`GenerationRuntime { id, startup: Mutex<Option<Sender<StartupSignal>>>, pending: Mutex<HashMap<PendingKey, Sender<DriverEvent>>> }`。sink/loss_sink/spawn_lock 保持独立字段。
2. **路由与清理规则**：`route(generation, event)` 先比对 current——旧代事件全部丢弃（含 delta，不进 sink）；`fail_generation_pending` 只 drain 该代表；`mark_dead_if_current(generation)` 仅同代才 take/kill；current 在 Ready 阶段死亡才触发 loss_sink（启动失败由首次请求收到启动错误，不伪装崩溃恢复）；`write_command` 只向 `phase == Ready` 的当前代写入。参数变化重启：先从 current 取出旧代，锁外优雅关闭旧进程，再启新代——旧 reader 之后结束只关闭自己的 stdout、失败自己的 waiter。
3. **启动状态机**：`StartupSignal { Ready, ProtocolMismatch{actual}, DriverError, UnexpectedEvent, Eof }`；spawn → 安装 Starting 代 → 启动 reader → 等待信号：版本正确 Ready → 同代转 Ready（成功）；其余（错版本/Error/其他已知事件/EOF/通道断开/超时）→ 回收该代 → 启动失败。就绪前禁止发送会话命令（落实 `resident-ai-session` 既有「等待就绪后才发送」）。
4. **等待键纪律**：`register()` 用 `Entry::Vacant`，`Occupied` 返回冲突错误；`PendingRegistration { generation, key, runtime }` 的 `Drop` 只注销自己所属代的同一注册。消息键 `PendingKey::Message(message_id)`；`start_session`/`replay_done`/`end_session` 共用 `PendingKey::SessionControl(session_id)`，同会话控制 ACK 至多一个在等待（也消除通用 `Error` 在三个键间猜测投递）。三个控制等待废除 `Ok(_) => Ok(())`：非预期 ACK 一律失败。
5. **锁中毒恢复**：`fn lock_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> { m.lock().unwrap_or_else(|p| p.into_inner()) }`，替换全部 `lock().unwrap()`（pending/路由 313/327/341/400、生命周期 413/421、sink 450/455、spawn 467/469/548、shutdown 579/587、register/write 600/607/614、cancel/end 719/733，以实际编译清单为准）。恢复 poison 解决连锁崩溃；业务不变量由代际类型维持。
6. **driver.mjs 会话队列**：`sessionTails: Map<sessionId, Promise>` 尾链模式——同会话命令按 stdin 顺序串行（start/replay_history/replay_done/send/end），跨会话并行；`cancel_message` 旁路立即执行；`send_message` 只串行到 `runTurn()` 启动（`runTurn` 本身不等待终态，`:165`），生成期间同会话 send 仍由 `session.busy` 拒绝（`:283`，保留为最后一层防御）；`shutdown` 设置全局屏障：停收新命令、取消活动 Agent、等各会话队列收束、再 dispose。不新增 ACK——`session_started`/`replay_ok`/`session_ended` 已覆盖需确认的边界，无 ACK 的 `replay_history` 与 `replay_done` 靠同队列顺序闭合。
7. **队列可测性**：队列逻辑抽为独立小模块（纯函数 + 无 DSH 启动副作用），`node:test` 覆盖（driver 目录当前无测试，`package.json` 的 check 链补一条 driver 测试脚本）。

## Risks / Trade-offs

- [重构面较大（dsh_driver.rs 状态结构重写）] → 分阶段落地、每阶段独立测试（先机械的 poison 助手，再代际类型，再闸门/键纪律）；现有假 Node driver 测试支架（`:1011` 一带）扩展复用。
- [严格闸门让过去「碰巧成功」的启动现在失败] → 这正是审计 P1-2 的意图：失败被如实暴露并回收，不再推迟到第一条会话命令才爆。
- [会话队列引入新死序风险] → cancel 旁路 + shutdown 屏障 + 队列模块独立单测；同会话 busy 语义不变。
- [控制键合并改变 start/end 并发等待行为] → 现有前端本就串行等待这些 ACK；合并只是把既有约定变成后端强制。

## 测试计划

1. **旧 reader EOF**：构造 gen1 → 切 gen2 → 触发 gen1 EOF；断言 gen2 进程/pending/ready waiter 保留、不触发 loss sink。
2. **ready 前退出 / 错误冒充 / 版本不符**：假 driver 不输出 ready 直接退出、首帧输出 `error`、输出错误版本；`ensure_started()` 失败、current 为空、进程回收。
3. **重复 pending 键**：同代同 `Message` 键注册两次——第二次立即冲突，第一次仍能收到终态。
4. **控制键互斥与严格匹配**：start 等待期间同会话再注册被拒；等待期间收到非预期事件类型 → 失败关闭。
5. **poison 存活**：测试线程持 lifecycle 锁 panic 后，`cancel_message()` 与 `shutdown_best_effort()` 不 panic。
6. **driver 队列**：延迟 fake `createAgentFor()`——先入队 replay_done、未完成时入队 send：只创建一次 Agent，send 在 `replay_ok` 后启动；跨会话并行不受影响；cancel 旁路即时。
7. 回归：现有 dsh_driver 全部测试与前端 745 项保持通过。

## Migration Plan

纯内部加固，无数据迁移、无协议变化；回滚 = git 还原。用户可见差异仅限「过去被掩盖的启动失败现在如实报错」。

## Open Questions

无阻塞项。`max_concurrent_generations` 数值与错误码设计属 3b，不在本 change。
