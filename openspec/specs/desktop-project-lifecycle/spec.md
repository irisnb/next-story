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
系统 SHALL 允许用户通过作品名和保存位置创建一部新作品，并在保存位置下创建以作品名命名的作品文件夹。

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

### Requirement: User can open a valid project folder
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构。

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含 `作品文本/草稿本.txt`、`作品文本/正文本.txt` 和 `next-story-system/project.json` 的文件夹
- **THEN** 系统打开该作品
- **AND** 系统进入编辑器
- **AND** 系统默认显示草稿本

#### Scenario: Open invalid project folder
- **WHEN** 用户选择的文件夹缺少必要作品结构
- **THEN** 系统拒绝打开该文件夹
- **AND** 系统提示这不是有效的 Next Story 作品文件夹

### Requirement: Project metadata is separate from user text
系统 SHALL 将作品元信息保存在系统抽屉内，并 MUST NOT 将草稿本或正文本内容保存到项目元信息文件中。

#### Scenario: Project metadata created
- **WHEN** 系统创建新作品
- **THEN** 系统在 `next-story-system/project.json` 中保存作品元信息
- **AND** `project.json` 不包含草稿本正文内容
- **AND** `project.json` 不包含正文本正文内容
