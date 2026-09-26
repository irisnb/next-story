## 1. ACL 与统一对话框入口

- [x] 1.1 `src-tauri/capabilities/default.json` 增加 `dialog:allow-confirm`、`dialog:allow-message`（与既有 open/save 并列，维持最小授权）
- [x] 1.2 新增 `src/app-dialog.ts`：`confirmDialog`（可用性缺失时保持既有放行；调用失败返回 false＝未确认）与 `showMessage`（吞掉异步拒绝）

## 2. 确认路径改造

- [x] 2.1 `src/editor.ts`：`confirmDiscardingCurrentDocument` 改为异步 `await confirmDialog`；两处使用点（文档会话注入与树刷新回落路径）适配并用 `await` 判断
- [x] 2.2 `src/editor-document-session.ts`：`confirmDiscard` 类型放宽为 `() => boolean | Promise<boolean>`，`await` 后判断，保留取消语义
- [x] 2.3 `src/file-management.ts`：隐藏可见性影响确认改为 `await confirmDialog(message)`，保留确认前后的双重所有权检查

## 3. 提示路径统一

- [x] 3.1 将全部 `alert(` 调用改经 `showMessage`（`editor-context-menu.ts`、`editor-link-actions.ts`、`editor.ts`、`export-word.ts`、`main.ts`、`new-project-form.ts`、`rich-text-editor.ts`、`workspace-project-flow.ts`），保持同步调用形状与既有文案
- [x] 3.2 全库复核：`git grep` 清单中不再存在绕过统一入口的直接 confirm/alert 调用（测试桩除外；`app-dialog.ts` 内部为唯一实现点）

## 4. 测试与验证

- [x] 4.1 新增 `tests/native-dialog.test.ts`：Promise(false) 真取消、Promise(true) 继续、调用拒绝按未确认（false）、同步桩兼容、`showMessage` 对拒绝不产生未处理拒绝、`capabilities/default.json` 含两项授权（配置断言）
- [x] 4.2 既有测试回归：相关测试文件的同步桩继续通过；`agent-on-demand-reading` 夹具的 confirm 桩由独立 `window` 对象改为 `globalThis.confirm`（统一入口读取位置），如实修复后全量通过
- [x] 4.3 `npm run check` 全绿（前端 1134 / 可靠性 120 / 驱动 13 / 离线验证 78 / 构建 / Rust）
- [x] 4.4 `verification/validation.md`：离线证据与如实边界；确认框真机可见性复核并入随后统一真机测试轮，不在本 change 冒充已验证
- [x] 4.5 归档前核对：规格 delta 完整；归档并核对报告/登记处（存储验证 C 项标记「已由 fix-native-dialog-prompts 修复」，真机复核待统一真机轮）
