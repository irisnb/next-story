# 提案：同一讨论的保存串行化（P0-4）

## Why

同一讨论的状态变化会触发多次 fire-and-forget 保存（`ai-feature.ts:311-327 persistDiscussion`，约 11 个调用点：轮次成功/失败、停止生成、重命名、置顶、改绑关注文档等）。`conversation-archive.ts` 的 `inFlightSaves` 只登记最后一个 Promise、不串行化（:217-218 新保存直接覆盖槽位），删除只等最后一次登记的保存（:235-242）。

**危害边界（2026-09-16 复核修正）**：审计原文「删除可被复活」实际已被双保险拦死——后端全局锁 + 墓碑机制（`conversation_store.rs:189-190/364-373`，删后到达的保存返回 `AlreadyDeleted`，有测试 `save_after_delete_is_rejected_and_does_not_resurrect_file`）+ 前端删后名单。**真正活着的问题是三个**：

1. **丢更新**：同一讨论两笔重叠保存（如「生成中 pending」与「完成 done」）到达后端顺序不确定，后端 last-writer-wins 且不比较记录新旧——慢到的旧状态可把新终态盖回去。
2. **伪报错**：迟到保存被后端墓碑拒绝后，前端 `.catch` 弹「讨论保存失败」——用户被吓到，实际什么都没丢。
3. **嫌疑缺陷（待核实）**：`undoDelete`（ai-feature.ts:402-403）走「恢复 + 保存」，若删后名单未清除刚恢复的 id，恢复后的新保存会被前端自己拦掉——重启后可能丢内容。

规格（`conversation-persistence`）对保存顺序与删除终局语义沉默；测试对「重叠保存」零覆盖（mock 全部立即 resolve，构造不出乱序）。对应审计队列第 5 项（P0-4），最后一个 P0。

## What Changes

- **串行链**：`conversation-archive.ts` 把 `inFlightSaves` 改造为按 **(projectPath, conversationId)** 的严格串行链（promise chaining）——后发起的保存必须等前一个完成落盘后才执行；key 加入 projectPath（修正现状只有 conversationId 的模块级全局 key）。
- **删除终局**：`conversationDelete` 进入同一条链——先排干该讨论全部在途保存，再执行删除；删除后到达的保存继续被删后名单拦截。
- **伪报错消除**：保存被后端 `AlreadyDeleted` 拒绝时识别为预期终局，不再置 `saveError`；真实失败仍如实报错。
- **嫌疑缺陷核实**：核实并（如确有）修复 `undoDelete` 未清删后名单的问题，补「撤销删除后可继续保存」回归测试。
- **测试**：补「旧保存慢完成不得覆盖新状态」「重叠保存后删除：终局且无伪报错」「迟到保存不误报不复活」。
- **规格**：`conversation-persistence` 新增 Requirement，把顺序与终局语义写成契约。

### 不做什么（Non-Goals）

- 不改后端（全局锁、墓碑、原子写已足够；乱序问题在前端排队解决后，last-writer-wins 即正确语义）。
- 不改 `ai-feature.ts` 的 11 个 fire-and-forget 调用点（队列建在 archive 层这个唯一出入口，上层无需感知）。
- 不做重启后的墓碑持久化（前端名单与后端墓碑均为进程内存态——重启后名单清空是正确行为，此时后端墓碑也同步不存在，无危害）。
- 不动讨论删除的 UX（删除确认、撤销窗口等既有行为不变）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `conversation-persistence`：新增一条 Requirement「同一讨论的保存串行且删除具终局性」（现有规格只规定单文件原子写与删除移除档案，未规定并发顺序与终局语义）。

## Impact

- **代码**：`src/conversation-archive.ts`（串行链 + 删除排队 + 错误分类）、`src/ai-feature.ts`（仅 `undoDelete` 一处嫌疑修复，待核实）、`tests/conversation-archive.test.ts`、`tests/ai-feature-persistence.test.ts`（乱序场景）。
- **规格**：`openspec/specs/conversation-persistence/spec.md` 增补（delta 见 specs/）。
- **验证**：`npm run test:frontend` + typecheck + lint；后端测试不受影响（无后端改动），CI 全量兜底。
- **风险**：低——改动集中在一个模块；后端行为不变；新增测试用可控 resolve 时序的 Promise 直接复现原缺陷。
