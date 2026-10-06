# system-prompt-layering 增量规格（wire-system-prompt-channel）

## ADDED Requirements

### Requirement: 信封内容与次序固定
系统 SHALL 在会话的 system 层（信封）组装制度性提示，内容与次序 SHALL 固定为：陪想身份（中文）→ 宪法红线（含诚实材料边界与追问语义条款）→ 链路卡挂载位。宪法红线 SHALL 永居链路卡挂载位之上（次序不变式）；陪想身份 SHALL 顶替 DSH 默认部署 persona，英文默认 persona 文案 MUST NOT 出现在最终 system 层；DSH harness 标识段位于最顶且不可移除。链路卡挂载位在本变更中 SHALL 为空（卡内容属后续变更）。

#### Scenario: 会话建立即含完整信封
- **WHEN** 任一会话建立
- **THEN** system 层包含陪想身份与宪法红线，次序为身份先于红线先于卡挂载位

#### Scenario: 默认 persona 被顶替
- **WHEN** 会话的 system 层完成组装
- **THEN** 最终 system 层不含英文默认 persona 文案（"coding agent"表述不出现）
- **AND** 陪想身份文本位于红线条款之前

#### Scenario: 次序不变式为结构性保证
- **WHEN** 未来链路卡内容注入挂载位
- **THEN** 卡段落位于宪法红线之下，任何配置或卡片内容都不得置于红线之上

### Requirement: 制度性提示每轮在场且不依赖首轮前缀
system 层提示 SHALL 对会话内每一轮请求在场（含追问轮与框架压缩后的轮次），MUST NOT 依赖首条 user 消息前缀承载制度性内容；宪法红线与身份文本 MUST NOT 出现在任何 user 消息文本中（禁止双份投递）。

#### Scenario: 追问轮信封完整
- **WHEN** 用户在多轮讨论中提交追问
- **THEN** 该轮请求的 system 层完整包含身份与红线
- **AND** user 文本只包含增量问题与当轮材料

#### Scenario: 压缩后红线仍在场
- **WHEN** 长对话触发框架压缩后继续追问
- **THEN** 压缩后请求的 system 层仍完整包含宪法红线（红线不随对话历史被摘要丢弃）

#### Scenario: user 层无双份投递
- **WHEN** 审查任一轮的 user 消息文本
- **THEN** 不含身份句与宪法红线条款文本

### Requirement: 崩溃重放携带相同信封
宿主在崩溃恢复重建会话时 SHALL 重发与原会话逐字相同的 system_prompt；重放会话的 system 层与原会话一致，且 MUST NOT 以在重放 user 文本中拼接提示词前缀的方式补投制度性内容。

#### Scenario: 重发逐字一致
- **WHEN** 驱动进程崩溃后宿主恢复并重放某讨论
- **THEN** 新会话的 start_session 携带与原会话逐字相等的 system_prompt

#### Scenario: 重放文本不再拼接前缀
- **WHEN** 崩溃恢复重放首轮 user 文本
- **THEN** 该文本不包含提示词前缀，制度性内容由 start_session 携带的 system 层提供

### Requirement: 信纸职责划分
每轮差异内容 SHALL 保留在 user 消息层（信纸）：入口方式说明（直接提问／及时召唤的姿态差异）、工具使用的入口差异说明、用户问题、当轮材料（关注文档现场材料、目录投影、检索片段）。system 层内容 SHALL 不随入口方式与轮次变化（本变更范围内为纯常量）。

#### Scenario: 入口差异留在信纸
- **WHEN** 直接提问与及时召唤两种入口分别组装请求
- **THEN** 两者的入口姿态与工具使用差异体现在 user 层
- **AND** system 层内容完全一致

#### Scenario: 材料装配位置不变
- **WHEN** 常规轮次自动附带现场材料
- **THEN** 材料块仍组装在 user 消息层，装配行为与既有要求一致
