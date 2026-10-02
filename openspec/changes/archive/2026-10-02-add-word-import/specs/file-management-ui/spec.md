# file-management-ui Specification（delta）

## ADDED Requirements

### Requirement: 文件管理区提供 Word 导入入口

文件管理区 SHALL 在新建文档与新建文件夹入口旁提供「导入 Word 文档」入口。该入口 SHALL 只触发导入流程（选择文件 → 预检 → 用户确认 → 创建新文档），完整行为由 `project-word-import` 规定。入口 MUST NOT 因此修改任何既有文档的正文内容——与既有「文件管理操作不得写用户文档正文」边界一致：导入创建的新文档，其内容全部逐字来自用户选定的文件，属用户主动搬运自己的材料。

#### Scenario: 入口位于新建入口旁

- **WHEN** 用户在已打开作品的文件管理区查看操作入口
- **THEN** 「导入 Word 文档」入口与新建文档、新建文件夹入口并列可见

#### Scenario: 导入只新增文档

- **WHEN** 用户通过导入入口完成一次导入
- **THEN** 内容树出现导入创建的新文档
- **AND** 既有文档的正文与既有节点结构不被修改

#### Scenario: 无打开作品时入口禁用

- **WHEN** 未打开任何作品
- **THEN** 导入入口不可用，并提示需先打开作品
