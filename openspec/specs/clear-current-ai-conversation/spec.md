# clear-current-ai-conversation Specification

## Purpose
Document the user-initiated "新建对话" (new conversation) capability in the AI panel, which clears the current temporary conversation and returns the panel to a blank, directly-askable state without creating any persisted history.
## Requirements
### Requirement: 用户可以在当前作品中开始新的临时对话
系统 SHALL 在当前存在临时对话或首轮请求时提供“新建对话”操作。用户触发后，系统 MUST 清除当前临时对话、请求显示、追问草稿和直接提问草稿，保持面板展开并回到可直接提问的空状态。

#### Scenario: 已完成对话新建对话
- **WHEN** 用户在已有首轮回应或追问记录的 AI 面板中点击“新建对话”
- **THEN** 当前对话内容和追问输入被清除
- **AND** 面板保持展开
- **AND** 直接提问输入回到空白可提交前状态

#### Scenario: 首轮请求中开始新对话
- **WHEN** 首轮请求仍在加载且用户点击“新建对话”
- **THEN** 面板回到空白直接提问状态
- **AND** 该首轮请求稍后返回的结果不显示在面板中，也不创建当前对话

#### Scenario: 追问请求中开始新对话
- **WHEN** 追问请求仍在加载且用户点击“新建对话”
- **THEN** 面板回到空白直接提问状态
- **AND** 该追问请求稍后返回的结果不修改新的空白状态

#### Scenario: 新建对话不产生历史会话
- **WHEN** 用户清除当前临时对话并开始新的提问
- **THEN** 面板只显示新的临时对话
- **AND** 面板不提供被清除对话的列表、恢复或切换入口
