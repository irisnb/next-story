## MODIFIED Requirements

### Requirement: User can create a project folder
系统 SHALL 允许用户通过作品名和保存位置创建一部新作品，并在保存位置下创建以作品名命名的作品文件夹。系统 MUST NOT overwrite or delete an existing same-name folder, and failed creation cleanup MUST only remove filesystem entries created by the current creation attempt.

#### Scenario: Create valid project
- **WHEN** 用户输入非空作品名并选择可访问的保存位置
- **THEN** 系统创建对应作品文件夹
- **AND** 系统创建 `作品文本/草稿本.txt`
- **AND** 系统创建 `作品文本/正文本.txt`
- **AND** 系统创建 `next-story-system/project.json`

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
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构。系统 MUST reject project structures whose required project directories or files are symlinks, reparse points, or resolve outside the selected project folder, and MUST reject required project files that exceed the supported read-size limit before reading them into memory.

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含 `作品文本/草稿本.txt`、`作品文本/正文本.txt` 和 `next-story-system/project.json` 的文件夹
- **AND** all required project directories and files are normal filesystem entries inside the selected project folder
- **AND** required project files are within supported read-size limits
- **THEN** 系统打开该作品
- **AND** 系统进入编辑器
- **AND** 系统默认显示草稿本

#### Scenario: Open invalid project folder
- **WHEN** 用户选择的文件夹缺少必要作品结构
- **THEN** 系统拒绝打开该文件夹
- **AND** 系统提示这不是有效的 Next Story 作品文件夹

#### Scenario: Required project path escapes selected folder
- **WHEN** 用户选择的文件夹 contains a required project directory or file that is a symlink, reparse point, or resolves outside the selected project folder
- **THEN** 系统拒绝打开该文件夹
- **AND** 系统提示这不是有效的 Next Story 作品文件夹

#### Scenario: Required project file is too large
- **WHEN** 用户选择的文件夹 contains `project.json`, `草稿本.txt`, or `正文本.txt` above the supported read-size limit
- **THEN** 系统拒绝打开该文件夹 before reading that file into memory
- **AND** 系统提示这不是有效的 Next Story 作品文件夹 or that the file cannot be read safely
