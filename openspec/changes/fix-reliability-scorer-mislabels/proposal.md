# 提案：可靠性评分器误标清零（审计修复队列 8c）

## Why

回答可靠性测试器的保守自动初筛（`screening.mjs`）对**正确答案**存在确定性误标，导致长上下文通过率失真（审计 P2-15 记录的 10k 8/12、30k 11/18、50k 14/24 中混有评分器误标，无法区分模型真实缺陷与评分器局限）。2026-09-22 探索模式实测坐实两类误标模式，且评分器自 2026-09-14 审计后零改动、132 条长上下文证据的人工复核字段全部为空、31 条历史证据标签停留在旧版评分器口径。8b 应用级验证已归档，本项是修复队列 8c；工作完全离线（rescore 不发网络请求、不重跑模型），无 API 费用。

**两类坐实的误标模式（当前评分器 × 当前证据）**：

- **修饰语插入致漏命中**：lc-50k-04，答案「陈渡是北境的一名**邮差**…」事实完全正确，但 `mustContain` 要求连续字面短语「陈渡是邮差」，中间插入「北境的一名」后匹配失败 → 误标 NEEDS_REVIEW。43 条 NEEDS_REVIEW 中「未明确命中预期事实」占 15 条。
- **转述否定致漏否定**：lc-10k-08，问题「苏晚还在盐镇中学教书吗」，答案「**不在**。…苏晚已经**辞去**了盐镇中学的工作…」否定与新事实齐全，但 `mustNegate` 检查要求旧事实短语以被否定形式出现在答案里，答案是转述、该短语不出现 → 误标 NEEDS_REVIEW。「未明确否定旧事实」占 19 条。

**附带发现**：lc-10k-08 的 oracle 把 `mustNegate` 写成「苏晚**还在**盐镇中学教书」，违反现行规格《命题级边界短语》「mustNegate 应省略时态助词（还在/仍然）」的既有要求——长上下文校验器 `validate.mjs` 没有时态助词检查，该要求在 oracle 侧未生效。

## What Changes

- **评分器命中逻辑修复**（保守立场不变）：
  - `mustContain` 支持成分间有界间隙的命中（「陈渡是…邮差」类修饰语插入可命中，间隙与否定检查维持保守约束）；
  - `mustNegate` 支持等价否定形式：oracle 可为旧事实声明转述等价短语（如「辞去了盐镇中学的工作」），等价短语以直接否定或离开动词出现即满足否定边界。
- **oracle 边界短语审计与修正**：按人工裁决结果修正长上下文 oracle 中不可命中的边界短语（去时态助词、改为可命中的命题形式、补等价否定形式声明）。
- **校验器补漏**：`long-context/validate.mjs` 增加时态助词检查（还在/仍然等），使规格既有要求在 oracle 侧真正生效。
- **43 条 NEEDS_REVIEW 人工裁决**：`human_review` 落 `MODEL_OK` / `MODEL_ERROR` / `SCORER_ERROR` / `UNRESOLVED` 并附裁决理由，产出「模型缺陷 vs 评分器误标」真相表。
- **证据清账**：`rescore.mjs` 增加写回模式——31 条旧评分器标签按当前评分器刷新，裁决结果写入证据，manifest 计数同步重算；原自动结果保留为历史，不覆盖。
- **防回归与文档**：screening 测试补两类误标实锤场景；`docs/answer-reliability-tester.md` 同步新命中语义。

## Capabilities

### New Capabilities

（无——全部落在既有能力上）

### Modified Capabilities

- `answer-reliability-testing`：
  - 「保守自动初筛」要求扩展：`mustContain` 的有界间隙命中语义、`mustNegate` 的等价否定形式判定；
  - 「命题级边界短语」要求扩展：时态助词省略规则由校验器在长上下文 oracle 上强制执行；
  - 新增「证据重评与裁决完整性」要求：证据可用当前评分器离线重评并写回（保留历史）、NEEDS_REVIEW 终态须有人工裁决或显式记录的保守残留。

## Impact

- **代码**：`sidecar/reliability/screening.mjs`、`rescore.mjs`、`long-context/validate.mjs`、`long-context/oracle/*.json`、`evidence/**`（写回）。
- **测试**：`sidecar/reliability/tests/`（screening / rescore / long-context 各补场景）。
- **文档**：`docs/answer-reliability-tester.md`。
- **不动**：生产 driver、Rust 后端、前端、DSH 协议、核心 fixtures 案例语义；全程离线，不重跑模型、不发 API 请求。
- **验收口径**：「误标清零」＝人工裁决后，评分器能力所及的误标（SCORER_ERROR 类）全部消除；保守设计残留（如引用内错误结论、同义改写）不算误标，但须逐条显式记录。
