# ai-panel-state-structure 变更增量

## MODIFIED Requirements

### Requirement: Discussion state preserves current AI boundaries
The discussion state SHALL preserve multiple discussions within a project while open discussions SHALL be displayed in their own windows, and multiple discussion windows MAY be open at once. A new first-round request SHALL start a new discussion and open its window without replacing prior discussions, which remain archived and reopenable. Stale results SHALL be rejected by discussion identity. Each open discussion SHALL keep the full display history for rendering and crash-recovery replay, while each request payload SHALL only carry the incremental new content. When the project is unloaded, the in-memory discussion and window view SHALL be cleared while the on-disk discussion archives remain.

#### Scenario: Follow-up requests send only the increment
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL only carry the new question content, not the prior conversation turns
- **AND** the conversation display history SHALL remain the source for rendering and crash-recovery replay, not for request payloads

#### Scenario: New invocation starts a new discussion without replacing prior ones
- **WHEN** a new first-round request is accepted
- **THEN** the system SHALL establish a new discussion identity, open its window, and display the new discussion
- **AND** prior discussions SHALL remain archived and reopenable, and their open windows SHALL remain open

#### Scenario: User-created new discussion rejects stale results
- **WHEN** the user starts a new discussion while a first or follow-up request is pending in the prior discussion
- **THEN** the system SHALL prevent the pending request's later result from modifying the new discussion

#### Scenario: Project unload clears in-memory view but retains archives
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close all discussion windows, return the request state to idle, and remove the current project's discussion set from the in-memory view
- **AND** the on-disk discussion archives SHALL remain in the project folder

### Requirement: 当前讨论保存完整轮次
面板状态 SHALL 保存窗口结构（打开的讨论、停靠或浮动、聚焦窗口）与讨论集合的轻量视图（当前作品内各讨论的身份、标题、时间与终态），并 SHALL 保存每个打开讨论的完整显示轮次（首轮冻结材料、首轮回应与后续问答轮次），作为显示与崩溃恢复重放的运行期事实源；窗口位置与尺寸 MUST NOT 进入讨论档案；每轮请求载荷只携带增量内容，显示历史不作为请求载荷重发。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 面板进入当前讨论结构，后续追问复用该讨论

#### Scenario: 每轮请求只携带增量
- **WHEN** 当前讨论中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次
- **AND** 面板显示历史仍完整保留全部轮次

#### Scenario: 收起停靠区保留对话
- **WHEN** 用户收起并重新展开停靠区
- **THEN** 窗口结构、讨论完整轮次与未发送输入保持不变

#### Scenario: 切换作品加载新列表，切换文档不清空讨论
- **WHEN** 作品或当前文档切换
- **THEN** 切换作品时关闭旧作品窗口、清空当前视图并加载新作品的讨论列表
- **AND** 切换文档时不清空讨论、不改变讨论绑定、不关闭窗口

### Requirement: 面板状态支持直接提问草稿与待附带选区
`AiPanelState` SHALL 继续作为唯一面板事实源，并保存每个讨论窗口的直接提问草稿、当前待附带选区及其发送状态。

#### Scenario: 状态变化通知完整视图
- **WHEN** 任一窗口的直接提问草稿或待附带选区发生有效变化
- **THEN** 面板通过既有订阅机制通知一次，并提供反映完成变化的只读视图

#### Scenario: 发送后材料保持稳定
- **WHEN** 直接提问请求已经提交
- **THEN** 已发送问题和选区不再被后续编辑器选区变化修改
