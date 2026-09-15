# ci-pipeline delta

## MODIFIED Requirements

### Requirement: Dependabot 更新策略

Dependabot SHALL 以默认周度频率巡逻 npm 与 cargo 依赖，SHALL 递送全部版本层级（含 semver-major 大版本）的更新 PR；机器人 MUST NOT 自动合并任何更新 PR，采纳、关闭或忽略均由用户决定。

#### Scenario: 周度巡逻递单

- **WHEN** Dependabot 周度巡逻发现任意生态存在可用更新（补丁、小版本或大版本）
- **THEN** 对应更新 PR 被创建，不受版本层级过滤

#### Scenario: 大版本更新照常递单

- **WHEN** 某依赖发布新的 major 版本且 Dependabot 巡逻发现
- **THEN** Dependabot 照常创建对应 PR，由用户决定后续处理

#### Scenario: 机器人不自动合并

- **WHEN** 任一 Dependabot 更新 PR 的检查通过
- **THEN** PR 保持打开等待用户处理，Dependabot 不得自行合并
