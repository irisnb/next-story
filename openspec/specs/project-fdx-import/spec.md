# project-fdx-import Specification

## Purpose

从外部 `.fdx` 文件（Final Draft 存档格式）导入内容为作品文档：文件识别（含 `.fdr` 老格式拒绝）、XML 解析与段落类型语义映射（以文件自带 ElementSettings 为布局权威）、结构性降级与如实告知（双栏对白/标题页/场景元数据/剧注/修订标记/未知元素）、拆分建议（用户拍板）、导入落盘与失败处理；导入内容逐字来自用户文件。

## Requirements

### Requirement: 识别 .fdx 文件并拒绝 .fdr 老格式

系统 SHALL 通过共享的「导入文档」入口接受 `.fdx` 文件；SHALL 按 UTF-8 读取并剥离 BOM；SHALL 校验 XML 良构性与根元素为 `FinalDraft`。`.fdr`（Final Draft 1–7 私有二进制老格式）MUST 以中文错误拒绝并提示用户在 Final Draft 中另存为 `.fdx` 后再导入；MUST NOT 尝试解析。畸形 XML、超过大小上限或根元素不符 MUST 以中文可读错误稳定失败且零副作用。

#### Scenario: 导入 .fdx 文件

- **WHEN** 用户选择一个 Final Draft 保存的 `.fdx` 文件
- **THEN** 系统解析并进入预检流程

#### Scenario: .fdr 老格式被拒绝并提示

- **WHEN** 用户选择一个 `.fdr` 文件
- **THEN** 系统以中文提示在 Final Draft 中另存为 `.fdx` 后再导入
- **AND** 不产生任何副作用

#### Scenario: 畸形 XML 被拒绝

- **WHEN** 用户选择一个非 XML 或根元素不是 `FinalDraft` 的文件
- **THEN** 系统以中文可读错误稳定失败

### Requirement: 段落类型语义映射与降级

系统 SHALL 把 `.fdx` 段落类型映射到既有文档语法：Scene Heading 与 Shot 映射为二级标题（场景编号 Number 属性并入标题文字前缀）；New Act 映射为一级标题；Outline N 映射为 N 级标题；Action 映射为普通段落；Character／Dialogue／Parenthetical 映射为缩进段落；Transition 映射为右对齐段落；未知类型按普通段落导入。**段落布局 SHALL 以文件自带的 ElementSettings 为权威**：对齐（Left／Center／Right／Full→两端对齐）与相对缩进（类型值减正文基准，基准按文件 Action／General 实际值、左右独立）按文件实际数值换算映射，FirstIndent（含负值悬挂）映射为首行缩进；设置缺失时回退固定档（对白浅、括注中、人物深的 1:1.5:2 相对顺序）；Transition 在文件未提供对齐时默认右对齐，文件显式指定 Left 时 MUST 尊重文件值。Text 的粗体／斜体／下划线样式与显式 Font／Size／Color 属性 SHALL 映射为对应文字标记（颜色 48 位形态截取 RGB）。标题页（TitlePage）段落并入正文开头时 SHALL 保留其自带对齐属性。结构性降级 SHALL 如实告知：双栏对白（DualDialogue）拆为先后两组段落并计数；标题页并入并计数；场景元数据（SceneProperties 及其 Story Map 场景数据）丢弃并计数；剧注（ScriptNote）丢弃并计数；修订标记（Revisions 体系与行内标记）忽略并计数，全部文字无损；未知元素（白名单家具之外）跳过并计数；其余文档级机器设置无感丢弃。导入文档落盘前 MUST 通过既有严格语法校验。

#### Scenario: 剧本段落各得其所

- **WHEN** 导入一份含场景头、动作、人物、括注、对白与转场的 `.fdx` 剧本
- **THEN** 场景头成为标题、转场按文件设置对齐、人物与对白按文件设置的相对缩进呈现（人物深于括注、括注深于对白）
- **AND** 全部可见文字逐字保留

#### Scenario: 自定义版式按文件值映射

- **WHEN** 导入一份用户自定义版式的文件（如正文基准缩进非默认值）
- **THEN** 缩进换算以该文件自身的 ElementSettings 数值为准，不按默认值猜测

#### Scenario: 场景编号并入标题

- **WHEN** 场景头带 Number 属性（如「12」）
- **THEN** 编号并入导入后标题文字的前缀，信息不丢失

#### Scenario: 双栏对白拆分告知

- **WHEN** 剧本含 DualDialogue 结构
- **THEN** 两组人物与对白按先后顺序导入为普通缩进段落
- **AND** 预检如实告知拆分计数

#### Scenario: 标题页并入正文开头并保留对齐

- **WHEN** 文件含 TitlePage
- **THEN** 标题页文字逐段并入文档开头（保字），其段落对齐属性保留
- **AND** 预检如实告知

#### Scenario: 场景元数据与剧注丢弃告知

- **WHEN** 文件含 SceneProperties 或 ScriptNote
- **THEN** 其内容不进入正文，预检逐项告知丢弃计数

#### Scenario: 修订标记忽略文字无损

- **WHEN** 文件带修订体系与行内修订标记
- **THEN** 全部文字无损导入、修订标记忽略
- **AND** 预检如实告知

#### Scenario: 未知元素跳过告知

- **WHEN** 文件含白名单家具之外的未知元素
- **THEN** 未知元素跳过、导入文字不受影响
- **AND** 预检以专用损耗项告知计数与元素名

### Requirement: 导入内容逐字来自用户文件

导入产生的全部文字内容 MUST 逐字来自用户选定的 `.fdx` 文件；场景编号并入标题文字前缀、标题页并入正文、转场 XML 回声换行拆段与行边空白处理属于格式规则，MUST NOT 视为改写。导入 MUST 只创建新文档，MUST NOT 修改任何既有文档的正文、名称、结构或保存状态。

#### Scenario: 文字与源文件一致

- **WHEN** 导入完成
- **THEN** 新文档中的可见文字与源文件文字逐字一致（格式规则除外）

#### Scenario: 既有文档在导入后不变

- **WHEN** 用户完成一次 `.fdx` 导入
- **THEN** 既有文档的正文与内容树中既有节点不被修改

### Requirement: 场景头序列拆分由用户拍板

场景头导入为标题后，预检识别到重复标题序列（同层级、短序列文本、重复至少 3 次，如「第X集」式场景头）时，系统 SHALL 按既有规则给出拆分建议。是否拆分 MUST 由用户选择，默认不拆分。

#### Scenario: 集数场景头建议拆分

- **WHEN** 预检一份场景头为「第一集」至「第六十一集」序列的 `.fdx` 文件
- **THEN** 预览建议按场景头拆分为 61 个文档
- **AND** 默认选项为不拆分

### Requirement: 导入落盘与失败处理

用户确认后系统 SHALL 重新解析并落盘，复用共享导入语义：预览与提交之间文件内容变化（内容哈希不一致）时 MUST 要求重新预检；文档名默认为文件名去扩展名（拆分时以标题文本为名并做净化与同级唯一化）；AI 可见性默认值与既有新建文档一致；失败 MUST 中文报错且不留部分完成的文档结构。

#### Scenario: 确认导入成功

- **WHEN** 用户在预览中确认导入 `.fdx` 文件
- **THEN** 新文档出现在目标位置并可在编辑器中打开

#### Scenario: 导入失败无残留

- **WHEN** 落盘过程任一步骤失败
- **THEN** 系统显示中文可读错误且内容树不残留部分完成的导入结构
