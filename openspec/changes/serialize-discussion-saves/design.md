# 设计：同一讨论的保存串行化

## Context

保存链路：`ai-feature.ts persistDiscussion`（fire-and-forget，约 11 个调用点）→ `conversation-archive.ts conversationSave`（登记 `inFlightSaves`，新保存覆盖槽位、不排队）→ Tauri 命令 `conversation_save` → 后端 `conversation_store`（全局锁 + 墓碑 + tempfile 原子写）。删除：`conversationDelete` 把 id 加入 `deletedConversationIds` 后**只等最后一次登记的保存**。撤销删除：`undoDelete` await `restoreConversation` + `saveConversation`。

后端已保证：单文件原子、save/delete 互不交错、删后保存被墓碑拒绝。**缺口全在前端**：重叠保存的到达顺序不确定（丢更新）、迟到保存的拒绝被当失败弹错（伪报错）、key 不含 projectPath（模块级全局 Map，跨作品同名 id 理论可串档）。

## Goals / Non-Goals

**Goals:**

- 同一 (projectPath, conversationId) 的保存按发起顺序严格串行落盘——后发起者必在先发起者完成之后执行，消灭丢更新。
- 删除排干在途保存后执行，具终局性；删除后的迟到保存被安全吞掉且不报错。
- 撤销删除后该讨论可继续正常保存（含嫌疑缺陷核实）。
- 顺序与终局语义进入规格，重叠保存场景进测试。

**Non-Goals:**

- 不改后端（见提案）。
- 不改 `ai-feature.ts` 的调用点与 fire-and-forget 风格。
- 不做保存去重/合并（两笔相邻保存都落盘，只保证顺序；调用频率不高，无性能压力）。

## Decisions

### D1：串行链建在 conversation-archive 层

archive 是保存/删除的唯一出入口（`undoDelete` 也经 `conversationSave`）。队列放这里，上层 11 个 fire-and-forget 调用点零改动。备选「在 ai-feature 层排队」要求每个调用点感知队列，否决。

### D2：链的实现——按 key 的 promise chaining

```
tail: Map<key, Promise<void>>   // key = projectPath + '\u0000' + conversationId

conversationSave(key, record):
    const run = (tail.get(key) ?? Promise.resolve())
        .then(() => 已删除 ? skip : invoke("conversation_save", record))
        .then(清 saveError)
        .catch(错误分类：AlreadyDeleted → 预期终局，静默；其余 → 置 saveError)
        .finally(() => { if (tail.get(key) === run) tail.delete(key); });
    tail.set(key, run);
    return run;

conversationDelete(key):
    const run = (tail.get(key) ?? Promise.resolve())
        .then(() => invoke("conversation_delete", id))   // 排干在途保存后才删
        .finally(...);
    deletedConversationIds.add(key);                      // 立即生效：后续新保存 no-op
    tail.set(key, run);
    return run;
```

要点：**删除先把 key 进删后名单再入链**——删除排队期间新发起的保存直接 no-op（不会排到删除后面去）；已在链中的存量保存正常落盘，然后删除执行。`AlreadyDeleted` 的判别方式在实现时按后端实际错误形状确定（错误码字符串或结构字段），判别不出的宁可当真失败报错（失败开放朝用户可见方向，不吞真错）。

### D3：undoDelete 与删后名单的一致性

实现时核实 `undoDelete` 路径：`restoreConversation` 成功后必须把 key 从 `deletedConversationIds` 移除（或名单按 key 而非裸 id 重建），否则恢复后的首笔保存被前端拦截。若现状已正确，任务以「补回归测试锁死」收尾；若有缺陷，修复并记录。

### D4：链头阻塞风险的处理

若某环的 IPC invoke 永不返回，链会卡死该讨论的后续保存。缓解与接受理由：每环 `catch` 保证异常不阻断后续；Tauri invoke 挂起不返回意味着 IPC 通道/进程已死，此时编辑器整体已不可用——不为该场景加超时复杂度。诚实记录，不做超时。

### D5：不做保存合并与新鲜度裁决

后端 last-writer-wins 在「到达顺序 = 发起顺序」后即正确语义。给记录加序号/时间戳裁决是后端改动且引入时钟问题，否决——前端排队已充分。

## Risks / Trade-offs

- **[链实现错误引入死锁/漏 catch]** → 每环 finally 清槽位 + catch 分类；新增测试覆盖「链中失败后下一笔保存仍执行」。
- **[AlreadyDeleted 判别过宽吞真错]** → 判别条件按后端错误形状精确匹配；测试锁定「真失败仍报 saveError」。
- **[多窗口并发]** → 讨论窗口均为同进程同前端上下文，共享同一 archive 模块与链，无跨进程竞态；Tauri 多窗口若拆分 JS 上下文则后端全局锁仍是兜底（顺序可能乱但不会交错写）。
- **[回归面]** → archive 层全部既有测试（删后 no-op、单在途保存、正常保存）必须保持通过。

## Migration Plan

纯前端改动，无数据迁移。回滚 = revert 单提交。已有档案文件格式与位置不变（`next-story-system/conversations/<id>.json`）。

## Open Questions

（无——链语义、错误分类、嫌疑缺陷核实路径均已定义；实现时唯一待确认项是 AlreadyDeleted 的具体错误形状。）
