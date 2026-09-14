## MODIFIED Requirements

### Requirement: AI feature orchestration keeps zero write-back capability
The decomposed AI feature orchestration MUST NOT receive, create, or expose any callback, command, state transition, or UI action that inserts, appends, replaces, rewrites, deletes, moves, organizes, or saves draft notebook or main notebook text using AI output. The controlled story-material assembly added for regular discussions (focus-document field material, allowed directory projection, and cross-document literal retrieval) SHALL be read-only and MUST NOT expand this zero write-back boundary.

#### Scenario: Decomposed modules do not receive notebook write functions
- **WHEN** AI feature orchestration is composed for the editor
- **THEN** the modules responsible for AI requests, panel state, follow-up handling, and thinking expansion do not receive draft notebook or main notebook write callbacks
- **AND** AI output remains display-only temporary panel material

#### Scenario: Configuration preflight does not broaden AI context
- **WHEN** the decomposed orchestration checks whether LLM configuration exists before a first request or follow-up request
- **THEN** it does not add nearby text, full notebook text, summaries, project metadata, AI content library material, persistent history, or user-confirmed story information to the model request
- **AND** only the separate controlled story-material assembly step may add the allowed focus-document field material, directory projection, and retrieval candidates for regular discussions

#### Scenario: 常规取材不扩展写回能力
- **WHEN** 常规讨论的请求组装加入关注文档现场材料、目录投影与跨文档字面检索
- **THEN** 该组装只产生只读材料
- **AND** 不向任何模块注入作品写入回调、命令或状态迁移

### Requirement: 直接提问编排当前讨论增量请求
AI feature orchestration SHALL 让直接提问首轮成功后进入当前讨论，每轮请求只携带增量内容，并保持每讨论单请求锁与失败恢复语义。常规直接提问首轮和追问 SHALL 附带该讨论发送时刻冻结的关注文档现场材料、允许目录投影与跨文档字面检索候选片段；及时召唤 MUST NOT 经过该常规取材流程。首轮预检 SHALL 按讨论进行，不同讨论的首轮请求 SHALL 可以并发发起；请求 SHALL 经调度器按全局同时生成上限发起或排队；停止生成 SHALL 只影响对应讨论的当前请求。

#### Scenario: 直接提问首轮成功后进入统一对话
- **WHEN** 直接提问首轮成功
- **THEN** 后续追问复用当前讨论身份与会话

#### Scenario: 每轮请求只携带增量
- **WHEN** 当前讨论中提交新一轮问题
- **THEN** 请求载荷只包含本次问题，不重发此前问答轮次

#### Scenario: 同一时刻只允许一轮请求
- **WHEN** 某讨论内一轮请求正在进行
- **THEN** 该讨论内新的首轮或追问请求被拒绝，不并发发起
- **AND** 不同讨论的请求互不等待、互不阻塞

#### Scenario: 不同讨论首轮可并发发起
- **WHEN** 讨论 A 的首轮预检或请求正在进行
- **AND** 用户在讨论 B 发起首轮请求
- **THEN** 讨论 B 的预检与请求正常进行，不因作品级门禁被拒绝
- **AND** 讨论 A 不受影响

#### Scenario: 达到上限时按调度排队
- **WHEN** 全局同时生成数已达上限且用户发起请求
- **THEN** 请求进入排队并在对应讨论窗口显示排队状态
- **AND** 名额释放后按先到先服务开始

#### Scenario: 失败保留追问供重试
- **WHEN** 当前讨论中一轮请求失败
- **THEN** 失败问题保留，用户可原样重试或修改后重发

#### Scenario: 常规首轮附带冻结现场材料
- **WHEN** 用户提交常规直接提问
- **THEN** 本轮请求附带该讨论发送时刻冻结的关注文档现场材料、允许目录投影与跨文档字面检索候选片段

#### Scenario: 常规追问附带本轮材料
- **WHEN** 用户在常规讨论中提交追问
- **THEN** 本轮请求附带当前关注文档的发送时刻材料
- **AND** 不重发此前轮次的材料或问答历史

#### Scenario: 及时召唤不经过常规取材
- **WHEN** 用户发起及时召唤
- **THEN** 请求按冻结选区快车道发起
- **AND** 请求不包含常规现场材料、目录投影或跨文档检索片段
