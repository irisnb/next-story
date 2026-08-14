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
系统在编辑器标签页、本子内存状态与保存相关前端状态中，对两个用户文本本子的代码标识 SHALL 仅为 `draft` 与 `main`，并 MUST 分别唯一对应草稿本与正文本。系统 MUST NOT 为同一本子引入第二套并行英文标识。用户可见名称与磁盘文件名仍为中文「草稿本」「正文本」，本轮磁盘路径为 `作品文本/草稿本.json` 与 `作品文本/正文本.json`。

#### Scenario: 标签页与状态使用 draft/main
- **WHEN** 实现或读取当前本子标签、本子内存文档键或保存快照中的本子字段
- **THEN** 草稿本使用代码标识 `draft`
- **AND** 正文本使用代码标识 `main`
- **AND** 不存在第三种本子代码标识表示上述二者之一

#### Scenario: 代码标识不改变用户可见命名
- **WHEN** 用户查看编辑器标签或作品文件夹中的本子文件
- **THEN** 仍看到草稿本与正文本及 `作品文本/草稿本.json`、`作品文本/正文本.json`
- **AND** 代码层 `draft`/`main` 不作为第二套产品中文名展示给用户

#### Scenario: 保存字段语义保持不变
- **WHEN** 系统保存或重新打开作品
- **THEN** 草稿本结构化文档仍按草稿本保存流程处理
- **AND** 正文本结构化文档仍按正文本保存流程处理
- **AND** Rust 或 IPC 中既有 `main_content` 语义仍只指正文本内容

#### Scenario: 禁止为正文本恢复第二英文名
- **WHEN** 后续实现新增与两个本子相关的前端状态、测试夹具或内部快照字段
- **THEN** 草稿本 SHALL 使用 `draft`
- **AND** 正文本 SHALL 使用 `main`
- **AND** 不得使用 `manuscript`、`screenplay` 或其它英文名再次表示正文本

### Requirement: User can edit draft and main text
系统 SHALL 允许用户在由 Tiptap/ProseMirror 承载的草稿本和正文本中输入、编辑文字并应用本轮支持的基础格式。编辑器内部文档结构 MUST 完整对应两个本子对保存状态和项目存储暴露的 Tiptap JSON 事实源。

#### Scenario: Edit draft notebook
- **WHEN** 用户在草稿本编辑区输入文字或应用支持格式
- **THEN** 系统在草稿本编辑区显示对应文字和格式
- **AND** 草稿本当前结构化文档随用户编辑更新

#### Scenario: Edit main text notebook
- **WHEN** 用户在正文本编辑区输入文字或应用支持格式
- **THEN** 系统在正文本编辑区显示对应文字和格式
- **AND** 正文本当前结构化文档随用户编辑更新

#### Scenario: Internal editor update does not create user content
- **WHEN** 系统初始化或销毁 Tiptap/ProseMirror 编辑器实例
- **THEN** 系统不把占位内容或生命周期 transaction 计入用户本子文档
- **AND** 系统不因此把未编辑作品标记为有未保存修改

### Requirement: Manual save writes both notebooks
系统 SHALL 在用户触发手动保存时冻结并同时保存草稿本和正文本的完整结构化文档。

#### Scenario: Save from draft tab
- **WHEN** 用户当前位于草稿本标签页并触发保存
- **THEN** 系统将草稿本完整文档写入 `作品文本/草稿本.json`
- **AND** 系统将正文本完整文档写入 `作品文本/正文本.json`

#### Scenario: Save from main text tab
- **WHEN** 用户当前位于正文本标签页并触发保存
- **THEN** 系统将草稿本完整文档写入 `作品文本/草稿本.json`
- **AND** 系统将正文本完整文档写入 `作品文本/正文本.json`

### Requirement: Saved notebook content is loaded when reopening project
系统 SHALL 在重新打开作品时从结构化本子文件中读取并校验草稿本和正文本的完整文档。

#### Scenario: Reopen saved project
- **WHEN** 用户保存草稿本和正文本后关闭作品
- **AND** 用户再次打开同一作品文件夹
- **THEN** 系统从 `作品文本/草稿本.json` 读取草稿本文档
- **AND** 系统从 `作品文本/正文本.json` 读取正本文档
- **AND** 编辑器显示的文字和支持格式与上次手动保存一致

### Requirement: Notebook switching preserves unsaved input
系统 SHALL 在草稿本与正文本之间切换时，分别保留两个本子当前尚未保存的完整结构化文档、各自编辑历史和可继续编辑的上下文，且 MUST NOT 因标签切换要求用户保存或把切换本身记录为编辑。

