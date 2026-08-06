# Selection Entry Internal Boundaries

本 change 不改变 `selection-ai-invocation` 的产品需求。以下契约仅用于验收内部重构，并不新增用户可见能力。

## ADDED Requirements

### Requirement: 选区入口内部控制层使用单一按钮决策来源
选区入口的 DOM 控制层 SHALL 使用现有纯按钮决策结果决定开启动作的创建、显示和可用状态，MUST NOT 在 DOM 控制层复制同一按钮组合规则。

#### Scenario: 按钮组合规则发生变化
- **WHEN** 纯按钮决策结果只包含“及时召唤”或只包含“思维扩展”
- **THEN** DOM 控制层只呈现决策结果允许的动作
- **AND** DOM 控制层不依靠另一份独立组合判断覆盖该结果

### Requirement: 选区入口保持稳定的外部适配边界
选区入口 SHALL 保持 `setupSelectionEntry(options)` 的外部参数、返回控制器和既有生命周期行为不变；内部职责拆分 MUST NOT 要求 `src/ai-feature.ts` 改变接入协议。

#### Scenario: 编辑器接入入口
- **WHEN** `src/ai-feature.ts` 通过现有 options 调用 `setupSelectionEntry()`
- **THEN** 入口仍返回可执行 `reset()` 的 `SelectionEntryController`
- **AND** 现有入口显示、动作回调和项目切换清理行为保持不变

### Requirement: 选区入口行为保持不变
内部边界整理后，系统 SHALL 继续要求有效选区、在开启动作点击时冻结选区、请求进行中阻止重复操作，并保持现有定位、菜单锚点稳定、上下文失效隐藏和 reset 清理行为。

#### Scenario: 点击开启动作时冻结选区
- **WHEN** 用户在有效选区上选择“及时召唤”或“思维扩展”
- **THEN** 系统使用点击时的选区快照触发既有回调
- **AND** 后续编辑器变化不得替换已冻结的快照

#### Scenario: 请求进行中阻止重复操作
- **WHEN** 当前 AI 请求正在进行且入口动作被触发
- **THEN** 系统不发起第二个入口请求
- **AND** 入口仍遵循现有的动作可见性和阻止反馈规则

#### Scenario: 重置入口控制器
- **WHEN** 当前作品、本子或编辑器生命周期触发入口 `reset()`
- **THEN** 系统清理入口和菜单状态
- **AND** 旧入口不得代表新的选区上下文
