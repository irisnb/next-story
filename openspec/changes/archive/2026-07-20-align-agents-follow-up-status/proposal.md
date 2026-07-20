## Why

协作宪法 `AGENTS.md` 仍写「当前没有……继续追问、多轮对话」，但 `openspec/specs/summon-ai-follow-up` 与实现、README 已确认：首次召唤成功后存在**单条线性临时追问**。新进助手若只读 AGENTS，会按错误现状设计下一刀，和真相源冲突。现在修，成本极低，且避免后续 change 建在过期前提上。

## What Changes

- 修正 `AGENTS.md`「项目是什么」中「当前已实现」段落：写明选区召唤 + 首次回应后的线性临时追问；明确仍无初始问题输入、历史、持久化、附近上下文、摘要、完整作品认知、AI 内容库、用户确认的作品信息。
- 必要时同步 `AGENTS.md`「第一版边界」中核心闭环表述，使与已实现追问一致（仍不扩大范围、不承诺未来架构）。
- **不改**应用代码、不改 AI 行为、不改产品铁律正文（零写回、判断权、临时材料等保持原样）。
- **不改** `summon-ai-follow-up` 行为规格（能力已归档）；仅修正协作文档与治理要求中关于「当前状态表述须诚实」的约束。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `project-mission-governance`：补充要求——`AGENTS.md` 对「当前已实现 AI 能力」的摘要 MUST 与 `openspec/specs/` 已实现真相一致，MUST NOT 否认已归档能力（例如临时线性追问），也 MUST NOT 把未实现项写成已实现。

## Impact

- **文档**：`AGENTS.md`（协作入口，影响所有 AI/人类参与者）。
- **规格**：`openspec/specs/project-mission-governance` 增加状态诚实要求的 delta。
- **代码 / API / 运行时**：无。
- **用户可见产品行为**：无变化。