#### Scenario: Switch away from an edited draft notebook and return
- **WHEN** 用户修改草稿本内容或格式但尚未保存
- **AND** 用户切换到正文本后再切回草稿本
- **THEN** 草稿本显示切换前的全部未保存修改
- **AND** 系统不显示离开作品提示
- **AND** 系统不自动保存任何本子
- **AND** 标签切换不产生额外撤销步骤

#### Scenario: Both notebooks contain unsaved input
- **WHEN** 用户先后修改草稿本和正文本且尚未保存
- **AND** 用户在两个标签页之间切换
- **THEN** 两个本子分别显示各自当前的未保存文字和格式
- **AND** 任一本子的文档和撤销历史都不覆盖另一本子

### Requirement: Leaving a project protects unsaved changes
系统 SHALL 在应用内操作即将卸载当前作品且任一本子的当前完整结构化文档不同于最后一次成功保存的完整结构化文档时，要求用户选择“保存并离开”“不保存并离开”或“取消”。未保存判断 MUST 包含只有标题、粗体、斜体或列表结构发生变化而可见纯文本未变化的情况。

#### Scenario: Only formatting changed before leaving
- **WHEN** 用户只修改任一本子的支持格式且可见文字保持不变
- **AND** 用户执行打开其他作品、返回欢迎页或其它会卸载当前作品的操作
- **THEN** 系统显示未保存修改提示

#### Scenario: Leave after reverting formatting to baseline
- **WHEN** 用户修改支持格式后又把两个本子的完整结构化文档恢复为最后一次成功保存的结构
- **AND** 用户执行会卸载当前作品的操作
- **THEN** 系统不显示未保存修改提示
- **AND** 系统继续原来的离开操作

#### Scenario: Save formatting and leave
- **WHEN** 任一本子只有支持格式存在未保存修改
- **AND** 用户选择“保存并离开”
- **THEN** 系统保存两份当前完整结构化文档
- **AND** 系统仅在保存成功后继续原来的离开操作

#### Scenario: Leave a project and save changes
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户执行打开其他作品、返回欢迎页或其他会卸载当前作品的操作
- **AND** 用户选择“保存并离开”
- **THEN** 系统同时保存草稿本和正文本的当前完整结构化文档
- **AND** 系统仅在保存成功后继续原来的离开操作

#### Scenario: Leave a project without saving changes
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统继续原来的离开操作

#### Scenario: Cancel leaving a project
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“取消”
- **THEN** 系统留在当前作品
- **AND** 草稿本和正文本的当前完整结构化文档与历史保持不变

#### Scenario: Leave a project with no unsaved changes
- **WHEN** 草稿本和正文本的完整结构化文档都等于最后一次成功保存的结构
- **AND** 用户执行会卸载当前作品的操作
- **THEN** 系统不显示未保存修改提示
- **AND** 系统继续原来的离开操作

### Requirement: Closing the application protects unsaved changes
系统 SHALL 在桌面窗口即将关闭且任一本子的当前完整结构化文档不同于最后一次成功保存的完整结构化文档时阻止默认关闭，并要求用户选择“保存并离开”“不保存并离开”或“取消”。该判断 MUST 与编辑器显示的结构化保存状态使用同一事实源，并 MUST 包含仅格式变化。

#### Scenario: Only formatting changed before window close
- **WHEN** 用户只修改任一本子的支持格式且可见文字保持不变
- **AND** 用户请求关闭桌面窗口
- **THEN** 系统阻止默认关闭并显示未保存修改提示

#### Scenario: Save formatting and close
- **WHEN** 任一本子只有支持格式存在未保存修改
- **AND** 用户请求关闭桌面窗口并选择“保存并离开”
- **THEN** 系统保存两份当前完整结构化文档
- **AND** 系统仅在保存成功后关闭窗口

#### Scenario: Close the application and save changes
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“保存并离开”
- **THEN** 系统同时保存草稿本和正文本的当前完整结构化文档
- **AND** 系统仅在保存成功后关闭窗口

#### Scenario: Close the application without saving changes
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统关闭窗口

#### Scenario: Cancel closing the application
- **WHEN** 任一本子的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“取消”
- **THEN** 系统保持窗口打开
- **AND** 草稿本和正文本的当前完整结构化文档与历史保持不变

