# project-word-import Specification（delta）

## MODIFIED Requirements

### Requirement: 结构映射保真与降级

系统 SHALL 把 `.docx` 内容映射到既有文档语法：段落；标题样式（Heading 1–6 及 WPS 同义样式）映射为对应层级标题；指向有效编号定义且编号可见的列表映射为无序／有序列表；run 级文字样式（粗体、斜体、下划线、删除线、颜色、字号、字体、高亮、超链接）映射为对应文字标记；段落对齐、缩进、行距与段距映射为对应段落属性。**字符与段落属性 SHALL 经样式继承解析：文档默认（docDefaults）与样式 `basedOn` 继承链（字符属性与段落属性分别）与直接属性合并后映射；链上存在但无法解析或映射的属性 SHALL 以 `style_degraded` 计数告知。符号字符（`w:sym`）SHALL 映射为对应 Unicode 字符（常用符号字体映射表）；无法可靠映射的 SHALL 以 `symbol_dropped` 计数告知，MUST NOT 静默丢弃。编号 SHALL 按文档语义续算：同一 `numId` 的计数跨普通段落打断持续，更深层级在更浅层级出现时重置，`startOverride` 覆盖被消费，打断后重续的有序列表以当前计数值为起始编号；无法表达的编号体系沿用既有 `numbering_degraded` 降级并告知，MUST NOT 输出貌似正确的错误编号。**编号墓碑（`numId=0` 或指向不可见定义）MUST NOT 转为列表；表格 MUST 拍平为逐格文字段落；空段落 SHALL 保留；`mc:AlternateContent` 缺失 `mc:Fallback` 时 SHALL 跳过该块并计入告知；`wpsCustomData` 等私货命名空间内容 SHALL 忽略。导入文档落盘前 MUST 通过既有严格语法校验。

#### Scenario: 纯文字惯例文件完整导入

- **WHEN** 导入一份零样式、纯文字惯例结构的 WPS 剧本文件
- **THEN** 全部文字、段落顺序、加粗、字体、字号、颜色与高亮保留
- **AND** 空段落原样保留

#### Scenario: 样式定义的格式生效

- **WHEN** 导入一份字符或段落格式由样式表（含 `basedOn` 继承与文档默认）定义的文件
- **THEN** 生效属性按「文档默认 ← 样式链 ← 直接属性」合并结果映射
- **AND** 无法解析的链上属性以 `style_degraded` 如实告知

#### Scenario: 符号字符映射或告知

- **WHEN** 导入含 `w:sym` 符号字符的文件
- **THEN** 可映射的符号成为对应 Unicode 字符进入正文
- **AND** 不可映射的符号以 `symbol_dropped` 计数告知，不静默消失

#### Scenario: 编号跨打断续算

- **WHEN** 同一编号列表被普通段落后打断并再次出现
- **THEN** 重续列表从当前计数值继续编号（而非从起始值重起）
- **AND** 嵌套更深层级在更浅层级出现后重新从其起点计数

#### Scenario: 编号墓碑不产生编号

- **WHEN** 导入文件包含 `numId=0` 的编号属性段落（该编号在源应用中不显示）
- **THEN** 这些段落导入后不出现列表编号
- **AND** 文字内容完整保留

#### Scenario: 表格拍平保文字

- **WHEN** 导入文件包含表格
- **THEN** 表格内全部文字以逐格段落形式保留
- **AND** 表格结构不再保留，预检已如实告知

#### Scenario: 真实列表映射为列表

- **WHEN** 导入文件包含指向有效编号定义且编号可见的列表
- **THEN** 列表导入为对应的无序或有序列表

#### Scenario: 缺 Fallback 的兼容块被跳过

- **WHEN** 导入文件包含缺失 `mc:Fallback` 的 `mc:AlternateContent` 块
- **THEN** 系统不崩溃，跳过该块并计入告知
