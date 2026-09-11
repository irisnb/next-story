# conversation-persistence 变更增量

## MODIFIED Requirements

### Requirement: 讨论记录保存到作品文件夹内独立目录

系统 SHALL 将每个讨论的档案保存为作品文件夹内 `next-story-system/conversations/<conversation_id>.json` 的独立版本化 JSON 文件，MUST 与作品正文分开存放，并 SHALL 在档案中记录讨论身份、创建与更新时间、关注文档身份、轮次文本与生成终态、首轮材料来源，以及可选的自定义标题与置顶标记。自定义标题与置顶标记 SHALL 可由用户更新并持久化；字段缺失时 SHALL 按「未重命名、未置顶」处理，不视为损坏。

#### Scenario: 讨论档案写入作品文件夹

- **WHEN** 一个讨论产生需要保存的内容
- **THEN** 该讨论的档案写入其所属作品文件夹的 `next-story-system/conversations/` 目录
- **AND** 档案不写入作品正文目录，也不写入应用数据目录

#### Scenario: 重命名与置顶持久化

- **WHEN** 用户重命名或置顶一个讨论
- **THEN** 该讨论档案中的自定义标题或置顶标记被更新
- **AND** 重启后列表与窗口仍显示重命名后的标题与置顶状态

#### Scenario: 旧档案缺少扩展字段

- **WHEN** 读取一个没有自定义标题或置顶标记字段的旧档案
- **THEN** 系统按「未重命名、未置顶」处理并正常显示
- **AND** 不将该档案视为损坏或跳过

### Requirement: 删除讨论移除对应档案

系统 SHALL 在删除讨论时移除其档案文件，并 MUST NOT 遗留孤儿档案；若用户在删除提示期内撤销删除，系统 SHALL 恢复该讨论及其档案。

#### Scenario: 删除后档案移除

- **WHEN** 用户删除某讨论
- **THEN** 该讨论的档案文件被移除
- **AND** 重启后不再出现在列表中

#### Scenario: 撤销删除恢复档案

- **WHEN** 用户在删除提示期内撤销删除
- **THEN** 系统恢复该讨论及其档案
- **AND** 列表重新显示该讨论
