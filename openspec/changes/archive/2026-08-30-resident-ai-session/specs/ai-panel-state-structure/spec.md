# ai-panel-state-structure 变更增量

## MODIFIED Requirements

### Requirement: Temporary conversation state preserves current AI boundaries
The temporary conversation state SHALL preserve the current single in-memory linear conversation model with one first assistant response, ordered successful follow-up turns, and at most one pending follow-up turn. The conversation state SHALL keep the full display history for rendering and crash-recovery replay, while each request payload SHALL only carry the incremental new content. A user-initiated new conversation SHALL discard the current model and advance the identity boundary used to reject stale results.

#### Scenario: Follow-up requests send only the increment
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL only carry the new question content, not the prior conversation turns
- **AND** the conversation display history SHALL remain the source for rendering and crash-recovery replay, not for request payloads

#### Scenario: New invocation replaces the prior conversation
- **WHEN** a new first-round request is accepted
- **THEN** the system SHALL establish a new temporary conversation identity and prevent later results from the replaced conversation from modifying the current conversation

#### Scenario: User-created new conversation rejects stale results
- **WHEN** the user clears a conversation while a first or follow-up request is pending
- **THEN** the system SHALL prevent the pending request's later result from modifying the newly cleared state

#### Scenario: Reset clears temporary AI state
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close the panel, return the request state to idle, and remove the current temporary conversation from memory

### Requirement: Refactor introduces no new AI product capability
The state split SHALL NOT add AI panel behavior beyond the currently implemented direct-question flow with optional selection attachment and linear temporary follow-up.

#### Scenario: No new context source is added
- **WHEN** the AI panel state is refactored
- **THEN** the system SHALL NOT add nearby text, full-document text, summaries, persisted history, multiple conversations, or user-confirmed project information to AI requests

#### Scenario: No notebook write path is added
- **WHEN** AI output or follow-up content is displayed in the panel
- **THEN** the system SHALL NOT provide an insert, replace, apply, organize, save, or other direct write path into the draft notebook or main notebook

#### Scenario: Request semantics remain unchanged
- **WHEN** first and follow-up requests are generated after the refactor
- **THEN** the system SHALL preserve the existing request semantics, including streaming generation and use of the single saved LLM configuration

### Requirement: 统一临时对话保存完整轮次
面板状态 SHALL 保存统一的不限轮临时对话的完整显示轮次（首轮冻结材料、首轮回应与后续问答轮次），作为显示与崩溃恢复重放的运行期事实源；每轮请求载荷只携带增量内容，显示历史不作为请求载荷重发。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 面板进入统一临时对话结构，后续追问复用该对话

#### Scenario: 每轮请求只携带增量
- **WHEN** 统一对话中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次
- **AND** 面板显示历史仍完整保留全部轮次

#### Scenario: 收起面板保留对话
- **WHEN** 用户收起并重新展开面板
- **THEN** 对话完整轮次与未发送输入保持不变

#### Scenario: 作品或文档切换清空对话
- **WHEN** 作品或当前文档切换
- **THEN** 面板清空统一对话、待附带选区与未发送输入
