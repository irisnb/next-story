# desktop-project-lifecycle Specification

## Purpose
TBD - created by archiving change establish-desktop-project-foundation. Update Purpose after archive.
## Requirements
### Requirement: Welcome page provides project entry points
系统 SHALL 在启动后显示简单欢迎页，并只提供新建作品和打开作品两个主要入口。

#### Scenario: Launch application
- **WHEN** 用户启动应用
- **THEN** 系统显示欢迎页
- **AND** 欢迎页提供“新建作品”和“打开作品”入口

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
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构。系统 MUST reject project structures whose required project directories or files are symlinks, reparse points, or resolve outside the selected project folder, MUST reject required project files that exceed the supported read-size limit before reading them into memory, and MUST recover or reject interrupted manual-save transactions before loading notebook contents.

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含 `作品文本/草稿本.txt`、`作品文本/正文本.txt` 和 `next-story-system/project.json` 的文件夹
- **AND** all required project directories and files are normal filesystem entries inside the selected project folder
- **AND** required project files are within supported read-size limits
- **AND** no interrupted manual-save transaction is present or recovery completes successfully
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

#### Scenario: Open project with unrecoverable interrupted save
- **WHEN** 用户选择的文件夹 contains an interrupted manual-save transaction
- **AND** 系统 cannot recover the project to one coherent generation
- **THEN** 系统拒绝打开该文件夹 before entering the editor
- **AND** 系统提示作品无法安全恢复或读取

### Requirement: Project metadata is separate from user text
系统 SHALL 将作品元信息保存在系统抽屉内，并 MUST NOT 将草稿本或正文本内容保存到项目元信息文件中。

#### Scenario: Project metadata created
- **WHEN** 系统创建新作品
- **THEN** 系统在 `next-story-system/project.json` 中保存作品元信息
- **AND** `project.json` 不包含草稿本正文内容
- **AND** `project.json` 不包含正文本正文内容

### Requirement: User can save both notebooks manually
系统 SHALL 允许用户手动保存当前作品，并 SHALL treat one manual save as a single coherent generation across `草稿本.txt`, `正文本.txt`, and `next-story-system/project.json`. 系统 MUST NOT load or present a mixed-generation project state after a failed or interrupted save.

#### Scenario: Save both notebooks successfully
- **WHEN** 用户在任一本子中修改文本
- **AND** 用户触发手动保存
- **THEN** 系统保存 `草稿本.txt`
- **AND** 系统保存 `正文本.txt`
- **AND** 系统更新 `next-story-system/project.json` 中的 `updated_at`
- **AND** the saved draft, main, and metadata belong to the same completed save generation

#### Scenario: Save is interrupted before completion
- **WHEN** 用户触发手动保存
- **AND** the save fails or the process stops before the save generation is committed
- **THEN** 系统 MUST NOT treat the partially written visible files as a completed save generation
- **AND** a later project open or save MUST recover to one coherent generation or fail with a clear project error before entering the editor

#### Scenario: Reopen after interrupted save recovery
- **WHEN** 用户打开 a project that contains an interrupted manual-save transaction
- **THEN** 系统 runs recovery before reading notebook contents into the editor
- **AND** 系统 opens the project only if `草稿本.txt`, `正文本.txt`, and `project.json` are recovered to one coherent generation
- **AND** 系统 refuses to open the project with a clear error if recovery cannot determine a coherent generation

#### Scenario: Failed save does not mark editor baseline as saved
- **WHEN** 用户触发手动保存
- **AND** the backend reports that save failed or recovery failed
- **THEN** 前端 MUST keep the current editor contents marked as unsaved
- **AND** 前端 MUST NOT report the failed save as saved
