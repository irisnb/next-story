# 设计：可靠性评分器误标清零

## Context

回答可靠性测试器的自动初筛是纯函数关键词判定（`screening.mjs`），四态结果中 `NEEDS_REVIEW` 是保守兜底。历次修复（`fix-negated-quotation-screening`、`fix-screener-false-failures`、`fix-screener-residual-defects`）都沿同一立场：**只用确定性字面证据判定，复杂语义一律落人工复核**。2026-09-22 实测坐实两类该立场内的确定性误标（见 proposal），同时发现：长上下文 oracle 绕过了时态助词校验、43 条 NEEDS_REVIEW 从未人工裁决、31 条证据标签是旧评分器口径（`rescore.mjs` 有意只读）。

约束：

- 一切判定保持确定性、离线、可复现；不引入模型辅助判分。
- 评分器立场不放松：宁可 NEEDS_REVIEW，不可假 PASS；修复方向是「让正确答案能被认出」，不是「让判定更宽容」。
- 证据是审计材料：写回不得销毁历史。

## Goals / Non-Goals

**Goals:**

- 两类误标模式（修饰语插入、转述否定）在评分器能力范围内可正确判定。
- 43 条 NEEDS_REVIEW 全部有人工裁决落档（`human_review`）。
- 31 条旧评分器标签刷新到当前口径，证据与 manifest 自洽（rescore 干跑 `changed=0`）。
- oracle 边界短语符合现行规格（含时态助词省略），校验器在长上下文侧强制执行。
- 「误标清零」有机器可查的验收口径（见 D5）。

**Non-Goals:**

- 不重跑任何模型、不发网络请求、不产生 API 费用。
- 不做同义改写的一般性语义匹配（评分器能力外的残留显式记录，见 D5）。
- 不动生产 driver、Rust 后端、前端、DSH 协议。
- 不改核心 fixtures 案例语义（只允许同规则的边界短语修正，如发现同类问题）。

## Decisions

### D1　`mustContain` 有界间隙命中（模式 A 修法）

**裁决**：`mustContain` 的满足判定（`hasSatisfiedOccurrence`）在连续字面匹配失败后，尝试**子序列间隙匹配**：短语按原字符顺序在答案中定位，允许段间间隙，约束全部满足才命中——

1. 间隙不得跨越子句边界（`，。；！？、：…\n`，与现行否定窗口同一套边界）；
2. 单段间隙长度 ≤ 8 字符（常量，实锤案例最大间隙 5）；
3. 间隙内出现否定/过去标记（`不 没 非 无 未 曾 原 前 已经 不再` 等扩展集）→ 该出现视为被否定，不满足；
4. 引号规则不变：段出现于引号内按现行 `mustContain` 引用规则计。

**为什么不是 oracle 侧换成短关键词**（如 `mustContain: ["邮差"]`）：丢失主语绑定，「老王是邮差」会误命中陈渡职业题。间隙匹配保留整短语的主谓宾顺序约束。

**为什么只给 `mustContain`、不给 `wrongConclusions`/`mustNegate`**：后两者驱动 `FAIL_LIKELY`，放松它们会制造误判失败——与历次修复方向相反。`mustContain` 只在 PASS 与 REVIEW 之间二选一，最坏结果是把本应复核的答案判为 PASS_LIKELY，风险有界且有人工复核层兜底。

**反例验证**：「陈渡是渔民；邮差老王常来」——间隙含子句边界 `；` → 不命中，保持 NEEDS_REVIEW（保守正确）。「陈渡是一位前邮差」——间隙含 `前` → 不命中（保守正确）。「陈渡是北境的一名邮差」——间隙「北境的一名」5 字符、无边界无标记 → 命中（修复目标）。

### D2　`mustNegate` 等价否定形式（模式 B 修法）

**裁决**：oracle 的 `factBoundary` 新增可选字段 `negationEquivalents`：以 `mustNegate` 短语为键，映射一组**转述等价短语**（如 `"苏晚在盐镇中学教书": ["辞去了盐镇中学的工作", "离开了盐镇中学"]`）。评分器判定：某 `mustNegate` 条目满足，当且仅当——

- 现行规则成立（原短语出现且被否定，且无未被引用的肯定断言）；**或**
- 任一等价短语出现且其前窗口含直接否定或离开动词（沿用现行 `NEGATION_MARKERS` 含辞去/离开/停止类）；
- 且原短语本身无未被引用、未被否定的肯定断言（转述否定但正文又肯定旧事实 → 仍不满足）。

