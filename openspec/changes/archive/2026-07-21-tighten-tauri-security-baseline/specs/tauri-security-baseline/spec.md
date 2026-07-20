## ADDED Requirements

### Requirement: 桌面壳不得暴露全局 Tauri API
系统 MUST NOT 在桌面 webview 中通过全局 `window.__TAURI__` 对象暴露 Tauri API。需要桌面能力的前端代码 SHALL 使用明确的 Tauri API import。

#### Scenario: 全局 Tauri 桥接被关闭
- **WHEN** 桌面应用 webview 加载打包后的前端
- **THEN** Tauri 全局 API 暴露在配置中被关闭
- **AND** 前端桌面调用继续使用明确的 `@tauri-apps/api` import

### Requirement: 桌面壳强制执行收紧的 CSP
系统 MUST 为 Tauri 桌面 webview 定义明确的 Content Security Policy。该策略 MUST 允许应用本地打包资源和 Tauri IPC，并 MUST NOT 允许任意远程脚本、frame、object 或 worker。

#### Scenario: 打包 webview 拥有明确 CSP
- **WHEN** Tauri 应用执行桌面打包构建
- **THEN** Tauri 配置包含非空 CSP 值
- **AND** CSP 不允许任意远程脚本执行
- **AND** CSP 不允许任意远程 frame 或 object 嵌入

### Requirement: 安全基线保持现有工作流
系统 MUST 在应用桌面壳安全基线时保持现有用户可见工作流。

#### Scenario: 现有应用检查仍通过
- **WHEN** 安全基线被应用
- **THEN** 作品生命周期、写作本、LLM 配置、选区 AI 召唤和继续追问行为保持不变
- **AND** 现有完整项目检查通过
- **AND** Tauri 桌面构建接受该配置
