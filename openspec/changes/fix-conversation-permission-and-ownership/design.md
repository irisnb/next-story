## Context

复核报告（`方向/开发前全面工程复核-2026-09-23.md`）F03/F05 的两处缺陷都已被逐条核查确认，且在本变更开工前仍原样存在：

- **F03**：`isConversationMaterialRestricted` / `restrictionReasonOf` / `isConversationRestrictedForRecovery` / `latchConversationRestriction`（`src/ai-panel-conversation.ts:194-291`）与后端 `latch_conversation_restrictions`（`src-tauri/src/conversation_store.rs:706-739`）只检查普通出处 `provenance`；补读出处 `on_demand_reading_provenance` 完全没有接入权限判定，也没有任何持久锁存表达。`conversation-store.rs:1417` 的现有测试明确断言「只含补读出处的讨论不锁存」——该缺陷被测试固定住了。
- **F05**：前端普通保存的 `buildConversationRecord`（`ai-panel-conversation.ts:614`）与 `buildDiscussionRecord`（`:727`）携带 `on_demand_reading_grant`，后端 `save_conversation_locked`（`conversation_store.rs:439-499`）只保全 `on_demand_reading_provenance`、不保全授权字段；授权开关 `conversationSetOnDemandReading`（`conversation-archive.ts:377-384`）不在前端保存串行链上。工具通道 `upsert_on_demand_provenance`（`story_tool_channel.rs:931-959`）与 `grant_on_demand_reading`（`story_tools.rs:528-537`）都是「读一次锁、写一次锁」，与普通保存交错时存在丢更新窗口（可回退新轮次/标题/授权）。

Change 2（`rework-conversation-storage`）已完成的半个底：普通保存对补读出处做 None 保全；窄更新（标题/置顶/开关）共用 `CONVERSATION_STORE_LOCK`；元信息索引已携带 `on_demand_document_ids` 供列表判定使用。这些保持并推广，不推翻。

约束：遵循 AGENTS.md 绝对边界（讨论档案由受控应用服务写入，AI 路径零写回）；旧档案必须无需迁移正常打开；不提升档案版本号；一次一个 change（第 10 节排定本项为第 3 次）。

## Goals / Non-Goals

**Goals:**

- 权限影响关系统一：受限判定、后端锁存、崩溃恢复过滤、列表脱敏、关闭前影响提示基于同一份「讨论消费过的文档」推导，覆盖普通出处与补读出处。
- 只含补读出处的讨论也能被持久锁存（重新开启可见性不解除），旧逐条锁存标记继续兼容识别。
- 字段所有权明确：普通保存不能授予/撤销授权、不能改写出处与锁存；授权与出处只经后端窄更新写入。
- 补读出处落档与授权写入与普通保存、删除、恢复共享同一临界区（单事务读改写），交错不丢更新、不回退。
- F03/F05 审计复现转为仓库内正式回归测试。

**Non-Goals:**

- 不改授权交互、界面文案与产品概念；不新增材料来源。
- 不处理 F04/F07/F09（停止、退出、关闭收尾，Change 4）与 F10–F14（工程门禁，Change 5）。
- 不做档案版本升级或数据迁移；不引入数据库、不做存储格式重构。
- 不优化讨论列表容量、渲染与增量写入（维持 Change 2 边界）。

## Decisions

### D1：统一「材料消费文档」推导，判定只读一处

前端新增单一推导 `consumedDocumentIds(record | summary | conversation)`：合并普通出处 `provenance` 与补读出处 `on_demand_reading_provenance`（摘要用 `provenance` + `on_demand_document_ids`，旧档案 `provenance === null` 时保持 `missing_provenance` 保守语义）。所有判定改用该推导：

- `isConversationMaterialRestricted`：`已锁存 || consumed ∩ hidden ≠ ∅`；
- `restrictionReasonOf`、`conversationFromRecord`、`isConversationRestrictedForRecovery`、`latchConversationRestriction` 同一入口；
- 后端 `latch_conversation_restrictions` 的命中条件改为 `references_incomplete || provenance 命中 || on_demand_document_ids 命中`。

被否决的替代：给补读出处单独加逐条 `revoked` 标记并在各判定点补分支。它把「新增一种来源要在多处补隐藏判断」制度化，违反复核报告 6.1 的实用标准。

### D2：受限锁存用档案级字段，兼容旧逐条标记

讨论档案新增字段 `restriction: Option<{ reason: "hidden_material", at: string }>`（`#[serde(default)]`，不提升版本号）：

- **写**：后端锁存命令命中受影响讨论时写入 `restriction`（单调：已存在不改写时间）；不再新增逐条 `revoked` 标记写入。
- **读**：判定 = `restriction` 存在 **或** 任一出处条目带旧 `revoked` 标记（旧版本写下的锁存继续生效）。元信息索引保留 `provenance_has_revoked`（兼容旧索引与旧档案），新增派生布尔 `restricted`（`record.restriction.is_some() || provenance_has_revoked`）。
- **重存**：前端重存不再需要给出处打 `revoked` 标记（锁存由后端写并被普通保存保全）；`conversationProvenanceForArchive` 的旧打标逻辑仅保留为旧数据直通。

