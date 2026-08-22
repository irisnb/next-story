## Why

选区快照相等判断和浏览器存储探测目前各有重复实现，未来任一处语义或异常处理变化都可能造成入口状态、面板滚动和文档记忆行为不一致。当前正值前端边界收敛阶段，应在继续扩展功能前建立唯一的共享契约，同时提升留白偏好的可测试性。

## What Changes

- 新增共享的选区快照相等判断，统一 AI 面板滚动重置与选区入口的快照身份语义。
- 新增共享的最小存储适配接口，包含读取、写入和删除能力。
- 统一 `localStorage` 可用性探测与不可用时的安全 fallback 行为。
- 让编辑器留白偏好存储可通过依赖注入，补充真实持久化路径测试。
- 复用共享测试存储夹具，删除重复的测试实现。
- 保持现有存储键名、返回值、默认档位、作品记忆选择逻辑和 UI 行为不变。
- 不包含 AI 面板 DOM 查询契约、编辑器模块拆分或任何 Rust/Tauri 改动。

## Capabilities

### New Capabilities
- `shared-storage-and-selection-identity`: 提供前端共享存储适配和选区快照身份契约。

### Modified Capabilities
- `workspace-navigation`: 明确作品记忆使用共享存储适配并在浏览器存储不可用时安全回退。
- `editor-margin-preference`: 明确留白偏好使用共享存储适配，并支持测试注入而不改变用户行为。

## Impact

- 影响 `src/document-memory.ts`、`src/editor-margin.ts`、`src/editor.ts`、`src/ai-panel-scroll.ts`、`src/selection-entry.ts` 及相关前端测试。
- 新增一个前端纯函数/适配模块；不新增运行时依赖，不改变持久化键名或 JSON 格式。
- 需要回归选区入口、AI 面板滚动、编辑器加载、作品记忆和留白偏好测试。
