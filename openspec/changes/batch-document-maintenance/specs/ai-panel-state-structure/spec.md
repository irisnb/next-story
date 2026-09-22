## MODIFIED Requirements

### Requirement: AI panel state responsibilities remain separated
The AI panel state implementation SHALL keep panel visibility, request status, discussion state, follow-up turn state, read-only view construction, and subscriber notification as separable responsibilities while preserving the existing public AI panel behavior. It SHALL expose the user-initiated new-conversation transition through the facade and reducer without conflating it with project lifecycle reset.

#### Scenario: Existing callers keep using the facade
- **WHEN** feature orchestration, panel rendering, or scroll logic needs AI panel state
- **THEN** the system SHALL expose a stable facade that preserves the current AI panel state behavior without requiring callers to coordinate internal state modules directly

#### Scenario: State transitions preserve notification behavior
- **WHEN** a public AI panel state operation changes state successfully
- **THEN** the system SHALL notify subscribers once with a read-only view that reflects the completed transition

#### Scenario: Invalid state operations remain inert
- **WHEN** a public AI panel state operation is rejected because the current state does not allow it
- **THEN** the system SHALL preserve existing state and avoid emitting a subscriber notification

#### Scenario: New conversation is distinct from project reset
- **WHEN** the user triggers the new-conversation operation while the panel is in a non-empty or loading state
- **THEN** the reducer SHALL start a new discussion while keeping the panel open
- **AND** the prior discussion SHALL be preserved as an archive
- **AND** project lifecycle reset SHALL continue to close the panel

### Requirement: Refactor introduces no new AI product capability
The state split SHALL NOT add AI panel behavior beyond the currently implemented direct-question flow with optional selection attachment and linear follow-up.

#### Scenario: No new context source is added
- **WHEN** the AI panel state is refactored
- **THEN** the system SHALL NOT add nearby text, full-document text, summaries, or user-confirmed project information to AI requests

#### Scenario: No user document write path is added
- **WHEN** AI output or follow-up content is displayed in the panel
- **THEN** the system SHALL NOT provide an insert, replace, apply, organize, save, or other direct write path into user documents

#### Scenario: Request semantics remain unchanged
- **WHEN** first and follow-up requests are generated after the refactor
- **THEN** the system SHALL preserve the existing request semantics, including streaming generation and use of the single saved LLM configuration

### Requirement: 当前讨论保存完整轮次
面板状态 SHALL 保存窗口结构（打开的讨论、停靠或浮动、聚焦窗口）与讨论集合的轻量视图（当前作品内各讨论的身份、标题、时间与终态），并 SHALL 保存每个打开讨论的完整显示轮次（首轮冻结材料、首轮回应与后续问答轮次），作为显示与崩溃恢复重放的运行期事实源；窗口位置与尺寸 MUST NOT 进入讨论档案；每轮请求载荷只携带增量内容，显示历史不作为请求载荷重发。

#### Scenario: 直接提问首轮成功后进入统一讨论
- **WHEN** 直接提问首轮成功
- **THEN** 面板进入当前讨论结构，后续追问复用该讨论

#### Scenario: 每轮请求只携带增量
- **WHEN** 当前讨论中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次
- **AND** 面板显示历史仍完整保留全部轮次

#### Scenario: 收起停靠区保留讨论
- **WHEN** 用户收起并重新展开停靠区
- **THEN** 窗口结构、讨论完整轮次与未发送输入保持不变

#### Scenario: 切换作品加载新列表，切换文档不清空讨论
- **WHEN** 作品或当前文档切换
- **THEN** 切换作品时关闭旧作品窗口、清空当前视图并加载新作品的讨论列表
- **AND** 切换文档时不清空讨论、不改变讨论绑定、不关闭窗口
