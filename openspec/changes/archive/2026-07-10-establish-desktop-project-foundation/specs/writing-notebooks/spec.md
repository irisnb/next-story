## ADDED Requirements

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
