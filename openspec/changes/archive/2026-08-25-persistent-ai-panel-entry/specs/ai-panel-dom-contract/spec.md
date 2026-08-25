## ADDED Requirements

### Requirement: 现有面板 DOM 契约包含直接提问节点
现有 `AiPanelDom` 契约 SHALL 集中提供直接提问输入、提交控件、待附带选区提示及移除操作所需节点。

#### Scenario: 完整面板契约接线
- **WHEN** 应用组装包含现有 AI 面板的页面 DOM
- **THEN** `AiPanelDom` 提供直接提问所需节点并完成统一初始化

#### Scenario: 直接提问操作调用现有 action
- **WHEN** 用户提交问题或移除待附带选区
- **THEN** DOM 适配器通过统一的 `AiPanelActions` 触发状态操作

### Requirement: DOM 契约包含统一对话与追问节点
现有 `AiPanelDom` 契约 SHALL 同时提供统一临时对话线程与追问输入所需节点，供三个首轮入口共享。

#### Scenario: 统一对话渲染接线
- **WHEN** 任一首轮入口成功后进入统一对话
- **THEN** `AiPanelDom` 提供对话线程与追问输入节点并完成渲染

#### Scenario: 追问操作调用现有 action
- **WHEN** 用户在统一对话中提交、重试或编辑追问
- **THEN** DOM 适配器通过统一的 `AiPanelActions` 触发状态操作