被否决的替代：给 `OnDemandReadingProvenance` 增加 `revoked: bool` 并在 meta 增 `on_demand_has_revoked`。它能工作，但锁存语义分裂到每个来源、每个判定点，未来来源继续加分支；且报告验收明确禁止「靠给空普通出处加标记假装完成」，档案级字段是更诚实的表达。

### D3：普通保存的后端所有字段一律取档案现值（严格所有权）

把「None 保全」升级为硬规则：普通保存（`conversation_save` 命令路径）对**后端所有字段**——`on_demand_reading_grant`、`on_demand_reading_provenance`、`restriction`——忽略调用方提供的任何值；档案存在时取磁盘现值，档案首次创建时取缺省（`None`）。实现放在存储层公开保存入口内、同一临界区完成（读现值 → 合并 → 写入），内部窄更新继续使用不合并的 `*_locked` 路径。

前端配套：`buildConversationRecord` / `buildDiscussionRecord` 不再输出 `on_demand_reading_grant`（类型字段保留用于读取）。

安全性分析（写入设计测试）：授权只能经后端窄更新成功写入，而窄更新要求档案已存在；因此「内存中有授权而档案不存在」不可达——创建时取缺省不会丢掉真实授权。

被否决的替代：保留「调用方传 None 才保全」的启发式。它挡不住任何显式传值的调用方，所有权仍然靠约定而不是结构，F05 类缺陷会复发。

### D4：读改写收进存储层单临界区；授权开关不依赖前端排队

- `upsert_on_demand_provenance` 从 `story_tool_channel.rs` 移入 `conversation_store.rs`：全程持 `CONVERSATION_STORE_LOCK`（读 → 合并条目 → 落盘），通道层只做调用与失败记录；`story_tools::grant_on_demand_reading` 改为直接调用既有 `set_on_demand_reading(root, id, true)`，消除重复实现与两次取锁。
- 前端 `conversationSetOnDemandReading` 不加入保存串行链：普通保存不再触碰授权字段（D3），授权顺序不再依赖前端排队；后端存储锁保证与在途保存串行。删除/恢复/墓碑逻辑不变。

### D5：前端判定与显示路径

- `TemporaryConversation` 增加读取侧的锁存来源（由 `conversationFromRecord` 从 `restriction` 字段映射为 `restricted` / `restrictionReason`）；`conversationProvenanceForArchive` 与 `summaryOf` 随 D1/D2 调整；删除撤销路径（`ai-feature-delete-undo.ts`）沿用同一判定。
- `ai-panel-view-model.ts` 的出处展示继续按当前 `hiddenDocumentIds` 脱敏，不依赖锁存标记形态。

## Risks / Trade-offs

- [旧档案带逐条 `revoked` 标记但无 `restriction` 字段，被误认为未锁存] → 判定把旧标记等价于锁存（D2 读路径），并有专门回归测试覆盖「旧标记档案重新开启可见性后仍受限」。
- [普通保存严格忽略调用方授权字段 → 某条真实写入路径丢授权] → 逐个写入路径核对（授权卡允许、面板开关、首轮在途、终态保存）并为「授权先落窄更新、随后旧保存到达」写交错测试；发现漏路径即修。
- [档案级锁存与旧逐条标记双真相漂移] → 新写入只写档案级字段；旧标记只读；`derive_meta` 两个字段各自派生并在判定中 OR，不做互相回写。
- [锁存命令遍历成本] → 与现状同复杂度（索引命中优先，`references_incomplete` 才回退读正文），不新增全量正文读取。
- [回滚兼容] → 旧版本读取新字段时忽略未知字段（serde 默认行为），不会损坏档案；但旧版本不会识别新写入的档案级锁存，回滚期间该部分受限判定退化——如实列为已知限制。
- [删除/恢复与锁存的交错] → 回收区恢复沿用档案原值（含 `restriction`）；锁存命令走索引与墓碑同在存储锁内，不产生「已删除讨论被锁存复活」。

## Migration Plan

- 无数据迁移：新字段带 `#[serde(default)]`，旧档案缺省为空；旧索引缺 `restricted` 时由既有「失效重建」路径（`body_bytes` 比对）在下次列表时派生。
- 规格与实现同步在一个 change 内完成；归档时更新第 10 节状态与文档地图，不引入中间态发布。
- 回滚策略：代码回退即可；回退后新字段被忽略、旧逐条标记路径仍读取——但本变更新写入的档案级锁存将不再生效（见 Risks）。

## Open Questions

- 无阻塞性未知项。验证方式按项目惯例在 apply 阶段落 `verification/validation.md`：仓库门禁（`npm run check`、前端/Rust 测试、fmt、clippy）＋ F03/F05 转正回归测试；是否需要补一次应用级真实链路记录，由 tasks 的验收项定。
