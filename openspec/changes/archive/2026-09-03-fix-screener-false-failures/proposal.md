## Why

长上下文幻觉测试第一轮（coherent-10k 档）暴露：评分器把 3 个**正确回答**误判为 `FAIL_LIKELY`。根因不是模型幻觉，而是评分器两类系统性缺陷：否定词表只认「没有/不是/未」、不认「辞去/离开/放弃」等脱离旧状态的语义否定；以及 `mustNegate`/`wrongConclusions` 用裸实体词（如「盐城」「母亲」）当命题，导致正确回答里为解释而提及该实体时被误判为「断言了旧事实/错误结论」。这两类缺陷遍布全部长上下文查询，必须泛化修复而非逐个案例打补丁。

## What Changes

- 扩展否定词表：新增「辞去、辞职、离职、辞退、离开、放弃、停止、不再、退出、卸任、终止、中断」等表达「脱离/停止旧状态」的语义否定词，使「辞去了盐镇中学的工作」这类明确否定被正确识别。
- 修正评分器的 FAIL 判定：`mustNegate` 和 `wrongConclusions` 的「被断言」判定，从「存在一次未否定、未引用的出现」收紧为「存在未否定的断言出现，且该短语没有任何否定（含引用内否定）出现」——即混合信号（既否定又断言）时保守落到 `NEEDS_REVIEW` 而非 `FAIL_LIKELY`。
- 修正引用判定的保守性：`wrongConclusions` 的「以引用形式出现」复核理由，改为只对「有引用且无否定」的短语触发，使「正确否定 + 引用原文」不再误入人工复核。
- 确立并落地数据规范：`mustNegate` 和 `wrongConclusions` 必须写**完整命题短语**（含动作/关系词，如「住在盐城」「母亲留给她的」），禁止写裸实体词（如「盐城」「母亲」）；修正全部长上下文查询中违反此规范的裸词。
- 补充回归测试，覆盖语义否定、混合信号、裸词改命题三类场景。

## Capabilities

### Modified Capabilities

- `answer-reliability-testing`: 保守自动初筛的否定识别与 FAIL 判定规则收紧，明确 `mustNegate`/`wrongConclusions` 必须写完整命题短语的边界约定。

## Impact

- `sidecar/reliability/screening.mjs`: 否定词表、FAIL 判定、引用判定逻辑。
- `sidecar/reliability/long-context/story-specs.mjs` 及重新生成的 `oracle/*.json`: 裸词改完整命题。
- `sidecar/reliability/tests/screening.test.mjs`、`long-context.test.mjs`: 回归测试。
- 不修改生产 driver、不修改长上下文材料正文、不修改评分器四态定义。
