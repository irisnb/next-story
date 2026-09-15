# 恢复 Dependabot 默认更新策略（restore-dependabot-default-policy）

## Why

2026-09-15 归档的 `fix-ci-timezone-and-dependabot-hygiene` 把 Dependabot 调教为「月度巡逻、忽略大版本、分组递单、在途上限 2」。用户征询朋友意见后重新决策：依赖更新通知（包括大版本换代，如 Tiptap 3、reqwest 0.13）本身是有价值的知情信息，不应被过滤；且 CI 已恢复绿灯，PR 不再全红，通知噪音成本大幅下降。故恢复 Dependabot 默认策略。CI 修复本身（时区测试、格式化、clippy、资源占位）与本 change 无关，保持不动。

## What Changes

- **`.github/dependabot.yml` 恢复为默认策略**：npm 与 cargo 均恢复 `interval: weekly`；移除 `ignore`（大版本过滤）、`groups`（分组）、`open-pull-requests-limit`（在途上限），即回到 2026-08-15 引入时的原始配置。
- **`ci-pipeline` 规格同步修订**：「Dependabot 更新策略」要求改为：周度巡逻、递送全部版本层级（含 semver-major）的更新 PR、机器人只递单不合并，采纳与否由用户决定。删除「大版本不递单」「按组合并递单」场景，新增「大版本更新照常递单」场景。
- **审计报告同步标注**：《方向/全量地基审计-2026-09-14.md》第八节插队行补注「Dependabot 策略已于 2026-09-15 经用户决策回退为默认周度」，避免该文档成为失真源。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `ci-pipeline`：修改「Dependabot 更新策略」要求——巡逻频率月度→周度，取消「不递送 semver-major」与「按生态分组递单、在途上限」约束，改为「递送全部版本层级更新 PR，机器人不得自动合并，采纳由用户决定」。

## Impact

- **配置**：`.github/dependabot.yml`（恢复至 2026-08-15 原始内容）。
- **规格**：`openspec/specs/ci-pipeline/spec.md` 一项 Requirement 修订（archive 时同步主规格）。
- **文档**：《方向/全量地基审计-2026-09-14.md》一处补注。
- **不改**：CI workflow（`ci.yml`）、任何产品代码、测试、依赖版本本身。
- **可预期副作用**：下个巡逻周期（一周内）Dependabot 将重新递出此前关闭的 10 张更新 PR（CI 已绿，不再是红叉）；用户已知情并接受。
