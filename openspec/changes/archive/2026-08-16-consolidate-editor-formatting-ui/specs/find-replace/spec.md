# find-replace Specification Delta

## ADDED Requirements

### Requirement: 查找替换有可见入口
系统 SHALL 在左侧竖排工具栏提供「查找」入口按钮，点击与 `Ctrl+F` 等效（打开查找栏并聚焦查找框）。系统 MUST 让 `Ctrl+H` 继续打开查找栏并聚焦替换框。查找替换 MUST NOT 只能通过快捷键触发。

#### Scenario: 点击查找按钮打开查找栏
- **WHEN** 用户点击左侧工具栏的「查找」按钮
- **THEN** 查找栏打开并聚焦查找输入框
- **AND** 与按 `Ctrl+F` 行为一致

#### Scenario: Ctrl+H 聚焦替换框
- **WHEN** 用户按 `Ctrl+H`
- **THEN** 查找栏打开并聚焦替换输入框
