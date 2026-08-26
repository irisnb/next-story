## ADDED Requirements

### Requirement: 用户可以在当前作品中开始新的临时对话

系统 SHALL 在当前存在临时对话或首轮请求时提供“新建对话”操作。用户触发后，系统 MUST 清除当前临时对话、请求显示、追问草稿和直接提问草稿，保持面板展开并回到可直接提问的空状态。

#### Scenario: 已完成对话新建对话

- **WHEN** 用户在已有首轮回应或追问记录的 AI 面板中点击“新建对话”
- **THEN** 当前对话内容和追问输入被清除
- **AND** 面板保持展开
- **AND** 直接提问输入回到空白可提交前状态

#### Scenario: 首轮请求中开始新对话

- **WHEN** 首轮请求仍在加载且用户点击“新建对话”
- **THEN** 面板回到空白直接提问状态
- **AND** 该首轮请求稍后返回的结果不显示在面板中，也不创建当前对话

#### Scenario: 追问请求中开始新对话

- **WHEN** 追问请求仍在加载且用户点击“新建对话”
- **THEN** 面板回到空白直接提问状态
- **AND** 该追问请求稍后返回的结果不修改新的空白状态

#### Scenario: 新建对话不产生历史会话

- **WHEN** 用户清除当前临时对话并开始新的提问
- **THEN** 面板只显示新的临时对话
- **AND** 面板不提供被清除对话的列表、恢复或切换入口

## MODIFIED Requirements

### Requirement: AI panel state responsibilities remain separated

The AI panel state implementation SHALL keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only view construction, and subscriber notification as separable responsibilities while preserving the existing public AI panel state behavior. It SHALL expose the user-initiated new-conversation transition through the facade and reducer without conflating it with project lifecycle reset.

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
- **THEN** the reducer SHALL clear the current temporary AI state while keeping the panel open
- **AND** project lifecycle reset SHALL continue to close the panel

### Requirement: Temporary conversation state preserves current AI boundaries

The temporary conversation state SHALL preserve the current single in-memory linear conversation model anchored to one frozen selection snapshot, with one first assistant response, ordered successful follow-up turns, and at most one pending follow-up turn. A user-initiated new conversation SHALL discard the current model and advance the identity boundary used to reject stale results.

#### Scenario: Follow-up requests use the frozen anchor

- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL use the original frozen selected text and the existing successful conversation turns, not the editor's current selection or notebook text

#### Scenario: New invocation replaces the prior conversation

- **WHEN** a new summon request is accepted
- **THEN** the system SHALL establish a new temporary conversation identity and prevent later results from the replaced conversation from modifying the current conversation

#### Scenario: User-created new conversation rejects stale results

- **WHEN** the user clears a conversation while a first or follow-up request is pending
- **THEN** the system SHALL prevent the pending request's later result from modifying the newly cleared state

#### Scenario: Reset clears temporary AI state

- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close the panel, return the request state to idle, and remove the current temporary conversation from memory

### Requirement: AI 面板必须通过显式 DOM 契约接线

系统 SHALL 为 AI 面板提供一个集中且严格类型化的 DOM 依赖契约，契约包含面板渲染、折叠、新建对话、思维扩展、错误恢复和临时追问所需的全部节点。AI 面板初始化 MUST 使用该契约，不得依赖散落的全局节点查询。

#### Scenario: 新建对话控件完成契约接线

- **WHEN** 应用从包含新建对话控件的页面组装 `AppDom`
- **THEN** `AiPanelDom` 提供该控件并完成统一初始化
- **AND** 点击控件通过面板 facade 触发新建对话状态迁移

#### Scenario: 空状态隐藏新建对话控件

- **WHEN** AI 面板处于空白直接提问状态且没有进行中的请求
- **THEN** 新建对话控件不可见或被隐藏

#### Scenario: 非空状态显示新建对话控件

- **WHEN** AI 面板存在临时对话或首轮/追问请求正在进行
- **THEN** 新建对话控件可见且可用
