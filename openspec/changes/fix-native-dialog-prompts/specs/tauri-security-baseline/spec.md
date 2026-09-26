# tauri-security-baseline Specification Delta

## ADDED Requirements

### Requirement: 系统对话框的授权与异步语义

前端实际使用的系统对话框能力（打开 / 保存 / 确认 / 提示）SHALL 全部在 capabilities 中授予对应 ACL 权限。调用确认类对话框时，前端 MUST 按异步语义等待用户决定，MUST NOT 把对话框结果当同步布尔使用；对话框调用失败时 MUST NOT 把破坏性操作当作已确认执行。调用提示类对话框失败 MUST NOT 产生未处理拒绝。

#### Scenario: 关闭文档可见性前确认生效
- **WHEN** 用户关闭一篇有受影响讨论的文档的 AI 可见性
- **THEN** 系统显示影响确认对话框
- **AND** 用户取消时关闭操作不执行
- **AND** 用户确认后才执行关闭

#### Scenario: 删除未保存文档确认生效
- **WHEN** 当前文档存在未保存修改且内容树操作将移除该文档
- **THEN** 系统显示确认对话框
- **AND** 用户取消时保留当前内容
- **AND** 用户确认后才继续

#### Scenario: 确认调用失败不当作已确认
- **WHEN** 确认类对话框调用失败（授权被拒或运行时错误）
- **THEN** 破坏性操作不执行
- **AND** 系统不把失败静默当作已确认

#### Scenario: 提示调用失败不产生未处理拒绝
- **WHEN** 提示类对话框调用失败
- **THEN** 系统不产生未处理拒绝，也不因此中断当前流程
