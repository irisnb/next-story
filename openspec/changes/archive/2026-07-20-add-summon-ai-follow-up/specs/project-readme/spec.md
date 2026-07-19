## MODIFIED Requirements

### Requirement: README distinguishes implemented truth, future direction, and permanent boundaries
项目 README MUST 只将正式规格确认的产品能力描述为已实现，MUST 将未来方向标记为未实现，并 MUST 将永久 AI 边界与普通未实现项目分开说明。

#### Scenario: README lists implemented capabilities
- **WHEN** README 声明当前已实现的产品能力
- **THEN** 每项声明都有当前正式规格中的要求作为依据
- **AND** 在本 change 归档后，README 可以将“召唤 AI 首次回应后围绕原冻结选区进行线性临时追问”写为已实现
- **AND** README 说明召唤时仍没有文字或问题输入，追问只在首次回应成功后开放
- **AND** README 说明临时对话只在当前应用打开周期存在，新召唤会替换旧对话
- **AND** README 不得把附近文本、整本摘要、AI 内容库、作品信息、多个对话、历史、持久化、分支、自动摘要、流式输出、停止生成、多 provider 或多模型支持写成已实现
- **AND** README MUST NOT 把追问地基宣称为思维扩展、思考收束或完整未来 AI 架构已经完成

#### Scenario: README refers to future direction
- **WHEN** README 提及尚未归档进正式规格的产品方向
- **THEN** README 将该内容明确标记为未来方向或当前未实现
- **AND** README 不把方向文档当作已实现事实来源

#### Scenario: README states the permanent AI notebook boundary
- **WHEN** README 说明 AI 与草稿本、正文本的关系
- **THEN** README 明确说明首次回应、用户追问和后续 AI 回应都只属于两个本子之外的临时材料
- **AND** README 明确说明 AI 永远不能插入、追加、替换、改写、删除、移动或整理草稿本和正文本内容
- **AND** README 说明内容只有经过用户亲手复制、粘贴、编辑并保存后才进入作品事实
