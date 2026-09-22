# project-word-export Specification

## Purpose

将当前作品内容树中已保存的文档按内容树顺序导出为一个可继续编辑的 DOCX 文件，同时保持只读、不修改任何作品数据。

## Requirements

### Requirement: Export the complete active project to DOCX
系统 SHALL 提供将当前作品导出为一个真正的 `.docx` 文件的能力，导出范围包括活动内容树中的全部文档。

#### Scenario: Export all documents in tree order
- **WHEN** 用户触发当前作品的 Word 导出
- **THEN** 系统按 `root_children` 及各文件夹 `children` 的顺序递归遍历活动内容树
- **AND** 将遇到的每篇文档依次写入同一个 `.docx` 文件
- **AND** 不导出回收站中的节点

#### Scenario: Empty project export
- **WHEN** 当前作品没有活动文档
- **THEN** 系统仍可生成包含作品名称和有效空正文的 `.docx` 文件

### Requirement: Preserve project hierarchy in exported document
导出的 Word 文档 MUST 清楚保留作品名称、文件夹名称和文档名称，并 MUST 保持每篇文档的正文与其文档标题的对应关系。

#### Scenario: Folder and document headings
- **WHEN** 内容树包含嵌套文件夹和多个文档
- **THEN** 导出的 Word 文档按树顺序输出对应的文件夹标题和文档标题
- **AND** 每篇文档正文紧随其自身文档标题之后
- **AND** 不把不同文档的正文合并成无法区分的连续文本

### Requirement: Preserve editable document content and supported formatting
导出器 MUST 保留每篇结构化文档的可见文字、块顺序、段落、已支持标题、无序列表、有序列表以及可映射的文字标记，并 MUST 生成可继续编辑的 Word 内容，而不是页面截图或不可编辑图片。

#### Scenario: Rich structured document export
- **WHEN** 文档包含中文、标点、emoji、多个段落、标题、列表、粗体或斜体
- **THEN** 导出的 Word 文档保留可见字符及其顺序
- **AND** 导出内容仍可在 Word 中编辑
- **AND** 可映射的结构和文字格式在 Word 中保持

#### Scenario: Unsupported presentation attributes
- **WHEN** 文档包含 DOCX 无法直接表达的内部展示属性
- **THEN** 系统保留对应的可见文字、段落顺序和必要结构
- **AND** 不因无法表达某个展示属性而丢弃整篇文档或擅自改写文字

### Requirement: Export is read-only and uses saved project content
导出 MUST 只读取已保存的作品数据，不得修改作品文档、内容树或保存状态，也不得把 AI 面板内容写入导出文档。

#### Scenario: Export does not mutate project data
- **WHEN** 用户完成一次 Word 导出
- **THEN** 作品目录中的内容树和文档事实源字节内容不被导出流程修改
- **AND** 编辑器的未保存状态不因导出而被保存或清除

#### Scenario: Unsaved editor changes
- **WHEN** 当前编辑器存在尚未保存的修改
- **THEN** 导出使用后端已保存版本
- **AND** 界面明确告知用户导出不包含尚未保存的修改

### Requirement: User chooses a safe DOCX destination
系统 SHALL 允许用户通过保存对话框选择导出文件位置，默认建议使用作品名称加 `.docx`，并 MUST 对取消、生成失败和写入失败提供稳定且可理解的结果。

#### Scenario: Choose destination and save
- **WHEN** 用户确认一个可写的目标路径
- **THEN** 系统生成有效的 `.docx` 文件并写入该路径
- **AND** 前端显示导出成功及目标位置

#### Scenario: Cancel export
- **WHEN** 用户关闭保存对话框或取消选择目标路径
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
