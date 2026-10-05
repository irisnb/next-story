## ADDED Requirements

### Requirement: 外部粘贴保留有序列表编号样式

系统 SHALL 在外部 HTML 粘贴时把有序列表的编号样式（`ol[type]` 属性或行内 `list-style-type`）映射为对应编号样式（`1`/`A`/`a`/`I`/`i`）；无法识别或非法的样式 MUST 按数字处理。该映射 MUST NOT 改变既有的文字完整性校验与拒绝规则。

#### Scenario: 粘贴带样式的有序列表

- **WHEN** 粘贴的 HTML 含 `<ol type="A">`
- **THEN** 生成的列表编号样式为 `"A"`，渲染为大写字母

#### Scenario: 非法样式按数字处理

- **WHEN** 粘贴的 HTML 含无法识别或非法的列表样式
- **THEN** 该列表按数字编号处理
- **AND** 其余内容与既有拒绝规则不受影响
