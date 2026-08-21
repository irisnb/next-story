## Why

内容树存储地基（`content-tree-storage`）已完成：作品在磁盘上已是「文件夹 + 文档」的内容树，结构操作（创建 / 重命名 / 移动 / 删除进回收站 / 恢复）的后端函数也已全部写好。但前端能调用的命令层仍是旧的「双槽位」契约——`open_project` 只返回「草稿本」「正文本」两篇根级文档，`save_project` 只存这两篇，而写好的结构操作函数一个都没暴露成 Tauri 命令。结果就是内容树对前端完全不可见，用户看不到、也用不上任何文件管理能力。本 change 把内容树操作与按文档 ID 读写作为一套**新命令**暴露给前端，为下一个 change 的前端「文件管理」UI 提供命令基础；旧双槽位命令保留不动作为过渡，前端旧 UI 在本 change 完成后继续可用。

## What Changes

- 新增内容树结构操作的 Tauri 命令：创建文件夹、创建文档、重命名、移动、排序、删除进回收站、恢复（对应后端已实现但未暴露的 `create_folder` / `create_document` / `rename_node` / `move_node` / `reorder_children` / `delete_node` / `restore_node`）。
- 新增 `open_content_tree` 命令：返回整棵内容树结构（节点列表、类型、父子关系、顺序、回收站）。
- 新增 `read_document` 命令：按文档 ID 读取单篇文档正文；新增 `save_document` 命令：按文档 ID 保存单篇文档正文。
- 旧 `open_project` / `save_project` 双槽位命令保留不动作为过渡，前端旧 UI 继续可用；它们的移除与「前端最小适配仍返回/保存两篇迁移文档（过渡边界）」这条过渡 requirement 的移除，推迟到前端切换的 change 中确定。

## Capabilities

### New Capabilities
- `content-tree-commands`: 前端可调用的内容树命令契约——读取整棵树、按文档 ID 读取/保存单篇文档正文，以及创建 / 重命名 / 移动 / 排序 / 删除进回收站 / 恢复等结构操作命令。

### Modified Capabilities
<!-- 本 change 只新增命令，不改变旧命令或既有存储行为，故无修改的 capability。旧契约的移除推迟到前端切换 change。 -->

## Impact

- Rust/Tauri 后端：`src-tauri/src/lib.rs` 命令注册、`src-tauri/src/project/`（`operations.rs`、`mod.rs`）的命令层。
- 前端 IPC 契约类型（`src/types.ts`、`src/project-api.ts`）随新命令增加；前端 UI 与三模块重构不属于本 change（下一个 change 做）。
- 现有 specs：本 change 不修改既有 capability 的需求，只新增 `content-tree-commands`。
- 不涉及 DSH、AI 面板、LLM 配置、单篇文档的 Tiptap 格式（`structured-notebook-storage` 格式版本 2 不变）。
