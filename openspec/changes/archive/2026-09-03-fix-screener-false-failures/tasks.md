## 1. 评分器否定词表扩展

- [x] 1.1 在 `screening.mjs` 的否定词表新增「辞去、辞职、离职、辞退、离开、放弃、停止、不再、退出、卸任、终止、中断」等脱离/停止旧状态的语义否定词
- [x] 1.2 新增回归测试：`辞去了盐镇中学的工作` 中的 `盐镇中学` 判定为 negated，而非 asserted

## 2. mustNegate/wrongConclusions 裸词改完整命题

- [x] 2.1 审查 `story-specs.mjs` 全部查询的 `mustNegate` 与 `wrongConclusions`，找出裸实体词
- [x] 2.2 把裸词改为完整命题短语（含动作/关系词，去掉时态助词），并重新生成 `oracle/*.json`
- [x] 2.3 新增校验：`mustNegate`/`wrongConclusions` 含裸实体词（无人名/地名/物名/职位名单独出现）时报错

## 3. 回归测试与验证

- [x] 3.1 新增回归测试：语义否定（辞去）、裸词改命题（盐城→住在盐城、母亲→母亲留给她的）三类场景
- [x] 3.2 重跑 `npm run test:reliability`，确认全部通过且无破坏已归档行为
- [x] 3.3 用修复后的评分器重新初筛 coherent-10k 证据，确认原 3 个误判不再 FAIL
- [x] 3.4 更新 `docs/answer-reliability-tester.md` 的自动初筛说明，注明语义否定与命题规范
