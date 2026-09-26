## Context

存储验证（`openspec/changes/archive/2026-09-24-rework-conversation-storage/verification/validation.md` C 节）登记的缺陷在五次 change 后仍未修：

- `tauri-plugin-dialog 2.7.1` 经 `init-iife.js` 把 `window.confirm` 覆写为**异步**实现（返回 Promise，映射 `plugin:dialog|confirm`）、`window.alert` 覆写为映射 `plugin:dialog|message` 的异步调用。
- `src-tauri/capabilities/default.json` 只授予 `dialog:allow-open` / `dialog:allow-save`；`confirm` / `message` 两条命令被 ACL 拒绝（验证时实测捕获未处理拒绝）。
- 调用方按同步布尔使用：`src/editor.ts:46-48`（`return globalThis.confirm(...)` 当布尔返回）、`src/file-management.ts:265`（`!window.confirm(message)` 恒假）、~20 处 `alert` 调用遍布 8 个文件。
- 后果：删除未保存文档的确认与关闭文档 AI 可见性前的影响确认被**静默跳过**（破坏性操作无确认执行）；各失败路径提示不显示。

既有规格已经要求这些确认存在——`project-reliability-boundaries`「Unsaved current document deletion is explicit」、`controlled-story-read-visibility`「关闭 AI 可见性前提示受影响讨论」——本缺陷属**实现违约**（ACL 缺授权 + 同步误用），不是需求缺失。本 change 同时补一条安全基线要求防止复发。

测试现状（修复必须兼容）：`tests/editor.test.ts`、`tests/export-word.test.ts`、`tests/editor-link-popover.test.ts` 以同步函数桩替换 `globalThis.confirm` / `globalThis.alert`；`tests/workspace-project-flow.test.ts` 以 `Object.defineProperty(window, "confirm", ...)` 注入同步桩。

## Goals / Non-Goals

**Goals:**

- 全部确认路径恢复可见且语义正确：取消真的取消、确认才继续。
- 确认类调用按异步语义等待；对话框调用失败时破坏性操作不被当作已确认。
- 提示类调用不产生未处理拒绝。
- ACL 两项授权齐备并有配置断言；防复发回归测试。

**Non-Goals:**

- 不改确认/提示文案与用户流程；不改后端 Rust；不引入新依赖。
- 不重写测试桩体系（保持既有同步桩可用）。
- 不做真机可见性复核（并入随后的统一真机测试轮）。
- 不新建对话框语义模块的通用抽象层（统一入口只做异步兼容与失败语义，不扩 API）。

## Decisions

### D1：保留 `globalThis` 调用，新增统一入口包装异步语义

`src/app-dialog.ts`：

- `confirmDialog(message): Promise<boolean>`：
  - `typeof globalThis.confirm !== "function"` → `true`（环境无对话框能力：保持既有放行语义，服务测试/浏览器）；
  - 否则 `try { return Boolean(await globalThis.confirm(message)); } catch { return false; }`——**调用失败 = 未确认**，破坏性操作不执行。
- `showMessage(message): void`：`alert` 不存在直接返回；调用结果若为 Promise 则 `void result.catch(() => {})`——信息性提示失败不制造未处理拒绝。

被否决的替代 A：改用 `@tauri-apps/plugin-dialog` 官方 import 并 `await`。需要把 4 个测试文件的同步桩体系重写为模块注入，churn 与回归风险大；且 `window.confirm/alert` 的异步覆写本就是该插件的兼容通道，包装它同样正确。

被否决的替代 B：只补 ACL、不改调用方。`!Promise` 恒假，守卫仍被跳过——根因未修。

### D2：ACL 只加两项

`capabilities/default.json` 增加 `dialog:allow-confirm`、`dialog:allow-message`。维持「只授予实际使用能力」基线：不顺手加 `ask` 等未使用权限。

### D3：失败语义区分「无能力环境」与「调用失败」

- 可用性缺失（`typeof !== "function"`）：保持既有放行（否则纯浏览器/测试环境无法工作）。
- 调用被拒/运行时错误（Promise reject 或同步 throw）：`confirmDialog` 返回 `false`（失败关闭），`showMessage` 吞掉。
  取舍如实记录：对话框故障时确认类操作会被挡住——安全优先于便利。

### D4：提示路径统一为 `showMessage`

全部 `alert(` 调用（8 文件约 20 处）改为 `showMessage(`：保持同步调用形状（fire-and-forget），获得拒绝吞掉，并把未来对话框语义集中在单一入口。不改变各提示的触发条件与文案。

## Risks / Trade-offs

- [对话框故障时确认操作被挡住] → 安全优先（宁可拦住，不可静默放行破坏性操作）；后续如需可见故障提示可单独立项。
- [插件未来改变注入行为] → 包装同时兼容同步布尔与 Promise，两种形态都有测试。
- [遗漏确认/提示调用点] → 以全库 `confirm(` / `alert(` grep 清单为验收基线；关键路径有测试覆盖。
- [宿主 ACL 配置与真实注入行为仍在真机才可见] → 配置断言只能防「漏授权」；真实对话框行为由统一真机测试轮复核。

## Migration Plan

- 无数据迁移；回滚即代码回退。
- 规格与实现同一 change；归档时同步 `tauri-security-baseline` 并更新验证记录；真机复核并入随后的统一真机测试轮（不在本 change 内冒充已验证）。

## Open Questions

- 无阻塞项。
