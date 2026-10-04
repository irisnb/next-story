## ADDED Requirements

### Requirement: 字体选择按文字字符类别

系统 SHALL 按 run 文字内容选择映射字体：含东亚字符的 run 取东亚字体（`eastAsia`），纯拉丁 run 取西文主字体（`ascii`，缺失时按既有西文备用键与东亚字体依次回退）；MUST NOT 对所有 run 无条件优先东亚字体。主题字体键（`asciiTheme` 等）沿用既有口径（不解析、不计损耗）；混排 run 以东亚字体承载（不拆分文字），该取舍如实记录。

#### Scenario: 纯拉丁文字使用拉丁字体

- **WHEN** 导入文件中文档字体配置区分东亚与拉丁字体，且某 run 为纯拉丁文字
- **THEN** 该 run 的字体映射为拉丁字体（如 `ascii` 指定的 Calibri）
- **AND** 不被标为东亚字体

#### Scenario: 东亚文字使用东亚字体

- **WHEN** 某 run 含东亚文字
- **THEN** 该 run 的字体映射为 `eastAsia` 指定字体

### Requirement: 复合间距属性按子属性合并

段落间距（`spacing`）的样式继承合并 SHALL 按子属性（`before`／`after`／`line`／`lineRule`）逐项进行；上层样式设置的子属性 MUST NOT 因下层样式仅覆盖其他子属性而丢失；映射输出 SHALL 反映合并后的行距与段距。该合并 MUST NOT 以无差别递归替换所有复合对象替代。

#### Scenario: 仅覆盖段后间距不丢继承行距

- **WHEN** 文档默认设置行距，段落样式仅覆盖段后间距
- **THEN** 合并结果同时保留继承行距与被覆盖的段后间距
- **AND** 映射输出包含对应 `lineHeight`

#### Scenario: 直接属性按覆盖生效

- **WHEN** 段落直接属性覆盖行距或段距
- **THEN** 直接值优先，未直接覆盖的其余子属性保持继承值

### Requirement: 符号映射表的规范依据

符号字体映射表（Wingdings／Symbol）SHALL 以公开编码表为规范依据（Wingdings＝Alan Wood 表；Symbol＝Adobe Symbol 编码表），表内条目 MUST 与公开表一致；可映射符号 SHALL 输出对应 Unicode 字符，无法可靠映射者 MUST 以 `symbol_dropped` 计数告知，错误映射与静默丢弃均 MUST NOT 发生。

#### Scenario: 修正样本按公开表逐条输出

- **WHEN** 导入覆盖修正条目的符号样本
- **THEN** 每个符号输出公开表对应字符，零错误映射
- **AND** 未映射码位仍计入 `symbol_dropped`

#### Scenario: 常用符号不丢失

- **WHEN** 导入含此前缺映射的常用符号（如 F0FB）
- **THEN** 该符号按公开表映射输出，不再计入丢弃
