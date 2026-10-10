## MODIFIED Requirements

### Requirement: 面板状态支持直接提问草稿与待附带选区
`AiPanelState` SHALL 继续作为唯一面板事实源，并按讨论保存直接提问草稿、当前待附带选区及其发送状态；当前面板只投影选中的讨论，面板隐藏或讨论投影切换不清除其他讨论状态。编辑器文档切换 SHALL 清除未发送实时选区与待附带重点提示，保留按讨论草稿、在途请求和已发送冻结材料；待附带选区不得因讨论草稿保留而跨文档复用。

#### Scenario: 状态变化通知完整视图
- **WHEN** 任一讨论的直接提问草稿或待附带选区发生有效变化
- **THEN** 面板通过既有订阅机制通知一次，并提供反映完成变化的只读视图

#### Scenario: 发送后材料保持稳定
- **WHEN** 直接提问请求已经提交
- **THEN** 已发送问题和选区不再被后续编辑器选区变化修改

#### Scenario: 文档切换清除未发送选区
- **WHEN** 编辑器从文档A切换到文档B，讨论中仍有未发送的待附带选区
- **THEN** 清除该实时选区与待附带重点提示，保留讨论草稿和在途请求
- **AND** 已发送冻结材料和召唤快照不改变，不将A的未发送选区附到B的后续提问

### Requirement: Discussion state preserves current AI boundaries
The discussion state SHALL preserve multiple discussions within a project while a single panel displays only the current discussion. A new first-round request SHALL start a new discussion and select its view without replacing prior discussions, which remain archived and reopenable. Results SHALL be routed by discussion identity; invalid identities SHALL reject stale results, while valid hidden discussions SHALL continue receiving their own results. Each discussion needed for rendering or crash-recovery replay SHALL keep its full display history independently of the current view, while each request payload SHALL only carry the incremental new content. When the project is unloaded, the in-memory discussion and panel view SHALL be cleared and requests SHALL return to idle while the on-disk discussion archives remain.

#### Scenario: Follow-up requests send only the increment
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL only carry the new question content, not the prior conversation turns
- **AND** the conversation display history SHALL remain the source for rendering and crash-recovery replay, not for request payloads

#### Scenario: New invocation starts a new discussion without replacing prior ones
- **WHEN** a new first-round request is accepted
- **THEN** the system SHALL establish a new discussion identity and display it in the current panel
- **AND** prior discussions SHALL remain archived and reopenable, with their requests, queues, authorization waits and drafts preserved

#### Scenario: User-created new discussion rejects stale results
- **WHEN** the user starts a new discussion while a first or follow-up request is pending in the prior discussion
- **THEN** the system SHALL prevent the pending request's later result from modifying the new discussion
- **AND** a still-valid prior discussion SHALL receive its own result independently of the visible view

#### Scenario: Project unload clears in-memory view but retains archives
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL hide the panel, return the request state to idle, and remove the current project's discussion set from the in-memory view
- **AND** the on-disk discussion archives SHALL remain in the project folder

### Requirement: 当前讨论保存完整轮次
面板状态 SHALL 保存单面板运行期显示状态（可见性、当前讨论身份、最大化、列表展开与侧栏宽度）与讨论集合的轻量视图（当前作品内各讨论的身份、标题、时间与终态），并 SHALL 保存供显示或恢复使用的每个讨论的完整显示轮次（首轮冻结材料、首轮回应与后续问答轮次），作为显示与崩溃恢复重放的运行期事实源。所有在途讨论的业务状态 SHALL 独立保留，不依赖当前视图挂载。系统 MUST NOT 保存停靠/浮动、聚焦窗口或多窗口几何结构；面板布局 MUST NOT 进入讨论档案。每轮请求载荷只携带增量内容，显示历史不作为请求载荷重发。

#### Scenario: 直接提问首轮成功后进入统一讨论
- **WHEN** 直接提问首轮成功
- **THEN** 面板进入当前讨论结构，后续追问复用该讨论

#### Scenario: 每轮请求只携带增量
- **WHEN** 当前讨论中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次
- **AND** 面板显示历史仍完整保留全部轮次

#### Scenario: 收起面板保留讨论
- **WHEN** 用户收起并重新展开面板
- **THEN** 讨论完整轮次与未发送输入保持不变，生成、排队与授权等待继续
- **AND** 收起清除最大化与列表展开，重开显示右边栏

#### Scenario: 切换作品加载新列表，切换文档不清空讨论
- **WHEN** 作品或当前文档切换
- **THEN** 切换作品时结束旧作品会话、隐藏面板、清空当前视图并加载新作品的讨论列表
- **AND** 切换文档时不清空讨论、不改变讨论绑定、不隐藏面板

### Requirement: 作品级 AI 重置仅由作品边界触发
编辑器 SHALL 将 AI 面板的作品级生命周期（`beginProject` 语义：重置作品域状态并加载讨论列表；`endProject` 语义：结束全部会话）仅绑定到作品边界事件：作品打开（含卸载后重开）触发恰一次 `beginProject`，作品卸载触发 `endProject`。同一作品内的文档切换（含内容树操作导致的当前文档回落换绑）MUST NOT 触发作品级重置：不结束 DSH 会话、不清空讨论列表、不隐藏当前面板、不改变讨论绑定。文档切换 SHALL 更新编辑器视图与最后打开文档记忆，并清除未发送实时选区及待附带重点提示；按讨论草稿、在途请求、已发送冻结材料与召唤快照 SHALL 保留。

#### Scenario: 切换文档不触发作品级重置
- **WHEN** 用户在同一作品内从文档 A 切换到文档 B
- **THEN** 不再次执行作品级初始化（不结束 DSH 会话、不清空讨论列表、不隐藏面板、不改变讨论绑定）
- **AND** 编辑器视图切换到文档 B，最后打开文档记忆更新为 B
- **AND** 未发送实时选区与待附带重点提示清除，讨论草稿、在途请求及已发送冻结材料保持不变

#### Scenario: 打开作品恰一次初始化
- **WHEN** 用户打开作品，或卸载后重新打开同一作品
- **THEN** 恰好执行一次作品级初始化：加载该作品的讨论列表并恢复 AI 面板作品域状态

#### Scenario: 当前文档移出内容树时不重置
- **WHEN** 内容树操作导致当前文档被移出树，编辑器自动回落到另一文档
- **THEN** 按文档切换语义处理（不触发作品级重置），讨论与面板保持原状
