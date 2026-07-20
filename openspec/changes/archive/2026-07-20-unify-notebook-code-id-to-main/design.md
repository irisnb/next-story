## Context

产品有且仅有两个用户文本本子：草稿本、正文本。磁盘与 UI 中文名稳定；代码侧草稿本全程为 `draft`，正文本在编辑器/保存/Rust 为 `main`，在选区快照为 `manuscript`，经 `tabToNotebookKind` 翻译。

快照字段 `notebook` 仅用于前端身份比较（同一次召唤、滚动重置等），**不**发送给模型，后端也不按本子类型分支生成。统一标识是命名/类型对齐，不是行为功能。

约束：一次一个 change；零写回；不扩大 AI 能力；用户已确认统一到 `main`、类型尽量合并、代码+测试+误导性现行注释/规格表述一并清、历史归档不动。

### Current Naming Map

| 层 | 草稿本现状 | 正文本现状 | 本 change 后 |
|---|---|---|---|
| UI 标签页代码值 | `draft` | `main` | 保持 `draft` / `main` |
| 编辑器内存状态 | `draft` | `main` | 保持 `draft` / `main` |
| 保存 / Rust IPC 语义 | `draft_content` 方向 | `main_content` 方向 | 保持不变 |
| 选区快照 `notebook` | `draft` | `manuscript` | 改为 `draft` / `main` |
| 选区/AI 前端类型 | `NotebookKind` 含 `draft` | `NotebookKind` 含 `manuscript` | 与标签页共用 `draft | main` |

这里最容易误解的是 `main`：它在代码里同时可能出现在 Tauri 主窗口、入口文件或正文本标识中。本 change 只处理「本子代码标识」。如果遇到 window id、入口文件 `main.ts`、Rust `main.rs`，不因名字相同而改动。

## Goals / Non-Goals

**Goals:**

- 正文本唯一代码标识：`main`。
- 两个本子代码值仅为：`draft` | `main`。
- 删除 `manuscript` 与 `tabToNotebookKind`。
- 选区快照与标签页使用同一套本子值（优先单一类型，避免平行别名）。
- 测试与现行注释对齐；用户可见行为不变。
- `npm run check` 通过。

**Non-Goals:**

- 不改磁盘 `草稿本.txt` / `正文本.txt`。
- 不改 Rust IPC 字段名语义（保持 `main_content` 等）。
- 不改 AI Prompt、生成、追问、面板 UX。
- 不拆 `ai-panel-state`。
- 不清洗归档 change / 反面案例中的历史用词。
- 不把 `main` 改成 `manuscript` 或其它名字。

## Decisions

### D1：统一目标标识为 `main`（不是 `manuscript`）

- **选择**：选区/AI 改为 `main`，与 UI/保存/IPC 主轨对齐。
- **理由**：改动面最小；避免触碰存盘与 Rust；旧项目曾有 manuscript 相关烂账语义，不宜再当主名。
- **备选**：全库改 `manuscript` —— 否决（IPC/编辑器/测试面过大，无用户收益）。

### D2：类型合并策略

- **选择**：标签页与选区共用 `"draft" | "main"`。优先让 `SelectionSnapshot.notebook` 使用与 `NotebookTab` 相同的类型（或单一导出类型别名），删除仅值为 `manuscript` 的 `NotebookKind` 分叉。
- **理由**：同值仍双类型名也会留下「好像有两套本子 ID」的错觉。
- **备选**：保留两个 type 名但值同为 draft/main —— 可接受但次优；仅在合并引起无谓大 diff 时退回。

### D3：删除映射层

- **选择**：删除 `tabToNotebookKind`；`captureSelection` 直接接收当前 tab / `draft|main`。
- **理由**：无翻译即无第二名字入口。

### D4：规格写法

- **选择**：在 `selection-ai-invocation` 与 `writing-notebooks` 用 **ADDED** 约束「代码标识唯一」，不改写既有中文产品行为需求（那些需求已正确使用草稿本/正文本）。
- **理由**：用户行为未变；需要可归档的规范钩子防止 `manuscript` 回流。

### D5：历史文档

- **选择**：`openspec/changes/archive/**`、`反面案例/**` 不改。
- **理由**：历史证据应保持原貌；现行真相以主规格 + 代码为准。

### D6：`manuscript` 清理边界

