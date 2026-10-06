# 提案：信封分层迁移（wire-system-prompt-channel）

> 制作模块第一刀三刀之首（拍板记录见《方向/制作模块/交付物定义-讨论-2026-10-06》§3 执行拆分）。本变更只做分层迁移与通道接线，不含链路卡与制作模块任何可见功能（第二、三刀范围）。

## Why

技术摸底（2026-10-06）核实了两个存量问题，且制作模块需要制度性注入位：

1. **身份错位**：模型实际收到的 system prompt 是 DSH 出厂英文「You are a coding agent…」，与产品定位（剧本创作陪想）错位；宪法红线等制度性内容全部拼在**第一条 user 消息的文本前缀**里（`generate.rs` 四层组装）。
2. **红线漂移风险**：追问轮不重发提示词，长对话压缩后首条前缀可能不在场（DSH 官方文档证实压缩会丢弃前置内容；本项目未实测，机制风险已确立——摸底报告待验证项 P2）。
3. **制作模块前置**：链路卡需要制度性注入位置，且**红线必须与卡同层**（否则卡在 system 层会制度性压过留在 user 层的红线，次序倒置）。用户已拍板「信封各司其职」分层：红线＋陪想身份＋（未来的）链路卡入 system 层；入场说明、用户问题、当轮材料留 user 层。
4. **通道现成但未接线**：协议预留的 `start_session.system_prompt` 通道两端各差一步（Rust 不发送；驱动存储但从不消费）。驱动源码侦察已确认接线点（`createAgentFor` setup 注册 per-agent section，一处同时覆盖正常与崩溃重放两路）与风险清单（双份投递、重放一致性、协议契约同步）。

外部证据（2026-10-06 调研）：system 层指令冲突时制度性优先于 user 层（OpenAI×2＋Anthropic 官方文档原文）；稳定 system 前缀对 DeepSeek 系前缀缓存友好。

## What Changes

- **分层迁移**：宪法红线＋陪想身份（中文）迁入 system 层，顶替英文 coding-agent persona；user 前缀中的红线与身份文本移除（防止双份投递）。system 层内部次序固定：引擎标识 → 红线＋陪想身份 → **链路卡挂载位（预留空位，本变更不填）**。
- **通道接线**：`sidecar/driver/driver.mjs` 在 `createAgentFor` 的 setup 回调按 `session.systemPrompt` 注册 per-agent sections（遮蔽默认 persona）；Rust 宿主 `dsh_driver.rs` 在 `start_session` 发送 system_prompt、持久化、崩溃重放时重发。
- **重放一致性**：重放会话的 system_prompt 与原会话逐字一致；`replay_prompt_prefix`（重放文本再拼提示词前缀）相应移除，显示历史投影与此对齐。
- **协议契约同步**：`protocol.json` 字段描述更新（从「Rust 宿主 v1 不发送」改为必发语义）、`adapter.mjs`、两端契约测试。
- **分层归属原则**（细节 design.md 定案）：制度性内容上信封（红线、身份、挂载位）；每轮差异留信纸（入场方式说明、工具使用的入口差异、用户问题、当轮材料）。
- **不改变**：材料装配行为、工具开放边界、任何用户可见交互；legacy 无状态链路（`dsh-headless-generation`）的等价基准随迁移更新。

## Capabilities

### New Capabilities

- `system-prompt-layering`：信封分层制度——system 层内容构成与次序不变式（红线永居卡挂载位之上）、与 user 层的职责划分、崩溃重放的逐字一致性、双份投递禁止。

### Modified Capabilities

- `dsh-headless-generation`：首轮提示词的组装位置条款更新——身份句、宪法红线（含诚实材料边界与追问语义）迁入会话 system 层并逐字保留；user 消息文本不再携带这些条款（禁止双份投递）；崩溃恢复由「重放文本前缀同步」改为「start_session 携带相同 system_prompt」。（会话机制侧的新行为由新能力 `system-prompt-layering` 承载；`resident-ai-session` 的追问增量、重放等既有要求原文不受影响，无需修改。）

## Impact

- **sidecar**：`driver.mjs`（createAgentFor setup＋section 注册）、`protocol.json`（单一真相源）、`adapter.mjs`、驱动侧契约测试。
- **Rust 宿主**：`src-tauri/src/dsh_driver.rs`（发送／持久化／重发）、`src-tauri/src/llm_config/generate.rs`（组装调整、重放前缀移除）、`ai_orchestration.rs`（如涉及）。
- **前端**：`src/ai-feature.ts` 显示历史投影与重放对齐（如涉及）。
- **验证**：全量回归（材料链路 8 场景、编排回归 5 场景、长上下文套件）；**P2 实测**（长对话压缩后红线在场性——摸底遗留待验证项在本变更内闭环）；崩溃恢复一致性（重放前后行为对称）；前缀缓存命中不恶化观察；按账本第 21 条真机冒烟（涉及外部进程与协议变更）。
