# ai-panel-state-structure 变更增量

## RENAMED Requirements

- FROM: `### Requirement: Temporary conversation state preserves current AI boundaries`
- TO: `### Requirement: Discussion state preserves current AI boundaries`

- FROM: `### Requirement: 统一临时对话保存完整轮次`
- TO: `### Requirement: 当前讨论保存完整轮次`

## MODIFIED Requirements

### Requirement: AI panel state responsibilities remain separated
The AI panel state implementation SHALL keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only view construction, and subscriber notification as separable responsibilities while preserving the existing public AI panel behavior. It SHALL expose the user-initiated new-conversation transition through the facade and reducer without conflating it with project lifecycle reset.

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

### Requirement: Discussion state preserves current AI boundaries
The discussion state SHALL preserve multiple discussions within a project while the panel SHALL display one current discussion at a time. A new first-round request SHALL start a new discussion without replacing prior discussions, which remain archived and reopenable. Stale results SHALL be rejected by discussion identity. The current discussion state SHALL keep the full display history for rendering and crash-recovery replay, while each request payload SHALL only carry the incremental new content. When the project is unloaded, the in-memory discussion view SHALL be cleared while the on-disk discussion archives remain.

#### Scenario: Follow-up requests send only the increment
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL only carry the new question content, not the prior conversation turns
- **AND** the conversation display history SHALL remain the source for rendering and crash-recovery replay, not for request payloads

#### Scenario: New invocation starts a new discussion without replacing prior ones
- **WHEN** a new first-round request is accepted
- **THEN** the system SHALL establish a new discussion identity and display the new discussion
- **AND** prior discussions SHALL remain archived and reopenable

#### Scenario: User-created new discussion rejects stale results
- **WHEN** the user starts a new discussion while a first or follow-up request is pending in the prior discussion
- **THEN** the system SHALL prevent the pending request's later result from modifying the new discussion

#### Scenario: Project unload clears in-memory view but retains archives
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close the panel, return the request state to idle, and remove the current project's discussion set from the in-memory view
- **AND** the on-disk discussion archives SHALL remain in the project folder

### Requirement: Refactor introduces no new AI product capability
The state split SHALL NOT add AI panel behavior beyond the currently implemented direct-question flow with optional selection attachment and linear temporary follow-up.

#### Scenario: No new context source is added
- **WHEN** the AI panel state is refactored
- **THEN** the system SHALL NOT add nearby text, full-document text, summaries, or user-confirmed project information to AI requests

#### Scenario: No notebook write path is added
- **WHEN** AI output or follow-up content is displayed in the panel
- **THEN** the system SHALL NOT provide an insert, replace, apply, organize, save, or other direct write path into the draft notebook or main notebook

#### Scenario: Request semantics remain unchanged
- **WHEN** first and follow-up requests are generated after the refactor
- **THEN** the system SHALL preserve the existing request semantics, including streaming generation and use of the single saved LLM configuration

### Requirement: 当前讨论保存完整轮次
面板状态 SHALL 保存当前讨论引用与讨论集合的轻量视图（当前作品内各讨论的身份、标题、时间与终态），并 SHALL 保存当前讨论的完整显示轮次（首轮冻结材料、首轮回应与后续问答轮次），作为显示与崩溃恢复重放的运行期事实源；每轮请求载荷只携带增量内容，显示历史不作为请求载荷重发。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 面板进入当前讨论结构，后续追问复用该讨论

#### Scenario: 每轮请求只携带增量
- **WHEN** 当前讨论中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次
- **AND** 面板显示历史仍完整保留全部轮次

#### Scenario: 收起面板保留对话
- **WHEN** 用户收起并重新展开面板
- **THEN** 讨论完整轮次与未发送输入保持不变

#### Scenario: 切换作品加载新列表，切换文档不清空讨论
- **WHEN** 作品或当前文档切换
- **THEN** 切换作品时清空当前视图并加载新作品的讨论列表
- **AND** 切换文档时不清空讨论、不改变讨论绑定