**为什么不是识别答案开头的「不在。/没有。」**：初筛是纯函数（`expect + answer`），看不到问题文本；且「不在」的指向依赖问题语义，引入它就破了确定性字面立场。

**为什么不是语义相似度**：直接违反工具核心立场。

等价短语枚举不完怎么办：未枚举的转述仍落 NEEDS_REVIEW，人工裁决记录后按需扩充等价表——等价表只从**真实证据**生长，不预猜。

### D3　oracle 修正与校验器补漏

- lc-10k-08 类条目：`mustNegate`「苏晚还在盐镇中学教书」→「苏晚在盐镇中学教书」（去时态助词，符合现行规格），并按 D2 补等价形式。
- `validate.mjs` 新增检查：`mustNegate`/`wrongConclusions` 含时态助词（还在、仍然、依旧、已经 等）即 FAIL；`negationEquivalents` 的键必须存在于同查询的 `mustNegate`，值必须是完整命题短语（沿用裸实体/裸称谓/缺主语谓词同一套非法清单）。
- oracle 的 `expect` 修改不影响材料哈希链（`oracle.material_hash` 绑定材料不绑定查询内容），校验器其余不变量不受影响。

### D4　重评写回与裁决落档

- `rescore.mjs` 新增 `--write`（默认保持只读干跑，现行行为不变）：逐档刷新 `result.automatic`/`reasons`，原值推入 `result.automatic_history`（含时间戳）；manifest 的 `counts` 重算并记 `rescored_at`。响应正文、协议记录、原始运行信息一概不动。
- 新增小工具 `review.mjs`：`node review.mjs <runId> <caseId> <MODEL_OK|MODEL_ERROR|SCORER_ERROR|UNRESOLVED> --notes "…"`，校验后写入 `result.human_review`/`reviewer_notes`。43 条逐条落档。
- 裁判分离不变量保持：人工结论只存 `human_review`，永不覆盖自动结果。

### D5　「误标清零」验收口径

分层定义，机器可查部分进任务勾账：

1. **自洽**：全部证据（含 9 月初旧档）`rescore` 干跑 `changed=0`——证据标签与当前评分器口径一致。
2. **裁决完备**：所有 `NEEDS_REVIEW` 记录 `human_review ≠ null`。
3. **误标归零**：对裁决为 `MODEL_OK` 且原自动结果非 `PASS_LIKELY` 的记录，用修复后评分器＋修正后 oracle 重评后自动结果为 `PASS_LIKELY`；若仍非 `PASS_LIKELY`，其残留原因必须属于**显式记录的保守类别**（引用内错误结论、超出等价表的同义改写），在 change 验证记录中逐条登记——这类是设计行为，不算误标。
4. **防回归**：D1/D2 实锤场景（lc-50k-04、lc-10k-08 原文）进 screening 单测；全部离线套件复跑通过。

`SCORER_ERROR` 裁决值仍保留用于**标记历史误标**（裁决发生在修复前的证据上），最终态以 3 的重评结果为准。

### D6　文档同步

`docs/answer-reliability-tester.md` 增补：间隙命中语义、等价否定形式字段、`rescore --write` 与 `review.mjs` 用法、保守残留的登记口径。README/方向文档不涉及（工具行为不在产品叙述范围）。

## Risks / Trade-offs

- [间隙匹配假 PASS（「前邮差」类过去式遗漏标记）] → 间隙扫描用扩展否定/过去标记集＋子句边界硬约束；测试覆盖反例；残留风险有界（PASS_LIKELY 是倾向性结论，人工复核层仍在）。
- [等价否定表枚举不全，误标清不干净] → 等价表只从真实证据生长；未覆盖转述落 NEEDS_REVIEW＋裁决登记，按 D5-3 显式记录为保守残留，不假装清零。
- [写回改动证据引发审计链疑虑] → 原值全量进 `automatic_history`、manifest 记 `rescored_at`、git diff 可复核；证据「不重跑模型可读」的规格承诺不受影响。
- [oracle 修改后旧证据 reasons 与新口径混淆] → 写回统一用「当前评分器＋当前 oracle」重评，一轮到位，不留下新旧混杂状态。

## Migration Plan

纯离线工具与数据变更，无部署面。回滚＝git revert（评分器、oracle、证据、manifest 同仓）。执行顺序：先修评分器与校验器（带测试）→ 修 oracle → 裁决 43 条 → `--write` 一轮清账 → 验收四查。

## Open Questions

- 间隙上限 8 字符是否够用：现证据最大实需 5；作为常量可在实施时按全部 43 条复核微调，不构成设计风险。
