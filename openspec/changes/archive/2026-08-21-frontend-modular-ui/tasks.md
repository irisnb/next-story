## 1. 后端：新建作品默认一篇文档

- [x] 1.1 修改 `src-tauri/src/project/operations.rs` 的 `create_project`：从创建「草稿本」「正文本」两篇改为创建一篇默认文档「未命名文档」
- [x] 1.2 更新 `src-tauri/src/project/mod.rs` 中 `CreateProjectParams` / 创建路径相关注释与契约，确认不残留双槽位假设
- [x] 1.3 更新新建作品相关 Rust 测试（`operations.rs` 测试模块、`project_test.rs`），断言新作品根级只有一篇文档

## 2. 后端：打开作品返回整棵树

- [x] 2.1 修改 `operations.rs` 的 `open_project`：返回 `{ metadata, tree }`（整棵 `ContentTree`），不再硬性要求「草稿本」「正文本」两篇存在，移除 `draft_content` / `main_content` 字段
- [x] 2.2 调整 `mod.rs` 的 `ProjectOpenResult` 结构（或新增 `ProjectTreeOpenResult`），导出给命令层
- [x] 2.3 更新 `open_project` 相关 Rust 测试：断言返回整棵树、含非「草稿本/正文本」的文档也能打开

## 3. 后端：移除旧双槽位命令

- [x] 3.1 在 `src-tauri/src/lib.rs` 移除 `save_project` 命令及 `invoke_handler` 中的注册（保留 `open_content_tree` / `read_document` / `save_document` 等新命令；`open_project` 命令保留但返回改为整棵树）
- [x] 3.2 清理 `mod.rs` / `operations.rs` 中仅服务于双槽位的 `save_existing_project` / `save_project` 旧入口（`run_save_transaction` 及其故障注入测试保留，标记 `#[cfg(test)]`）
- [x] 3.3 确认 `generate_ai_thinking` 白名单测试（`lib.rs` 测试模块）不再引用已移除的双槽位字段，或相应调整

## 4. 前端：类型与命令封装对齐

- [x] 4.1 在 `src/types.ts` 移除 `ProjectOpenResult` 的 `draft_content` / `main_content` 与 `ProjectState` 的 `draftContent` / `mainContent` / `NotebookTab`，改为 `ProjectTreeState`（含 `projectPath`、`projectName`、`tree`）
- [x] 4.2 在 `src/project-api.ts` 移除 `openProject` / `saveProject` 旧封装，调整打开作品调用为 `openContentTree` + `readDocument` + `saveDocument`
- [x] 4.3 更新依赖旧类型的现有代码与测试（`editor.ts`、`new-project-form.ts`、相关 test 文件）

## 5. 前端：模块导航骨架

- [x] 5.1 在 `index.html` 编辑器页顶部加三模块标签 `[写作] [文件管理] [设置]`，调整 `dom.ts` 暴露对应元素
- [x] 5.2 在 `views.ts` / `main.ts` 引入模块视图切换逻辑：写作页 / 文件管理页 / 设置页三视图，打开作品默认落在写作页
- [x] 5.3 把 LLM 配置从独立 page 迁入「设置」模块视图，`llm-config-form.ts` 接入设置模块，移除独立 `llm-config-page` 的导航耦合

## 6. 前端：写作页当前文档 + 切换 + 记忆

- [x] 6.1 重写 `editor.ts` 从「双编辑器切换」为「单编辑器 + 按文档 ID 加载/保存」：移除双 textarea / 双 `EditorAdapter`，改为一个编辑器实例
- [x] 6.2 写作页顶部显示当前文档名，做成可点入口，点开扁平文档列表切换文档
- [x] 6.3 实现 localStorage 记忆：按作品路径记录上次编辑文档 ID，打开作品时恢复，切换时更新，失效时回退到第一篇
- [x] 6.4 实现切换文档前静默保存当前文档（复用 `saveDocument`），保存失败阻止切换并提示；无文档时显示空态
- [x] 6.5 更新离开/关闭 guard（`leave-guard.ts`、`close-guard.ts`）只 guard 当前文档

## 7. 前端：文件管理页

- [x] 7.1 新增文件管理页视图：渲染 `ContentTree` 为文件树（文件夹/文档混合排序、区分类型、展开/折叠）
- [x] 7.2 实现新建文档 / 新建文件夹、重命名、移动、删除进回收站、恢复的界面交互，调用 `project-api.ts` 对应命令
- [x] 7.3 实现回收站二级页（文件树底部入口进入），列出被删子树并支持恢复
- [x] 7.4 文件管理页的操作错误以中文提示呈现（复用后端中文错误）

## 8. 测试与验证

- [x] 8.1 更新前端现有测试（`editor.test.ts`、`project-flow-race.test.ts`、`llm-config-form.test.ts` 等）以适配新类型与单编辑器模型
- [x] 8.2 新增前端测试：模块切换、文档切换与记忆、文件树渲染、文件管理操作调用命令
- [x] 8.3 运行 `cargo test`（src-tauri）与前端 `npm run typecheck`、`npm run lint`、`npm run test:frontend` 全部通过
- [x] 8.4 手工冒烟：新建作品（一篇文档）、打开旧作品（含「草稿本」「正文本」两篇）、三模块切换、文件管理建/删/恢复、切换文档自动保存（已由用户在真实桌面应用中手动验证，并确认修复）