- **选择**：只清理现行业务代码、现行测试、当前 change delta 需要约束的规格。历史归档、旧反例、第三方依赖、用户创作文本中的自然语言不纳入清理。
- **理由**：目标是消除当前系统里的第二本子 ID，不是做全仓库文字替换。全仓库机械替换会破坏历史记录，也可能误动与本 change 无关的文本。

### D7：测试优先锁定行为等价

- **选择**：实现时先改选区适配相关测试期望，再改代码让测试表达新命名；最终跑完整 `npm run check`。
- **理由**：用户行为不变，但内部快照值变化。测试应该明确锁住「正文本快照现在是 `main`」和「不再存在映射函数」这两个结果。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 漏改测试中的 `"manuscript"` | 实现后对 `src/`、`tests/` 全量 grep，业务路径应为 0 |
| 误改磁盘中文路径或 IPC | 任务清单明确禁止；diff 审查 |
| 合并类型引起额外 import 噪音 | 优先最小 diff；必要时 type alias 过渡 |
| 有人把 Tauri window id `main` 与本子 `main` 混淆 | 注释写清：本子标识 vs 窗口 id 是不同概念 |
| 机械替换误伤历史文档 | 搜索结果按目录筛选；archive 与反面案例只读不改 |
| AI 相关文件被误认为要改 Prompt | 本 change 只允许改快照身份字段；Prompt 与消息组装不得改 |
| `NotebookKind` 删除后引用方报类型错 | 先用 LSP/TypeScript 暴露所有引用，再逐个改为共用类型 |

## Migration Plan

### Step A：确认实现基线

1. 只看现行路径：`src/`、`tests/`、`openspec/specs/` 与本 change 的 `openspec/changes/unify-notebook-code-id-to-main/`。
2. 搜索 `manuscript`、`NotebookKind`、`tabToNotebookKind`、`notebook`，确认哪些是本子 ID，哪些只是历史文字或无关词。
3. 确认没有另一个活跃 change 需要同时修改同一套文件。

### Step B：先收敛类型

1. 在 `src/types.ts` 中让选区快照使用同一套本子代码值：`draft | main`。
2. 优先做法：复用已有 `NotebookTab`，或建立单一类型别名让 `NotebookTab` 与快照字段都指向同一个联合类型。
3. 删除以 `manuscript` 为值的类型分叉；如果删除类型名会造成大面积无意义 diff，可短暂保留类型名但值必须已是 `draft | main`，且后续任务继续评估能否删掉。

### Step C：删除翻译层

1. 在 `src/selection-adapter.ts` 删除 `tabToNotebookKind`。
2. 让 `captureSelection` 直接接收当前本子代码值。
3. 保持选区文本、起止位置、浮动按钮定位、空白选区判断等行为不变。

### Step D：改调用点和测试

1. 在 `src/selection-entry.ts` 及其它调用点删除映射调用，直接传当前 tab。
2. 更新 `tests/selection-adapter.test.ts`：正文本快照期望从 `manuscript` 改为 `main`；删除映射函数测试。
3. 更新其它测试中作为本子 ID 的 `manuscript`，例如 AI 面板滚动状态测试。

### Step E：残留检查与验证

1. 搜索 `src/` 与 `tests/`：作为本子 ID 的 `manuscript` 应为 0；`tabToNotebookKind` 应为 0。
2. 跑 `npm run check`。
3. 人工审 diff：确认未改磁盘中文路径、Rust `main_content`、AI Prompt、AI 请求消息结构、用户可见文案。
4. 若验证失败，只修本 change 引入的问题；不顺手重构无关模块。

### Data Migration

无需数据迁移。原因：

- `notebook` 是运行期前端快照字段，不写入作品文件夹。
- 已保存作品仍是 `草稿本.txt` / `正文本.txt`。
- Rust IPC 的 `main_content` 语义不变。
- AI 后端不根据 `notebook` 字段保存或持久化状态。

### Rollback Plan

如实现中发现范围失控或验证失败难以快速定位：

1. 回退本 change 对 `src/types.ts`、`src/selection-adapter.ts`、`src/selection-entry.ts` 和相关测试的修改。
2. 保留 OpenSpec 文档不归档，重新评估是否需要更小 change。
3. 因不涉及磁盘数据迁移，回滚不需要处理用户作品文件。

## Open Questions

（无。用户已确认：统一到 `main`、类型合并优先、代码+测试+现行误导表述、历史不动。）
