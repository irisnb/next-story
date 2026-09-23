# desktop-project-lifecycle 变更增量

> apply 期扩围补全（用户确认 2026-09-23）：追加「User can create a project folder」与「User can open a valid project folder」两个 MODIFIED 块——同文件既有「作品结构版本为整数 3」表述与已对齐的「当前版本 4」矛盾，按 `project/mod.rs` 的 `CURRENT_VERSION = 4` 语义对齐：创建场景写入值 → 4；拒绝未知/未来版本场景 → 「高于当前支持版本」表述；校验规则语义断言保持不动。

## MODIFIED Requirements

### Requirement: 作品结构版本变化通过迁移框架处理
系统 MUST 提供一个作品版本迁移框架：打开作品时识别作品结构版本，版本高于当前支持版本时拒绝；版本低于当前版本且存在已注册迁移步骤时，按版本逐级迁移，迁移前备份、迁移后校验、失败回滚；不存在迁移步骤的旧版本仍被拒绝。迁移回滚 MUST 使用事务式暂存与恢复，且回滚失败 MUST 显式上报（不得静默吞掉）；迁移步骤 MUST 幂等，并 MUST 支持「迁移中途崩溃后再次打开作品」时恢复到一致有效世代。当前生产环境注册了两个迁移步骤：`2 → 3`（双本子转根文档——把旧双本子作品（`作品文本/草稿本.json`、`作品文本/正文本.json`）自动迁移为内容树根层的两篇普通文档「草稿本」「正文本」，正文与格式保留，不保留特殊本子身份，不恢复双本子模型，不额外包裹迁移文件夹）与 `3 → 4`（物化 `ai_visible`）；当前作品结构版本为 4。

#### Scenario: 未来版本被拒绝
- **WHEN** 作品结构版本高于当前支持版本
- **THEN** 系统拒绝打开并提示不支持的作品结构版本

#### Scenario: 无迁移步骤的旧版本被拒绝
- **WHEN** 作品结构版本低于当前版本且未注册对应迁移步骤
- **THEN** 系统拒绝打开并提示不支持的作品结构版本
- **AND** 系统不创建迁移目录或改写任何文件

#### Scenario: 旧双本子作品自动迁移为两篇普通文档
- **WHEN** 用户打开一个作品结构版本为 2 的旧双本子作品
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

### Requirement: User can create a project folder
系统 SHALL 允许用户通过作品名和保存位置创建一部新作品，并在保存位置下创建以作品名命名的作品文件夹。系统 MUST NOT overwrite or delete an existing same-name folder, and failed creation cleanup MUST only remove filesystem entries created by the current creation attempt. 新建作品 SHALL 创建一棵内容树，根级包含一篇默认文档，而非固定的「草稿本」「正文本」两篇。

#### Scenario: Create valid project
- **WHEN** 用户输入非空作品名并选择可访问的保存位置
- **THEN** 系统创建对应作品文件夹
- **AND** 系统创建一棵内容树，根级包含一篇默认文档
- **AND** 系统按稳定文档 ID 在 `作品文本/documents/<id>.json` 保存该篇文档的正文（格式版本 2）
- **AND** 系统在 `next-story-system/content-tree.json` 保存内容树元数据（节点身份、类型、父级、子级顺序、名称，不含正文）
- **AND** 系统创建作品结构版本为整数 `4`（当前支持版本）的 `next-story-system/project.json`

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
系统 SHALL 允许用户选择作品文件夹打开作品，并 SHALL 在进入编辑器前校验作品结构和内容树。系统 MUST 先以只读方式校验 `project.json` 的作品结构版本，只有版本为受支持的整数版本后才可运行可能写盘的事务恢复或迁移。系统 MUST reject project structures whose required project directories or files are symlinks, reparse points, or resolve outside the selected project folder, MUST reject required project files that exceed the supported read-size limit before reading them into memory, and MUST recover or reject interrupted manual-save transactions before loading document contents. 打开成功时系统 SHALL 返回整棵内容树结构，前端据此确定当前文档。

#### Scenario: Open valid project folder
- **WHEN** 用户选择包含内容树元数据文件、文档正文文件和 `next-story-system/project.json` 的文件夹
- **AND** all required project directories and files are normal filesystem entries inside the selected project folder
- **AND** `project.json` 的作品结构版本为受支持的整数版本
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
- **WHEN** 用户选择的作品使用作品结构版本 1 和旧 `.txt` 本子文件
- **THEN** 系统拒绝打开该作品
- **AND** 系统显示该作品结构版本不受支持的中文错误
- **AND** 系统不迁移、重命名、删除或改写任何原文件

#### Scenario: Reject unknown future project structure version
- **WHEN** `project.json` 的作品结构版本高于当前支持版本（如整数 `5`）或不是受支持的整数版本
- **THEN** 系统拒绝打开该作品 before reading document contents into the editor
- **AND** 系统不把未知版本按当前支持版本解释或写回

#### Scenario: Unsupported version with interrupted transaction remains untouched
- **WHEN** 作品结构版本不是受支持的整数版本且作品目录同时包含中断事务文件
- **THEN** 系统在运行任何事务恢复前拒绝打开
- **AND** 原项目文件和事务文件的字节保持不变

#### Scenario: Open project with unrecoverable interrupted save
- **WHEN** 用户选择的文件夹 contains an interrupted manual-save transaction
- **AND** 系统 cannot recover the project to one coherent valid generation
- **THEN** 系统拒绝打开该文件夹 before entering the editor
- **AND** 系统提示作品无法安全恢复或读取
