# 设计：恢复 Dependabot 默认更新策略

## Context

上一 change（`2026-09-15-fix-ci-timezone-and-dependabot-hygiene`）基于「单人开发、版本钉死、大版本噪音」的判断调教了 Dependabot。用户征询朋友后推翻该判断：更新通知是重要知情信息，且 CI 绿灯后 PR 不再产生失败邮件，原噪音前提已弱化。

## Goals / Non-Goals

**Goals:**

- Dependabot 行为回到默认：周度巡逻 npm 与 cargo、递送全部版本层级的更新 PR。
- `ci-pipeline` 规格与实际配置一致（规格是真相源，不能留着与配置矛盾的旧策略）。
- 审计报告不留失真表述。

**Non-Goals:**

- 不升级任何依赖版本（PR 递回来≠合并，采纳由用户逐张决定）。
- 不动 CI 门禁、测试、格式化与资源占位等上一 change 的修复成果。
- 不改 GitHub 账号通知设置（若日后嫌邮件多，可在 GitHub 设置里单独调，与管家策略无关）。

## Decisions

1. **直接恢复 2026-08-15 的原始配置文件**（weekly + 无 ignore/groups/limit），而非在现文件上做对称删改——两者结果一致，取历史原样最不易引入笔误，git diff 也最清晰。
2. **规格修订而非删除**：「Dependabot 更新策略」Requirement 保留但改写为默认策略 + 「机器人只递单不合并」的边界（这条从旧策略继承，是永久产品立场：采纳权在用户）。
3. **补注而非改写审计报告**：上一 change 的归档记录是历史事实（当时确实改了月度策略），只在第八节插队行补一句「已于 2026-09-15 回退为默认」，两个 change 的归档各自构成完整证据链。

## Risks / Trade-offs

- [可预期] 一周内 10 张更新 PR 重新递回（含 5 张 Tiptap 2→3、1 张 reqwest 0.12→0.13）。→ 缓解：无需处理，批/关都由用户决定；CI 已绿，不产生失败邮件；本 change 提案中已向用户明示。
- [权衡] 周度巡逻的常规通知邮件回来（约每周一两封）。可接受：用户明确表示该信息有知情价值；后续嫌多可单独调 GitHub 通知设置。

## Migration Plan

1. 恢复 `.github/dependabot.yml`；本地以 YAML 语法校验自检。
2. 提交推送；CI 应双平台绿灯（纯配置/文档改动，无代码路径变化）。
3. 归档 change，同步 `ci-pipeline` 主规格，补注审计报告。

回滚：`git revert` 单提交即可。

## Open Questions

（无——策略方向已由用户确认。）
