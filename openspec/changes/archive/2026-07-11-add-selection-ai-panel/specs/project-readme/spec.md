## MODIFIED Requirements

### Requirement: README distinguishes implemented truth, future direction, and permanent boundaries
项目 README MUST 只将正式规格确认的产品能力描述为已实现，MUST 将未来方向标记为未实现，并 MUST 将永久 AI 边界与普通未实现项目分开说明。

#### Scenario: README lists implemented capabilities
- **WHEN** README 声明当前已实现的产品能力
- **THEN** 每项声明都有当前正式规格中的要求作为依据
- **AND** 在本 change 归档后，README 可以将“只使用选区原文的 AI 最小实验闭环”写为已实现
- **AND** README 不得把附近文本、整本摘要、AI 内容库、多轮对话、会话历史、持久化、流式输出、停止生成、多 provider 或多模型支持写成已实现
- **AND** README MUST NOT 把该最小实验闭环宣称为已经完成带上下文的完整第一版 AI 闭环

#### Scenario: README refers to future direction
- **WHEN** README 提及尚未归档进正式规格的产品方向
- **THEN** README 将该内容明确标记为未来方向或当前未实现
- **AND** README 不把方向文档当作已实现事实来源

#### Scenario: README states the permanent AI notebook boundary
- **WHEN** README 说明 AI 与草稿本、正文本的关系
- **THEN** README 明确说明 AI 永远不能直接写入、插入、替换、改写、删除或移动草稿本和正文本内容
- **AND** README 说明 AI 输出只属于临时材料
- **AND** README 说明内容只有经过用户亲手复制、粘贴、编辑并保存后才进入作品事实
