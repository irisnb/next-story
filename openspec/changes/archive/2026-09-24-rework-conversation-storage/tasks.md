## 1. 后端存储层（conversation_store.rs + lib.rs + story_tool_channel.rs）

- [x] 1.1 定义元信息索引结构 `ConversationMeta`（version / 身份 / 标题 / 自定义标题 / 置顶 / 时间 / 最后状态 / 关注文档 / `body_bytes` / 材料引用索引 / `references_incomplete` 标记），索引读取上限 256 KiB
- [x] 1.2 实现 meta 读写：`read_meta` / `write_meta`（原子写复用 `write_file_atomically`），meta 文件名 `<id>.meta.json`；meta 的读、重建、写回与 save/delete 共用 `CONVERSATION_STORE_LOCK`
- [x] 1.3 实现 `derive_meta(&ConversationRecord)`：从正文派生全部 meta 字段（标题截断、引用索引提取规则与 `summarize` 一致）；**降级**：引用索引使 meta 超限时省略引用索引并置 `references_incomplete: true`，绝不截断引用条目
- [x] 1.4 `MAX_CONVERSATION_BYTES` 1 MiB → 8 MiB
- [x] 1.5 `save_conversation` 增加保存前字节校验：**在保全调用方未携带的补读出处之后、任何写盘之前**执行；超限返回专用中文错误（说明上限与建议新建对话），不覆盖最后一份可重开档案
- [x] 1.6 `save_conversation` 成功后同步原子写 meta（正文先、meta 后；meta 携带新正文 `body_bytes`；meta 写失败不致命）
- [x] 1.7 `list_conversations` 改为读 meta：缺失/损坏/超限 → 读正文重建；`body_bytes` 与 `fs::metadata` 字节长度不一致 → 判过期重建；孤儿 meta → 清理跳过；正文超限/损坏 → 沿用 skipped 提示
- [x] 1.8 `summarize` 不再携带 `turns` 全文（摘要瘦身，保留列表 UI 与受限判定所需全部字段）
- [x] 1.9 软删除带失败协议：`delete_conversation` 记墓碑 → 正文移入 `conversations/.trash/`（提交点）→ meta 移入（失败可容忍）；`restore_conversation` 正文移回（提交点）→ meta 移回或重建 → 清墓碑，任一步失败保留原位与撤销可能；应用启动（打开作品前）清空 `.trash/`
- [x] 1.10 `conversations_using_document` 改为扫 meta 引用索引；`references_incomplete` 的讨论回退读正文兜底，不因降级漏报
- [x] 1.11 新增 IPC 命令（lib.rs 注册，中文错误契约与列表一致）：
  - `conversation_read`：按身份读完整档案（复用 `read_conversation`）
  - `conversation_update_meta`：重命名/置顶窄更新（读改写仅动 title/pinned，模式与 `set_on_demand_reading` 一致，未打开讨论也可用）
  - `latch_conversation_restrictions`：按文档 ID 执行权限锁存（先扫 meta 定位受影响讨论，再对其读正文、引用该文档的普通出处条目转 `revoked`、保存正文＋meta；语义与现状前端锁存逐条对齐，不覆盖补读出处）
- [x] 1.12 `story_tool_channel.rs` 的补读出处 upsert 保存失败不再静默忽略：落档失败如实记录/上报，不得无声丢弃
- [x] 1.13 后端测试：超限保存拒绝且不覆盖旧档案、写成功必可读回（转正 `tmp/project-audit` 的 F06 复现不变量）、meta 过期检测重建、`references_incomplete` 降级与影响查询兜底、孤儿清理、软删除失败协议与撤销、锁存语义与现状对齐、迟到保存墓碑不复活

## 2. 前端契约与打开流程

- [x] 2.1 `ConversationSummary` 类型去掉 `turns` 全文，改为携带 meta 字段（含 `body_bytes` 之外的前端所需字段与材料引用索引）
- [x] 2.2 列表缓存（轻量条目）与打开讨论缓存（全文）拆分：reducer 不再把列表摘要转成完整讨论；重新 list 只刷新列表缓存，不得清空或重建已打开讨论的运行态
- [x] 2.3 `conversation-archive.ts` 新增 `conversation_read` 与 `conversation_update_meta` 调用封装
- [x] 2.4 点击列表条目：已打开窗口 → 只聚焦不重读；未打开 → 异步读档 → "正在打开"占位提示 → 成功后 `conversationFromRecord` 重建渲染；**迟到守卫**：结果返回时校验作品代次、讨论未删除、窗口未关闭，任一不符则丢弃
- [x] 2.5 保存链错误透传：8 MiB 超限等专用中文错误完整到达对应讨论窗口（修复 `ai-feature.ts:349-351` 吞错），不得静默或泛化为普通失败
- [x] 2.6 保存成功后本地更新列表条目（前端持有完整 conversation，派生 meta 同构字段），不触发整表刷新
- [x] 2.7 重命名/置顶改走 `conversation_update_meta` 窄更新（未打开条目无需先读全文），前端更新内存与列表条目
- [x] 2.8 删除/撤销改走软删除命令，`ai-feature-delete-undo.ts` 不再依赖内存全文重建；恢复成功前不清守卫（修复 `conversation-archive.ts:329-330` 时序）
- [x] 2.9 关闭文档 AI 可见性 → 调 `latch_conversation_restrictions` 后端锁存并更新内存条目受限状态；**判定算法与现状一致（仅普通出处参与判定），不提前接入补读出处**（留给 Change 3）
- [x] 2.10 前端测试更新与新增：打开流程（读档中提示、成功渲染、失败提示、迟到丢弃）、删除撤销不依赖全文、重命名/置顶窄更新、保存后列表条目更新不覆盖运行态、锁存迁移后行为与现状一致

## 3. 验证与文档

- [x] 3.1 `npm run check` 与 `cargo test` 全绿（含新增后端与前端测试）
- [x] 3.2 核对《开发前全面工程复核-2026-09-23.md》第 10 节与本 change 最终形态一致（编号、F06 归属、Change 3 措辞）
- [x] 3.3 核对规格 delta 归档所需内容完整（MODIFIED 需求全文保留、场景格式合规），提交前自查无遗漏
