# writing-notebooks Specification

## Purpose
规定写作区文档的保存、离开/关闭保护与保存状态沟通：离开作品与关闭应用前保护当前文档的未保存修改（含仅格式变化），保存失败绝不丢弃当前输入，编辑器如实沟通保存状态；AI 与后台自动化绝不写用户文档。
## Requirements
### Requirement: Leaving a project protects unsaved changes
系统 SHALL 在应用内操作即将卸载当前作品且当前文档的当前完整结构化文档不同于最后一次成功保存的完整结构化文档时，要求用户选择“保存并离开”“不保存并离开”或“取消”。未保存判断 MUST 包含只有标题、粗体、斜体或列表结构发生变化而可见纯文本未变化的情况。应用内离开操作 MUST 等正在进行的中文组合输入自然完成后，在未保存判断、离开确认及所需保存之前暂停正文修改，并持续保护到真正卸载/替换提交或失败/取消；授权返回本身 MUST NOT 解除保护。选择“不保存并离开” MUST 只在实际成功离开时丢弃旧输入，不能提前清空内容、历史或基线。

#### Scenario: Only formatting changed before leaving
- **WHEN** 用户只修改当前文档的支持格式且可见文字保持不变
- **AND** 用户执行打开其他作品、返回欢迎页或其它会卸载当前作品的操作
- **THEN** 系统显示未保存修改提示

#### Scenario: Leave after reverting formatting to baseline
- **WHEN** 用户修改支持格式后又把当前文档的完整结构化文档恢复为最后一次成功保存的结构
- **AND** 用户执行会卸载当前作品的操作
- **THEN** 系统不显示未保存修改提示
- **AND** 系统继续原来的离开操作

#### Scenario: Save formatting and leave
- **WHEN** 当前文档只有支持格式存在未保存修改
- **AND** 用户选择“保存并离开”
- **THEN** 系统保存当前文档的当前完整结构化文档
- **AND** 系统仅在保存成功后继续原来的离开操作

#### Scenario: Leave a project and save changes
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户执行打开其他作品、返回欢迎页或其他会卸载当前作品的操作
- **AND** 用户选择“保存并离开”
- **THEN** 系统保存当前文档的当前完整结构化文档
- **AND** 系统仅在保存成功后继续原来的离开操作

#### Scenario: Leave a project without saving changes
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统继续原来的离开操作

#### Scenario: Cancel leaving a project
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户执行会卸载当前作品的操作
- **AND** 用户选择“取消”
- **THEN** 系统留在当前作品
- **AND** 当前文档的当前完整结构化文档与历史保持不变

#### Scenario: Leave a project with no unsaved changes
- **WHEN** 当前文档的完整结构化文档等于最后一次成功保存的结构
- **AND** 用户执行会卸载当前作品的操作
- **THEN** 系统不显示未保存修改提示
- **AND** 系统继续原来的离开操作

#### Scenario: 授权后读取目标期间仍保护正文
- **WHEN** 用户已允许离开当前作品，但目标作品正文仍在读取或准备
- **THEN** 旧正文和作品身份继续显示，所有正文修改入口保持暂停
- **AND** 系统不能仅因离开确认已返回而解锁编辑

#### Scenario: 不保存离开后目标读取失败
- **WHEN** 用户选择“不保存并离开”，随后目标作品读取或准备失败
- **THEN** 系统保留旧作品、旧树、旧编辑器实例、输入和撤销历史
- **AND** 未保存状态保持，编辑恢复，失败原因可见

#### Scenario: 保存后目标读取失败
- **WHEN** 用户选择“保存并离开”且保存成功，随后目标读取失败
- **THEN** 系统保留旧编辑器和历史并恢复编辑，不切换作品或文件树
- **AND** 保存成功的事实保留，不重新伪造未保存状态

#### Scenario: 返回欢迎页成功或取消
- **WHEN** 用户在没有其他切换进行时请求返回欢迎页
- **THEN** 系统在组合输入结束后暂停正文修改，并按原有三选项保护未保存内容
- **AND** 仅允许离开且所需保存成功时共同卸载编辑器与文件管理并使旧装载失效
- **AND** 取消或保存失败时仍在旧作品，输入、历史及身份不变且可继续编辑

### Requirement: Closing the application protects unsaved changes
系统 SHALL 在桌面窗口即将关闭且当前文档的当前完整结构化文档不同于最后一次成功保存的完整结构化文档时阻止默认关闭，并要求用户选择“保存并离开”“不保存并离开”或“取消”。该判断 MUST 与编辑器显示的结构化保存状态使用同一事实源，并 MUST 包含仅格式变化。

#### Scenario: Only formatting changed before window close
- **WHEN** 用户只修改当前文档的支持格式且可见文字保持不变
- **AND** 用户请求关闭桌面窗口
- **THEN** 系统阻止默认关闭并显示未保存修改提示

#### Scenario: Save formatting and close
- **WHEN** 当前文档只有支持格式存在未保存修改
- **AND** 用户请求关闭桌面窗口并选择“保存并离开”
- **THEN** 系统保存当前文档的当前完整结构化文档
- **AND** 系统仅在保存成功后关闭窗口

