# project-word-export Specification

## Purpose

将所选范围（当前文档／文件夹／整作品）的已保存内容按内容树顺序导出为可继续编辑的 DOCX 文件，样式与编辑器呈现对齐，同时保持只读、不修改任何作品数据。

## Requirements

### Requirement: 按所选范围导出 DOCX

系统 SHALL 在导出时提供三种范围：当前文档（默认）、作品内任选文件夹（含其嵌套子树）、整个作品；SHALL 按既有内容树顺序导出所选范围内的全部文档，回收站中的节点 MUST NOT 出现。

#### Scenario: 导出当前文档

- **WHEN** 用户在未选择其他范围的情况下导出
- **THEN** 生成的 `.docx` 仅含当前文档内容，默认文件名为该文档名

#### Scenario: 导出文件夹子树

- **WHEN** 用户选择某文件夹为导出范围
- **THEN** 该文件夹及其嵌套子文件夹内的全部文档按树序写入同一个 `.docx`

#### Scenario: 导出整个作品

- **WHEN** 用户选择整个作品为导出范围
- **THEN** 全部活动文档按树序写入同一个 `.docx`，行为与旧整作品导出等价

#### Scenario: 空范围导出

- **WHEN** 导出范围内没有任何文档（空作品或空文件夹）
- **THEN** 导出成功，生成的 `.docx` 仅含范围根标题与有效空正文

### Requirement: 范围层级的标题映射

导出文件 SHALL 保留范围结构与文档边界：整个作品范围以作品名为一级标题（文件夹二级、文档三级）；文件夹范围以文件夹名为一级标题（其文档二级）；文档范围以文档名为一级标题；文档内部标题始终按自身层级输出。不同文档的正文 MUST NOT 合并为无法区分的连续文本。

#### Scenario: 文档范围不含树标题

- **WHEN** 用户导出单个文档
- **THEN** 文件以该文档名为标题，正文不含作品名与其他文件夹/文档标题

#### Scenario: 文件夹范围的层级

- **WHEN** 用户导出含嵌套文件夹的文件夹范围
- **THEN** 文件夹名与各文档名按层级呈现，每篇正文紧随其文档标题之后

### Requirement: Preserve editable document content and supported formatting
导出器 MUST 保留每篇结构化文档的可见文字、块顺序、段落、已支持标题、无序列表、有序列表以及可映射的文字标记，并 MUST 生成可继续编辑的 Word 内容，而不是页面截图或不可编辑图片。样式保真 SHALL 与编辑器呈现对齐：正文字体与字号（16px↔12pt 同值换算）、标题层级字号、文字颜色、段落对齐按编辑器当前呈现设置；打开导出文件的机器未安装同款字体时回退系统字体显示，MUST NOT 影响内容与颜色。

#### Scenario: Rich structured document export
- **WHEN** 文档包含中文、标点、emoji、多个段落、标题、列表、粗体或斜体
- **THEN** 导出的 Word 文档保留可见字符及其顺序
- **AND** 导出内容仍可在 Word 中编辑
- **AND** 可映射的结构和文字格式在 Word 中保持

#### Scenario: 样式与编辑器对齐
- **WHEN** 编辑器正文为 16px 思源黑体、标题按层级字号、部分文字着色
- **THEN** 导出的 DOCX 正文为 12pt 同族字体、标题与颜色设置与编辑器呈现对应

#### Scenario: Unsupported presentation attributes
- **WHEN** 文档包含 DOCX 无法直接表达的内部展示属性
- **THEN** 系统保留对应的可见文字、段落顺序和必要结构
- **AND** 不因无法表达某个展示属性而丢弃整篇文档或擅自改写文字

### Requirement: Export is read-only and uses saved project content
导出 MUST 只读取已保存的作品数据，不得修改作品文档、内容树或保存状态，也不得把 AI 面板内容写入导出文档。未保存提示 SHALL 仅在导出范围包含当前文档且该文档存在未保存修改时出现。

#### Scenario: Export does not mutate project data
- **WHEN** 用户完成一次 Word 导出
- **THEN** 作品目录中的内容树和文档事实源字节内容不被导出流程修改
- **AND** 编辑器的未保存状态不因导出而被保存或清除

#### Scenario: Unsaved editor changes
- **WHEN** 导出范围包含当前文档且该文档存在未保存修改
- **THEN** 导出使用后端已保存版本
- **AND** 界面明确告知用户导出不包含尚未保存的修改

#### Scenario: 范围不含当前文档时不提示

- **WHEN** 导出范围不包含当前打开的文档，而当前文档存在未保存修改
- **THEN** 导出正常进行，不弹出未保存提示

### Requirement: User chooses a safe DOCX destination
系统 SHALL 通过统一导出入口让用户选择格式、范围与目标文件位置，默认文件名 SHALL 按导出范围生成（文档名／文件夹名／作品名＋`.docx`，可修改），并 MUST 对取消、生成失败和写入失败提供稳定且可理解的结果。

#### Scenario: Choose destination and save
- **WHEN** 用户在导出对话框选定范围为某文档并确认一个可写的目标路径
- **THEN** 系统生成有效的 `.docx` 文件并写入该路径
- **AND** 前端显示导出成功及目标位置

#### Scenario: Cancel export
- **WHEN** 用户关闭导出对话框或保存对话框
- **THEN** 系统不生成文件
- **AND** 前端不把取消操作显示为错误

#### Scenario: Export failure
- **WHEN** 文档读取、DOCX 生成或目标文件写入失败
- **THEN** 系统返回稳定的失败结果和中文说明
- **AND** 不留下被当作成功导出的不完整文件

### Requirement: 导出实现依赖链卫生

Word 导出实现的 Rust 依赖链 SHALL 保持可维护：DOCX 生成库 MUST 为仍在维护（能够接收修复发布）的版本；依赖链 MUST NOT 触发 future-incompat 警告（未来 Rust 版本将拒绝编译的旧写法）；依赖链 MUST NOT 依赖仓库内 vendored 兼容垫片或经 `[patch.crates-io]` 改写来满足编译。依赖链组件出现在册安全警报时，有修复版可用 SHALL 升级至修复版；无修复版可用 MUST 在仓库内记录已接受风险与理由，不得静默搁置。

#### Scenario: 依赖链不含死库与垫片

- **WHEN** 检查 Word 导出实现的 Cargo 依赖链
- **THEN** DOCX 生成库为活跃维护版本（近期能接收修复发布）
- **AND** 链中不存在为满足编译而维护的仓库内 vendored 垫片或 `[patch.crates-io]` 改写

#### Scenario: future-incompat 清零

- **WHEN** 在仓库执行 `cargo report future-incompat`
- **THEN** 导出实现的依赖链不产生任何 future-incompat 警告

#### Scenario: 安全警报有修复版时升级

- **WHEN** 导出依赖链中的组件出现有修复版可用的在册安全警报
- **THEN** 依赖链升级至修复版，警报随升级关闭

#### Scenario: 无修复版时登记已接受风险

- **WHEN** 导出依赖链中的组件出现暂无修复版可用的在册安全警报
- **THEN** 仓库内记录该警报的接受理由与复评条件
