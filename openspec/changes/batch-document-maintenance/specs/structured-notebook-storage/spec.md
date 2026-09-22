## MODIFIED Requirements

### Requirement: 每篇文档使用带版本外层的 Tiptap JSON
系统 SHALL 将每篇文档的磁盘事实源保存为一个 JSON 对象，其 `format` MUST 为 `next-story-tiptap`，`version` MUST 为整数 `2`，`document` MUST 为符合格式版本 2 grammar 的 Tiptap 文档。外层对象 MUST 恰好包含这三个字段且不得包含额外字段。打开时系统 MUST 接受 `version` 为 `1` 或 `2` 的文档：`version` 为 `1` 的文档 MUST 按格式版本 2 grammar 校验（版本 1 是版本 2 的严格子集），正文与格式一字不改，用户下次保存时 MUST 以 `version` 为 `2` 写回。该版本只描述单篇文档格式，不得用于表示作品结构版本。

#### Scenario: 保存有效结构化文档
- **WHEN** 用户保存包含标题、粗体和列表的文档
- **THEN** 对应文件包含 `format`、`version` 和 `document` 三个必需字段
- **AND** `version` 为整数 `2`
- **AND** `document` 完整保留本轮支持的内容和格式

#### Scenario: 打开版本 1 文档并按版本 2 保存
- **WHEN** 用户打开一个 `version` 为 `1` 的合法结构化文档
- **THEN** 系统按格式版本 2 grammar 接受该文档且不改变任何可见文字与格式
- **AND** 用户保存后该文件以 `version` 为 `2` 写回

#### Scenario: 拒绝未来格式版本
- **WHEN** 任一文档的 `version` 高于 `2`
- **THEN** 系统拒绝打开并提示文档版本不受支持
- **AND** 系统不尝试降级或清空该文档

#### Scenario: HTML 不成为事实源
- **WHEN** 系统保存任一文档
- **THEN** 系统不以 HTML 字符串代替 Tiptap JSON 文档

#### Scenario: 拒绝外层额外字段
- **WHEN** 文档 JSON 除 `format`、`version` 和 `document` 外还包含其它外层字段
- **THEN** 系统拒绝该文件而不是忽略额外字段
