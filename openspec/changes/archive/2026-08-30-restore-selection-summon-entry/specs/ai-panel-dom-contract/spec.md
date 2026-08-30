# ai-panel-dom-contract 规格增量

## MODIFIED Requirements

### Requirement: DOM 契约包含统一对话与追问节点
现有 `AiPanelDom` 契约 SHALL 同时提供统一临时对话线程与追问输入所需节点，供直接提问与及时召唤两个首轮入口共同使用。

#### Scenario: 统一对话渲染接线
- **WHEN** 直接提问或及时召唤首轮成功后进入统一对话
- **THEN** `AiPanelDom` 提供对话线程与追问输入节点并完成渲染

#### Scenario: 追问操作调用现有 action
- **WHEN** 用户在统一对话中提交、重试或编辑追问
- **THEN** DOM 适配器通过统一的 `AiPanelActions` 触发状态操作
