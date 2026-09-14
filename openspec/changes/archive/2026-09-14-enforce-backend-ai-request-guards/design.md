# 设计：后端生成护栏与取材锁

## Context

- 3a 之后 `dsh_driver.rs` 已代际化：`Inner { lifecycle, sink, loss_sink, spawn_lock }`；`send_message_and_wait` 依次 `current_runtime()` → `runtime.register(PendingKey::Message)` → `write_command` → 等待循环（注册凭据 `Drop` 自清理）。准入控制应插在**最前**，让护栏不可绕过且覆盖全部出口。
- 前端调度器现状：`ai-request-scheduler.ts` 默认上限 2、FIFO 排队、排队状态只在对应窗口呈现；`ai-request.ts` 每讨论单飞锁。正常 UI 路径先排队，不会触达后端拒绝。
- Node 驱动：`driver.mjs` 会话 `busy` 检查保留（最后一层防御，随 3a 的会话队列串行化后更可靠）。
- 取材路径：`lib.rs` 的 `ai_send_message` 常规取材块中 `locks.acquire(path).ok()` 吞掉锁失败后继续 `assemble_round_context`。
- 错误码契约：`GenerateAiErrorCode`（`llm_config/mod.rs`）+ 前端 `types.ts` 联合类型，无规格枚举约束。

## Goals / Non-Goals

**Goals:**
- 后端准入不可绕过：同讨论重复生成 → `conversation_busy`；全局超限 → `capacity_exceeded`；两者都不写驱动协议。
- 许可生命周期零泄漏：注册、写命令、等待、超时取消宽限期、所有错误出口都持许可；结束即释放。
- 取材锁失败立即失败关闭，固定安全文案，不调用组装。
- 前后端职责在规格里分层清楚，上限数值继续留给真实基线。

**Non-Goals:**
- 不做用户可配置上限或环境变量；不做 capabilities 查询协议（过度设计）。
- 不改前端调度器与排队 UX。
- 不处理审计队列第 4-6 项（前端生命周期问题）。

## Decisions

1. **准入表与上限放 `DshDriverManager`（生成层）而非 Tauri 命令层**：`generate.rs` 直接调用全局 manager，命令层护栏会被测试与内部调用绕过；放在 `send_message_and_wait` 入口则所有调用方一律受控。
2. **RAII 许可按会话键**：`Admission { active_by_session: HashMap<String, String> }`（会话 → 进行中消息 id）；`GenerationPermit` 的 `Drop` 只删除自己登记的会话条目（带消息 id 比对，防误删继任者）。获取顺序：先查同会话冲突，再查总量超限，最后登记。
3. **上限默认 2，构造可注入**：`new()` 用与前端一致的当前值；`new_with_limit(n)` 供测试。注释与规格明确「当前安全策略，非实测容量结论」；真实基线仍待阶段 7。前后端两个常量必须一起调整并有契约测试锚定（前端调度器测试已断言默认 ≥2）。
4. **新错误码不复用 `Service`**：`Service` 混装远端限流与内部错误；后端本地拒绝要能被测试与未来遥测区分。固定中文文案随码定义，`message` 不含路径/身份。
5. **锁失败关闭的实现形态**：`lib.rs` 抽 `assemble_context_under_lock(locks, path, …) -> Result<RoundContext, AssembleContextError>`；`AssembleContextError::{ LockUnavailable, Denied(MaterialDenial) }`；映射：`LockUnavailable` → `service_error("作品读取暂时不可用，本次请求未发送。")`，`Denied(RecoveryRequired)` → 既有 `story_recovery_required_error()`，其余 → 既有 `invalid_story_context_error()`。闭包内不再 `.ok()`。
6. **职责分层表**（写入规格）：

| 层 | 责任 |
|---|---|
| 前端 scheduler | 正常 UI 路径 FIFO 排队、排队状态、停止排队 |
| Rust manager | 不排队；不可绕过地拒绝同讨论重复与全局超限 |
| Node driver | 会话 `busy` 最后一层防御 |

## Risks / Trade-offs

- [正常 UI 竞态下用户可能见到后端拒绝码] → 固定文案可读且不重试风暴；前端排队先行，实际触达概率极低。
- [许可覆盖超时取消宽限期，名额释放略晚] → 与「请求真正结束才释放」语义一致，防取消期间超卖。
- [上限 2 写死两处（前后端）] → 契约锚定 + 规格声明「基线后一起调整」；本 change 不引入配置面。
- [lib.rs 抽函数改变错误传播形状] → 纯内部重构，映射表全量对齐既有三种错误路径，回归由既有前端 745 项 + Rust 测试守护。

## 测试计划

1. **准入护栏（dsh_driver 单元 + 假驱动）**：`new_with_limit(2)` + 延迟应答假驱动（1.5s 后 `message_done`）：两个不同会话并发进行中，第三会话 → `capacity_exceeded` 且迅速返回（未写协议由「无需驱动参与即可立即拒绝」保证）；同一会话第二请求 → `conversation_busy`；前两个完成后名额释放，新请求成功。
2. **许可零泄漏**：超时路径（短 timeout + 不应答驱动）结束后，新请求可再次获得名额。
3. **取材锁**：`assemble_context_under_lock` 传入不可规范化路径（锁获取失败）→ `LockUnavailable`，且不调用组装（错误先于组装返回）。
4. **错误码契约**：snake_case 序列化断言扩展 `conversation_busy` / `capacity_exceeded`；固定文案不含敏感痕迹。
5. 回归：`npm run check` 全量（含 `test:driver`）。

## Migration Plan

纯代码护栏，无数据迁移；回滚 = git 还原。正常 UI 行为不变。

## Open Questions

无阻塞项。上限实测数值属阶段 7 基线工作，不在本 change。
