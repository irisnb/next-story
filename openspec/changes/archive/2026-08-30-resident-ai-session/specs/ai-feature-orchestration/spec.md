# ai-feature-orchestration 变更增量

## MODIFIED Requirements

### Requirement: AI feature orchestration remains behavior-preserving after decomposition
The system SHALL keep the editor-facing `setupAiFeature(...)` integration as the public AI feature composition entry while allowing its internal request, panel, follow-up, and project lifecycle orchestration responsibilities to be split into smaller modules. The decomposition MUST preserve the existing behavior of direct-question submission, follow-up submission, retry/edit recovery, configuration-missing handling, and stale-result isolation. The retired selection-tool entries (`AI 及时召唤`, `思维扩展`) MUST NOT be part of the composed orchestration.

#### Scenario: Direct question still starts from frozen materials
- **WHEN** the user submits a direct question with an optional selection attachment
- **THEN** the decomposed orchestration uses the frozen question and selection snapshot to start the first AI request

#### Scenario: Follow-up recovery still uses the current temporary conversation identity
- **WHEN** the user submits, retries, or edits a follow-up in the current temporary conversation
- **THEN** the decomposed orchestration uses the existing conversation identity and pending turn identity rules
- **AND** rejected follow-up request acceptance only cancels the attempted pending turn

#### Scenario: Retired selection tools are not composed
- **WHEN** the AI feature orchestration is composed for the editor
- **THEN** no floating selection entry, `及时召唤` action, or `思维扩展` action is registered

### Requirement: 面板 action 编排直接提问请求
AI feature orchestration SHALL 将直接提问问题和可选冻结选区编排为一次流式生成请求，并继续隔离迟到结果。

#### Scenario: 直接提问使用当前 LLM 配置
- **WHEN** 用户提交合法直接提问
- **THEN** 系统使用当前有效 LLM 配置发起一次流式生成

#### Scenario: 旧作品请求结果被丢弃
- **WHEN** 作品或文档切换后旧直接提问请求返回
- **THEN** 旧结果不得修改当前面板状态

## REMOVED Requirements

### Requirement: 三个首轮入口共享统一对话编排
**Reason**: 旧选区工具（`AI 及时召唤`、`思维扩展`）退场，"三个首轮入口"不复存在；"每轮请求携带完整问答"随一次性进程模型一并退场。
**Migration**: 直接提问编排统一对话增量请求由本能力新增要求承接（见下）。

## ADDED Requirements

### Requirement: 直接提问编排统一对话增量请求
AI feature orchestration SHALL 让直接提问首轮成功后进入统一临时对话，每轮请求只携带增量内容，并保持单请求锁与失败恢复语义。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 后续追问复用统一对话身份与会话

#### Scenario: 每轮请求只携带增量
- **WHEN** 统一对话中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次

#### Scenario: 同一时刻只允许一轮请求
- **WHEN** 一轮请求正在进行
- **THEN** 新的首轮或追问请求被拒绝，不并发发起

#### Scenario: 失败保留追问供重试
- **WHEN** 统一对话中一轮请求失败
- **THEN** 失败问题保留，用户可原样重试或修改后重发
