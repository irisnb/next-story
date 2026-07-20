# writing-notebooks Specification

## Purpose
TBD - created by archiving change establish-desktop-project-foundation. Update Purpose after archive.
## Requirements
### Requirement: Editor provides draft and main text notebooks
系统 SHALL 在编辑器中提供草稿本和正文本两个文本区域，并以标签页方式切换。

#### Scenario: Enter editor after opening project
- **WHEN** 用户打开有效作品
- **THEN** 系统显示草稿本和正文本两个标签页
- **AND** 系统默认选中草稿本标签页

#### Scenario: Switch to main text tab
- **WHEN** 用户点击正文本标签页
- **THEN** 系统显示正文本编辑区

#### Scenario: Switch to draft tab
- **WHEN** 用户点击草稿本标签页
- **THEN** 系统显示草稿本编辑区

### Requirement: 两个本子的代码标识唯一对应
系统在编辑器标签页、本子内存状态与保存相关前端状态中，对两个用户文本本子的代码标识 SHALL 仅为 `draft` 与 `main`，并 MUST 分别唯一对应草稿本与正文本。系统 MUST NOT 为同一本子引入第二套并行英文标识（例如用 `manuscript` 再指正文本）。用户可见名称与磁盘文件名仍为中文「草稿本」「正文本」及既有路径，本要求不授权修改磁盘文件名。

#### Scenario: 标签页与状态使用 draft/main
- **WHEN** 实现或读取当前本子标签、本子内存内容键或保存快照中的本子字段
- **THEN** 草稿本使用代码标识 `draft`
- **AND** 正文本使用代码标识 `main`
- **AND** 不存在第三种本子代码标识表示上述二者之一

#### Scenario: 代码标识不改变用户可见命名
- **WHEN** 用户查看编辑器标签或作品文件夹中的文本文件
- **THEN** 仍看到草稿本与正文本（及既有 `作品文本/草稿本.txt`、`作品文本/正文本.txt`）
- **AND** 代码层 `draft`/`main` 不作为第二套产品中文名展示给用户

#### Scenario: 保存字段语义保持不变
- **WHEN** 系统保存或重新打开作品
- **THEN** 草稿本内容仍按既有草稿本保存流程处理
- **AND** 正文本内容仍按既有正文本保存流程处理
- **AND** 本要求不授权把 Rust 或 IPC 中既有 `main_content` 语义改为其它名称

#### Scenario: 禁止为正文本恢复第二英文名
- **WHEN** 后续实现新增与两个本子相关的前端状态、测试夹具或内部快照字段
- **THEN** 草稿本 SHALL 使用 `draft`
- **AND** 正文本 SHALL 使用 `main`
- **AND** 不得使用 `manuscript`、`screenplay` 或其它英文名再次表示正文本

### Requirement: User can edit draft and main text
系统 SHALL 允许用户在草稿本和正文本中输入和编辑纯文本。

#### Scenario: Edit draft notebook
- **WHEN** 用户在草稿本编辑区输入文本
- **THEN** 系统在草稿本编辑区显示用户输入的文本

#### Scenario: Edit main text notebook
- **WHEN** 用户在正文本编辑区输入文本
- **THEN** 系统在正文本编辑区显示用户输入的文本

### Requirement: Manual save writes both notebooks
系统 SHALL 在用户触发手动保存时同时保存草稿本和正文本。

#### Scenario: Save from draft tab
- **WHEN** 用户当前位于草稿本标签页并触发保存
- **THEN** 系统将草稿本内容写入 `作品文本/草稿本.txt`
- **AND** 系统将正文本内容写入 `作品文本/正文本.txt`

#### Scenario: Save from main text tab
- **WHEN** 用户当前位于正文本标签页并触发保存
- **THEN** 系统将草稿本内容写入 `作品文本/草稿本.txt`
- **AND** 系统将正文本内容写入 `作品文本/正文本.txt`

### Requirement: Saved notebook content is loaded when reopening project
系统 SHALL 在重新打开作品时从用户文本文件中读取草稿本和正文本内容。

#### Scenario: Reopen saved project
- **WHEN** 用户保存草稿本和正文本内容后关闭作品
- **AND** 用户再次打开同一作品文件夹
- **THEN** 系统从 `作品文本/草稿本.txt` 读取草稿本内容
- **AND** 系统从 `作品文本/正文本.txt` 读取正文本内容
- **AND** 编辑器显示的内容与上次手动保存的内容一致

### Requirement: No AI or background automation writes user notebooks in this change
系统 MUST NOT 在本 change 中提供 AI 或后台自动流程直接写入草稿本或正文本的能力。

#### Scenario: First foundation scope excludes AI writes
- **WHEN** 本 change 实现完成
- **THEN** 系统不存在 AI 面板写入草稿本的入口
- **AND** 系统不存在 AI 面板写入正文本的入口
- **AND** 系统不存在自动替换用户选区的入口

### Requirement: Notebook switching preserves unsaved input
系统 SHALL 在草稿本与正文本之间切换时，分别保留两个本子当前尚未保存的内存内容，且 MUST NOT 因标签切换要求用户保存。

