## Context

作品内容树的事实存储已完成：`content_tree.rs` 提供 `ContentTree`（`root_children`、`nodes: HashMap<id, ContentTreeNode>`、`recycle_bin`）与两种节点（`NodeKind::Folder` / `NodeKind::Document`），以及创建、重命名、移动、排序、删除进回收站、恢复等结构操作；`operations.rs` 已把这些操作包装成事务化的项目级函数（`create_folder` / `create_document` / `rename_node` / `move_node` / `reorder_children` / `delete_node` / `restore_node`），并在 `mod.rs` 中 `pub use` 导出。但 `lib.rs` 的 `invoke_handler` 只注册了 `create_project` / `open_project` / `save_project` / `open_url` / LLM 配置 / `generate_ai_thinking` 等旧命令——结构操作函数一个都没暴露成 Tauri 命令，`open_project` / `save_project` 仍是双槽位契约，且硬性要求根级存在「草稿本」「正文本」两篇文档。

约束与利益相关方：Rust/Tauri 后端是作品事实的唯一写入者，DSH/AI 不接入；「AI 永不写用户文档」的永久边界不变，本 change 不新增任何 AI 写文档路径。前端旧的 `src/project-api.ts` / `src/types.ts` 仍按双槽位契约工作，本 change 不得破坏它（前端切换另行 change）。

## Goals / Non-Goals

**Goals:**
- 把内容树结构操作（创建 / 重命名 / 移动 / 排序 / 删除进回收站 / 恢复）暴露为前端可调用的 Tauri 命令。
- 提供 `open_content_tree` 命令返回整棵树结构，`read_document` / `save_document` 按文档 ID 读写单篇正文。
- 所有新命令沿用既有作品锁与事务机制，保持「一次结构变更 / 一次保存 = 一个一致世代」的原则。
- 保持旧 `open_project` / `save_project` 双槽位命令不变，前端旧 UI 继续可用。

**Non-Goals:**
- 不实现前端三模块 UI、文件管理页、回收站二级页、设置页（下一个 change）。
- 不移除旧双槽位命令，也不移除「前端最小适配（过渡边界）」requirement（推迟到前端切换 change）。
- 不实现回收站永久清空、不实现拖拽排序的具体交互（排序命令已提供，交互属前端）。
- 不改单篇文档的 Tiptap 格式（版本 2 不变），不改迁移框架。

## Decisions

### D1：纯新增命令，不改旧命令契约

新增一套内容树命令，`open_project` / `save_project` 完全不动。这样本 change 是纯增量，前端旧 UI 在 change 完成后零影响，符合「本 change 只做后端命令层」的拆分。

**备选**：直接改造 `open_project` 返回整棵树、`save_project` 改为按 ID 保存。**否决**：会立即破坏前端旧代码（`ProjectOpenResult` 类型与 `save_project` 调用签名都会编译失败/运行出错），把前端适配强行拉进本 change，违背拆分意图。

### D2：新命令集与返回契约

新增以下 Tauri 命令（均携带 `project_path`，在阻塞线程内取作品锁后执行）：

| 命令 | 入参 | 返回 | 对应后端函数 |
|------|------|------|--------------|
| `open_content_tree` | `project_path` | `ContentTree`（序列化 JSON） | `operations::read_content_tree` |
| `read_document` | `project_path`, `document_id` | `String`（Tiptap JSON） | `read_and_validate_notebook` |
| `save_document` | `project_path`, `document_id`, `content` | `()` | 新增按 ID 保存事务 |
| `create_folder` | `project_path`, `parent` | 新节点 ID | `operations::create_folder` |
| `create_document` | `project_path`, `parent` | 新节点 ID | `operations::create_document` |
| `rename_node` | `project_path`, `id`, `name` | `()` | `operations::rename_node` |
| `move_node` | `project_path`, `id`, `new_parent` | `()` | `operations::move_node` |
| `reorder_children` | `project_path`, `parent`, `order` | `()` | `operations::reorder_children` |
| `delete_node` | `project_path`, `id` | `()` | `operations::delete_node` |
| `restore_node` | `project_path`, `id` | `()` | `operations::restore_node` |

