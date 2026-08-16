# find-replace Specification

## Purpose
TBD - created by archiving change add-extended-text-formatting. Update Purpose after archive.
## Requirements
### Requirement: 查找在当前本子可见文字上字面匹配并高亮
系统 SHALL 在当前本子的可见文字上进行字面查找，支持区分大小写开关，并 MUST 高亮全部命中、显示命中总数与当前序号，提供上一个与下一个的导航。查找高亮是装饰，MUST NOT 改变文档内容、结构或保存结果。查找范围 MUST 只包含当前本子，不跨到另一本子。

#### Scenario: 查找并高亮命中
- **WHEN** 用户输入要查找的文字
- **THEN** 当前本子中所有命中处被高亮
- **AND** 系统显示命中总数

#### Scenario: 上一个与下一个导航
- **WHEN** 存在多个命中且用户点击下一个
- **THEN** 光标移动到下一命中处
- **AND** 当前序号随之更新

#### Scenario: 区分大小写开关
- **WHEN** 用户开启区分大小写并查找某词
- **THEN** 只匹配大小写完全一致的命中
- **AND** 关闭后匹配不区分大小写

#### Scenario: 查找不改变文档
- **WHEN** 用户执行查找后立即保存
- **THEN** 保存结果与查找前一致
- **AND** 高亮不进入文档结构

### Requirement: 替换当前项与替换全部作为可撤销编辑
系统 SHALL 提供替换当前项与替换全部，两者 MUST 作为可撤销编辑处理，替换全部 MUST 合并为单个事务。替换只改变被匹配文字，MUST NOT 改变其它内容或格式。无命中时替换 MUST 不产生编辑。

#### Scenario: 替换当前命中
- **WHEN** 存在命中且用户替换当前项
- **THEN** 当前命中文字被替换
- **AND** 替换可被一次撤销恢复

#### Scenario: 替换全部为单事务
- **WHEN** 存在多个命中且用户点击替换全部
- **THEN** 所有命中在同一事务内被替换
- **AND** 一次撤销可恢复替换前的全部文字

#### Scenario: 无命中时不产生编辑
- **WHEN** 查找无任何命中且用户尝试替换
- **THEN** 文档不发生变化
- **AND** 不产生可撤销步骤

### Requirement: 查找替换有可见入口
系统 SHALL 在左侧竖排工具栏提供「查找」入口按钮，点击与 `Ctrl+F` 等效（打开查找栏并聚焦查找框）。系统 MUST 让 `Ctrl+H` 继续打开查找栏并聚焦替换框。查找替换 MUST NOT 只能通过快捷键触发。

#### Scenario: 点击查找按钮打开查找栏
- **WHEN** 用户点击左侧工具栏的「查找」按钮
- **THEN** 查找栏打开并聚焦查找输入框
- **AND** 与按 `Ctrl+F` 行为一致

#### Scenario: Ctrl+H 聚焦替换框
- **WHEN** 用户按 `Ctrl+H`
- **THEN** 查找栏打开并聚焦替换输入框

