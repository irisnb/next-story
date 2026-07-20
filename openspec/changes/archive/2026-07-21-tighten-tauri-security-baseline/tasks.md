## 1. 配置

- [x] 1.1 更新 `src-tauri/tauri.conf.json`，关闭 `app.withGlobalTauri`。
- [x] 1.2 添加明确且收紧的 `app.security.csp`，允许本地打包资源和 Tauri IPC，同时阻止任意远程脚本、frame、object 和 worker。

## 2. 验证

- [x] 2.1 确认前端 Tauri 调用仍使用明确的 `@tauri-apps/api` import，不依赖 `window.__TAURI__`。
- [x] 2.2 运行 `npm run check`，确认现有完整项目检查通过。
- [x] 2.3 运行 `npm run tauri:build`，确认桌面打包配置可被接受。
