## Why

存储验证（2026-09-25）登记的 C 项缺陷至今未修：Tauri 对话框插件把 `window.confirm` / `window.alert` 覆写为异步实现，但 `capabilities/default.json` 缺 `dialog:allow-confirm` / `dialog:allow-message` 授权，命令被 ACL 拒绝；且调用方按同步布尔使用（`!Promise` 恒为假）——「关闭文档 AI 可见性前的影响确认」与「删除未保存文档的确认」被跳过，**破坏性操作在无用户确认下执行**；各失败提示也不显示。即将进行的统一真机测试轮会直接踩中它（隐藏文档影响提示不出现），先修再测。

## What Changes

- **ACL 最小补授权**：`src-tauri/capabilities/default.json` 增加 `dialog:allow-confirm` 与 `dialog:allow-message`（与既有 `dialog:allow-open` / `dialog:allow-save` 并列）。
- **统一对话框入口**：新增 `src/app-dialog.ts`——`confirmDialog` 按异步语义等待用户决定（兼容同步布尔桩与 Promise 实现），对话框调用失败时按「未确认」处理；`showMessage` 承载提示类信息并吞掉异步拒绝，不产生未处理拒绝。
- **确认路径改造**：未保存文档删除守卫（`editor.ts` / `editor-document-session.ts`）与隐藏文档影响确认（`file-management.ts`）改为 `await` 语义，并保持既有所有权检查。
- **提示路径统一**：全部 `alert(` 调用改经 `showMessage`（8 个文件、约 20 处），保持同步调用形状。
- **防复发回归**：Promise 型确认（取消真的取消、确认才继续）、确认调用失败不当作已确认、提示拒绝不产生未处理拒绝、capabilities 两项授权齐备的配置断言。
- **真机复核**：确认框可见性与取消/确认行为——并入随后的统一真机测试轮记录。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tauri-security-baseline`：新增「系统对话框的授权与异步语义」要求——实际使用的对话框能力必须授权；确认类调用必须按异步语义等待；对话框调用失败不得被当作已确认。

## Impact

- 配置：`src-tauri/capabilities/default.json`。
- 前端：新增 `src/app-dialog.ts`；`src/editor.ts`、`src/editor-document-session.ts`、`src/file-management.ts`（确认路径）；`src/editor-context-menu.ts`、`src/editor-link-actions.ts`、`src/export-word.ts`、`src/main.ts`、`src/new-project-form.ts`、`src/rich-text-editor.ts`、`src/workspace-project-flow.ts`（提示路径）。
- 测试：新增 `tests/native-dialog.test.ts`；相关既有测试保持兼容。
- 兼容性：无对话框能力的环境（测试 / 浏览器）保持既有放行语义；不改后端 Rust、不改确认文案与用户流程。
- 不涉及：统一真机测试轮本身（作为其后独立执行的活动）。
