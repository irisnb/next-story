## Context

当前 Tauri 桌面壳开启了 `app.withGlobalTauri`，并把 `app.security.csp` 设为 `null`。这表示前端代码可以通过全局对象访问 Tauri，打包后的 webview 也没有明确的 Content Security Policy（CSP，内容安全策略）。

当前前端在 `src/project-api.ts` 中通过 `@tauri-apps/api` import 调用 Tauri，因此关闭全局对象不应改变预期应用流程。应用也已经把 AI 输出按纯文本渲染；但未来 UI 表面可能展示更多用户可控文本或模型可控文本，所以桌面壳默认应处在更窄的执行环境里。

## Goals / Non-Goals

**Goals:**

- 移除桌面 webview 中的全局 `window.__TAURI__` 暴露。
- 添加明确 CSP，允许本地应用资源和 Tauri IPC，同时阻止不需要的远程 script、style、frame、object 和 worker 来源。
- 保持作品生命周期、写作本、LLM 配置、选区 AI 召唤和继续追问的现有产品行为。

**Non-Goals:**

- 不改变 Tauri capabilities 或 command 权限。
- 不改变前端渲染、AI prompt、模型配置、持久化或产品工作流。
- 不引入宽泛的安全框架、sanitizer 库或运行时迁移。

## Decisions

### 关闭全局 Tauri 访问

将 `app.withGlobalTauri` 设为 `false`，并保持所有前端桌面调用都通过明确的 `@tauri-apps/api` import 路由。

考虑过的替代方案：为了方便继续开启 `withGlobalTauri`。拒绝原因：当前应用不需要它；全局特权 API 会放大未来任何脚本执行路径的影响。

### 添加收紧的打包 webview CSP

将 `app.security.csp` 设为明确策略：默认只允许本地资源，允许本地打包资源中的图片和字体以及浏览器内部可能需要的 data/blob，允许 Tauri IPC，不允许远程脚本或 frame。

考虑过的替代方案：因为当前 AI 输出渲染避免解析 HTML，所以继续关闭 CSP。拒绝原因：CSP 是整个桌面 webview 的纵深防线，不只保护当前 AI 输出路径。

### 通过现有检查加 Tauri 打包验证

使用现有 `npm run check` 检查 TypeScript、前端测试、前端构建和 Rust 测试，然后运行 `npm run tauri:build` 确认打包后的 Tauri 配置可被接受。

考虑过的替代方案：因为变更只是 JSON 配置编辑，只跑前端检查。拒绝原因：CSP 和 `withGlobalTauri` 由 Tauri 打包 / 运行时消费，因此桌面构建才是相关的兼容性检查。

## Risks / Trade-offs

- CSP 可能阻止打包应用实际需要的资源来源 -> 缓解：让策略聚焦当前本地资源，并用 `npm run tauri:build` 验证；如果运行时测试发现某个本地来源被阻止，只做窄范围调整。
- 关闭 `withGlobalTauri` 可能破坏隐藏的、依赖 `window.__TAURI__` 的前端代码 -> 缓解：确认代码库使用 import 形式的 Tauri API，并运行现有检查套件。
- 过于宽松的 CSP 会变成只写在纸上的安全说明 -> 缓解：要求策略阻止远程脚本和 frame，除非未来 OpenSpec change 明确证明需要放开。
