# project-word-import Specification（delta）

## MODIFIED Requirements

### Requirement: 选择并识别 .docx 文件

系统 SHALL 在文件管理区经共享的「导入文档」入口（同一入口接受 `.docx` 与 `.md`，`.md` 行为由 `project-markdown-import` 规定）让用户选择单个 `.docx` 文件，仅在已打开作品时可用。文件识别 MUST NOT 依赖系统 MIME 标签（WPS 保存的 `.docx` 报告非标准 `application/wps-office.docx`），SHALL 按扩展名与 ZIP 结构（存在 `[Content_Types].xml`）判断。非法文件（扩展名不符、损坏、非 ZIP 结构、解析失败）MUST 以中文可读错误稳定失败，且不产生任何副作用。

#### Scenario: 导入入口仅在作品打开时可用

- **WHEN** 未打开任何作品时查看文件管理区
- **THEN** 导入入口不可用，并提示需先打开作品

#### Scenario: 选择 WPS 保存的 .docx

- **WHEN** 用户选择一个 WPS 保存的 `.docx` 文件（系统 MIME 为非标准值）
- **THEN** 系统按扩展名与 ZIP 结构正常识别并进入预检

#### Scenario: 选择非法文件

- **WHEN** 用户选择损坏文件或非 ZIP 结构的文件
- **THEN** 系统显示中文可读错误
- **AND** 不创建任何文档，不修改任何既有数据

#### Scenario: 取消选择

- **WHEN** 用户在文件选择对话框取消
- **THEN** 导入流程终止，无任何副作用
