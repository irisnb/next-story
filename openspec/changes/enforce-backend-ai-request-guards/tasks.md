# 任务：后端生成护栏与取材锁

## 1. 错误码契约

- [x] 1.1 `GenerateAiErrorCode` 新增 `ConversationBusy`（「当前讨论已有生成中的请求，请稍候」）与 `CapacityExceeded`（「已达同时生成上限，请等待进行中的生成完成后再试」）；snake_case 序列化与固定文案断言
- [x] 1.2 前端 `types.ts` 错误码联合类型扩展 `conversation_busy` / `capacity_exceeded`

## 2. 后端生成准入护栏

- [x] 2.1 `dsh_driver.rs`：`Inner` 增 `admission: Mutex<Admission>`（会话 → 进行中消息 id）与 `max_concurrent_generations`；`new()` 默认与前端当前值一致（2，注释声明为当前安全策略非容量结论）；新增 `new_with_limit(n)` 测试构造
- [x] 2.2 `send_message_and_wait` 入口先取 RAII 许可：同会话冲突 → `conversation_busy`；总量超限 → `capacity_exceeded`；许可 `Drop` 只删除自己登记的条目（消息 id 比对），覆盖全部出口含超时取消宽限期
- [x] 2.3 测试：`new_with_limit(2)` + 延迟应答假驱动——两会话并发进行中第三会话立即 `capacity_exceeded`、同会话第二请求 `conversation_busy`、完成后名额释放新请求成功；超时路径结束后名额可复得（零泄漏）

## 3. 取材锁失败关闭

- [x] 3.1 `lib.rs` 抽 `assemble_context_under_lock`：锁获取 `Result` 化，失败映射固定安全文案「作品读取暂时不可用，本次请求未发送。」且绝不调用组装；`RecoveryRequired` 保持 `story_recovery_required` 专用码；其余拒绝维持 `invalid_story_context_error`
- [x] 3.2 测试：不可取锁路径 → `LockUnavailable` 错误先于组装返回

## 4. 验证与收尾

- [x] 4.1 `npm run check` 全量通过（含 `test:driver` 与前端回归）
- [x] 4.2 OpenSpec 严格校验通过（change 与规格）
- [x] 4.3 按项目规范提交（git-master：查状态、精确暂存、中文提交信息）；归档时同步 `方向/全量地基审计-2026-09-14.md` 队列 3b 与 P1-4/P1-5 状态
