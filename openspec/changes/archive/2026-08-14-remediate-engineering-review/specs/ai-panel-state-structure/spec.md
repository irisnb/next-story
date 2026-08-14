## ADDED Requirements

### Requirement: 订阅可退订
AI 面板状态 SHALL 在注册订阅时返回退订函数，调用退订函数后该监听器不再被通知，以便窗口重建、多实例或销毁时释放监听。

#### Scenario: 退订后不再通知
- **WHEN** 调用者调用 `subscribe` 返回的退订函数
- **THEN** 后续状态变化不再通知该监听器
