## ADDED Requirements

### Requirement: 桌面壳只授予当前功能实际需要的权限
系统 MUST 只授予前端当前实际使用的 Tauri 插件权限。当前功能不使用的插件能力 MUST NOT 在 capabilities 中授予，且 MUST NOT 注册对应插件或保留对应依赖。

#### Scenario: 未使用的 opener 能力不被授予
- **WHEN** 前端代码不使用打开外部链接或外部文件的能力
- **THEN** capabilities 不包含 opener 权限
- **AND** 应用不注册 opener 插件
- **AND** 应用不依赖 opener 插件包

#### Scenario: 实际使用的 dialog 能力保持
- **WHEN** 前端使用目录选择能力
- **THEN** dialog 权限保持授予
- **AND** 新建作品目录选择等现有工作流保持不变
