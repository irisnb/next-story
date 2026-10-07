## MODIFIED Requirements

### Requirement: 信封内容与次序固定
系统 SHALL 在会话的 system 层（信封）组装制度性提示，内容与次序 SHALL 固定为：陪想身份（中文）→ 宪法红线（含诚实材料边界与追问语义条款）→ 链路卡挂载位。宪法红线 SHALL 永居链路卡挂载位之上（次序不变式）；陪想身份 SHALL 顶替 DSH 默认部署 persona，英文默认 persona 文案 MUST NOT 出现在最终 system 层；DSH harness 标识段位于最顶且不可移除。链路卡挂载位 SHALL 承载当轮冻结的链路卡文本（change `add-making-module-core` 起接入；无启用链路或该轮未携带卡时为空）；卡文本 SHALL 由系统统一包装（含「可替换的讨论方法、非强制规则」声明），任何卡片内容 MUST NOT 置于红线之上。

#### Scenario: 会话建立即含完整信封
- **WHEN** 任一会话建立
- **THEN** system 层包含陪想身份与宪法红线，次序为身份先于红线先于卡挂载位

#### Scenario: 默认 persona 被顶替
- **WHEN** 会话的 system 层完成组装
- **THEN** 最终 system 层不含英文默认 persona 文案（"coding agent"表述不出现）
- **AND** 陪想身份文本位于红线条款之前

#### Scenario: 次序不变式为结构性保证
- **WHEN** 任一轮携带链路卡文本注入挂载位
- **THEN** 卡段落位于宪法红线之下，任何配置或卡片内容都不得置于红线之上

#### Scenario: 无卡轮次挂载位为空
- **WHEN** 未启用链路的轮次发起
- **THEN** 挂载位为空段，信封仅含陪想身份与宪法红线

### Requirement: 崩溃重放携带相同信封
宿主在崩溃恢复重建会话时 SHALL 重发与原会话逐字相同的 system_prompt（身份＋红线常量部分）；链路卡文本不经 start_session 携带，且 MUST NOT 以在重放 user 文本中拼接提示词前缀的方式补投制度性内容。重放完成与下一轮请求之间 SHALL 无模型调用；恢复后的首个轮次 SHALL 按当轮冻结的链路版本携带卡文本（冻结规则见 chain-assembly）。

#### Scenario: 重发逐字一致
- **WHEN** 驱动进程崩溃后宿主恢复并重放某讨论
- **THEN** 新会话的 start_session 携带与原会话逐字相等的 system_prompt

#### Scenario: 重放文本不再拼接前缀
- **WHEN** 崩溃恢复重放首轮 user 文本
- **THEN** 该文本不包含提示词前缀，制度性内容由 start_session 携带的 system 层提示与逐轮 chain_cards 字段提供

#### Scenario: 恢复后首轮按冻结版本携带卡
- **WHEN** 崩溃恢复重放完成且用户发出新轮次
- **THEN** 该轮 send_message 按当轮冻结的链路版本携带卡文本，重放期间无模型调用发生

### Requirement: 信纸职责划分
每轮差异内容 SHALL 保留在 user 消息层（信纸）：入口方式说明（直接提问／及时召唤的姿态差异）、工具使用的入口差异说明、用户问题、当轮材料（关注文档现场材料、目录投影、检索片段）。system 层的身份与红线 SHALL 不随入口方式与轮次变化；链路卡挂载位内容 SHALL 仅随当轮冻结的链路版本变化（见 chain-assembly），除此之外 system 层不承载轮次差异。

#### Scenario: 入口差异留在信纸
- **WHEN** 直接提问与及时召唤两种入口分别组装请求
- **THEN** 两者的入口姿态与工具使用差异体现在 user 层
- **AND** system 层的身份与红线内容完全一致

#### Scenario: 材料装配位置不变
- **WHEN** 常规轮次自动附带现场材料
- **THEN** 材料块仍组装在 user 消息层，装配行为与既有要求一致

#### Scenario: 链路卡差异在信封
- **WHEN** 前后两轮使用不同的链路版本
- **THEN** 差异仅体现在 system 层链路卡段，user 层消息结构保持既有形态
