# structured-notebook-storage Specification

## Purpose
TBD - created by archiving change add-basic-rich-text-storage. Update Purpose after archive.
## Requirements
### Requirement: 每篇文档使用带版本外层的 Tiptap JSON
系统 SHALL 将每篇文档的磁盘事实源保存为一个 JSON 对象，其 `format` MUST 为 `next-story-tiptap`，`version` MUST 为整数 `2`，`document` MUST 为符合格式版本 2 grammar 的 Tiptap 文档。外层对象 MUST 恰好包含这三个字段且不得包含额外字段。打开时系统 MUST 接受 `version` 为 `1` 或 `2` 的文档：`version` 为 `1` 的文档 MUST 按格式版本 2 grammar 校验（版本 1 是版本 2 的严格子集），正文与格式一字不改，用户下次保存时 MUST 以 `version` 为 `2` 写回。该版本只描述单篇文档格式，不得用于表示作品的项目结构版本。

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

### Requirement: 文档 schema 只允许本轮支持的结构
格式版本 2 MUST 使用以下完整 grammar，并 MUST 拒绝未列出的字段、节点、标记、属性和嵌套：`doc` 必须且只包含 `type` 与非空 `content`，其直接子节点只能是 `paragraph`、`heading`、`bulletList` 或 `orderedList`；`paragraph` 必须且只包含 `type`，或另含一个非空 `content`，或另含一个只由 `textAlign`、`lineHeight`、`spacingBefore`、`spacingAfter`、`textIndent`、`indentLeft`、`indentRight` 中若干键组成的 `attrs`；`heading` 必须包含 `type`、`attrs`（`attrs` 必须含整数 `level` 且 `1 ≤ level ≤ 6`，可另含上述段落属性键），并可另含一个非空 `content`；段落与标题的 `content` 只能包含 `text`；`text` 必须包含不含 CR 或 LF 的非空字符串 `text`，且字符串中所有码点 MUST 为合法 Unicode 标量值（MUST NOT 包含 U+D800–U+DFFF 范围内的孤立代理项），可另含不重复且固定按 rank 升序排列的 `marks`；mark 的 rank 顺序 MUST 为 `bold`、`italic`、`underline`、`strike`、`textStyle`、`highlight`、`link`；`bold`、`italic`、`underline`、`strike` 必须且只包含 `type`；`textStyle` 必须且只包含 `type` 与可选的 `attrs`，其 `attrs` MUST 只含 `color`、`fontFamily`、`fontSize` 中的键，`color` MUST 为小写 `#rrggbb` 六位十六进制字符串，`fontFamily` MUST 为固定字族名，`fontSize` MUST 为固定档位字符串；`highlight` 必须且只包含 `type` 与 `attrs`，其 `attrs` MUST 恰好为 `{ "color": 小写 #rrggbb }`；`link` 必须且只包含 `type` 与 `attrs`，其 `attrs` MUST 恰好为 `{ "href": 非空字符串 }`；拥有完全一致 marks（每个 mark 的 `type` 与 `attrs` 均一致）的相邻 `text` 节点 MUST 合并为一个最大文本节点，未合并形态 MUST 视为非法而不是在打开时静默规范化；`bulletList` 必须且只包含 `type` 与至少一个 `listItem` 的非空 `content`；`orderedList` 必须且只包含 `type`、恰好为一个整数 `1 ≤ start ≤ 2^53-1` 的 `attrs` 与至少一个 `listItem` 的非空 `content`，且 `start` 与 `listItem` 数量之和 `start + (listItem 数量 - 1)` MUST NOT 超过 `2^53-1`；`listItem` 必须且只包含 `type` 与 `content`，其 `content` MUST 恰好以一个 `paragraph` 开头，且其后只能再跟至多一个 `bulletList` 或 `orderedList` 作为嵌套列表。空段落或空标题 MUST 省略 `content`；无标记文字 MUST 省略 `marks`；段落属性全部为默认值时 MUST 省略 `attrs`。

#### Scenario: 校验有效文档
- **WHEN** 文档只包含合法嵌套的正文、一到六级标题、全部字符标记、段落属性、两种列表及嵌套列表、链接
- **THEN** 系统接受该文档用于打开或保存

#### Scenario: 接受带属性字符标记
- **WHEN** 文本节点带 `textStyle`（含 `color`/`fontFamily`/`fontSize`）、`highlight`（含 `color`）或 `link`（含 `href`）
- **THEN** 系统按 rank 顺序接受这些 marks 及其属性
- **AND** 系统保持相邻不同 attrs 文本节点分离

