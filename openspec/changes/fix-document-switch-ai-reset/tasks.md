# 任务：修复切换文档误重置全部 AI 讨论

## 1. 回调拆分与绑定

- [x] 1.1 全仓清点 `onLoaded` 引用（src 与 tests），确认除 `editor.ts` 装配处外无其他消费者
- [x] 1.2 `src/editor-document-session.ts`：options 删除 `onLoaded`，新增必填 `onProjectLoaded` 与 `onDocumentLoaded`；`showProject`（:105）触发前者，`loadDocument`（:83）触发后者
- [x] 1.3 `src/editor.ts`：移除原 :259-263 的无条件 `beginProject`，改为 `onProjectLoaded`（记忆 + beginProject + 视图）与 `onDocumentLoaded`（仅记忆 + 视图）两个自包含绑定；`applyTree` 空回落（session :125）一并走 `onDocumentLoaded`
- [x] 1.4 `npm run typecheck` 通过（编译器确认回调契约无漏改点）

## 2. 回归测试

- [x] 2.1 `tests/editor.test.ts`：新增「switching to another document does not reset the AI project」——绑 AI 控制器 mock，走真实用户路径（点击文档列表项切换到文档二），断言 beginProject 计数不变且当前文档已切换
- [x] 2.2 既有生命周期基线全过：showProject → beginProject 恰一次；unload → endProject 一次；applyTree 同文档不重置（:495 现有测试）；session 级测试同步更新（loadDocument 不触发作品级回调、空回落走文档回调）

## 3. 验证与收尾

- [x] 3.1 全量验证：`npm run test:frontend`（746 通过 0 失败）+ `npm run typecheck` + `npm run lint` 全过
- [x] 3.2 更新 `方向/全量地基审计-2026-09-14.md` 队列 4 行状态并同步进度注记（P0 清 4/5）
- [ ] 3.3 提交推送，确认 CI 双平台绿灯
- [ ] 3.4 归档 change（openspec archive，同步主 specs）
