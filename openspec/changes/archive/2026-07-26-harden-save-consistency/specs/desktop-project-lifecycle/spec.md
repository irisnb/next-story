## MODIFIED Requirements

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
