## 1. 后端：按文档 ID 保存正文

- [x] 1.1 在 `src-tauri/src/project/operations.rs` 新增 `save_document(project_root, document_id, content)`：校验 ID 是树中存在的文档节点、校验正文为合法格式版本 2 且不超过字节上限，复用映射式事务写该文档正文 + `project.json`（元信息最后提交）
- [x] 1.2 在 `src-tauri/src/project/mod.rs` 导出 `save_document`，并补 `save_existing_document` 之类的项目级入口（若需要先 `validate_project_structure`）
- [x] 1.3 为 `save_document` 补故障注入测试，覆盖单文档保存的中断恢复（Staged 丢弃 / Committing 前滚）

## 2. 后端：读取命令

- [x] 2.1 在 `operations.rs` 或 `mod.rs` 提供 `open_content_tree(project_root) -> ContentTree` 的公开入口（复用 `read_content_tree`，或将其可见性提升并校验）
- [x] 2.2 提供 `read_document(project_root, document_id) -> String` 公开入口：校验 ID 是文档节点，复用 `read_and_validate_notebook` 读正文

## 3. 后端：结构操作命令封装

- [x] 3.1 确认 `create_folder` / `create_document` / `rename_node` / `move_node` / `reorder_children` / `delete_node` / `restore_node` 在 `mod.rs` 已 `pub use` 导出（当前已导出），命令层可直接包装
- [x] 3.2 为每个结构操作补充/核对中文错误返回（`ContentTreeError` 与 `ProjectError` 的 `Display`），确保前端可读

## 4. 命令注册（lib.rs）

- [x] 4.1 在 `src-tauri/src/lib.rs` 为 `open_content_tree`、`read_document`、`save_document`、`create_folder`、`create_document`、`rename_node`、`move_node`、`reorder_children`、`delete_node`、`restore_node` 各加 `#[tauri::command]` 包装，均在阻塞线程内取作品锁后执行
- [x] 4.2 把上述新命令加入 `invoke_handler` 的 `generate_handler!` 列表，保留旧 `open_project` / `save_project` 不动
- [x] 4.3 定义新命令的入参/返回结构（`parent` / `new_parent` 用 `Option<String>`，`ContentTree` 直接序列化返回），确认 `ContentTreeNode` / `NodeKind` / `RecycleBinEntry` 的 serde 派生完整

## 5. 前端 IPC 契约类型

- [x] 5.1 在 `src/types.ts` 新增内容树相关类型：`NodeKind`、`ContentTreeNode`、`RecycleBinEntry`、`ContentTree`，与后端 serde 序列化字段对齐
- [x] 5.2 在 `src/project-api.ts` 新增 `openContentTree`、`readDocument`、`saveDocument`、`createFolder`、`createDocument`、`renameNode`、`moveNode`、`reorderChildren`、`deleteNode`、`restoreNode` 调用封装
- [x] 5.3 保持旧 `openProject` / `saveProject` 及其类型不变，前端旧 UI 继续可用

## 6. 测试与验证

- [x] 6.1 为结构操作命令补 Rust 集成测试（创建 / 重命名 / 移动 / 删除进回收站 / 恢复 / 排序的边界与错误路径）
- [x] 6.2 为 `open_content_tree` / `read_document` 补测试（合法读取、非法树 / 不存在 ID / 非法正文被拒）
- [x] 6.3 运行 `cargo test`（`src-tauri`）与前端 `npm test` 确认全部通过，旧双槽位命令行为无回归
- [x] 6.4 手工冒烟：打开旧作品，旧编辑器双 tab 仍可读写；新命令可经测试桩验证返回结构（以 mockIPC 测试桩模拟验证：`tests/project-api-content-tree.test.ts` 覆盖 10 个命令封装与超限防线；旧命令无回归由 `project_test.rs` 覆盖）
