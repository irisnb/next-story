## MODIFIED Requirements

### Requirement: User can edit draft and main text
系统 SHALL 允许用户在由 Tiptap/ProseMirror 承载的草稿本和正文本中输入和编辑纯文本。编辑器内部文档结构 MUST NOT 改变两个本子对保存状态和项目存储暴露的完整纯文本语义。

#### Scenario: Edit draft notebook
- **WHEN** 用户在草稿本编辑区输入文本
- **THEN** 系统在草稿本编辑区显示用户输入的文本
- **AND** 草稿本当前纯文本随用户编辑更新

#### Scenario: Edit main text notebook
- **WHEN** 用户在正文本编辑区输入文本
- **THEN** 系统在正文本编辑区显示用户输入的文本
- **AND** 正文本当前纯文本随用户编辑更新

#### Scenario: Internal editor update does not create user text
- **WHEN** 系统初始化或销毁 Tiptap/ProseMirror 编辑器实例
- **THEN** 系统不把内部编辑器结构、占位内容或生命周期事件计入用户本子文字
- **AND** 系统不因此把未编辑作品标记为有未保存修改

### Requirement: Notebook switching preserves unsaved input
系统 SHALL 在草稿本与正文本之间切换时，分别保留两个本子当前尚未保存的完整纯文本、各自编辑历史和可继续编辑的上下文，且 MUST NOT 因标签切换要求用户保存或把切换本身记录为文字编辑。

#### Scenario: Switch away from an edited draft notebook and return
- **WHEN** 用户修改草稿本但尚未保存
- **AND** 用户切换到正文本后再切回草稿本
- **THEN** 草稿本显示切换前的全部未保存修改
- **AND** 系统不显示离开作品提示
- **AND** 系统不自动保存任何本子
- **AND** 标签切换不产生额外撤销步骤

#### Scenario: Both notebooks contain unsaved input
- **WHEN** 用户先后修改草稿本和正文本且尚未保存
- **AND** 用户在两个标签页之间切换
- **THEN** 两个本子分别显示各自当前的未保存内容
- **AND** 任一本子的内容和撤销历史都不覆盖另一本子

### Requirement: Editor communicates save state
系统 SHALL 根据两个本子从编辑器内核投影得到的当前完整纯文本和最后一次成功保存的完整纯文本，显示“有未保存修改”“正在保存…”“已保存”或“保存失败：<原因>”中的对应状态。系统 MUST NOT 使用 ProseMirror 文档对象、JSON 或 HTML 代替项目纯文本判断保存状态。

#### Scenario: User creates an unsaved change
- **WHEN** 用户修改任一本子的可见纯文本，使其不同于最后一次成功保存的内容
- **THEN** 系统显示“有未保存修改”

#### Scenario: User reverts all edits before saving
- **WHEN** 用户修改一个或两个本子后，又把两个本子的完整纯文本都恢复为最后一次成功保存的内容
- **THEN** 系统显示“已保存”

#### Scenario: Save is in progress
- **WHEN** 系统正在保存草稿本和正文本
- **THEN** 系统显示“正在保存…”
- **AND** 系统不启动第二次并发保存

#### Scenario: Save succeeds without later edits
- **WHEN** 保存成功
- **AND** 保存期间用户没有产生晚于本次纯文本保存快照的新修改
- **THEN** 系统显示“已保存”

#### Scenario: Current content changes after save snapshot
- **WHEN** 系统已经冻结本次保存的草稿本和正文本纯文本快照
- **AND** 当前编辑器纯文本在保存完成前后与该快照不同
- **THEN** 系统显示“有未保存修改”
- **AND** 系统 MUST NOT 把快照之后的修改标记为已保存

#### Scenario: Manual save fails
- **WHEN** 用户手动保存草稿本和正文本
- **AND** 写盘失败
- **THEN** 系统显示“保存失败：<原因>”
- **AND** 当前纯文本仍被视为未保存修改
