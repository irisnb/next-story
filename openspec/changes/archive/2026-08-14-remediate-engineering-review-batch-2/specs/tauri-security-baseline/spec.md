## ADDED Requirements

### Requirement: CSP 不授予未使用的脚本执行能力
系统 MUST 在 CSP 中不授予当前前端未使用的脚本执行能力：不包含 `script-src 'unsafe-inline'`，不包含 `'wasm-unsafe-eval'`（应用不使用内联脚本、eval 或 WebAssembly）。Tauri 注入的 IPC 脚本由系统原生注入、不受 CSP 约束，`@tauri-apps/api` 从 `'self'` 加载。

#### Scenario: CSP 不含 unsafe-inline 脚本
- **WHEN** 打包构建完成后
- **THEN** CSP 的 script-src（或回落的 default-src）不包含 `'unsafe-inline'`
- **AND** CSP 不包含 `'wasm-unsafe-eval'`
- **AND** Tauri IPC 调用仍正常工作
