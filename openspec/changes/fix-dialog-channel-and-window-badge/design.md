## Context

统一真机测试轮（2026-09-26）在**已安装的修复构建**上对上一 change（`fix-native-dialog-prompts`）做验收时发现两处缺陷。直接证据与源码链：

- **确认管道**：
  - 运行时探针（应用内 `__TAURI_INTERNALS__.invoke`）：`plugin:dialog|confirm` → `REJECTED:Command plugin:dialog|confirm not allowed by ACL`；`plugin:dialog|message` → 实际弹出并返回（`Cancel`）；`plugin:dialog|open` → 通过 ACL（仅报参数错误）。
  - 插件源码（`tauri-plugin-dialog-2.7.1`）：`src/lib.rs` 的 `invoke_handler` 只注册 `commands::open` / `commands::save` / `commands::message`；`permissions/confirm.toml` 的 `allow-confirm` 为**废弃别名**，`commands.allow = ["message"]`。
  - 插件注入脚本（`src/init-iife.js`，由 `lib.rs:195` 注入）：`window.confirm` 覆写调用 `plugin:dialog|confirm`——**该命令不存在**，该覆写在 2.7.1 中是不可用通道。
  - 官方 JS 包（`@tauri-apps/plugin-dialog` dist）：`confirm()` / `ask()` 都经 `messageCommand()` 调用 `plugin:dialog|message`。
  - 上一 change 的假设（「注入覆写是可用通道，包装它即可」）因此不成立；其 ACL 新增中 `allow-message` 是有用的一半、`allow-confirm` 是无害但无效的别名。
- **徽标**：`src/ai-window.ts` 渲染序列先 `dom.badge.classList.toggle("hidden", badge === null)`，随后 `applyBadgeClass` 以 `dom.badge.className = "ai-window-badge"` **整体重置类名**，把 `hidden` 抹掉；终态（done / idle）时徽标不隐藏、文本停留在上一次的「生成中」。真机 DOM 证据：`badge.cls = "ai-window-badge"`（无 `hidden`）、文本「生成中」，同时停止按钮已隐藏、轮次档案已 `done`。

约束：保持既有测试接缝（多个测试文件以 `globalThis.confirm` / `globalThis.alert` 打桩）；不改产品文案与交互；重建安装包需要新的真机复验。

## Goals / Non-Goals

**Goals:**

- 确认与提示对话框在真实应用中**可用**：经官方插件 API 安装运行期实现，取消 / 确认行为正确。
- ACL 授权与实际命令一致（`message`），移除废弃别名。
- 徽标在终态正确隐藏，不再残留「生成中」。
- 回归测试覆盖两条修复；真机复验继续统一测试轮。

**Non-Goals:**

- 不改对话框文案、按钮语义与调用点（`editor.ts`、`file-management.ts`、20 处提示保持不动）。
- 不重写测试桩体系（继续以全局函数为接缝；安装器提供可注入实现仅供测试）。
- 不改后端 Rust；不动统一真机测试轮其余场景的执行方式。
- 不为插件上游缺陷做通用兼容层（只修本应用使用的两条通道）。

## Decisions

### D1：官方 API 背书 + 启动时安装（保留全局接缝）

`app-dialog.ts` 新增：

```ts
export interface NativeDialogImpls {
  confirm?: (message: string) => Promise<boolean>;
  message?: (message: string) => Promise<void>;
}
export function installNativeDialogs(impls: NativeDialogImpls = {}): void;
```

- 默认实现取 `@tauri-apps/plugin-dialog` 的 `confirm` / `message`；安装为 `globalThis.confirm` / `globalThis.alert`（alert 侧包一层吞拒绝）。
- `main.ts` 启动装配时调用一次（早于任何用户交互；晚于插件注入，因此覆盖注入覆写）。
- `confirmDialog` / `showMessage` 继续读全局函数——**测试接缝零迁移**（现有 5+ 个测试文件的全局桩保持不变）。

被否决的替代 A：把测试桩迁移到模块注入（mock `@tauri-apps/plugin-dialog`）。`node --test` 无模块 mock 框架，需要重写所有确认 / 提示相关测试，churn 与回归风险大。

被否决的替代 B：继续等待 / 依赖注入覆写。该覆写在本版本调用不存在的命令，永远不可用。

### D2：alert 一并安装，取消对注入覆写的依赖

提示侧当前经注入覆写（`plugin:dialog|message`）可用，但同样依赖注入脚本。统一由 `installNativeDialogs` 安装两条通道，使应用不再依赖插件注入行为；`showMessage` 的吞拒绝语义不变。

### D3：capabilities 以实际命令为准

移除 `dialog:allow-confirm`（废弃别名，实际不授予任何 confirm 命令）；保留 `dialog:allow-open`、`dialog:allow-save`、`dialog:allow-message`。规格同步要求「授权以实际调用的命令为准」。

### D4：徽标修复方式

`applyBadgeClass` 不再整体覆写类名：仅清理 / 添加 `is-*` 状态类，`hidden` 由既有的显式切换管理；或在渲染顺序上保证隐藏切换发生在类名整理之后。以测试锁定：生成中徽标可见且文本「生成中」；完成后徽标带 `hidden` 且不显示；已停止 / 失败等状态词与类正确。

**风险**：自装与注入覆写的先后（注入在 webview 初始化、自装在 `DOMContentLoaded` 装配——后者晚，覆盖成立）；官方 API 在测试环境不可调用（安装器接受注入实现，测试不触碰真实 API）。

## Risks / Trade-offs

- [官方 API 签名随插件升级变化] → 以包内 `.d.ts` 为准并在类型检查下使用；升级插件由 Dependabot 提醒。
- [用户语言环境 / 原生对话框外观变化] → 不指定 kind / title，与既有覆写外观保持一致（避免引入新文案）。
- [徽标修复影响其它状态显示] → 状态词映射不变，仅修类名管理；补状态矩阵测试。
- [重建安装包耗时] → 一次重建同时复验两条修复；作为统一真机轮的一部分执行。

## Migration Plan

- 无数据迁移；代码回滚即可。
- 实施后重建安装包并重装，继续统一真机测试轮（对话框取消 / 确认、徽标、余下 B/C/D 场景）。

## Open Questions

- 无阻塞项。上游插件缺陷（注入覆写引用不存在命令）如实记录在验证文档，不向上游提交改动（本 change 只保证应用侧可用）。