`parent` / `new_parent` 用 `Option<String>`（`None` 表示根级）。`ContentTree` / `ContentTreeNode` / `NodeKind` / `RecycleBinEntry` 已派生 `Serialize`，直接作为返回值序列化给前端，前端据此渲染文件树与回收站。

**备选**：把树打平成「前端友好」的嵌套结构再返回。**否决**：多余的一次转换，且 `ContentTree` 已有权威校验（`validate`）与稳定 ID 语义，前端直接消费同一结构最不易漂移。

### D3：`save_document` 复用既有事务，泛化为按 ID 保存

现有 `save_project` 走 `run_save_transaction`，把「草稿本」「正文本」两篇映射为稳定 ID 后事务写盘。`save_document` 复用它的事务机制，但改为按单个文档 ID 定位正文文件、只写这一篇 + `project.json`（`updated_at` 作为完成标记）。实现上：
- 校验 `document_id` 是树中存在的 `NodeKind::Document` 节点（复用 `read_content_tree` + 查找）；
- 校验 `content` 为合法格式版本 2 文档（复用 `validate_notebook_content`）与字节上限（复用 `validate_notebook_size`）；
- 通过映射式事务（`transactional_write_mapped` 或等价路径）暂存该文档正文 + `project.json`，元信息最后提交。

这样 `save_document` 与 `save_project` 共享同一套「一次保存 = 一个一致世代」的崩溃恢复与串行化，不另造一套事务。

### D4：结构操作命令直接封装既有项目级函数

`operations.rs` 的项目级结构操作函数（`create_folder` 等）已经做了「取锁前校验 + 事务化提交 + 结构校验」，命令层只需在 `lib.rs` 加 `#[tauri::command]` 包装、在阻塞线程内取锁、把 `ContentTreeError` / `ProjectError` 的中文 `Display` 转成 `Err(String)` 返回。不重复实现业务逻辑。

### D5：错误契约沿用中文可读字符串

新命令沿用现有 `Result<_, String>` 模式，`ContentTreeError` 的 `Display`（如「内容树节点不存在」「同级节点名称已存在」「不能移动到自身或后代」）与 `ProjectError` 的 `Display` 已是中文，直接映射为命令错误返回，前端可读。不新增错误枚举序列化格式。

## Risks / Trade-offs

- [旧 `open_project` 仍硬性要求「草稿本」「正文本」存在] → 本 change 保留旧命令不动，前端旧 UI 不触发删除/重命名这两篇，故无影响；前端切换后走新命令，旧命令随切换 change 移除，风险随之消失。
- [`save_document` 泛化引入回归] → 复用既有事务机制而非另造，用故障注入测试覆盖单文档保存的中断恢复；不触碰旧 `save_project` 路径。
- [命令暴露扩大攻击面] → 所有新命令沿用作品锁串行化 + 结构校验 + 文档 ID 非法字符校验（`validate_subtree` 已拒绝含 `/`、`\` 的 ID），不新增任何 AI 写文档路径。
- [`ContentTree` 直接返回给前端导致耦合] → 这是权威结构，且本 change 已有校验保证合法；前端只读展示，结构变更仍全部回走后端命令。

## Migration Plan

- 纯增量：无数据迁移、无磁盘格式变化、作品结构版本仍为 `3`。
- 前端旧 UI 不感知新命令，部署后零影响。
- 回滚策略：新命令独立于旧命令，若需回滚，移除新命令注册即可，旧命令与作品数据不受影响。

## Open Questions

- 旧 `open_project` / `save_project` 及「前端最小适配（过渡边界）」requirement 的移除，具体落在前端切换 change 内一起做，还是单独一个清理 change——在前端切换 change 的 propose 时确定。
- `save_document` 是否也接受「保存多篇」的批量形式——首版只做单篇，前端按需逐篇保存；批量留待需要时再评估。
