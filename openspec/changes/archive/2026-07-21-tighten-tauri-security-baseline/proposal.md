## Why

当前桌面壳暴露了 Tauri 全局 API，并关闭了 Content Security Policy（CSP，内容安全策略）。如果未来某条渲染路径意外允许脚本注入，webview 的影响范围会被放大；在后续 AI 或富文本表面增加前，应该先把这条安全基线收紧。

## What Changes

- 关闭全局 `window.__TAURI__` API 暴露；当前前端已经通过 `@tauri-apps/api` import 调用 Tauri。
- 为打包后的 Tauri webview 添加明确且收紧的 CSP，只允许本地应用资源和 Tauri IPC 所需来源。
- 保持现有应用行为不变：作品新建 / 打开 / 保存、LLM 配置、连接测试、选区 AI 生成和继续追问都必须继续可用。
- 将这条安全基线写入规格，避免未来 change 在没有明确 OpenSpec 决策时移除 CSP 或重新开启全局 Tauri 访问。

## Capabilities

### New Capabilities
- `tauri-security-baseline`：定义桌面壳在 Tauri API 暴露和 webview CSP 上的安全基线。

### Modified Capabilities
- 无。

## Impact

- 影响配置：`src-tauri/tauri.conf.json`。
- 影响验证：Tauri 桌面打包构建和现有完整项目检查。
- 不改变前端 API、Rust command、持久化格式或产品工作流。
