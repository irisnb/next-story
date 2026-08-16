# nested-lists Specification

## Purpose
TBD - created by archiving change add-extended-text-formatting. Update Purpose after archive.
## Requirements
### Requirement: 列表项可升降级形成多级嵌套
系统 SHALL 让无序列表与有序列表的项目通过 `Tab` 升为父级列表项的子级、通过 `Shift+Tab` 回到父级，从而形成多级嵌套列表。嵌套列表 MUST 作为 `listItem` 内的子 `bulletList` 或 `orderedList` 保存，并 MUST 在保存、关闭、重开后保持层级一致。升降级 MUST 作为可撤销编辑处理。

#### Scenario: Tab 创建子级列表项
- **WHEN** 用户在无序列表第二个项目按 `Tab`
- **THEN** 该项目成为第一个项目的嵌套子列表项
- **AND** 文档以 `listItem` 内嵌套 `bulletList` 的结构保存

#### Scenario: Shift+Tab 回到父级
- **WHEN** 用户在嵌套子列表项按 `Shift+Tab`
- **THEN** 该项目回到父级列表层

#### Scenario: 保存重开保持嵌套层级
- **WHEN** 文档含两层嵌套列表且用户保存后重开
- **THEN** 嵌套层级与项目顺序保持不变

### Requirement: 嵌套有序列表保留各层实际编号
系统 SHALL 在拆分、抬出或转换嵌套有序列表时，让每一层未触及片段保持操作前的实际显示编号。嵌套有序列表的 `start` 与编号计算 MUST 与最外层一致，且任何一层的有序列表起始值或实际编号 MUST NOT 超出 `2^53-1`。

#### Scenario: 嵌套有序列表子层编号
- **WHEN** 一个有序列表项目内嵌套一个从 1 开始的子有序列表
- **THEN** 子列表按子层 `start` 独立编号
- **AND** 父层与子层编号互不影响

#### Scenario: 拆分嵌套有序列表保留未触及编号
- **WHEN** 嵌套有序列表中的部分项目被抬出或转换
- **THEN** 未触及的前后片段保持操作前的实际显示编号

### Requirement: 工具栏列表状态适配嵌套结构
系统 SHALL 让无序列表与有序列表命令在嵌套结构下只转换选区触及的完整项目，并 MUST 在混合层级选区下显示正确的列表状态。嵌套列表项目的工具栏状态 MUST 与最外层一致地推导。

#### Scenario: 嵌套项目显示列表状态
- **WHEN** 光标位于嵌套子列表项内
- **THEN** 对应列表按钮显示该项目的列表类型
- **AND** 列表状态不因嵌套层级而显示为混合

