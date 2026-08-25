# ai-panel-state-structure Specification

## Purpose
Document the internal AI panel state boundaries that keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only views, and subscriber notifications separated while preserving the current selection summon and single linear temporary follow-up behavior.
## Requirements
### Requirement: AI panel state responsibilities remain separated
The AI panel state implementation SHALL keep panel visibility, request status, temporary conversation state, follow-up turn state, read-only view construction, and subscriber notification as separable responsibilities while preserving the existing public AI panel behavior.

#### Scenario: Existing callers keep using the facade
- **WHEN** feature orchestration, panel rendering, or scroll logic needs AI panel state
- **THEN** the system SHALL expose a stable facade that preserves the current AI panel state behavior without requiring callers to coordinate internal state modules directly

#### Scenario: State transitions preserve notification behavior
- **WHEN** a public AI panel state operation changes state successfully
- **THEN** the system SHALL notify subscribers once with a read-only view that reflects the completed transition

#### Scenario: Invalid state operations remain inert
- **WHEN** a public AI panel state operation is rejected because the current state does not allow it
- **THEN** the system SHALL preserve existing state and avoid emitting a subscriber notification

### Requirement: Temporary conversation state preserves current AI boundaries
The temporary conversation state SHALL preserve the current single in-memory linear conversation model anchored to one frozen selection snapshot, with one first assistant response, ordered successful follow-up turns, and at most one pending follow-up turn.

#### Scenario: Follow-up requests use the frozen anchor
- **WHEN** the user submits or retries a follow-up question after the first AI response succeeds
- **THEN** the generated follow-up request SHALL use the original frozen selected text and the existing successful conversation turns, not the editor's current selection or notebook text

#### Scenario: New invocation replaces the prior conversation
- **WHEN** a new summon request is accepted
- **THEN** the system SHALL establish a new temporary conversation identity and prevent later results from the replaced conversation from modifying the current conversation

#### Scenario: Reset clears temporary AI state
- **WHEN** the current project is unloaded or replaced
- **THEN** the system SHALL close the panel, return the request state to idle, and remove the current temporary conversation from memory

### Requirement: Refactor introduces no new AI product capability
The state split SHALL NOT add AI panel behavior beyond the currently implemented selection summon and single linear temporary follow-up flow.

#### Scenario: No new context source is added
- **WHEN** the AI panel state is refactored
- **THEN** the system SHALL NOT add nearby text, full-document text, summaries, persisted history, multiple conversations, or user-confirmed project information to AI requests

#### Scenario: No notebook write path is added
- **WHEN** AI output or follow-up content is displayed in the panel
- **THEN** the system SHALL NOT provide an insert, replace, apply, organize, save, or other direct write path into the draft notebook or main notebook

#### Scenario: Request semantics remain unchanged
- **WHEN** first summon and follow-up requests are generated after the refactor
- **THEN** the system SHALL preserve the existing request semantics, including non-streaming generation and use of the single saved LLM configuration

### Requirement: 订阅可退订
AI 面板状态 SHALL 在注册订阅时返回退订函数，调用退订函数后该监听器不再被通知，以便窗口重建、多实例或销毁时释放监听。

#### Scenario: 退订后不再通知
- **WHEN** 调用者调用 `subscribe` 返回的退订函数
- **THEN** 后续状态变化不再通知该监听器

### Requirement: AI 面板状态迁移显式化
AI 面板状态 SHALL 通过显式的 `(state, event) -> state` 纯函数（reducer）执行状态迁移，非法迁移作为结构可见（返回原状态、不通知订阅者），而不是散落在命令式方法中的隐式布尔分支。`AiPanelState` 保持为对外 facade，公开 API 与可观察行为不变。

#### Scenario: 状态迁移经纯函数执行
- **WHEN** 任何公开状态操作改变 AI 面板状态
- **THEN** 新状态由纯 reducer 计算得出
- **AND** reducer 无副作用且不通知订阅者

#### Scenario: 非法迁移不通知
- **WHEN** 公开状态操作被当前状态拒绝
- **THEN** reducer 返回原状态
- **AND** facade 不通知订阅者

### Requirement: 面板状态支持直接提问草稿与待附带选区
`AiPanelState` SHALL 继续作为唯一面板事实源，并保存直接提问草稿、当前待附带选区及其发送状态。

#### Scenario: 状态变化通知完整视图
- **WHEN** 直接提问草稿或待附带选区发生有效变化
- **THEN** 面板通过既有订阅机制通知一次，并提供反映完成变化的只读视图

#### Scenario: 发送后材料保持稳定
- **WHEN** 直接提问请求已经提交
- **THEN** 已发送问题和选区不再被后续编辑器选区变化修改

### Requirement: 统一临时对话保存完整轮次
面板状态 SHALL 保存统一的不限轮临时对话：首轮冻结选区锚点、首轮回应与后续完整问答轮次，作为唯一对话事实源。

#### Scenario: 三个首轮入口共享同一对话
- **WHEN** 直接提问、AI 及时召唤或思维扩展首轮成功
- **THEN** 面板进入同一临时对话结构，后续追问复用该对话

#### Scenario: 每轮请求携带完整问答
- **WHEN** 统一对话中提交新一轮问题
- **THEN** 请求载荷包含首轮冻结选区与此前全部问答轮次

#### Scenario: 收起面板保留对话
- **WHEN** 用户收起并重新展开面板
- **THEN** 对话完整轮次与未发送输入保持不变

#### Scenario: 作品或文档切换清空对话
- **WHEN** 作品或当前文档切换
- **THEN** 面板清空统一对话、待附带选区与未发送输入

