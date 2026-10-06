# 设计：信封分层迁移（wire-system-prompt-channel）

> 事实依据：《方向/制作模块/制作模块技术摸底-2026-10-06》（现状与行号）、驱动源码侦察记录（2026-10-06，接线点与风险清单，结论已并入本文）、外部调研（system 层优先性：OpenAI×2＋Anthropic 官方文档）。

## Context

现状（摸底核实）：全部制度性提示（红线、身份、工具说明）由 `compose_system_prompt`（`src-tauri/src/llm_config/generate.rs:83-89`）拼进**第一条 user 消息文本前缀**；追问轮不重发；崩溃重放经 `replay_prompt_prefix`（generate.rs:386-391）把提示词再拼回重放文本。模型真正的 system prompt 由 `@deepseek-ai/dsh-system-prompt` 插件组装：harness 标识段（order −100，固定）＋部署 persona 段（order 0，当前英文 coding agent 文案）。协议 `start_session.system_prompt` 字段：Rust 宿主不发送；驱动接收并存储（`sidecar/driver/driver.mjs:397`）但从不消费——死通道。

## Goals / Non-Goals

**Goals：**
1. 接线 system 通道：正常轮与崩溃重放两路一致（同一 system_prompt 逐字在场）。
2. 分层迁移：宪法红线＋中文陪想身份迁入 system 层，顶替英文 persona；user 前缀同步移除（禁止双份投递）。
3. system 层次序固定并预留链路卡挂载位（本变更空置，第二刀填）。
4. 实测闭环摸底遗留项 P2（长对话压缩后红线在场性）。

**Non-Goals：**
- 链路卡与制作模块任何功能（第二、三刀）；
- 材料装配、工具开放边界、可见交互的行为变化；
- 提示词文案重写（除身份句中文化外，文本原样迁移）。

## Decisions

**D1 注入点＝`createAgentFor` setup 的 per-agent section（不用 seed、不用 buildSeedEvents）。**
依据：DSH seed 表面白名单只有 user/assistant/tool-result 三种角色（`dsh-session/lib/types/surface.js:11-15`），seed 塞 system 消息不支持；seed request/header 会被 loop 首步覆盖（`dsh-agent-loop/lib/index.js:349,709-718`）。而 `createAgentFor`（driver.mjs:236-251）的 setup 回调是两条路径（首条 send_message 建会话、replay_done 重建）共同的必经点，一处注册两路一致。先例：`installModelSelection` 已在 setup 内注册 scoped waterfall（driver.mjs:243）。

**D2 section 注册方式＝遮蔽 `deployment:persona` ＋ 追加两个自定义段。**
- 遮蔽段 `deployment:persona`（order 0）：中文陪想身份文本（顶替英文 coding agent；`PERSONA_SECTION` 导出即为此用途，`dsh-system-prompt/lib/index.js:10-18`）。
- 追加段 `nextstory:constitution`（order 10）：宪法红线文本（`constitution_prompt()` 原文迁移）。
- 追加段 `nextstory:chain-cards`（order 20）：**本变更注册为空段**（或仅当非空时注册）——占住次序契约，第二刀填卡。次序不变式由此结构化保证：红线永居卡上。
- 不用 `complete: true`（会压掉其余全部段落与动态 context，`lib/index.js:264-289`）；走 section 正道则 `options.system === header.system` invariant 自洽（`dsh-agent-loop/lib/invariant.js:24-28`）。

**D3 system_prompt 内容＝纯常量确定性组装；重放一致性靠「冻结输入重算＋逐字断言」。**
本变更中 system_prompt 全部来自代码常量（身份句＋红线文本），`start_session` 时组装发送；崩溃重放时由相同常量重算并重发，契约测试断言重发值与原值逐字相等（无持久化必要——常量无状态）。第二刀引入卡后升级为「会话创建时冻结卡内容快照」（届时在链路库设计中定义，此处预留语义不实现）。

**D4 user 层瘦身范围。**
`compose_system_prompt` 与首轮 user 前缀：移除红线与身份文本；**保留**入口姿态句（DirectQuestion/Summon 差异，每轮信息）与工具使用说明（入口差异相关，每轮信息）。`replay_prompt_prefix` 重放前缀逻辑移除（重放会话的 system_prompt 由 start_session 携带）。`dsh-headless-generation` legacy 链路同步对齐（等价基准：legacy 与常驻链收到相同 system 层、user 层不再重复）。

**D5 协议契约同步。**
`protocol.json`：`start_session.system_prompt` 描述从「驱动接受该字段，Rust 宿主 v1 不发送」改为「宿主必发；驱动注册为 system 层段落」；`adapter.mjs` 已建模该字段（:82,:161），按新语义补消费；两端契约测试同步（含「重发逐字相等」断言）。

**D6 分层归属原则（本变更的执行口径）。**
制度性（每轮恒定、不许被压过）→ 信封：身份、红线、卡挂载位。每轮差异 → 信纸：入口姿态句、工具说明（按入口）、用户问题、当轮材料。此口径写入 `system-prompt-layering` 规格，第二刀沿用。

## Risks / Trade-offs

- [KV 缓存失效：system 前缀变化使缓存从首个差异 token 起作废] → system_prompt 每会话恒定且全讨论相同（常量）；跨会话也相同（同为常量）→ 前缀稳定，理论命中不降；真机以 token 计量观察核对。
- [双份投递：宿主残留 user 前缀] → 移除实现＋契约测试断言「首轮 user 文本不含红线句」。
- [崩溃重放不一致：驱动内存丢失 system_prompt] → D3 重算重发＋逐字断言测试；真机崩溃恢复场景回归。
- [压缩后红线是否真在场（P2）] → 本变更验证计划内实测闭环：真机长对话触发压缩后 dump request，断言 system 层含红线。
- [端点行为差异（智谱/OpenAI 兼容层对 system 段的处理）] → 真机验收用现役端点跑全场景；观察首字延迟无异常恶化。
- [legacy 链路对齐引入回归] → legacy 链路现有测试全量保留，等价断言更新。

## Migration Plan

纯内部行为变更，无数据迁移、无用户数据格式变化。回滚＝还原代码（无状态残留）。上线顺序：驱动侧（section 注册＋协议）→ Rust 宿主（发送＋瘦身）→ 契约测试绿 → 全量回归 → 真机验收（含 P2 实测与崩溃恢复）→ 归档。

## Open Questions

- ~~中文陪想身份句的最终措辞：实现时起草两版供用户过目择一（不阻塞其余设计）。~~ **已定（2026-10-06 用户拍板备选 A）**：「你是陪伴剧本创作者思考与探索的助手。」；实现常量、两侧契约测试与规格增量已同步（备选 B「剧本创作中的陪想助手…」未采用）。
