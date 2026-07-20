## Why

正文本在代码里有两个英文标识：编辑器/保存/Rust 用 `main`，选区快照/AI 用 `manuscript`，中间靠 `tabToNotebookKind` 翻译。草稿本全程是 `draft`，干净；分裂只出在正文本。这违反「一个概念只能有一个名字」，也会让后续改 AI 的人误以为存在第三个本子。现在统一成本低，且不碰用户可见行为。

这次 change 只处理「代码里同一个本子有两个名字」的问题。它不是 AI 能力扩展，不改变用户写作、保存、召唤 AI、继续追问或模型请求的行为。可以把它理解成：同一个镜头素材在剪辑工程里同时叫 `main` 和 `manuscript`，现在只把工程内部素材名统一，画面内容、导出文件和观众看到的片名都不动。

当前分裂点很具体：

- 草稿本：标签页、编辑器状态、选区快照都使用 `draft`。
- 正文本：标签页、编辑器状态、保存/Rust 方向使用 `main`。
- 正文本：选区快照/AI 相关前端类型使用 `manuscript`。
- `tabToNotebookKind` 负责把 `main` 翻译成 `manuscript`，这正是第二名字入口。

如果继续保留这层翻译，后续任何人改选区、AI 面板或追问时，都可能误判为「正文本在 AI 层就应该叫 manuscript」。这会扩大概念分裂，也增加误改磁盘字段、IPC 字段或规格文档的风险。

## What Changes

- 将选区/AI 层的本子代码标识统一为 `main`（与 UI 标签页、保存状态、IPC 字段一致）。
- 删除 `manuscript` 作为正文本代码标识的用法，以及 `tabToNotebookKind` 映射函数。
- 类型上让标签页与选区快照共用同一套本子值：`"draft" | "main"`（能合并类型则合并，避免平行别名）。
- 更新相关前端测试与误导性现行代码注释；现行 openspec 主规格若出现「正文本代码层叫 manuscript」类表述则对齐（当前主规格以中文产品名为主，预期改动很小）。
- **不改**用户可见中文名（草稿本/正文本）、磁盘文件名（`草稿本.txt`/`正文本.txt`）、Rust `main_content` 字段语义、AI 请求内容、Prompt、产品铁律。
- **不改**归档 change 历史与反面案例文档中的历史用词。

更细地说，本 change 的实现范围只允许包含：

- 前端类型定义：把选区快照的本子字段值收敛到 `draft | main`。
- 前端选区捕获：让 `captureSelection` 直接接收当前标签页代码值，不再翻译。
- 前端调用点：删除为了翻译 `main -> manuscript` 存在的调用。
- 前端测试：把期望值从 `manuscript` 改为 `main`，并删除映射函数本身的测试。
- 现行规格 delta：写清「代码标识唯一」这个约束，防止以后回流。

明确不允许借此扩大到：

- 改作品文件夹结构或中文文本文件名。
- 改 Rust 保存字段，例如把 `main_content` 改名。
- 改 AI 请求结构、Prompt、追问轮次或面板状态机。
- 引入任何「应用到正文」「自动整理正文」「AI 写回」能力。
- 清洗历史归档、反面案例或已经完成 change 的历史文字。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `selection-ai-invocation`：明确选区快照中的本子类型代码标识仅为 `draft` | `main`，分别对应草稿本与正文本；MUST NOT 再使用 `manuscript`（或其它第二英文名）标识正文本。
- `writing-notebooks`：明确两个本子的唯一代码标识为 `draft` / `main`，与产品名草稿本/正文本一一对应；不引入第二套本子 ID。

## Impact

- **代码**：`src/types.ts`、`src/selection-adapter.ts`、`src/selection-entry.ts`；可能的引用方与测试（`tests/selection-adapter.test.ts`、`tests/ai-panel-scroll.test.ts` 等）。
- **规格**：上述两个 capability 的 delta（行为对用户不变，约束代码标识唯一）。
- **API / 磁盘 / 运行时用户行为**：无破坏性用户行为变化；IPC 仍用既有 `main_content`；快照 `notebook` 字段仅前端内部使用，不发往模型。
- **非目标**：不拆 `ai-panel-state`；不改 AI 追问/生成逻辑；不做 `manuscript` 全库历史文档清洗。

验收时重点看四件事：

- `src/` 与 `tests/` 中，作为本子 ID 的 `manuscript` 不再出现。
- `tabToNotebookKind` 不再存在。
- 正文本选区快照的 `notebook` 值为 `main`，草稿本仍为 `draft`。
- `npm run check` 通过，且 diff 没有触碰磁盘中文路径、Rust IPC 字段语义和 AI Prompt。
