# desktop-project-lifecycle Specification

## Purpose
TBD - created by archiving change establish-desktop-project-foundation. Update Purpose after archive.
## Requirements
### Requirement: Welcome page provides project entry points
系统 SHALL 在启动后显示简单欢迎页，并提供新建作品、打开作品两个作品入口，以及一个进入 LLM 配置的入口。

#### Scenario: Launch application
- **WHEN** 用户启动应用
- **THEN** 系统显示欢迎页
- **AND** 欢迎页提供“新建作品”和“打开作品”入口
- **AND** 欢迎页提供进入 LLM 配置的入口

### Requirement: User can create a project folder
系统 SHALL 允许用户通过作品名和保存位置创建一部新作品，并在保存位置下创建以作品名命名的作品文件夹。系统 MUST NOT overwrite or delete an existing same-name folder, and failed creation cleanup MUST only remove filesystem entries created by the current creation attempt.

#### Scenario: Create valid project
- **WHEN** 用户输入非空作品名并选择可访问的保存位置
- **THEN** 系统创建对应作品文件夹
- **AND** 系统创建一棵内容树，根级包含两篇普通文档「草稿本」与「正文本」
- **AND** 系统按稳定文档 ID 在 `作品文本/documents/<id>.json` 保存两篇文档的正文（格式版本 2）
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
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构和内容树。系统 MUST 先以只读方式校验 `project.json` 的项目结构版本为整数 3，只有版本受支持后才可运行可能写盘的事务恢复或迁移。系统 MUST reject project structures whose required project directories or files are symlinks, reparse points, or resolve outside the selected project folder, MUST reject required project files that exceed the supported read-size limit before reading them into memory, and MUST recover or reject interrupted manual-save transactions before loading document contents.

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含内容树元数据文件、文档正文文件和 `next-story-system/project.json` 的文件夹
- **AND** all required project directories and files are normal filesystem entries inside the selected project folder
- **AND** `project.json` 的项目结构版本为整数 `3`
- **AND** required project files are within supported read-size limits and contain supported valid structures
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

### Requirement: Project metadata is separate from user text
系统 SHALL 将作品元信息保存在系统抽屉内，并 MUST NOT 将任何文档正文内容保存到项目元信息文件中。

#### Scenario: Project metadata created
- **WHEN** 系统创建新作品
- **THEN** 系统在 `next-story-system/project.json` 中保存作品元信息
- **AND** `project.json` 不包含任何文档正文内容
- **AND** `project.json` 不包含内容树结构

### Requirement: User can save documents manually
系统 SHALL 允许用户手动保存当前作品，并 SHALL treat one manual save as a single coherent generation across the affected document body files and `next-story-system/project.json`. 系统 MUST 在创建事务暂存文件前校验完整结构化文档，并 MUST NOT load or present a mixed-generation project state after a failed or interrupted save.

#### Scenario: Save documents successfully
- **WHEN** 用户在任一文档中修改文字或支持格式
- **AND** 用户触发手动保存
- **THEN** 系统保存受影响的文档正文文件
- **AND** 系统更新 `next-story-system/project.json` 中的 `updated_at`
- **AND** the saved documents and metadata belong to the same completed save generation

#### Scenario: Reject invalid notebook before staging
- **WHEN** 用户触发手动保存
- **AND** 任一文档的完整文档未通过后端格式版本 2 校验
- **THEN** 系统在创建事务暂存文件前拒绝保存
- **AND** 可见项目文件保持原有完整世代

#### Scenario: Save is interrupted before completion
- **WHEN** 用户触发手动保存
- **AND** the save fails or the process stops before the save generation is committed
- **THEN** 系统 MUST NOT treat the partially written visible files as a completed save generation
- **AND** a later project open or save MUST recover to one coherent valid generation or fail with a clear project error before entering the editor

#### Scenario: Reopen after interrupted save recovery
- **WHEN** 用户打开 a project that contains an interrupted manual-save transaction
- **THEN** 系统 runs recovery and validates the recovered files before loading document contents into the editor
- **AND** 系统 opens the project only if the affected document body files and `project.json` are recovered to one coherent valid generation
- **AND** 系统 refuses to open the project with a clear error if recovery cannot determine a coherent valid generation

