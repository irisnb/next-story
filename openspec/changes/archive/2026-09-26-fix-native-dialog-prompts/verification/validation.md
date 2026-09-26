# 原生确认与提示对话框修复·验证记录

> 2026-09-26。范围如实声明：本记录为离线门禁与回归测试证据；**确认框真机可见性复核并入随后的统一真机测试轮**，不在本记录冒充已验证。

## 一、方法与范围

- **修复对象**：存储验证（2026-09-25）C 项——`tauri-plugin-dialog` 把 `window.confirm`/`window.alert` 覆写为异步实现，但 capabilities 缺 `dialog:allow-confirm`/`dialog:allow-message` 授权、调用方按同步布尔使用，导致确认被静默跳过、提示不显示。
- **证据形态**：统一入口单元测试（`tests/native-dialog.test.ts`）、既有确认与可见性路径的异步语义回归（editor-document-session / editor / file-management）、capabilities 配置断言、全量门禁。

## 二、门禁结果（全部通过）

| 门禁 | 结果 | 说明 |
|---|---|---|
| `npm run check` | 通过（exit 0） | 前端 1134 / 可靠性 120 / 驱动 13 / 离线协议验证 78 / 生产构建 / `fmt:rust` / `clippy:rust` / Rust 302 单元＋80 集成 |
| 直接调用复核 | 通过 | tracked 源文件中 `alert(` / `confirm(` 直接调用为 0；`showMessage` 调用计数与清单一致（8 文件 20 处） |

## 三、回归证据（按不变量）

| 不变量 | 证据（测试） |
|---|---|
| 确认按异步语义等待：等待期间不写入、不提交 | `session awaits asynchronous discard decision`（editor-document-session）；`applyTree awaits asynchronous deletion confirmation`（editor）；`visibility change awaits confirmation and retains ownership`（file-management） |
| 取消真的取消 | editor 版 false → `cancelled` 且未保存内容保留；file-management 版 false → 无 `set:false` 写入 |
| 确认才继续 | true → `committed`；`set:false` 执行 |
| 对话框调用失败按未确认（失败关闭） | editor 版 reject → `cancelled`；file-management 版 reject → 无写入；native-dialog 版 rejection/抛错 → `false` |
| 等待期间 unload 或新操作 → 所有权保持、不写入 | file-management 版 `unload` / `new-operation` 分支 |
| 提示失败不产生未处理拒绝 | `showMessage consumes asynchronous rejection without unhandledRejection`（native-dialog） |
| 无对话框能力环境保持既有放行 | 非函数 → `confirmDialog` 返回 true；`showMessage` 无操作 |
| ACL 两项授权齐备 | capabilities 配置断言（`dialog:allow-confirm`、`dialog:allow-message`） |

## 四、对账修复（主控）

- 失败实现会话遗留的测试夹具问题修复一处：`tests/agent-on-demand-reading.test.ts` 的可见性夹具把 confirm 桩打在独立 `window` 对象上（`window !== globalThis`），统一入口读取 `globalThis.confirm` 导致桩被绕过（2 项断言失败）；改为在 `globalThis.confirm` 上打桩并恢复。修复后前端 1134/1134 与全量门禁通过。

## 五、边界与未验事项

- **未执行真机复核**：确认框/提示框在真实 WebView 中的可见性与取消/确认行为，并入随后统一真机测试轮；存储验证 C 项登记处同步标记「已修复，真机复核待统一轮」。
- ACL 权限标识符已对照 `src-tauri/gen/schemas/desktop-schema.json` 与 `tauri-plugin-dialog-2.7.1` 权限清单核实存在。
- 未改后端 Rust；未改确认/提示文案与用户流程。

> **2026-09-26 真机轮后续**：本修复依赖的插件注入覆写通道在真机被证实不可用（插件 2.7.1 不注册 `plugin:dialog|confirm`；`allow-confirm` 为 `allow-message` 的废弃别名）。本 change 新增的 `dialog:allow-message` 授权保留有效；应用侧实际修复由 `openspec/changes/archive/2026-09-26-fix-dialog-channel-and-window-badge/` 完成并经真机复验通过。
