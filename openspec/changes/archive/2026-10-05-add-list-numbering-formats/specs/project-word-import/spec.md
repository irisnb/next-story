## ADDED Requirements

### Requirement: Word 编号样式映射与格式降级告知

系统 SHALL 将 Word 编号定义的 `numFmt` 映射为列表编号样式：`decimal`→`"1"`、`upperLetter`→`"A"`、`lowerLetter`→`"a"`、`upperRoman`→`"I"`、`lowerRoman`→`"i"`；`bullet` 映射为无序列表，`none` 不产生列表。其余编号格式（含中文数字、序数词、`decimalZero` 等）与不符合 `%N.` 简单模板的 `lvlText` SHALL 按数字编号导入，并 MUST 以独立损耗类别（计数＋详情，形态与既有编号降级告知一致）如实告知，MUST NOT 静默改变编号样式。级别定义 SHALL 按 `lvlOverride` 语义解析：覆盖层提供的 `lvl` **整体替换**抽象定义的对应层（起点与格式均取覆盖值）；起点优先顺序 MUST 为 `startOverride` ＞ 覆盖层 `lvl` 起点 ＞ 抽象定义起点，样式采用同一链条取到的一层 `numFmt`。

#### Scenario: 字母编号保留

- **WHEN** 导入文件某编号定义的 `numFmt` 为 `upperLetter`，且 `lvlText` 为 `%1.`
- **THEN** 对应列表以大写字母编号导入并渲染
- **AND** 预检不出现编号样式降级告知

#### Scenario: 不支持格式降级并告知

- **WHEN** 导入文件的编号定义为中文数字或自定义编号模板
- **THEN** 列表按数字编号导入
- **AND** 预检以编号样式降级类别呈现计数与详情

#### Scenario: lvlOverride 起点与样式优先

- **WHEN** 某编号实例的覆盖层提供起点 4 且未提供 `startOverride`
- **THEN** 该层列表从 4 开始，而不是抽象定义的起点

#### Scenario: startOverride 优先于覆盖层起点

- **WHEN** 覆盖层同时提供 `startOverride` 与其 `lvl` 内的起点且两者不同
- **THEN** 以 `startOverride` 为准
