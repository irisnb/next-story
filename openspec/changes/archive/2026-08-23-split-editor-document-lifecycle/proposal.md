## Why

`src/editor.ts` 仍同时承担文档会话、视图渲染、保存持久化和控制器组装，文件约 611 行。交互模块虽已拆出，但核心生命周期职责仍耦合在一个闭包中，增加后续修复和测试的认知成本。

## What Changes

- 将文档会话职责拆到聚焦模块：作品状态、当前文档、异步加载代次、文档切换和删除后的回退。
- 将文档视图职责拆到聚焦模块：当前文档标题、空态和文档列表渲染。
- 将保存持久化职责拆到聚焦模块：保存状态、文档规范化与校验、大小限制、保存和失败处理。
- 保留 `src/editor.ts` 作为组装层和稳定的 `EditorController` facade。
- 保持现有公开接口、用户可观察行为、异步竞态保护和保存前切换行为不变。

## Capabilities

### New Capabilities

- `editor-document-lifecycle`: 定义编辑器文档会话、视图、持久化模块的窄边界及稳定 facade 行为。

### Modified Capabilities

无。此 change 是内部模块化，不改变已有产品需求或用户行为。

## Impact

- 主要影响 `src/editor.ts`，并新增文档会话、文档视图、持久化相关前端模块及其聚焦测试。
- `EditorController`、`EditorAdapter`、Tauri/Rust 命令、作品数据格式、AI 接线和选择入口保持兼容。
- 不新增依赖，不修改 AI 输出不得直接写入用户文档的边界。
