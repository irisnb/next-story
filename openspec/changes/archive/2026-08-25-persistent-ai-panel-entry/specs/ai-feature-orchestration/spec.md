## ADDED Requirements

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