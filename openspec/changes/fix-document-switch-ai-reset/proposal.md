# 提案：修复切换文档误重置全部 AI 讨论（P0-3）

## Why

同一作品内**切换文档**（用户每天都在做的基础操作）会触发作品级的 AI 全量重置：关闭全部讨论窗口、结束全部 DSH 会话、清空讨论列表。用户正在开的讨论、正在生成的轮次、窗口布局全部被无辜清掉。

根因（2026-09-16 复核，行号以当前 HEAD 为准）：「打开作品」与「切换文档」两条加载路径在 `editor-document-session.ts` 内部分叉（`showProject` :86-106 与 `loadDocument` :70-84），却**汇合到同一个 `options.onLoaded` 回调**（`editor.ts:259-263`）；该回调无条件调用 `aiFeature?.beginProject()`，而 `beginProject()`（`ai-feature.ts:853-856`）= `resetProjectScopedAi()`（:842-849，结束全部会话、清空全部状态）+ 重载讨论列表——零参数、零作品身份比较。这直接违反已归档规格 `ai-panel-state-structure`（spec.md:111-114：「切换文档时不清空讨论、不改变讨论绑定、不关闭窗口」）。对应审计队列第 4 项（P0-3），是用户每天会踩的正确性缺陷。

## What Changes

- **拆分回调**：`editor-document-session.ts` 把单一 `onLoaded` 拆成两个明确回调——`onProjectLoaded(project, documentId)`（仅 `showProject` 作品打开路径触发）与 `onDocumentLoaded(project, documentId)`（仅 `loadDocument` 文档切换路径触发）。
- **绑定归位**：`editor.ts` 中 `beginProject()` 只绑定到 `onProjectLoaded`；`onDocumentLoaded` 只做文档级的事——写「最后打开文档」记忆 + 刷新编辑器视图，完全不触碰 AI 控制器。
- **`applyTree` 回落路径一并修正**：当前文档被移出树时回落到 `loadDocument`（文档路径），修正后同样不再误重置——这是同一根因的另一个触发面。
- **补回归测试**：绑定 AI 控制器 mock 的 `switchDocument` 测试，断言 `beginProject` 不被再次调用（审计指出的测试缺口：`editor.test.ts:495` 现有测试只覆盖 `applyTree`，无文档切换覆盖）。
- 作品生命周期的正确语义不变：打开/重开作品恰一次 `beginProject`（重载讨论列表），卸载作品 `endProject`（`editor.ts:161`，现状已正确）。

### 不做什么（Non-Goals）

- 不改 `beginProject` / `resetProjectScopedAi` 自身语义（作品级重置本身是对的，只是触发边界错了）。
- 不动讨论级「关注文档改绑」（`switchFocusDocument`，ai-feature.ts:370-378）——那是讨论级机制，与本修复的控制级边界无关。
- 不处理 P1-8（卸载重开后快捷键/右键菜单不重建）——相邻缺陷但独立修，不搭车。
- 不改 Rust 后端、不改驱动协议。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-panel-state-structure`：新增一条 Requirement，把「作品级 AI 生命周期只由作品边界触发，文档切换不触发」从现有 Scenario 的一句话暗示升格为显式契约（现有 :111-114 Scenario 已要求此行为，本变更使其可被专门测试与守护）。

## Impact

- **代码**：`src/editor-document-session.ts`（回调拆分）、`src/editor.ts`（绑定改造，约 :259-268 区域）、`tests/editor.test.ts`（新增回归测试）。
- **规格**：`openspec/specs/ai-panel-state-structure/spec.md` 增补一条 Requirement（delta 见 specs/）。
- **验证**：`npm run test:frontend` 全量 + typecheck + lint；行为面由新增回归测试与既有 `showProject`/`unload`/`applyTree` 生命周期测试共同覆盖。
- **风险**：低——改动集中在回调装配处；`onTreeRefreshed` 已是同类「拆回调」的既有先例（editor.ts:264-268，注释明确「不重置 AI 面板」），本变更沿同一模式收敛。
