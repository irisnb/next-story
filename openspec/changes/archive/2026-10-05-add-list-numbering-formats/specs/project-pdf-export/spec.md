## ADDED Requirements

### Requirement: 编号样式随编辑器渲染

导出 PDF 时，有序列表的编号样式 SHALL 与编辑器呈现一致（数字、大写/小写字母、大写/小写罗马）；跨页列表 MUST 不重新从 1 起始；项目样式表 MUST NOT 以 `list-style-type` 覆盖列表自身样式。

#### Scenario: 字母列表渲染

- **WHEN** 文档含样式为 `"A"` 的有序列表并导出 PDF
- **THEN** PDF 中该列表以大写字母标记呈现

#### Scenario: 跨页不重编号

- **WHEN** 有序列表跨越 A4 分页
- **THEN** 分页后的项目延续编号，不从 1 重起

#### Scenario: 样式表不覆盖编号样式

- **WHEN** 打印样式表生效后导出带样式的有序列表
- **THEN** 列表仍按自身样式渲染，不被 `list-style-type` 覆盖
