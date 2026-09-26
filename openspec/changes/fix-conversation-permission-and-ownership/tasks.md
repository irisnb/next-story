## 1. 后端：统一锁存与索引（conversation_store.rs + lib.rs）

- [x] 1.1 档案新增统一受限锁存字段 `restriction`（锁存原因 + 锁存时间，`#[serde(default)]`，不提升版本号）；`ConversationMeta` 新增派生 `restricted: bool`（锁存字段存在或旧逐条标记存在），保留 `provenance_has_revoked` 兼容旧索引；`ConversationSummary` 同步携带两个标记
- [x] 1.2 `latch_conversation_restrictions` 命中判定覆盖两类出处（`provenance` 与 `on_demand_document_ids`；`references_incomplete` 回退读正文时同样检查两类）；命中讨论写入统一锁存记录并保存（单调、幂等：重复执行不改锁存时间、不丢失其他出处、不新增逐条 `revoked` 写入）；返回受影响讨论 ID 的语义不变
- [x] 1.3 `derive_meta` 派生 `restricted`；索引重建（缺失/损坏/失效）路径同步；旧 meta 缺 `restricted` 字段时的读取行为与旧正文锁存标记兼容（由 `provenance_has_revoked` 或重建补齐）
- [x] 1.4 更新既有锁存测试（`conversation_store.rs:1417` 一带）：翻转为「只含补读出处的讨论被锁存」；新增「旧逐条 `revoked` 标记档案无 `restriction` 字段仍判定受限」「重复锁存幂等且不改时间」「meta `restricted` 同步」用例
- [x] 1.5 后端测试：锁存命中含 `references_incomplete` 降级回退路径；恢复判定所需的 `restriction` 在重开读取中如实返回

## 2. 后端：字段所有权与原子读改写（conversation_store.rs + story_tools.rs + story_tool_channel.rs）

- [x] 2.1 普通保存合并：`conversation_save` 命令路径在同一临界区内读取档案现值，对后端所有字段（`on_demand_reading_grant`、`on_demand_reading_provenance`、`restriction`）忽略调用方取值——档案存在取现值、首次创建取缺省；内部 `*_locked` 路径不做合并（窄更新自持锁读改写）；原 `None 保全` 逻辑由该规则取代
- [x] 2.2 补读出处落档移入 `conversation_store.rs`：单临界区完成读 → 同轮同文档合并升级 → 落盘；`story_tool_channel.rs` 改为调用存储层函数，保留失败如实记录；移除通道内 `provenance_write_lock` 及不再需要的依赖
- [x] 2.3 `story_tools::grant_on_demand_reading` 改为调用 `set_on_demand_reading(root, id, true)`；消除重复实现与两次取锁；仅供测试使用的路径降为测试夹具
- [x] 2.4 F05 回归转正（Rust）：撤销授权后旧副本普通保存到达 → 磁盘仍未授权、重启读取仍为未授权；授权后不含授权字段的保存到达 → 授权保持；普通保存携带与现值不同的后端字段 → 被忽略；工具通道落档与普通保存交错（顺序注入）→ 最新轮次与最新出处都不丢失
- [x] 2.5 测试夹具与全量测试更新：以档案字段直接播种的用例改用 `*_locked`/窄更新或显式 seed；`cargo test`、`cargo fmt`、`cargo clippy --all-targets -- -D warnings` 干净

## 3. 前端：统一推导与判定（ai-panel-conversation.ts + ai-panel-reducer.ts + ai-panel-state.ts + conversation-archive.ts）

- [x] 3.1 新增单一推导 `consumedDocumentIds`：普通出处与补读出处并集；支持档案 / 摘要（`on_demand_document_ids` + 锁存标记）/ 运行期对话三种形态；档案 `provenance === null` 维持 `missing_provenance` 保守语义
- [x] 3.2 `isConversationMaterialRestricted`、`restrictionReasonOf`、`isConversationRestrictedForRecovery`、`latchConversationRestriction`、`conversationFromRecord` 全部改用该推导；`conversationFromRecord` 从档案 `restriction` 字段映射 `restricted` / `restrictionReason`；`TemporaryConversation` 读取侧相应扩展
- [x] 3.3 摘要与列表：`ConversationSummary` 契约新增 `restricted`（后端与前端派生两路一致）；`deriveConversationSummary`、`summaryOf`、删除撤销路径与 reducer 的列表/摘要判定改用统一推导（含补读出处与两类锁存标记）
- [x] 3.4 保存链：`buildConversationRecord` / `buildDiscussionRecord` 不再输出 `on_demand_reading_grant`（类型字段保留用于读取与展示）；`conversationProvenanceForArchive` 的旧 `revoked` 打标逻辑仅作旧数据直通
- [x] 3.5 前端测试：补读-only 隐藏来源的重开 / 锁存 / 恢复判定（转正 `visibility.mjs` 三类场景）；列表脱敏；旧 `revoked` 标记档案重开仍受限；保存载荷不携带授权字段（序列化断言）；`recomputeRestrictions` 路径用统一推导

## 4. 验证与收尾

- [x] 4.1 门禁全绿：`npm run check`、`npm run test:validation`、`cargo test`、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`
- [x] 4.2 `verification/validation.md`：记录门禁结果、F03/F05 转正测试证据与交错用例；如执行应用级记录（列表脱敏 / 隐藏后重开）如实写明范围与结果
- [ ] 4.3 归档前核对：规格 delta 完整（MODIFIED 全文、场景 4 级标题格式）；更新《开发前全面工程复核-2026-09-23.md》第 10 节 Change 3 行为 ✅（附归档 change 名与日期）；确认 Change 4 边界未被本 change 提前覆盖