#### Scenario: Switch away from an edited draft notebook and return
- **WHEN** 用户修改草稿本但尚未保存
- **AND** 用户切换到正文本后再切回草稿本
- **THEN** 草稿本显示切换前的全部未保存修改
- **AND** 系统不显示离开作品提示
- **AND** 系统不自动保存任何本子

#### Scenario: Both notebooks contain unsaved input
- **WHEN** 用户先后修改草稿本和正文本且尚未保存
- **AND** 用户在两个标签页之间切换
- **THEN** 两个本子分别显示各自当前的未保存内容
- **AND** 任一本子的内容都不覆盖另一本子

### Requirement: Leaving a project protects unsaved changes
系统 SHALL 在应用内操作即将卸载当前作品且任一本子存在未保存修改时，要求用户选择“保存并离开”“不保存并离开”或“取消”。

#### Scenario: Leave a project and save changes
- **WHEN** 任一本子存在未保存修改
- **AND** 用户执行打开其他作品、返回欢迎页或其他会卸载当前作品的操作
- **AND** 用户选择“保存并离开”
- **THEN** 系统同时保存草稿本和正文本的当前内容
- **AND** 系统仅在保存成功后继续原来的离开操作

#### Scenario: Leave a project without saving changes
- **WHEN** 任一本子存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统继续原来的离开操作

#### Scenario: Cancel leaving a project
- **WHEN** 任一本子存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“取消”
- **THEN** 系统留在当前作品
- **AND** 草稿本和正文本的当前内容保持不变

#### Scenario: Leave a project with no unsaved changes
- **WHEN** 草稿本和正文本都不存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **THEN** 系统不显示未保存修改提示
- **AND** 系统继续原来的离开操作

### Requirement: Closing the application protects unsaved changes
系统 SHALL 在桌面窗口即将关闭且任一本子存在未保存修改时阻止默认关闭，并要求用户选择“保存并离开”“不保存并离开”或“取消”。

#### Scenario: Close the application and save changes
- **WHEN** 任一本子存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“保存并离开”
- **THEN** 系统同时保存草稿本和正文本的当前内容
- **AND** 系统仅在保存成功后关闭窗口

#### Scenario: Close the application without saving changes
- **WHEN** 任一本子存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统关闭窗口

#### Scenario: Cancel closing the application
- **WHEN** 任一本子存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“取消”
- **THEN** 系统保持窗口打开
- **AND** 草稿本和正文本的当前内容保持不变

#### Scenario: Close the application with no unsaved changes
- **WHEN** 草稿本和正文本都不存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **THEN** 系统不显示未保存修改提示
- **AND** 系统关闭窗口

### Requirement: Save failure never discards current input
系统 MUST 在“保存并离开”写盘失败时中止原来的离开或关闭操作，保留两个本子的当前输入，并向用户显示可读的失败信息。

#### Scenario: Save fails while leaving a project
- **WHEN** 用户选择“保存并离开”以离开当前作品
- **AND** 保存草稿本或正文本失败
- **THEN** 系统不执行原来的离开操作
- **AND** 系统保留草稿本和正文本的当前输入
- **AND** 系统显示保存失败信息

#### Scenario: Save fails while closing the application
- **WHEN** 用户选择“保存并离开”以关闭桌面窗口
- **AND** 保存草稿本或正文本失败
- **THEN** 系统保持窗口打开
- **AND** 系统保留草稿本和正文本的当前输入
- **AND** 系统显示保存失败信息

### Requirement: Editor communicates save state
系统 SHALL 根据两个本子的当前内存内容和最后一次成功保存的内容，显示“有未保存修改”“正在保存…”“已保存”或“保存失败：<原因>”中的对应状态。

#### Scenario: User creates an unsaved change
- **WHEN** 用户修改任一本子的内容，使其不同于最后一次成功保存的内容
- **THEN** 系统显示“有未保存修改”

#### Scenario: User reverts all edits before saving
- **WHEN** 用户修改一个或两个本子后，又把两个本子的内容都恢复为最后一次成功保存的内容
- **THEN** 系统显示“已保存”

#### Scenario: Save is in progress
- **WHEN** 系统正在保存草稿本和正文本
- **THEN** 系统显示“正在保存…”
- **AND** 系统不启动第二次并发保存

#### Scenario: Save succeeds without later edits
- **WHEN** 保存成功
- **AND** 保存期间用户没有产生晚于本次保存快照的新修改
- **THEN** 系统显示“已保存”

#### Scenario: Current content changes after save snapshot
- **WHEN** 系统已经冻结本次保存的草稿本和正文本内容快照
- **AND** 当前内存内容在保存完成前后与该快照不同
- **THEN** 系统显示“有未保存修改”
- **AND** 系统 MUST NOT 把快照之后的修改标记为已保存

#### Scenario: Manual save fails
- **WHEN** 用户手动保存草稿本和正文本
- **AND** 写盘失败
- **THEN** 系统显示“保存失败：<原因>”
- **AND** 当前内容仍被视为未保存修改