#### Scenario: Close the application with no unsaved changes
- **WHEN** 草稿本和正文本的完整结构化文档都等于最后一次成功保存的结构
- **AND** 用户请求关闭桌面窗口
- **THEN** 系统不显示未保存修改提示
- **AND** 系统关闭窗口

### Requirement: Save failure never discards current input
系统 MUST 在“保存并离开”写盘失败时中止原来的离开或关闭操作，保留两个本子的当前完整结构化文档与编辑历史，并向用户显示可读的失败信息。

#### Scenario: Formatting save fails while leaving
- **WHEN** 用户选择“保存并离开”且当前修改只涉及支持格式
- **AND** 保存任一本子失败
- **THEN** 系统不执行原来的离开或关闭操作
- **AND** 两个本子的当前文字、格式和历史保持不变

#### Scenario: Save fails while leaving a project
- **WHEN** 用户选择“保存并离开”以离开当前作品
- **AND** 保存草稿本或正文本失败
- **THEN** 系统不执行原来的离开操作
- **AND** 系统保留草稿本和正文本的当前完整结构化文档与历史
- **AND** 系统显示保存失败信息

#### Scenario: Save fails while closing the application
- **WHEN** 用户选择“保存并离开”以关闭桌面窗口
- **AND** 保存草稿本或正文本失败
- **THEN** 系统保持窗口打开
- **AND** 系统保留草稿本和正文本的当前完整结构化文档与历史
- **AND** 系统显示保存失败信息

### Requirement: Editor communicates save state
系统 SHALL 根据两个本子的当前完整结构化文档和最后一次成功保存的完整结构化文档，显示“有未保存修改”“正在保存…”“已保存”或“保存失败：<原因>”中的对应状态。系统 MUST 比较规范化的结构值，且 MUST NOT 使用 HTML 或纯文本投影代替结构化事实源判断保存状态。

#### Scenario: User creates an unsaved content change
- **WHEN** 用户修改任一本子的可见文字或支持格式，使完整结构化文档不同于最后一次成功保存的文档
- **THEN** 系统显示“有未保存修改”

#### Scenario: User reverts all edits before saving
- **WHEN** 用户修改一个或两个本子后，又把两个本子的完整结构化文档都恢复为最后一次成功保存的内容
- **THEN** 系统显示“已保存”

#### Scenario: Save is in progress
- **WHEN** 系统正在保存草稿本和正文本的冻结文档快照
- **THEN** 系统显示“正在保存…”
- **AND** 系统不启动第二次并发保存

#### Scenario: Save succeeds without later edits
- **WHEN** 保存成功
- **AND** 保存期间用户没有产生晚于本次结构化文档快照的新修改
- **THEN** 系统显示“已保存”

#### Scenario: Current document changes after save snapshot
- **WHEN** 系统已经冻结本次保存的草稿本和正文本结构化文档快照
- **AND** 当前任一本子文档在保存完成前后与该快照不同
- **THEN** 系统显示“有未保存修改”
- **AND** 系统 MUST NOT 把快照之后的修改标记为已保存

#### Scenario: Manual save fails
- **WHEN** 用户手动保存草稿本和正文本
- **AND** 写盘失败
- **THEN** 系统显示“保存失败：<原因>”
- **AND** 当前结构化文档仍被视为未保存修改

### Requirement: AI and background automation never write user notebooks
系统 MUST 永久禁止 AI、AI 面板或后台自动流程向草稿本和正文本插入、追加、替换、改写、删除、移动、拆分、合并、分类或以其它方式整理任何字符或结构。AI 输出 MUST 只作为本子之外的临时材料显示；即使用户确认或授权，也 MUST 由用户亲手复制、粘贴、编辑并保存后才成为作品内容。本 change 不得新增任何绕过该边界的命令、IPC、回调或编辑器 transaction。

#### Scenario: AI 回应只进入 AI 面板
- **WHEN** 首次 AI 请求或后续追问成功返回回应
- **THEN** 回应只显示在 AI 面板中
- **AND** 草稿本和正文本的结构化文档、历史和保存状态不因回应而改变

#### Scenario: 用户要求 AI 直接写入
- **WHEN** 用户要求或确认把 AI 输出直接应用到草稿本或正文本
- **THEN** 系统不提供或执行直接写入动作
- **AND** AI 输出仍保持为本子之外可由用户自行取用的临时材料

#### Scenario: 后台流程不得整理本子
- **WHEN** AI 或后台流程生成分类、改写、摘要或其它候选内容
- **THEN** 系统不得因此拆分、合并、移动、删除或重排任一本子的结构或字符

