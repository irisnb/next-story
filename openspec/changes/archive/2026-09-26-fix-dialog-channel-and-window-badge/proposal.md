## Why

统一真机测试轮在**已安装的修复构建**上发现两处缺陷，其中之一阻塞后续场景：

1. **确认框管道在本插件版本根本不可用（阻塞 B 组场景）**：`tauri-plugin-dialog 2.7.1` 注入的 `window.confirm` 覆写调用 `plugin:dialog|confirm`，但该版本实际只注册 `open` / `save` / `message` 三个命令——`confirm` 命令不存在，`allow-confirm` 权限只是 `allow-message` 的废弃别名（`confirm.toml` 原文："DEPRECATED: This is now an alias to `allow-message`"）。因此即便 ACL 已授予（上一 change 的修复），该管道也永远无法弹出确认框；应用按既有「调用失败按未确认」语义静默中止。真机证据：探针返回 `REJECTED:Command plugin:dialog|confirm not allowed by ACL`；同一构建中 `message` 命令实测弹框并返回结果、`open` 命令通过 ACL。官方 JS API 的 `confirm()` / `ask()` 实际经 `message` 命令实现——正确通道是官方 API，不是注入覆写。
2. **窗口状态徽标残留「生成中」**：`ai-window.ts` 的 `applyBadgeClass` 以整体赋值重置类名，把同一轮渲染稍早加上的 `hidden` 类抹掉；生成完成后徽标不消失，永远显示过期的「生成中」文本（真机证据：轮次已 `done` 落盘、发送按钮已复位、停止按钮已隐藏，徽标仍可见）。

## What Changes

- **对话框改为官方 API 背书、启动时安装**：`app-dialog.ts` 新增 `installNativeDialogs()`——用 `@tauri-apps/plugin-dialog` 的 `confirm` / `message` 作为 `window.confirm` / `window.alert` 的运行期实现，在应用启动装配时安装（覆盖插件注入的不可用覆写）；`confirmDialog` / `showMessage` 的失败语义不变（调用失败按未确认、提示失败吞拒绝）。
- **capabilities 清理**：保留实际使用的 `dialog:allow-message`（以及 `open` / `save`），移除已废弃且仅为别名的 `dialog:allow-confirm`。
- **徽标渲染修复**：类名管理不再覆盖 `hidden`；终态（已完成 / 空闲）徽标正确隐藏，生成中 / 排队 / 已停止 / 失败状态词照旧。
- **回归测试**：安装器单元测试（替换全局函数、路由到注入实现）、徽标状态测试（生成中可见、完成后隐藏、状态类正确）。
- **真机复验**：重建安装包 → 重装 → 确认框取消 / 确认路径与徽标检查，继续统一真机测试轮其余场景。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tauri-security-baseline`：对话框实现 SHALL 经官方插件 JS API 并在启动时安装，MUST NOT 把运行期注入的 `window.confirm` / `window.alert` 覆写当作可用通道；ACL 授权 SHALL 以实际调用的插件命令为准（不得依赖已废弃的权限别名）。

## Impact

- 前端：`src/app-dialog.ts`、`src/main.ts`（启动安装）、`src/ai-window.ts`（徽标）。
- 配置：`src-tauri/capabilities/default.json`。
- 测试：`tests/native-dialog.test.ts` 扩充；`ai-window` / `ai-dock` 相关测试补徽标用例；既有确认 / 提示桩测试保持通过。
- 无产品文案与交互变化；不改其它模块与后端。
- 不涉及：统一真机测试轮其余场景（本 change 修复并重建后继续）；上一 change 的归档内容不改写，规格以增量方式修正实现契约。
