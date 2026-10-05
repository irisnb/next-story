## ADDED Requirements

### Requirement: 字母与罗马编号在 Markdown 中降级并如实告知

Markdown 规范只支持数字列表标记，系统 SHALL 把字母或罗马编号的有序列表降级为从 `start` 起始的数字列表，嵌套层级 MUST 由缩进保持；导出结果 SHALL 如实告知发生了编号样式降级。可见文字与列表项顺序 MUST NOT 改变。

#### Scenario: 字母列表降级

- **WHEN** 文档含样式为 `"A"` 的有序列表并导出 Markdown
- **THEN** 该列表在文件中以 `1.`、`2.`…数字标记呈现
- **AND** 导出结果告知编号样式已降级为数字

#### Scenario: 嵌套层级由缩进保持

- **WHEN** 文档含嵌套列表并导出 Markdown
- **THEN** 嵌套层级以缩进保持，列表项顺序不变
