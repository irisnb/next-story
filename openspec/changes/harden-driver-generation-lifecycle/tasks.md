# 任务：驱动代际与生命周期

## 1. 锁中毒恢复（机械先行，独立可验证）

- [x] 1.1 `dsh_driver.rs` 新增 `lock_recover` 助手（参照 `project/mod.rs:203` 的恢复式取锁），替换全部 `lock().unwrap()`（审计清点：313/327/341/400/413/421/450/455/467/469/548/579/587/600/607/614/719/733 一带，以实际编译清单为准）
- [x] 1.2 测试：测试线程持 lifecycle 锁 panic 后，`cancel_message()` 与 `shutdown_best_effort()` 不 panic 且完成清理

## 2. 代际架构

- [x] 2.1 引入 `GenerationId` / `Lifecycle` / `LiveGeneration` / `GenerationRuntime` 类型：`Inner.state` 改为 `Mutex<Lifecycle>`；pending 表下沉到代际运行时；generation 分配在 `spawn_lock` 保护下
- [x] 2.2 就绪等待改用代内独占一次性 `startup` 信号通道（`StartupSignal` 枚举），`"ready"` 不再进入通用 pending 表
- [x] 2.3 `route` / `fail_generation_pending` / `mark_dead_if_current` / `write_command` / delta 转发全部带代际检查；旧代事件与 EOF 只清理自身资源；只有已就绪当前代死亡才触发 loss_sink
- [x] 2.4 参数变化重启：先从 current 取出旧代、锁外优雅关闭旧进程，再生成并安装新代
- [x] 2.5 测试：旧 reader EOF 晚于新代安装——gen2 进程/等待/就绪保留、不触发 loss sink；旧代 delta 不进 sink

## 3. 启动闸门

- [x] 3.1 `StartupSignal` 状态机落地：仅版本正确 `Ready` 成功（同代转 Ready）；错版本 / `Error` / 其他已知事件 / EOF / 通道断开 / 超时 → 回收该代并返回启动失败；废除 `Ok(_) => Ok(())` 宽判
- [x] 3.2 测试：ready 前直接退出 / 首帧 `error` 冒充 / 错误协议版本 → `ensure_started()` 失败、current 为空、进程回收、不触发崩溃恢复通知

## 4. 等待键纪律

- [x] 4.1 pending 注册改 `Entry::Vacant` + `Result`：重复键明确冲突；`PendingRegistration` 凭据（generation + key + runtime）`Drop` 只注销自身
- [x] 4.2 `start_session` / `replay_done` / `end_session` 共用 `PendingKey::SessionControl(session_id)`；同会话控制 ACK 至多一个在等待；三处控制等待的非预期 ACK 一律失败关闭
- [x] 4.3 测试：重复 `Message` 键注册第二次立即冲突且第一次仍能收到终态；控制键互斥；start 等待期间收到非预期事件类型 → 失败

## 5. driver.mjs 会话内命令串行化

- [x] 5.1 抽出会话队列小模块（`sessionTails` 尾链）：同会话 start/replay_history/replay_done/send/end 按 stdin 顺序串行；跨会话并行；`cancel_message` 旁路立即执行；`send_message` 只串行到生成启动；`shutdown` 全局屏障（停收新命令、取消活动 Agent、等队列收束、再 dispose）
- [x] 5.2 队列模块 `node:test` 单测（无 DSH 启动副作用），`package.json` 增加测试脚本并接入 `npm run check` 链
- [x] 5.3 `driver.mjs` 接线；测试：延迟 fake `createAgentFor()` 下先入队 replay_done、未完成时入队 send——只创建一次 Agent、send 在 `replay_ok` 后启动；cancel 旁路即时

## 6. 验证与收尾

- [x] 6.1 `npm run check` 全量通过（含新增 driver 队列测试）；现有 dsh_driver 测试与前端 745 项回归保持
- [x] 6.2 OpenSpec 严格校验通过（change 与规格）
- [x] 6.3 按项目规范提交（git-master：查状态、精确暂存、中文提交信息）；归档时同步 `方向/全量地基审计-2026-09-14.md` 队列 3a 状态