#### Scenario: Failed save does not mark editor baseline as saved
- **WHEN** 用户触发手动保存
- **AND** the backend reports that save failed or recovery failed
- **THEN** 前端 MUST keep the current editor documents marked as unsaved
- **AND** 前端 MUST NOT report the failed save as saved

### Requirement: 保存必须执行与读取一致的字节上限
系统 MUST 在创建任何事务暂存文件前，对文档正文的 UTF-8 字节数执行与读取端一致的上限校验。任一内容超过上限时，系统 MUST 返回专用的中文错误并 MUST NOT 创建事务目录或修改任何可见项目文件。

#### Scenario: 文档正文超过上限被拒绝
- **WHEN** 用户触发手动保存
- **AND** 任一文档正文的 UTF-8 字节数超过支持上限
- **THEN** 系统在创建事务暂存文件前拒绝保存
- **AND** 系统返回说明哪个文档超限及上限的中文错误
- **AND** 可见项目文件保持原有完整世代
- **AND** 系统不创建 save-transaction 目录

#### Scenario: 恰好等于上限可保存
- **WHEN** 用户触发手动保存
- **AND** 文档正文的字节数都不超过上限
- **THEN** 系统正常完成保存

### Requirement: 超限中断事务可被安全恢复或明确拒绝
系统 MUST 对遗留的含超限文档正文的中断保存事务采取安全处置：`Staged` 阶段（尚未触碰可见文件）的暂存目录 MUST 被直接丢弃；`Committing` 阶段（已进入可见提交）的超限事务 MUST 返回带人工恢复路径的专用中文错误，而不是让作品永久无法打开或保存。

#### Scenario: Staged 超限事务被丢弃
- **WHEN** 作品包含一个 `Staged` 阶段的中断事务
- **AND** 该事务的暂存文档正文超过支持上限
- **THEN** 系统丢弃该事务目录并正常打开旧世代作品
- **AND** 系统不因读取超限暂存内容而拒绝打开

#### Scenario: Committing 超限事务返回专用错误
- **WHEN** 作品包含一个 `Committing` 阶段的中断事务
- **AND** 该事务的暂存文档正文超过支持上限
- **THEN** 系统拒绝打开并返回说明超限与人工恢复路径的中文错误
- **AND** 系统不静默丢弃或改写任何文件

### Requirement: 保存事务的关键文件在落盘时被持久刷新
系统 MUST 在写入事务暂存文档正文与事务清单时，在返回成功前把文件内容刷新到持久介质，并在替换可见文件后按目标平台同步父目录，以把崩溃恢复从仅进程中断向断电级推进。

#### Scenario: 关键暂存文件被刷新
- **WHEN** 系统写入事务暂存文档正文或事务清单
- **THEN** 系统在返回成功前把这些文件的内容刷新到持久介质

### Requirement: 项目结构版本变化通过迁移框架处理
系统 MUST 提供一个项目版本迁移框架：打开作品时识别项目结构版本，版本高于当前支持版本时拒绝；版本低于当前版本且存在已注册迁移步骤时，按版本逐级迁移，迁移前备份、迁移后校验、失败回滚；不存在迁移步骤的旧版本仍被拒绝。迁移回滚 MUST 使用事务式暂存与恢复，且回滚失败 MUST 显式上报（不得静默吞掉）；迁移步骤 MUST 幂等，并 MUST 支持「迁移中途崩溃后再次打开作品」时恢复到一致有效世代。当前生产环境注册了一个迁移步骤：`2 → 3`，把旧双本子作品（`作品文本/草稿本.json`、`作品文本/正文本.json`）自动迁移为内容树根层的两篇普通文档「草稿本」「正文本」，正文与格式保留，不保留特殊本子身份，不恢复双本子模型，不额外包裹迁移文件夹；版本 3 即当前版。

#### Scenario: 未来版本被拒绝
- **WHEN** 项目结构版本高于当前支持版本
- **THEN** 系统拒绝打开并提示不支持的项目结构版本

#### Scenario: 无迁移步骤的旧版本被拒绝
- **WHEN** 项目结构版本低于当前版本且未注册对应迁移步骤
- **THEN** 系统拒绝打开并提示不支持的项目结构版本
- **AND** 系统不创建迁移目录或改写任何文件

