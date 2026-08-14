## ADDED Requirements

### Requirement: AI 面板状态迁移显式化
AI 面板状态 SHALL 通过显式的 `(state, event) -> state` 纯函数（reducer）执行状态迁移，非法迁移作为结构可见（返回原状态、不通知订阅者），而不是散落在命令式方法中的隐式布尔分支。`AiPanelState` 保持为对外 facade，公开 API 与可观察行为不变。

#### Scenario: 状态迁移经纯函数执行
- **WHEN** 任何公开状态操作改变 AI 面板状态
- **THEN** 新状态由纯 reducer 计算得出
- **AND** reducer 无副作用且不通知订阅者

#### Scenario: 非法迁移不通知
- **WHEN** 公开状态操作被当前状态拒绝
- **THEN** reducer 返回原状态
- **AND** facade 不通知订阅者
