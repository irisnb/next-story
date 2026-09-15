# 设计：修复切换文档误重置全部 AI 讨论

## Context

`editor-document-session.ts` 有两个文档加载入口：`showProject()`（:86-106，作品打开，经 `beforeLoadProject` 与记忆文档解析）与 `loadDocument()`（:70-84，同作品内切换文档）。两者在内部各走完加载后，都调用**同一个** `options.onLoaded(project, documentId)`（汇合点 :105 / :83）。`editor.ts:259-263` 的该回调无条件执行 `aiFeature?.beginProject()`——而 `beginProject()`（ai-feature.ts:853-856）就是作品级重置（`resetProjectScopedAi`：projectToken++、清 undo、释放请求、结束**全部** DSH 会话、`state.reset()`）加重载讨论列表。于是每次切换文档都等于「卸载再重开作品」。

正确的作品边界已存在：`main.ts:117-124` 返回欢迎页 → `editor.unload()` → `endProject()`（editor.ts:161）；重开作品 → `showProject` → `beginProject`。问题只在 onLoaded 这个汇合点把文档边界误接成了作品边界。

既有先例：`applyTree`（session :108-131）树刷新走独立的 `onTreeRefreshed`（editor.ts:264-268，注释明确「不重置 AI 面板」），仅当前文档被移出树时回落 `loadDocument`——该回落路径当前同样会误触发 beginProject，是同一根因的第二触发面。

## Goals / Non-Goals

**Goals:**

- 同作品内切换文档（含 `applyTree` 回落）：不结束会话、不清讨论、不关窗口、不改绑定；只更新编辑器视图与最后打开文档记忆。
- 打开/重开作品：恰一次 `beginProject`（语义不变）；卸载作品：`endProject`（不变）。
- 回归测试锁死该边界，防止再次回潮。

**Non-Goals:**

- 不改 `beginProject`/`resetProjectScopedAi` 自身实现与语义。
- 不动讨论级关注文档改绑（`switchFocusDocument`）。
- 不处理 P1-8（卸载重开后交互模块不重建）。
- 不改后端与驱动协议。

## Decisions

### D1：结构化拆分回调，不做「作品身份比较」

替代方案是比较作品路径、相同则跳过 beginProject。否决理由：**卸载后重开同一作品**时路径相同会被跳过，导致讨论列表不加载；修补它需要把「卸载时清空身份」挂进 unload，引入跨函数的隐藏状态机，边界靠推断维持。拆回调让两条边界在装配处**结构性可见**：`showProject` → `onProjectLoaded`，`loadDocument` → `onDocumentLoaded`，与既有 `onTreeRefreshed` 模式一致（本仓库已验证过的收敛方向）。

### D2：回调契约

`options.onLoaded` 删除，新增两个回调（TypeScript 必填，编译器负责抓住全部漏改点，含测试）：

```
onProjectLoaded(project, documentId)  ← 仅 showProject 触发（含重开）
onDocumentLoaded(project, documentId) ← 仅 loadDocument 与 applyTree 空回落触发
```

`editor.ts` 绑定（各自自包含，语句顺序与原 onLoaded 完全一致）：

```
onDocumentLoaded = writeLastDocumentId + refreshEditorView                      // 不碰 AI 控制器
onProjectLoaded  = writeLastDocumentId + aiFeature?.beginProject() + refreshEditorView
```

不提取共享辅助函数：两个回调各两三行，自包含绑定改动最小、各自可读，且保持原语句顺序（memory → beginProject → refresh）无需论证顺序交换的安全性。

### D3：`applyTree` 回落自然修正，不单独处理

当前文档被移出树时 `applyTree` 回落 `loadDocument` → 走 `onDocumentLoaded` → 不再误重置。同文档树刷新继续走 `onTreeRefreshed`（现状已正确，测试 :495 覆盖）。无需为回落写专属分支——它本来就是文档切换语义。

### D4：测试策略（补审计指出的缺口）

现有缺口：`tests/editor.test.ts` 无任何「switchDocument 后 beginProject 不再被调用」的断言（:464 只测 showProject→1 次、unload→endProject；:495 只测 applyTree）。新增一条绑定 AI mock（含 `beginProject` 计数）的 switchDocument 回归测试；同时确认三条既有基线不回归：showProject 恰一次、unload 一次 endProject、applyTree 同文档零次。

## Risks / Trade-offs

- **[漏改某个 onLoaded 消费点]** → 回调改为必填，`tsc --noEmit` 全仓编译期抓漏；任务内含全仓 `onLoaded` 引用清点。
- **[某处依赖「切文档顺带刷新讨论列表」的隐性行为]** → 讨论列表本就按作品加载、不随文档变化（规格语义），回归全量 `test:frontend`（745+ 项）兜底。
- **[回调命名与未来 P1-8 修复耦合]** → 本变更只拆加载回调；P1-8 的交互模块重建属 `showProject`/`unload` 侧，互不干扰。

## Migration Plan

纯前端装配层改动，无数据迁移。回滚 = revert 单个提交。

## Open Questions

（无——调用链已经侦察核实到行号，方案沿既有 onTreeRefreshed 先例。）
