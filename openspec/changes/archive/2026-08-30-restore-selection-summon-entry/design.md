# 设计：恢复选区 AI 及时召唤入口

## Context

常驻会话改造后，产品只剩「直接提问」一个首轮入口；旧选区工具（及时召唤 / 思维扩展 / 浮动入口）代码保留但断线。2026-08-30 探索轮确认：及时召唤以正式功能身份恢复（走常驻会话流式），思维扩展经用户确认退场，系统提示词从「刻死的 const」改为「空位 + 现场填入」结构。决策依据见 `.omo/选区AI入口恢复决策-及时召唤与思维扩展-2026-08-30.md` 第八节。

关键代码现状：

- `src-tauri/src/llm_config/generate.rs`：两块 `const` 提示词（`FIXED_SYSTEM_PROMPT` / `DIRECT_QUESTION_SYSTEM_PROMPT`）；`ai_send_message_in_dir` 对空 question 返回 `invalid_request`（236-238 行）；`First` 类型的首轮文本 = 系统提示词 + `direct_question_user_content(question, selected_text)`；`ai_replay_history_in_dir` 在重放时给首轮 user 轮重新拼 `DIRECT_QUESTION_SYSTEM_PROMPT`。
- `src/ai-session-transport.ts`：`kind: "first"` 降级走 legacy 一次性命令（115-117 行）；`direct_question` 走常驻会话流式。
- `src/selection-entry.ts`：浮动入口控制器完整保留（33 测试全过），含两选项菜单。
- `src/ai-feature-first-request.ts`（@deprecated）：旧首轮预检/重试流程，19 测试。
- `src/ai-feature-direct-question.ts`：现役直接提问首轮流程（预检门禁、冻结、发送）。
- `index.html:140-149`：思维扩展面板 DOM（断线保留）。

## Goals / Non-Goals

**Goals:**

- 及时召唤作为正式功能恢复：浮动按钮单动作（无菜单），点击即以选区为材料发起常驻会话首轮，无需打字，流式呈现。
- 召唤发起的对话与直接提问发起的对话是同一种统一临时对话：可追问、可取消、可新建对话替换、崩溃恢复重放。
- 系统提示词改为「空位 + 现场填入」：红线层 + 入口层 + 语境层三块拼装，为未来动态化立结构。
- 思维扩展退场收尾：删除保留的死代码与 DOM。
- 全部「唯一入口」「旧选区工具已退场」记录修正。

**Non-Goals:**

- 多对话切换 / 会话列表 / 会话持久化（未来单独 change）。
- Agent 自动上下文、后台预加载、检索、摘要、记忆（未来能力）。
- 提示词的运行时动态机制（本次只立结构，填空规则保持简单）。
- 任何 AI 写入用户文档的通道（安全边界不动）。

## Decisions

### D1：召唤走常驻会话流式，legacy 通道退役删除

召唤首轮通过常驻会话发送，与直接提问同一条流式路径。`kind: "first"` 的 legacy 降级分支（`ai-session-transport.ts:115-117`）、`legacyGenerate` 依赖、`ai-feature-first-request.ts` 及其 19 个测试一并删除。

理由：非流式一次性回答与现面板逐字体验割裂，且会在同一面板里制造两套对话事实源。备选「保留 legacy 求改动最小」被否：体验倒退 + 双事实源违反 `persistent-ai-panel-entry` 的统一事实源要求。

### D2：协议扩展——新增 `SummonFirst` 消息类型，后端组装首轮任务

`AiMessageKind` 增加 `SummonFirst`。前端发送 `SummonFirst` 时空 question、带 `selected_text`；后端校验规则改为：`First`/`FollowUp` 要求 question 非空，`SummonFirst` 要求 `selected_text` 非空（浮动入口只在有选区时出现，选区是召唤的前提）。后端按召唤语义组装首轮文本（见 D3）。

理由：备选「前端配默认问题文本」被否——前端造假文本，且默认文本散落前端难以演进；备选「改协议允许完全空首轮」被否——召唤永远有选区材料，空到什么程度都不需要，校验反而失守。后端组装本来就是 `generate.rs` 的既定职责（模块注释：「由本模块集中组装固定首版思考任务」）。

### D3：提示词「空位 + 现场填入」三块结构

删除两块 `const` 碑文，改为组装函数：

