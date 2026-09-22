# 任务：可靠性评分器误标清零

> 依赖顺序：评分器与校验器（带测试）→ oracle 修正 → 人工裁决 → 写回清账 → 验收四查。全程离线，不发网络请求。

## 1. 评分器：mustContain 有界间隙命中（design D1）

- [x] 1.1 在 `screening.mjs` 实现 `mustContain` 间隙匹配：连续匹配失败后按子序列定位，间隙不跨子句边界、单段 ≤ 8 字符、间隙含否定/过去标记（扩展集）即视为不满足；引号规则沿用
- [x] 1.2 screening 单测：正例（「陈渡是北境的一名邮差」命中「陈渡是邮差」）、反例（子句边界阻断「陈渡是渔民；邮差老王」、过去标记阻断「前邮差」「曾是邮差」、间隙超限）
- [x] 1.3 断言 `wrongConclusions` / `mustNegate` 仍为连续匹配（间隙匹配不适用于失败判定方向）

## 2. 评分器：mustNegate 等价否定形式（design D2）

- [x] 2.1 定义 `factBoundary.negationEquivalents` 数据形状（键 = 同查询 mustNegate 条目，值 = 转述等价短语数组），`screenAnswer` 读取并纳入否定判定：等价短语出现且前置窗口含直接否定或离开动词即满足；原短语存在未被引用肯定断言则仍不满足
- [x] 2.2 screening 单测：等价满足（lc-10k-08 原文「不在。…辞去了盐镇中学的工作…」＋等价表）、原短语肯定断言压倒等价否定、无等价声明时行为不变
- [x] 2.3 用两条实锤证据（lc-50k-04、lc-10k-08 的 `response.text`）做离线重评冒烟：修正 oracle 前先确认评分器新逻辑可独立命中（lc-50k-04 无需 oracle 改动即应翻 PASS_LIKELY）

## 3. 校验器与 oracle 修正（design D3）

- [x] 3.1 `long-context/validate.mjs` 增加时态助词检查：mustNegate / wrongConclusions 含「还在、仍然、依旧、已经」即 FAIL
- [x] 3.2 `negationEquivalents` 结构校验：键必须存在于同查询 mustNegate；等价短语沿用裸实体/裸称谓/缺主语谓词非法清单
- [x] 3.3 校验器单测覆盖 3.1/3.2 两个新检查（正反例）
- [x] 3.4 逐档审计 43 条 NEEDS_REVIEW 涉及的 oracle 条目：去时态助词、改可命中的命题形式、按真实答案补 `negationEquivalents`；`node sidecar/reliability/long-context/validate.mjs` 全档通过
  - 本次完成机械部分（改 story-specs.mjs 源＋重新生成 oracle，材料哈希不变）：去助词 6 处（lc-10k-08、lc-30k-10/11、lc-50k-14、lc-coherent-08 的 mustNegate/wrongConclusions）；补等价表 10 处（lc-10k-06/08、lc-30k-11/16、lc-50k-10/14/19/20/21、lc-coherent-06/08），等价短语全部取自对应 evidence pass1/pass2 的 response.text 原文；pass2 各档 NEEDS_REVIEW 26→14，残留为同义/语序改写、对比句式与显式未知保守复核（任务 5 裁决）

## 4. 裁决与写回工具（design D4）

- [x] 4.1 `rescore.mjs` 增加 `--write` 模式（默认干跑行为不变）：刷新 `result.automatic`/`reasons`、原值推入 `result.automatic_history`（含时间戳）、manifest `counts` 重算并记 `rescored_at`；响应正文与协议记录不动
- [x] 4.2 新增 `review.mjs`：按 runId+caseId 写入 `human_review`（四态校验）与 `reviewer_notes`，不触碰自动结果
- [x] 4.3 rescore / review 单测：历史保留、manifest 重算、干跑零写入、四态校验拒绝非法值

## 5. 人工裁决 NEEDS_REVIEW（design D5-2）

- [x] 5.1 逐条裁决长上下文 8 档证据中的全部 NEEDS_REVIEW（用户参与复核）：MODEL_OK / MODEL_ERROR / SCORER_ERROR / UNRESOLVED ＋理由，经 `review.mjs` 落档
  - 2026-09-22 完成：终态 24 条 NEEDS_REVIEW 全部裁决（MODEL_ERROR 4：coh-03 ×2 超出材料可判定范围、coh-04 ×2 漏答「编辑」；MODEL_OK＋保守残留 20：①对比句式 8、②同义/语序 8、③未知标记作用域 4），另将 30 条误标平反记录批量落档 MODEL_OK，共 54 条；用户经大白话四类方案终审确认
- [x] 5.2 在 change 的 `verification/` 登记裁决真相表：误标条目、模型真实缺陷条目、保守残留条目分列
  - 见 `verification/adjudication.md`（含 oracle 修正清单、验收四查结果、改进候选三条、数字对账）

## 6. 写回清账与验收（design D5）

- [x] 6.1 `rescore --write` 一轮清账：全部证据（含 2026-09-02/03 旧档）刷新到当前评分器＋修正后 oracle 口径
- [x] 6.2 验收一（自洽）：干跑全量 `changed=0`
  - 15 档全部 `changed=0`、`case_writes=0`
- [x] 6.3 验收二（裁决完备）：所有 NEEDS_REVIEW 记录 `human_review ≠ null` 或在验证记录中登记保守残留
  - 无裁决数 = 0；`outcomes={"MODEL_OK":50,"MODEL_ERROR":4}`
- [x] 6.4 验收三（误标归零）：对裁决 MODEL_OK 且原自动结果非 PASS_LIKELY 的记录，重评后为 PASS_LIKELY，或残留原因属显式记录的保守类别（引用内错误结论、超出等价表的同义改写）
  - 20/20 残留全部带类别登记（①8 ②8 ③4），无类别漏网 0；spec delta 括注已同步扩为三类实登记类别
- [x] 6.5 验收四（防回归＋全绿）：screening / rescore / long-context / 其余可靠性套件全过；typecheck、ESLint、生产构建、`cargo check --all-targets`（确认无连带影响）
  - reliability 120 过 0 失败（基线 89→120）；长上下文校验四档全过；typecheck / 生产构建 / cargo check 全绿（docx future-incompat 为已知 8e 范围项；ESLint 全局 ignore 含 sidecar/**，不覆盖本目录，语法经 node --check）
- [x] 6.6 文档同步：`docs/answer-reliability-tester.md` 增补间隙命中语义、等价否定字段、`--write` 与 `review.mjs` 用法、保守残留登记口径；审计文档第八节 8c 行翻牌＋补记归档信息
  - 测试器文档 4 处增补；审计文档 8b 行翻「已完成并归档」、8c 行翻「实施完毕待归档」、新增补充十五
