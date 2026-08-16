# editor-margin-preference Specification

## Purpose
TBD - created by archiving change consolidate-editor-formatting-ui. Update Purpose after archive.
## Requirements
### Requirement: 编辑器正文四周留白可调节
系统 SHALL 提供编辑器正文四周留白（显示边距）的调节入口，作用于编辑器内容区的显示留白。留白是界面显示偏好，MUST NOT 写入草稿本或正文本的文档结构，也 MUST NOT 进入 AI 的选区快照输入。

#### Scenario: 调节留白档位
- **WHEN** 用户调节编辑器留白到更宽松的档位
- **THEN** 编辑器正文四周的空白变大、文字不再贴边
- **AND** 正文文字与文档结构不发生变化

#### Scenario: 留白不进入文档
- **WHEN** 用户调节留白后保存并重开作品
- **THEN** 文档内容与保存前一致
- **AND** 留白设置不影响草稿本或正文本的 JSON 内容

### Requirement: 留白作为显示偏好持久化
系统 SHALL 把编辑器留白设置作为应用级显示偏好持久化，并在应用重新打开后恢复。持久化 MUST 与作品文档、LLM 配置分开。留白设置缺失时 MUST 回退到一个合理默认档位。

#### Scenario: 重开后保持留白设置
- **WHEN** 用户把留白调到某档后关闭并重新打开应用
- **THEN** 编辑器恢复该留白档位

#### Scenario: 无留白设置时回退默认
- **WHEN** 应用首次运行且没有已保存的留白设置
- **THEN** 编辑器使用合理的默认留白，正文不贴窗口边

