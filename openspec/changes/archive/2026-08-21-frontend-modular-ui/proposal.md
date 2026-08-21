## Why

内容树的事实存储（`content-tree-storage`）与命令层（`content-tree-commands`）都已就绪，但前端仍是旧的固定「草稿本 / 正文本」单页编辑器：用户看不到、也管理不了自己的内容树，作品组织能力对用户完全不可见。产品方向要求内容树作为作品组织的界面真实可用——用户能新建、改名、移动、删除、从回收站恢复文档与文件夹，同时写作页保持专注（不塞树）。本 change 把前端重构成「写作 / 文件管理 / 设置」三个模块，并拆除上一个 change 遗留的双槽位过渡，让前端真正按内容树工作。

## What Changes

- **BREAKING**：前端从固定「草稿本 / 正文本」双 tab 切换为按内容树工作，写作页只编辑「当前文档」。
- 新增顶部标签式模块导航：`[写作] [文件管理] [设置]`，打开作品默认落在写作页。
- **写作页**：保留格式工具栏 + 写作区 + 查找替换 + AI 面板（四样捆一起，不加文件树）；顶部显示当前文档名，做成一个极简的可点入口，点开是扁平文档列表（非树）用于快速切换文档。
- **文件管理页**（新）：文件树展示与操作（新建文档 / 新建文件夹 / 重命名 / 移动 / 删除进回收站 / 恢复 / 排序）；回收站是文件管理页下的二级页，从文件树底部一行入口进入，不直接混在树里。
- **设置页**：把现有 LLM 配置迁入，作为设置模块的一个区域；以后软件设置、调试、API 相关都收纳在这里。
- **后端配合**：新建作品默认创建一篇文档（不再是「草稿本」「正文本」两篇）；打开作品改为返回整棵内容树结构（不再硬性要求「草稿本」「正文本」存在）；移除旧的 `open_project` / `save_project` 双槽位命令及「前端最小适配返回/保存两篇迁移文档」的过渡 requirement。
- **上次编辑记忆**：前端记住每个作品「上次正在编辑的文档」，重新打开作品时默认回到那篇（跨重启，存 localStorage，按作品路径区分）。
- 命名：用户界面统一叫「**文件管理**」，代码英文名 `content_tree` 保持不变（对应「作品 / project」同款两层命名）。

## Capabilities

### New Capabilities
- `workspace-navigation`: 顶部三模块导航（写作 / 文件管理 / 设置）、打开作品的默认模块、写作页当前文档的显示与极简切换入口、上次编辑文档的记忆与恢复。
- `file-management-ui`: 文件管理模块的界面——文件树展示、新建 / 重命名 / 移动 / 删除进回收站 / 恢复 / 排序，以及回收站二级页。

### Modified Capabilities
- `desktop-project-lifecycle`: 新建作品默认创建一篇文档（替换「根级两篇「草稿本」「正文本」」）；打开作品返回内容树结构（替换「返回两篇固定文档」）；移除「前端最小适配仍返回/保存两篇迁移文档（过渡边界）」的过渡 requirement。

## Impact

- 前端：`src/main.ts`、`src/views.ts`、`src/dom.ts`、`src/editor.ts`、`src/new-project-form.ts`、`src/llm-config-form.ts`、`src/types.ts`、`src/project-api.ts`、`index.html`、`src/styles.css` 大幅调整；新增文件管理页与模块导航相关模块。
- Rust/Tauri 后端：`src-tauri/src/project/operations.rs`（`create_project`、`open_project`）、`src-tauri/src/project/mod.rs`、`src-tauri/src/lib.rs`（移除旧命令、调整打开返回）。
- 现有 specs：`desktop-project-lifecycle` 的需求变更；`content-tree-commands` 保持不变（命令契约不变）。
- 不涉及 DSH、AI 面板逻辑、单篇文档的 Tiptap 格式（`structured-notebook-storage` 格式版本 2 不变）。