```
compose_system_prompt(entry) =
    CONSTITUTION_PROMPT      // 红线层：不代写、不润色、不判断、
                             //   不能声称读取没给它的东西（两块旧碑的
                             //   边界条款逐字提取合并，每次照抄）
  + entry_stance(entry)      // 入口层：DirectQuestion →「用户直接提出的
                             //   问题 + 可选重点材料」；Summon →「只有
                             //   冻结选区原文、没有用户问题，把选区当作
                             //   希望继续探索的材料」
  + context_clause(entry)    // 语境层：本次可见材料描述（当前随入口层
                             //   一并表达，不单独做动态机制）
```

- `First` 首轮文本 = `compose_system_prompt(DirectQuestion)` + 用户内容。
- `SummonFirst` 首轮文本 = `compose_system_prompt(Summon)` + 选区材料内容。
- 边界条款必须逐字保留，不得在合并中弱化（「不能声称读取…」清单一条不删）。

理由：备选「合并成一块新 const」被否——用户明确未来提示词是动态空位，第三块碑文会让下次改动变成二次重构；备选「本次直接实现动态提示词机制」被否——越界到 Agent 时代的 change，违反一次一个 change。

### D4：崩溃恢复重放携带会话来源

`ai_replay_history_in_dir` 增加来源参数（`direct_question | summon`），重放时按来源拼对应的入口层提示词。前端在内存状态中记录当前对话的发起方式（召唤 or 直接提问），重放时传入。

理由：重放只看得到投影后的首轮文本，无法自行判断来源；拼错提示词会让恢复后的会话丢失陪想姿态。备选「在首轮文本里埋来源标记让重放解析」被否——文本协议里埋机器标记脆弱且污染对话内容。临时对话不跨应用重启持久化，来源只存活在应用会话内存中，传参可行。

### D5：召唤 = 新建对话语义 + 首轮请求，复用现有状态机

召唤动作的前端流程：若存在当前对话 → 执行与「新建对话」按钮完全相同的 `newConversation()` + `endSession()`（无确认，现有测试已覆盖进行中请求的清理语义）→ 冻结选区快照（复用 `selection-ai-invocation` 的冻结机制）→ 走与直接提问共享的首轮预检门禁（配置校验、作品身份冻结）→ 发送 `SummonFirst` → 流式呈现。

实现上把 `ai-feature-direct-question.ts` 的首轮流程参数化出共享部分（预检、冻结、发送、流式），召唤与直接提问作为两种发起方式接入，不复制整条流程。

理由：替换语义与「新建对话」一致是探索轮确认的决定；共享流程避免两条首轮路径在预检、冻结、过期隔离上各自漂移。

### D6：浮动入口单动作化，`selection-entry.ts` 重新装配

保留 `selection-entry.ts` 的出现/消失时机、视口定位避让、防重复逻辑；移除两选项菜单，按钮点击即召唤。对应测试更新为单动作断言。装配点恢复：`ai-feature.ts` 重新接入 selection-entry，`onRetry` 恢复真实重试语义（当前是空操作）。

思维扩展清理：删除 `index.html:140-149` DOM、面板视图模型与状态机中的思维扩展死代码、相关测试。

理由：菜单只有一个选项时是多余的交互层；正式功能身份由规格与命名承载，不由菜单承载。

## Risks / Trade-offs

- [重放来源传错导致恢复会话姿态丢失] → 来源参数在传输层与命令层都有类型约束；测试覆盖「召唤发起 → 驱动崩溃 → 重放后追问仍锚定选区材料」。
- [提示词合并轻微改变模型行为] → 红线条款逐字保留；入口层语义与原两块碑文等价改写；真机验收对比召唤与直接提问的回应立场。
- [删除 `ai-feature-first-request.ts` 牵连预检语义测试] → 先确认其预检门禁语义已被 `ai-feature-direct-question.ts` 覆盖，再删；删除与共享流程提取在同一批任务中完成，避免中间态失守。
- [召唤进行中用户再次选中文字点按钮] → 替换语义天然覆盖（等同连续两次新建对话）；测试覆盖「流式进行中再次召唤」。
- [浮动按钮在窄视口/极端选区位置的回归] → 定位避让逻辑不动，只动菜单层；现有 33 测试中定位相关断言保持通过。

## Migration Plan

单应用内变更，无数据迁移（临时对话不持久化）。顺序：后端协议与提示词结构先行（含重放来源参数）→ 前端传输层接入 `SummonFirst` → 共享首轮流程提取 → 浮动入口装配 → 死代码删除 → 文档与规格修正。回滚即整体 revert，无持久状态残留。

## Open Questions

无——探索轮已逐项与用户对齐（通道、替换语义、提示词结构、入口形态、思维扩展退场、出范围项）。
