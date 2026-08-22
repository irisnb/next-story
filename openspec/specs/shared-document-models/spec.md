# shared-document-models Specification

## Purpose
TBD - created by archiving change extract-shared-document-models. Update Purpose after archive.
## Requirements
### Requirement: Structured document position calculations have one shared implementation

结构化文档相关代码 MUST 使用唯一的共享节点位置尺寸实现，不得在编辑器、格式命令或序列化调用方中保留等价的独立位置算法。

#### Scenario: Position sizes remain compatible

- **WHEN** 系统计算文本节点、普通块节点、空块和嵌套列表节点的位置尺寸
- **THEN** 结果与现有 ProseMirror 风格位置规则完全一致
- **AND** 文档序列化、格式分析和链接定位的对外结果不改变

### Requirement: Block traversal is shared by document consumers

选区序列化、格式状态分析和链接定位 MUST 使用同一套有序块遍历与位置计算；消费者 MAY 将共享记录映射为各自已有的返回类型，但不得重新递归计算同一套块位置。

#### Scenario: Nested list blocks keep stable ranges

- **WHEN** 系统遍历包含多层列表、列表项和段落的文档
- **THEN** 每个块的起止位置、深度和文本节点顺序与迁移前一致
- **AND** 嵌套列表内容不会错误并入外层块范围

#### Scenario: Empty blocks are included consistently

- **WHEN** 文档包含空段落或空列表项
- **THEN** 共享遍历器以既有规则返回这些块的位置和文本
- **AND** 选区纯文本序列化与格式状态分析保持原有结果

### Requirement: Shared document models do not change public behavior or write documents

共享模型 MUST 是无副作用的纯计算层；迁移 MUST 保持现有公开函数、返回结构、持久化 JSON 和选区序列化规则不变，且不得向用户文档写入任何内容。

#### Scenario: Existing public consumers remain compatible

- **WHEN** 现有代码调用 `serializeSelectionToPlainText`、`analyzeSelection` 或链接定位逻辑
- **THEN** 调用方式和返回结果保持兼容
- **AND** 现有序列化与格式回归测试继续通过

#### Scenario: Model calculation cannot mutate the document

- **WHEN** 共享位置模型或块遍历器接收一个结构化文档
- **THEN** 它只读取输入并返回计算结果
- **AND** 输入文档和用户作品文本不被修改