#### Scenario: Close the application and save changes
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“保存并离开”
- **THEN** 系统保存当前文档的当前完整结构化文档
- **AND** 系统仅在保存成功后关闭窗口

#### Scenario: Close the application without saving changes
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“不保存并离开”
- **THEN** 系统不保存本次未保存修改
- **AND** 系统关闭窗口

#### Scenario: Cancel closing the application
- **WHEN** 当前文档的完整结构化文档存在未保存修改
- **AND** 用户请求关闭桌面窗口
- **AND** 用户选择“取消”
- **THEN** 系统保持窗口打开
- **AND** 当前文档的当前完整结构化文档与历史保持不变

#### Scenario: Close the application with no unsaved changes
- **WHEN** 当前文档的完整结构化文档等于最后一次成功保存的结构
- **AND** 用户请求关闭桌面窗口
- **THEN** 系统不显示未保存修改提示
- **AND** 系统关闭窗口

### Requirement: Save failure never discards current input
系统 MUST 在“保存并离开”写盘失败时中止原来的离开或关闭操作，保留当前文档的当前完整结构化文档与编辑历史，并向用户显示可读的失败信息。

#### Scenario: Formatting save fails while leaving
- **WHEN** 用户选择“保存并离开”且当前修改只涉及支持格式
- **AND** 保存当前文档失败
- **THEN** 系统不执行原来的离开或关闭操作
- **AND** 当前文档的当前文字、格式和历史保持不变

#### Scenario: Save fails while leaving a project
- **WHEN** 用户选择“保存并离开”以离开当前作品
- **AND** 保存当前文档失败
- **THEN** 系统不执行原来的离开操作
- **AND** 系统保留当前文档的当前完整结构化文档与历史
- **AND** 系统显示保存失败信息

#### Scenario: Save fails while closing the application
- **WHEN** 用户选择“保存并离开”以关闭桌面窗口
- **AND** 保存当前文档失败
- **THEN** 系统保持窗口打开
- **AND** 系统保留当前文档的当前完整结构化文档与历史
- **AND** 系统显示保存失败信息

### Requirement: Editor communicates save state
系统 SHALL 根据当前文档的当前完整结构化文档和最后一次成功保存的完整结构化文档，显示“有未保存修改”“正在保存…”“已保存”或“保存失败：<原因>”中的对应状态。系统 MUST 比较规范化的结构值，且 MUST NOT 使用 HTML 或纯文本投影代替结构化事实源判断保存状态。

#### Scenario: User creates an unsaved content change
- **WHEN** 用户修改当前文档的可见文字或支持格式，使完整结构化文档不同于最后一次成功保存的文档
- **THEN** 系统显示“有未保存修改”

#### Scenario: User reverts all edits before saving
- **WHEN** 用户修改当前文档后，又把当前文档的完整结构化文档恢复为最后一次成功保存的内容
- **THEN** 系统显示“已保存”

#### Scenario: Save is in progress
- **WHEN** 系统正在保存当前文档的冻结文档快照
- **THEN** 系统显示“正在保存…”
- **AND** 系统不启动第二次并发保存

#### Scenario: Save succeeds without later edits
- **WHEN** 保存成功
- **AND** 保存期间用户没有产生晚于本次结构化文档快照的新修改
- **THEN** 系统显示“已保存”

#### Scenario: Current document changes after save snapshot
- **WHEN** 系统已经冻结本次保存的当前文档结构化文档快照
- **AND** 当前文档在保存完成前后与该快照不同
- **THEN** 系统显示“有未保存修改”
- **AND** 系统 MUST NOT 把快照之后的修改标记为已保存

#### Scenario: Manual save fails
- **WHEN** 用户手动保存当前文档
- **AND** 写盘失败
- **THEN** 系统显示“保存失败：<原因>”
- **AND** 当前结构化文档仍被视为未保存修改

### Requirement: AI and background automation never write user notebooks
系统 MUST 永久禁止 AI、AI 面板或后台自动流程向用户文档插入、追加、替换、改写、删除、移动、拆分、合并、分类或以其它方式整理任何字符或结构。AI 输出 MUST 只作为用户文档之外的临时材料显示；即使用户确认或授权，也 MUST 由用户亲手复制、粘贴、编辑并保存后才成为作品内容。本 change 不得新增任何绕过该边界的命令、IPC、回调或编辑器 transaction。

#### Scenario: AI 回应只进入 AI 面板
- **WHEN** 首次 AI 请求或后续追问成功返回回应
- **THEN** 回应只显示在 AI 面板中
- **AND** 用户文档的结构化文档、历史和保存状态不因回应而改变

#### Scenario: 用户要求 AI 直接写入
- **WHEN** 用户要求或确认把 AI 输出直接应用到用户文档
- **THEN** 系统不提供或执行直接写入动作
- **AND** AI 输出仍保持为用户文档之外可由用户自行取用的临时材料

#### Scenario: 后台流程不得整理用户文档
- **WHEN** AI 或后台流程生成分类、改写、摘要或其它候选内容
- **THEN** 系统不得因此拆分、合并、移动、删除或重排任何用户文档的结构或字符

