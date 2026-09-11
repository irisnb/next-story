# conversation-persistence Specification

## Purpose
TBD - created by archiving change add-conversation-persistence-and-isolation. Update Purpose after archive.
## Requirements
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

### Requirement: 用户轮接受即保存，终态原子更新

系统 SHALL 在用户轮被接受时立即写入该轮（终态为进行中），并 SHALL 在生成到达终态（成功、失败或取消）时原子更新该轮终态。保存 MUST 使用原子写入，不得留下半写文件。

#### Scenario: 生成中途崩溃保留已接受轮次

- **WHEN** 用户轮已被接受并保存，随后生成中途应用退出
- **THEN** 重开后该轮显示为中断终态
- **AND** 已保存内容完好，系统不自动重发该轮

### Requirement: 保存失败对用户可见

系统 SHALL 在讨论档案保存失败时向用户显示失败提示，MUST NOT 伪装成已经保存，也 MUST NOT 静默丢弃。

#### Scenario: 保存失败如实提示

- **WHEN** 讨论档案写入失败
- **THEN** 用户看到保存失败的提示
- **AND** 界面不显示「已保存」状态

### Requirement: 重启后按作品提供会话列表与重开

系统 SHALL 在应用重启后为当前作品列出已保存的讨论，并 SHALL 支持从列表打开查看。列表 MUST 只列出当前作品的讨论，MUST NOT 混入其他作品。

#### Scenario: 重启后列表恢复

- **WHEN** 应用重启后打开一部有已保存讨论的作品
- **THEN** 系统列出该作品的已保存讨论
- **AND** 用户可打开任一讨论查看已保存内容

#### Scenario: 列表不混入其他作品

- **WHEN** 当前作品切换为另一部
- **THEN** 列表只显示该作品的讨论

### Requirement: 读取容错不拖垮列表

系统 SHALL 有界读取讨论档案并对内容做校验；损坏或超限的档案 MUST 被跳过并如实提示，不得导致列表崩溃，也不得静默丢弃正常档案。

#### Scenario: 损坏档案不影响其他讨论

- **WHEN** 某讨论档案损坏或超出大小上限
- **THEN** 列表仍正常显示其余讨论
- **AND** 对损坏项给出可见提示

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

### Requirement: 讨论档案服务不向 AI 提供写入口

系统 MUST NOT 把讨论档案的保存、删除命令注册为 AI 可调用的工具，AI 路径 MUST 保持零写回作品文档与讨论档案。讨论档案由受控应用服务在用户操作驱动下写入。

#### Scenario: AI 无讨论档案写能力

- **WHEN** 检查 AI 可调用的工具与命令集合
- **THEN** 其中不存在任何写入、删除或修改讨论档案的入口

### Requirement: 讨论档案不是作品事实源

系统 SHALL 将讨论档案视为 AI 输出临时材料的记录；保存讨论 MUST NOT 等于写入作品正文，也不得赋予 AI 修改作品文档的能力。

#### Scenario: 保存讨论不触碰作品正文

- **WHEN** 讨论档案被保存
- **THEN** 作品正文文件不被修改
- **AND** AI 输出仍只能由用户亲手复制、编辑、保存后进入作品文本

