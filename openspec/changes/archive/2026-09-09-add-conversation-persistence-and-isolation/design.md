# Design: 独立对话与可靠保存（阶段 2）

## Context

当前链路是「单一临时对话」：`src/ai-panel-state.ts` 只有一个 conversation；`src/ai-session-transport.ts` 持单一 `activeSessionId` 与全局 `messageCounter`；Rust `dsh_driver.rs` 按 `msg:{message_id}` 建终态索引；sidecar `driver.mjs` 已有 `sessions` Map 但产品只用一个会话。任何新召唤都会清空旧对话，无落盘、无历史列表（见 `resident-ai-session`、`selection-ai-summon`、`ai-thinking-panel` 等规格中的「不持久化」「替换且不建立历史」要求）。

阶段 0 已确认（`方向/让AI看见作品-阶段0整体设计-2026-09-09.md` 第三至七节）：讨论归属一部作品、创建时绑定关注文档、新召唤开启新讨论不替换旧讨论、讨论级请求隔离、保存与重开、基本会话列表、删除是独立动作、讨论记录存作品文件夹内。阶段 1 已离线验证 DSH 多会话隔离与取消/迟到隔离可行。

现有可复用基础：`project/operations.rs` 的 `write_file_atomically`（tempfile + persist）与事务工具；`migration.rs` 的版本迁移框架；`dsh_driver.rs` 的会话命令与终态索引；`driver.mjs` 的会话 Map 与 replay 机制。

## Goals / Non-Goals

**Goals:**

- 多个讨论并存：独立身份、作品归属、关注文档绑定；新召唤/新建对话开启新讨论。
- 讨论级请求隔离：消息身份、流式目标、取消、迟到结果互不串用。
- 讨论持久化：轮次、生成终态、材料来源（选区快照、关注文档身份）写入作品文件夹内 `next-story-system/` 独立目录，版本化、原子写入、保存失败可见。
- 重启恢复 + 基本会话列表：按作品列出、重开查看、删除；不自动重发未完成请求。

**Non-Goals:**

- 多窗口并排显示、快车道（阶段 3）；会话内快捷跳转（后续）；可见性设置（阶段 4）；AI 看作品的现场材料与补读（阶段 5/6）。
- 真实 DSH 工具事件字段、等待基线、并发上限数值。
- AI 写作品能力：保持零写回，讨论档案由受控应用服务写入，不注册为 AI 可调用工具。

## Decisions

### D1 讨论身份：`conversation_id` 全局唯一，前缀进入消息身份

每个讨论创建时生成全局唯一 `conversation_id`（时间戳 + 随机段）。消息编号继续由 transport 的全局计数器生成，但拼成 `{conversation_id}:msg-{n}`，保证跨讨论唯一、Rust `pending` 索引键不变形（仍按 `msg:{message_id}`）。DSH 会话与讨论一一对应：一个讨论一个会话，复用 `driver.mjs` 现有 `sessions` Map 的多会话能力；会话在讨论重开并发出新追问时经 `replay_history` 重建，进程退出或删除讨论时结束。

- 备选：每讨论独立计数器 + 会话内路由——改动面更大（Rust 索引需加会话维度），不采用。

### D2 存储位置与格式：作品文件夹内每讨论一个 JSON 文件

- 路径：`<作品目录>/next-story-system/conversations/<conversation_id>.json`。
- 每文件头含：`version: 1`、`conversation_id`、`created_at`、`updated_at`、`focus_document_id`、`focus_document_title`、`turns`（用户/助手文本、终端状态）、`first_round_material`（冻结选区快照文本或直接提问问题、来源入口）。为阶段 5/6 预留 `materials`/`tool_events` 扩展位，不实填。
- 会话列表由扫描该目录得出（读每个文件的头字段），不另建索引文件，避免双文件一致性问题。
- 写入用 `write_file_atomically`；读取有界（上限参考现有 `MAX_METADATA_BYTES` 量级），损坏或超限文件跳过并如实提示，不让列表崩溃。
- 理由：作品以文件夹为单位、无全局索引，放作品文件夹内自动解决归属、搬迁、备份与删除一致性；与现有 `documents/<id>.json` 按 ID 寻址模式一致。备选（应用数据目录 + 作品路径关联）在作品移动/改名后失联，需额外重连机制，且违反「作品文件夹自包含」直觉，已由用户选择排除。

