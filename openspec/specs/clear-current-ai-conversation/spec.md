# clear-current-ai-conversation Specification

## Purpose
Document the user-initiated "新建对话" (new conversation) capability in the AI panel, which clears the current temporary conversation and returns the panel to a blank, directly-askable state without creating any persisted history.
## Requirements
### Requirement: 用户可以在当前作品中开始新的讨论
系统 SHALL 在当前存在讨论或首轮请求时提供"新建对话"操作。用户触发后，系统 MUST 开启一个新讨论，保留旧讨论及其档案（可重开），并在停靠区打开新讨论自己的窗口、进入可直接提问的新讨论空状态；删除讨论是独立动作，不由新建对话触发。

#### Scenario: 已完成对话新建对话
- **WHEN** 用户在已有首轮回应或追问记录的 AI 窗口中点击"新建对话"
- **THEN** 系统开启一个新讨论，旧讨论保留在讨论集合中且其窗口保持打开
- **AND** 系统在停靠区打开新讨论自己的窗口并进入新讨论的空状态
- **AND** 直接提问输入回到空白可提交前状态

#### Scenario: 首轮请求中开始新对话
- **WHEN** 首轮请求仍在加载且用户点击"新建对话"
- **THEN** 系统开启一个新讨论并在自己的窗口中进入新讨论的空状态
- **AND** 旧讨论中仍在加载的首轮请求其结果归属旧讨论，不显示在新讨论中

#### Scenario: 追问请求中开始新对话
- **WHEN** 追问请求仍在加载且用户点击"新建对话"
- **THEN** 系统开启一个新讨论并在自己的窗口中进入新讨论的空状态
- **AND** 旧讨论中仍在加载的追问请求其结果归属旧讨论，不修改新讨论

#### Scenario: 新建对话保留旧讨论档案
- **WHEN** 用户点击"新建对话"开启新讨论
- **THEN** 系统显示新讨论窗口，旧讨论保留为档案
- **AND** 系统提供会话列表以重开旧讨论；删除旧讨论是独立动作，不由新建对话触发