#### Scenario: 接受嵌套列表
- **WHEN** `listItem` 的 `content` 为一个 `paragraph` 后跟一个 `bulletList` 或 `orderedList`
- **THEN** 系统接受该嵌套列表结构

#### Scenario: 新建或无块时的最小合法文档
- **WHEN** 系统新建文档或处理后得到一个不包含任何块的 `doc`
- **THEN** 系统使用一个 `doc` 包含一个省略 `content` 的空 `paragraph` 作为合法最小表示
- **AND** 系统不接受或输出 `doc.content` 为空数组的表示
- **AND** 此规则仅适用于无任何块的初始或归零状态，用户文档中已有的空段落不受此规则约束

#### Scenario: 有序列表保留起始编号
- **WHEN** 有序列表的 `attrs.start` 为整数 3 且包含两个列表项
- **THEN** 系统接受并保留起始编号 3
- **AND** 两个项目的实际编号为 3 和 4

#### Scenario: 拒绝超出安全整数范围的列表编号
- **WHEN** 有序列表的 `attrs.start` 为 `2^53` 或 `start` 与列表项数量之和超过 `2^53-1`
- **THEN** 系统拒绝该文档

#### Scenario: 拒绝非规范字段和结构
- **WHEN** 文档包含空 `content` 数组、空 `marks`、重复或乱序 marks、相同 marks 的相邻未合并文本节点、含 CR/LF 的文本节点、含孤立代理项的文本节点、额外字段、非正整数或超出 `2^53-1` 的列表起始值、实际编号超出 `2^53-1`、`listItem` 开头不是 `paragraph`、或嵌套列表后还有多余内容
- **THEN** 系统拒绝该文档而不是静默规范化

#### Scenario: 不同标记的相邻文本保持分离
- **WHEN** 两个相邻文本节点的 marks 不同（含类型或 attrs 任一不同）
- **THEN** 系统接受并保持两个文本节点的边界
- **AND** 系统不为合并它们而丢失或扩大格式范围

#### Scenario: 拒绝未知结构
- **WHEN** 文档包含图片节点、表格节点或未知标记类型
- **THEN** 系统拒绝该文档
- **AND** 系统不静默删除未知结构后继续打开或保存

### Requirement: 前后端在读写边界校验完整文档
前端 MUST 在提交保存前校验文档的完整外层与文档结构，后端 MUST 在开始事务写入前独立校验文档。打开作品时，后端 MUST 在把内容返回编辑器前完成 JSON 解析、格式版本和 schema 校验。

#### Scenario: 前端拒绝提交非法当前文档
- **WHEN** 任一文档的当前结构化文档未通过前端校验
- **THEN** 前端不调用保存写盘
- **AND** 当前内容继续被视为未保存

#### Scenario: 后端拒绝非法保存载荷
- **WHEN** 后端收到包含非法节点或错误格式版本的保存请求
- **THEN** 后端在创建事务暂存文件前拒绝请求
- **AND** 现有可见项目文件保持不变

### Requirement: 非法或不支持的文档不得被当作空白打开
系统 MUST 在文档 JSON 损坏、外层字段错误、格式版本不支持或文档 schema 非法时停止打开作品并显示中文可读错误。系统 MUST NOT 用空白文档替代失败内容，也 MUST NOT 因打开失败覆盖任何原文件。

#### Scenario: 打开损坏的 JSON
- **WHEN** 任一文档正文文件不是合法 JSON
- **THEN** 系统拒绝进入编辑器并显示文件无法安全读取的中文错误
- **AND** 原文件保持不变

#### Scenario: 打开未来格式版本
- **WHEN** 任一文档的 `version` 高于当前支持版本
- **THEN** 系统拒绝打开并提示文档版本不受支持
- **AND** 系统不尝试降级或清空该文档

### Requirement: 不读取开发期纯文本本子
系统 MUST NOT 自动读取、转换或回写开发期 `草稿本.txt` 和 `正文本.txt`。开发期纯文本本子不是当前版本的有效作品事实源，也不得作为内容树文档正文的来源。

#### Scenario: 只含旧纯文本文件的作品
- **WHEN** 用户选择只包含旧 `.txt` 本子而不包含必需内容树文档正文文件的作品
- **THEN** 系统拒绝把该文件夹作为当前版本有效作品打开
- **AND** 系统不创建自动迁移文件

