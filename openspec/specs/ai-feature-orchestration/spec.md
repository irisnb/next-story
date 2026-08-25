## Purpose

规定 AI 功能编排拆分后的公开组合入口、行为保持要求，以及 AI 输出不得写回草稿本和正文本的边界。
## Requirements
### Requirement: AI feature orchestration remains behavior-preserving after decomposition
The system SHALL keep the editor-facing `setupAiFeature(...)` integration as the public AI feature composition entry while allowing its internal request, panel, thinking expansion, follow-up, and project lifecycle orchestration responsibilities to be split into smaller modules. The decomposition MUST preserve the existing behavior of AI timely summon, thinking expansion, follow-up submission, retry/edit recovery, configuration-missing handling, and stale-result isolation.

#### Scenario: Timely summon still starts from a frozen selection
- **WHEN** the user chooses `AI 及时召唤` from a valid draft notebook or main notebook selection
- **THEN** the decomposed orchestration uses the frozen selection snapshot to start the first AI request
- **AND** the request does not require or accept an initial user question

#### Scenario: Thinking expansion still preserves optional direction semantics
- **WHEN** the user starts `思维扩展` from a frozen selection with an empty or non-empty direction
- **THEN** the decomposed orchestration builds the same first-request payload shape as before decomposition
- **AND** an empty direction does not create a user direction
- **AND** a non-empty direction remains initial user material for later follow-up requests

#### Scenario: Follow-up recovery still uses the current temporary conversation identity
- **WHEN** the user submits, retries, or edits a follow-up in the current temporary conversation
- **THEN** the decomposed orchestration uses the existing conversation identity and pending turn identity rules
- **AND** rejected follow-up request acceptance only cancels the attempted pending turn

### Requirement: AI feature orchestration keeps zero write-back capability
The decomposed AI feature orchestration MUST NOT receive, create, or expose any callback, command, state transition, or UI action that inserts, appends, replaces, rewrites, deletes, moves, organizes, or saves draft notebook or main notebook text using AI output.

#### Scenario: Decomposed modules do not receive notebook write functions
- **WHEN** AI feature orchestration is composed for the editor
- **THEN** the modules responsible for AI requests, panel state, follow-up handling, and thinking expansion do not receive draft notebook or main notebook write callbacks
- **AND** AI output remains display-only temporary panel material

#### Scenario: Configuration preflight does not broaden AI context
- **WHEN** the decomposed orchestration checks whether LLM configuration exists before a first request or follow-up request
- **THEN** it does not add nearby text, full notebook text, summaries, project metadata, AI content library material, persistent history, or user-confirmed story information to the model request

### Requirement: 面板 action 编排直接提问请求
AI feature orchestration SHALL 将直接提问问题和可选冻结选区编排为一次现有生成链路请求，并继续隔离迟到结果。

#### Scenario: 直接提问使用当前 LLM 配置
- **WHEN** 用户提交合法直接提问
- **THEN** 系统使用当前有效 LLM 配置发起一次非流式生成

#### Scenario: 旧作品请求结果被丢弃
- **WHEN** 作品或文档切换后旧直接提问请求返回
- **THEN** 旧结果不得修改当前面板状态

### Requirement: 三个首轮入口共享统一对话编排
AI feature orchestration SHALL 让直接提问、AI 及时召唤、思维扩展在首轮成功后统一进入同一临时对话，并让每轮请求携带此前完整问答。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 后续追问复用统一对话身份与完整问答

#### Scenario: 每轮请求携带完整问答
- **WHEN** 统一对话中提交新一轮问题
- **THEN** 请求载荷包含首轮冻结选区与此前全部问答轮次

#### Scenario: 同一时刻只允许一轮请求
- **WHEN** 一轮请求正在进行
- **THEN** 新的首轮或追问请求被拒绝，不并发发起

#### Scenario: 失败保留追问供重试
- **WHEN** 统一对话中一轮请求失败
- **THEN** 失败问题保留，用户可原样重试或修改后重发
