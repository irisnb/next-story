# dsh-headless-generation 变更增量

## MODIFIED Requirements

### Requirement: DSH headless 生成与现有链等价
系统 SHALL 通过常驻 DSH 会话进程生成 AI 思考响应（本要求标题中的 headless 为历史能力名），其输入（用户问题 + 可选冻结选区重点材料）与输出语义与现有生成链一致：不代写正文、不评价故事、纯文本回答、流式输出。系统 MUST 要求模型区分"从提供材料中可见的内容"与"进一步提出的可能解释、问题或方向"，不把假设冒充作品事实。Runtime Contract MUST 保留任务、事件、结果、错误和能力声明的扩展位。

#### Scenario: 首问生成等价
- **WHEN** 传入一个合法的首问请求（非空问题，可选选区材料）
- **THEN** 常驻会话路径流式返回非空 assistant 文本，内容只基于问题与选区材料，不代写正文、不判断故事好坏

#### Scenario: 追问生成等价
- **WHEN** 在已建立的会话中传入追问
- **THEN** 会话在既有上下文基础上流式返回非空 assistant 文本

#### Scenario: 生成保持陪想姿态
- **WHEN** 系统组装任一轮生成请求
- **THEN** 请求要求模型区分材料可见信息与可能解释，不代写、不润色、不提供可直接替换正文的改写文本，不替用户评价或决定故事方向

## REMOVED Requirements

### Requirement: 统一对话每轮携带完整问答
**Reason**: 常驻会话在进程内维护对话历史，前端改为每轮增量发送；"每轮携带完整问答"是"用完即焚"进程模型的配套要求，随该模型一并退场。
**Migration**: 增量发送、会话历史维护与超限压缩见 `resident-ai-session` 能力规格。
