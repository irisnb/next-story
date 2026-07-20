## 1. 类型与选区适配

- [x] 1.1 在 `src/types.ts` 将本子代码值收敛为单一联合类型 `"draft" | "main"`，并让 `NotebookTab` 与选区快照字段共用这套值
- [x] 1.2 在 `src/types.ts` 删除或改写以 `manuscript` 为正文本值的 `NotebookKind` 分叉；若为降低 diff 暂留类型名，其值也 MUST 仅为 `draft | main`
- [x] 1.3 在 `src/types.ts` 清理误导注释：不得再表达「正文本在选区/AI 层叫 manuscript」
- [x] 1.4 在 `src/selection-adapter.ts` 删除 `tabToNotebookKind`，使 `captureSelection` 直接接受当前本子代码值 `draft | main`
- [x] 1.5 在 `src/selection-adapter.ts` 确认除 `notebook` 字段值外，其它快照字段（原文、起止位置、矩形位置、空白过滤）行为不变
- [x] 1.6 在 `src/selection-entry.ts`（及任何仍调用映射的调用点）改为直接传入当前本子标识，无 `main -> manuscript` 翻译层

## 2. 测试与残留清理

- [x] 2.1 更新 `tests/selection-adapter.test.ts`：正文本快照期望与用例从 `manuscript` 改为 `main`
- [x] 2.2 更新 `tests/selection-adapter.test.ts`：移除 `tabToNotebookKind` 映射函数测试，改为验证 `captureSelection` 直接保留传入的 `main`
- [x] 2.3 更新其余前端测试中硬编码的 `"manuscript"` 本子标识（如 `tests/ai-panel-scroll.test.ts`）
- [x] 2.4 在 `src/` 与 `tests/` 检索：业务代码不得再出现作为本子 ID 的 `manuscript` 或 `tabToNotebookKind`
- [x] 2.5 人工筛选搜索结果：若 `manuscript` 只出现在 archive、反面案例、旧说明或非当前业务路径中，不为本 change 修改

## 3. 验证

- [x] 3.1 运行 TypeScript/LSP 诊断或 `npm run typecheck`，确认类型合并没有留下引用错误
- [x] 3.2 运行前端测试，确认选区快照与 AI 面板状态测试按 `main` 通过
- [x] 3.3 运行 `npm run check`（typecheck、前端测试、前端构建、Rust 测试按项目脚本），确认通过
- [x] 3.4 人工确认范围：未改磁盘中文路径、未改 Rust `main_content` 字段语义、未改 AI 请求/Prompt、未改用户可见文案；diff 仅命名/类型/测试/当前规格 delta
- [x] 3.5 人工确认行为等价：草稿本仍用 `draft`；正文本选区快照改为 `main`；AI 仍只拿选区原文，不读取上下文，不写回两本子

## 4. 收尾

- [x] 4.1 向用户报告实现 diff 与验证结果，明确这是内部命名统一、用户可见行为无变化
- [x] 4.2 用户确认实现无误后，按流程 archive 本 change（将 delta 合入 `selection-ai-invocation` 与 `writing-notebooks` 主规格）
