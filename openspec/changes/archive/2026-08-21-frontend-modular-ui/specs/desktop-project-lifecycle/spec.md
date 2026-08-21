# desktop-project-lifecycle Delta

## MODIFIED Requirements

### Requirement: User can create a project folder
系统 SHALL 允许用户通过作品名和保存位置创建一部新作品，并在保存位置下创建以作品名命名的作品文件夹。系统 MUST NOT overwrite or delete an existing same-name folder, and failed creation cleanup MUST only remove filesystem entries created by the current creation attempt. 新建作品 SHALL 创建一棵内容树，根级包含一篇默认文档，而非固定的「草稿本」「正文本」两篇。

#### Scenario: Create valid project
- **WHEN** 用户输入非空作品名并选择可访问的保存位置
- **THEN** 系统创建对应作品文件夹
- **AND** 系统创建一棵内容树，根级包含一篇默认文档
- **AND** 系统按稳定文档 ID 在 `作品文本/documents/<id>.json` 保存该篇文档的正文（格式版本 2）
- **AND** 系统在 `next-story-system/content-tree.json` 保存内容树元数据（节点身份、类型、父级、子级顺序、名称，不含正文）
- **AND** 系统创建项目结构版本为整数 `3` 的 `next-story-system/project.json`

#### Scenario: Empty project name
- **WHEN** 用户尝试使用空作品名创建作品
- **THEN** 系统拒绝创建作品
- **AND** 系统提示用户填写作品名

#### Scenario: Invalid project name
- **WHEN** 用户尝试使用包含当前操作系统非法文件名字符的作品名创建作品
- **THEN** 系统拒绝创建作品
- **AND** 系统提示用户更换作品名

#### Scenario: Inaccessible save location
- **WHEN** 用户选择系统无法访问或无法写入的保存位置创建作品
- **THEN** 系统拒绝创建作品
- **AND** 系统提示用户更换保存位置

#### Scenario: Project folder already exists
- **WHEN** 用户选择的保存位置下已经存在同名文件夹
- **THEN** 系统拒绝覆盖已有文件夹
- **AND** 系统提示用户更换作品名或保存位置

#### Scenario: Failed create does not delete unowned folder
- **WHEN** 创建作品过程中失败
- **AND** 目标作品文件夹 was not created by the current create attempt
- **THEN** 系统 MUST NOT delete that folder
- **AND** 系统 MAY remove only files or directories that the current create attempt created

### Requirement: User can open a valid project folder
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构和内容树。系统 MUST 先以只读方式校验 `project.json` 的项目结构版本为整数 3，只有版本受支持后才可运行可能写盘的事务恢复或迁移。系统 MUST reject project structures whose required project directories or files are symlinks, reparse points, or resolve outside the selected project folder, MUST reject required project files that exceed the supported read-size limit before reading them into memory, and MUST recover or reject interrupted manual-save transactions before loading document contents. 打开成功时系统 SHALL 返回整棵内容树结构，前端据此确定当前文档。

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含内容树元数据文件、文档正文文件和 `next-story-system/project.json` 的文件夹
- **AND** all required project directories and files are normal filesystem entries inside the selected project folder
- **AND** `project.json` 的项目结构版本为整数 `3`
- **AND** required project files are within supported read-size limits and contain supported valid structures
- **AND** no interrupted manual-save transaction is present or recovery completes successfully
- **THEN** 系统打开该作品
- **AND** 系统进入编辑器
- **AND** 系统返回整棵内容树结构，前端据以展示当前文档

#### Scenario: Open invalid project folder
- **WHEN** 用户选择的文件夹缺少必要作品结构
- **THEN** 系统拒绝打开该文件夹
- **AND** 系统提示这不是有效的 Next Story 作品文件夹

#### Scenario: Required project path escapes selected folder
- **WHEN** 用户选择的文件夹 contains a required project directory or file that is a symlink, reparse point, or resolves outside the selected project folder
- **THEN** 系统拒绝打开该文件夹
- **AND** 系统提示这不是有效的 Next Story 作品文件夹

#### Scenario: Required project file is too large
- **WHEN** 用户选择的文件夹 contains `project.json`, `content-tree.json`, or a document body file above the supported read-size limit
- **THEN** 系统拒绝打开该文件夹 before reading that file into memory
- **AND** 系统提示这不是有效的 Next Story 作品文件夹 or that the file cannot be read safely

#### Scenario: Notebook document is invalid
- **WHEN** 任一文档正文 JSON 损坏、格式版本不支持或文档 schema 非法
- **THEN** 系统拒绝打开该文件夹 before entering the editor
- **AND** 系统显示中文可读错误
- **AND** 系统不把失败文档替换为空白内容

#### Scenario: Reject old project structure version
- **WHEN** 用户选择的作品使用项目结构版本 1 和旧 `.txt` 本子文件
- **THEN** 系统拒绝打开该作品
- **AND** 系统显示该项目结构版本不受支持的中文错误
- **AND** 系统不迁移、重命名、删除或改写任何原文件

#### Scenario: Reject unknown future project structure version
- **WHEN** `project.json` 的项目结构版本不是整数 3
- **THEN** 系统拒绝打开该作品 before reading document contents into the editor
- **AND** 系统不把未知版本按版本 3 解释或写回

#### Scenario: Unsupported version with interrupted transaction remains untouched
- **WHEN** 项目结构版本不是整数 3 且作品目录同时包含中断事务文件
- **THEN** 系统在运行任何事务恢复前拒绝打开
- **AND** 原项目文件和事务文件的字节保持不变

#### Scenario: Open project with unrecoverable interrupted save
- **WHEN** 用户选择的文件夹 contains an interrupted manual-save transaction
- **AND** 系统 cannot recover the project to one coherent valid generation
- **THEN** 系统拒绝打开该文件夹 before entering the editor
- **AND** 系统提示作品无法安全恢复或读取

## REMOVED Requirements

### Requirement: 前端最小适配仍返回/保存两篇迁移文档（过渡边界）
**Reason**: 过渡形态已完成使命。前端已改为按内容树工作：打开作品返回整棵树、按文档 ID 读写正文、写作页只编辑当前文档。旧的「草稿本」「正文本」双槽位契约与配套命令被移除。

**Migration**: 旧双槽位 `open_project` / `save_project` 命令及其前端封装一并移除；前端改用 `open_content_tree` + `read_document` + `save_document` 命令。旧作品迁移出的「草稿本」「正文本」两篇普通文档在内容树中作为普通文档继续可见可编辑，无数据迁移。