### D3 保存时机：接收即存、终态更新

- 用户轮被接受时立即写入（状态 `pending`）；生成到达终态（成功/失败/取消）时原子更新该轮终态。
- 应用中途崩溃：重开后该讨论显示最后一次保存状态，未完成轮标记为「中断」，不自动重发、不伪装成功。
- 删除讨论 = 删除对应文件，单独动作，不在关闭/切换路径中触发。

### D4 前端状态模型：当前讨论引用 + 讨论集合

- `ai-panel-state` 从单 conversation 改为：`conversations`（当前作品讨论的轻量视图：id、标题、时间、终态）+ `activeConversationId`（当前显示）。一次显示一个讨论；阶段 3 再引入多窗口显示。
- 会话列表 UI 入口：按作品列出讨论（标题取首轮问题或召唤文本截断，空则用时间），点击重开查看；「新建对话」按钮语义改为开启新讨论（旧讨论保留为档案）。
- 切作品：沿用 `resetProjectScopedAi`，清空当前视图并加载新作品的讨论列表；旧讨论文件留在原作品目录。

### D5 讨论级单请求锁与迟到隔离

- 锁从「全局同一时刻只允许一轮请求」改为「每个讨论同一时刻只允许一轮请求」；不同讨论可并行生成，互不等待。
- 迟到结果按 `{conversation_id}` 隔离：原讨论已删除/已切换后到达的 delta、终态一律丢弃（沿用既有 `conversationGeneration` ABA 思路，升级为按讨论 ID）。
- 取消、超时只影响对应讨论。

### D6 Rust 侧：新增讨论档案存储模块，不进入能力网关

- 新增 `src-tauri/src/conversation_store.rs`（list / save / delete，均为前端命令），复用 `write_file_atomically` 与有界读取。
- 明确不注册为 AI 可调用工具、不进入 `capability_gateway` 授权面；AI 路径继续零写回。

### D7 无数据迁移

当前没有任何持久化对话，无旧数据需要迁移。规格文本的 requirement 变更即迁移主体。档案格式带 `version: 1`，为未来格式演进预留迁移位（复用 `migration.rs` 模式，届时另开 change）。

## Risks / Trade-offs

- [保存中途崩溃导致轮次不完整] → 接收即存 + 终态原子更新；重开显示「中断」，不自动重发。
- [档案文件损坏/被手工编辑] → 有界读取 + JSON 校验，失败项跳过并在列表/提示中如实说明，不崩溃、不静默丢弃成功项。
- [多讨论并行生成增加资源压力] → 阶段 2 只保证隔离与正确性；并发上限与排队在阶段 3 与真实等待基线一起定。
- [讨论文件随作品增长] → 每文件只存轮次文本与最小材料记录；自动清理与体积规则随阶段 5 材料设计再定，本阶段不设静默清理。
- [保存与删除竞态] → 前端按讨论串行化操作 + Rust 原子替换；删除先于保存的竞态按「删除优先」处理，不复活已删讨论。

## Migration Plan

1. 规格变更先行：更新 2 个新 capability 与 9 个现有 capability 的 requirement（delta spec）。
2. 实现顺序：讨论身份与请求隔离 → 保存格式与命令 → 列表/重开/删除 UI → 全链路验证。
3. 回滚：代码回滚后旧行为（不保存）恢复；已写入的档案文件被忽略，无破坏。
4. 验证：`npm run check`、`npm run test:rust`、现有 AI 相关测试全绿；手动走查重启恢复、切换作品、删除讨论、迟到结果隔离。

## Open Questions

- 列表条目标题：优先首轮问题/召唤文本截断，空则时间——先按此实现，可后续微调。
- 讨论数量上限与清理：留待阶段 5 材料规则一起定。
- 生成中关闭面板/切走再切回时的 UI 状态呈现：阶段 2 内按「讨论独立生成、切回显示进行中状态」实现，窗口级细节交阶段 3。