#### Scenario: 旧双本子作品自动迁移为两篇普通文档
- **WHEN** 用户打开一个项目结构版本为 2 的旧双本子作品
- **THEN** 系统通过 `2 → 3` 迁移步骤把草稿本与正文本自动迁移为内容树根层的两篇普通文档「草稿本」「正文本」
- **AND** 两篇文档保留原有文字与格式
- **AND** 两篇文档只是普通文档，不保留特殊本子身份，也不恢复双本子模型
- **AND** 系统不额外包裹一层迁移文件夹

#### Scenario: 迁移框架支持备份与回滚
- **WHEN** 存在注册的迁移步骤且迁移过程中任一步失败
- **THEN** 系统回滚已做的迁移并恢复迁移前文件
- **AND** 返回中文可读错误

#### Scenario: 回滚失败显式上报
- **WHEN** 迁移失败后系统尝试回滚
- **AND** 回滚本身也失败
- **THEN** 系统返回同时包含原始迁移错误与回滚失败说明的中文可读错误
- **AND** 系统保留迁移备份文件，并给出需要人工恢复的明确路径

#### Scenario: 迁移中途崩溃后可再次打开
- **WHEN** 迁移过程中应用崩溃，作品目录留下部分迁移状态
- **AND** 用户再次打开该作品
- **THEN** 系统恢复到一个一致有效世代
- **AND** 若无法确定一致有效世代，系统拒绝打开并返回中文可读错误

### Requirement: 同一作品的操作必须串行化
系统 MUST 在同一进程内对同一作品的所有打开、保存与迁移操作进行串行化，使得针对同一作品的两个操作不会并发执行。每次保存事务 MUST 使用唯一事务标识，并在提交前确认该事务未被其它操作替换。系统 MUST NOT 因两个并发保存而让文档正文或项目元信息出现来自不同保存世代的混合状态。

#### Scenario: 同一作品并发保存不互相破坏
- **WHEN** 两个针对同一作品的保存请求同时到达
- **THEN** 系统串行执行两个保存
- **AND** 每次保存产生的文档正文与项目元信息都属于同一个完整保存世代
- **AND** 系统 MUST NOT 出现一个请求的暂存文件被另一个请求当作中断事务删除或覆盖

#### Scenario: 不同作品的保存可并行
- **WHEN** 两个针对不同作品的保存请求同时到达
- **THEN** 系统不因全局锁而串行化它们
- **AND** 每个作品各自保持世代一致

### Requirement: 前端最小适配仍返回/保存两篇迁移文档（过渡边界）
当前前端最小适配仍把内容树根层的两篇普通文档「草稿本」「正文本」映射为 `draft_content` / `main_content` 两个字段返回与保存，使现有编辑器保持可用。这是过渡形态：作品事实已由内容树承载，前端尚未实现作品结构页 / 写作空间 UI，也未实现按内容树浏览或编辑任意文档。本 requirement 只描述当前前端契约的诚实边界，不是长期产品形态；前端适配另行 change。

#### Scenario: 打开作品返回两篇迁移文档
- **WHEN** 前端打开一个版本 3 作品
- **THEN** 后端把内容树根层的「草稿本」「正文本」两篇普通文档内容映射为 `draft_content` / `main_content` 返回
- **AND** 前端按现有编辑器契约展示这两篇文档

#### Scenario: 保存作品写回两篇迁移文档
- **WHEN** 前端触发手动保存
- **AND** 提交 `draft_content` / `main_content`
- **THEN** 后端把两篇文档内容写回内容树中对应的「草稿本」「正文本」文档正文文件
- **AND** 保存作为一个完整一致世代提交

### Requirement: 读取大小限制使用有界读取
系统 MUST 在读取项目文件与配置文件时，使用「打开一次文件句柄后有界读取」的方式限制读取量，而 MUST NOT 依赖读取前的元数据长度作为最终限制。当实际读取量超过支持上限时，系统 MUST 拒绝并返回中文可读错误，且 MUST NOT 把超限内容无界读入内存。

#### Scenario: 文件在长度检查后增大
- **WHEN** 系统准备读取一个在长度检查后、实际读取前被增大的文件
- **AND** 实际内容超过支持读取上限
- **THEN** 系统有界读取并在超过上限时拒绝
- **AND** 系统不把超限内容无界读入内存
