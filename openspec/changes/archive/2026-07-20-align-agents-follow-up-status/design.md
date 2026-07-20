## Context

地基审查发现：`AGENTS.md` 第 17 行仍写「当前没有……继续追问、多轮对话」，而：

- `openspec/specs/summon-ai-follow-up` 已定义临时线性追问
- README 与实现（`ai-panel-state`、`GenerateAiRequest.follow_up` 等）已支持首次回应后的追问
- `project-mission-governance` 要求 AGENTS 提炼红线，但未明确要求「当前已实现摘要」与主规格一致

本 change 只修协作入口文档与治理要求，不触碰运行时。

## Goals / Non-Goals

**Goals:**

- 让 `AGENTS.md` 对当前 AI 能力的摘要与 `openspec/specs/` 一致
- 写清「有什么 / 没有什么」：有选区召唤 + 单条线性临时追问；无初始问题输入、历史、持久化、附近上下文等
- 在 `project-mission-governance` 增加可检验的「状态诚实」要求，防止以后再漂移

**Non-Goals:**

- 不改 AI 产品行为、Prompt、请求协议
- 不实现新功能（思维扩展、收束、多对话等）
- 不统一 `main` / `manuscript` 命名（另议）
- 不拆分 `ai-panel-state`（后续 change）
- 不重写方向宪章或第一版共识全文

## Decisions

### 1. 只改 `AGENTS.md` 的「当前状态」表述，不扩写成长规格

- **选择**：在「项目是什么」用 2–4 句替换过期段落；「第一版边界」仅在必要时补半句「含临时追问」
- **理由**：AGENTS 必须短；完整行为仍以 `summon-ai-follow-up` 等主规格为准
- **备选**：把追问细则抄进 AGENTS → 否决（会变成第二份规格，违反分层）

### 2. 用词区分「临时线性追问」与「多轮历史对话」

- **选择**：写「首次回应成功后可在当前临时对话中线性追问；对话仅存于本次应用打开周期」
- **避免**：笼统写「已有多轮对话」而不限定临时/单条/不持久化（易被读成完整聊天产品）
- **理由**：与 `summon-ai-follow-up` 的「单条线性临时对话」一致

### 3. 治理规格用 ADDED，不改写既有「AGENTS 将使命提炼为协作红线」全文

- **选择**：新增「AGENTS 当前已实现摘要须与主规格一致」要求 + 场景
- **理由**：现有要求仍有效；ADDED 在归档时更安全，避免 MODIFIED 丢细节

### 4. 实现顺序

1. 按 delta 规格改 `AGENTS.md` 文案  
2. 人工对照 `summon-ai-follow-up` / README「已实现」列表做一次一致性检查  
3. 归档时把 delta 合入 `project-mission-governance`

## Risks / Trade-offs

- **[Risk] 修文档时误扩范围** → 文案 checklist：禁止出现「历史 / 持久化 / 附近上下文已实现」
- **[Risk] 读者仍混淆临时追问与完整对话** → 明确「单条、线性、本周期、新召唤替换旧对话」
- **[Risk] 只改 AGENTS 不改治理规格，以后再漂** → 本 change 同时 ADDED 状态诚实要求
- **[Trade-off] 不在此 change 统一命名** → 命名债仍在，但与文档诚实正交，应单独讨论

## Migration Plan

1. 用户确认本 proposal / design / specs / tasks  
2. apply：编辑 `AGENTS.md`，无代码构建  
3. 对照检查后 archive  
4. 回滚：git 还原 `AGENTS.md` 与 change 目录即可

## Open Questions

- （无阻塞项）命名策略与 `ai-panel-state` 拆分不在本 change 内，用户确认文档 change 后再另开讨论/change。
