# editor-context-menu Specification

## Purpose
TBD - created by archiving change add-extended-text-formatting. Update Purpose after archive.
## Requirements
### Requirement: 编辑器右键菜单提供上下文相关命令
系统 SHALL 在草稿本与正文本的编辑区提供右键菜单，菜单项 MUST 根据当前上下文显示并正确禁用：剪切、复制、粘贴、粘贴为纯文本；选区存在且不在链接上时提供创建链接；光标落在链接上时提供链接的打开、编辑与移除。菜单 MUST NOT 提供字符或段落格式命令（格式命令的唯一图形化入口是左侧格式抽屉）。菜单命令 MUST 只作用于当前本子。

#### Scenario: 有选区时显示剪贴板与创建链接
- **WHEN** 用户选中文字（不在链接上）后右键
- **THEN** 菜单显示剪切、复制、粘贴、粘贴为纯文本及创建链接
- **AND** 菜单不显示下划线、删除线、清除格式等格式命令

#### Scenario: 无选区时禁用剪切复制
- **WHEN** 当前本子只有光标且用户右键
- **THEN** 剪切、复制与创建链接显示为禁用
- **AND** 粘贴与粘贴为纯文本保持可用

#### Scenario: 链接上右键显示链接命令
- **WHEN** 用户右键一个链接
- **THEN** 菜单显示链接的打开、编辑与移除
- **AND** 打开与编辑遵守链接只允许 http/https 与不导航规则

### Requirement: 粘贴为纯文本入口
系统 SHALL 在右键菜单与快捷键 `Ctrl+Shift+V` 提供粘贴为纯文本，MUST 只插入可见文字并清除一切格式，并 SHALL 保持插入位置所属的段落或列表上下文。

#### Scenario: 右键粘贴为纯文本
- **WHEN** 剪贴板含格式化内容且用户右键选择粘贴为纯文本
- **THEN** 系统只插入可见文字
- **AND** 不保留任何字符或段落格式

