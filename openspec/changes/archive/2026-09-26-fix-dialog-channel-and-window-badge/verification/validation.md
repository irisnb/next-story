# 对话框管道与窗口徽标修复·验证记录

> 2026-09-26。离线门禁与**安装版真机复验**证据；本轮真机测试的完整场景记录见 `方向/统一真机验收-2026-09-26.md`。
> 构建为工作区未提交状态的修正版（含本 change 全部改动），安装时间 2026-09-26 21:05。

## 一、修复对象

统一真机测试轮在上一 change（`fix-native-dialog-prompts`）的安装构建上发现两处缺陷：

1. **确认框管道不可用**：`tauri-plugin-dialog 2.7.1` 注入的 `window.confirm` 覆写调用 `plugin:dialog|confirm`——该版本命令表只有 `open` / `save` / `message`，`confirm` 命令不存在，`allow-confirm` 权限只是 `allow-message` 的废弃别名；初版修复的 ACL 授权无法使该通道工作。
2. **窗口徽标残留「生成中」**：`applyBadgeClass` 以整体赋值重置类名，抹掉同轮渲染刚加的 `hidden`，终态徽标不消失。

## 二、离线门禁（全绿）

| 项目 | 结果 |
|---|---|
| `npm run check` | 通过（前端 **1137/1137**、可靠性 120、驱动 13、离线验证 78、构建、`fmt:rust`、`clippy:rust`、Rust 302 单元＋80 集成） |
| 新增测试 | 安装器路由（注入 confirm/message、吞拒绝）、徽标状态矩阵（生成中可见、完成后隐藏、已停止文本与类）、capabilities 断言（含 `dialog:allow-message`、不含废弃 `dialog:allow-confirm`） |

## 三、真机复验（修正版安装包）

| 场景 | 结果 | 证据 |
|---|---|---|
| 取消路径 | 原生确认框出现（含受影响讨论标题与后果说明）；点「取消」→ 开关保持「允许 AI 查看」 | `shots/s13-dialog-offscreen.png`、`shots/s14-after-cancel.png` |
| 确认路径 | 对话框出现；点「确定」→ 配角篇转「不允许 AI 查看」 | `shots/s15-dialog-confirm-offscreen.png`、`shots/s16-after-confirm.png` |
| 磁盘锁存 | 讨论档案写入 `restriction`（见下） | 磁盘核对（mubczsrk 档案） |
| 列表脱敏 | 该讨论行显示「（已隐藏的文档）」 | `shots/s17b-list.png` |
| 受限讨论打开 | 橙色提示「曾使用后来已隐藏的文件…」、追问禁用、新建对话入口 | `shots/s18-restricted-open.png` |
| 重启保持 | 重启后仍受限/脱敏 | `shots/s23-restart-list.png` |
| 重新开启不解除 | 三篇文档全部重新开启后仍受限（仅锁存可解释） | `shots/s24-list-after-reenable.png` |
| 徽标生成中 | 徽标可见、`is-generating`、文本「生成中」 | `shots/s21-generating-badge.png` |
| 徽标完成后 | 徽标带 `hidden`（不再残留） | `shots/s22-after-done-badge.png` |
| 停止生成 | 追问后约 0.8 秒点停止 → 「已停止」＋重试入口 | `shots/s26-stop-attempt.png` |

确认路径的磁盘证据（`…/conversations/mubczsrk-….json`）：

```json
"restriction": { "reason": "hidden_material", "at": "2026-09-26T13:15:38.369+00:00" }
```

## 四、上游插件缺陷（如实记录）

`tauri-plugin-dialog 2.7.1` 的注入脚本把 `window.confirm` 覆写为调用 `plugin:dialog|confirm`；该版本不注册 `confirm` 命令（`lib.rs` 命令表：`open` / `save` / `message`），`permissions/confirm.toml` 中 `allow-confirm` 为废弃别名（`commands.allow = ["message"]`）。因此该注入覆写在 2.7.1 中永远不可用。本 change 改为经官方 JS API 在启动时安装应用自己的确认/提示实现，不再依赖注入覆写；未向上游提交改动（应用侧自足）。

## 五、边界与未验事项

- 关闭失败重试、启动窗口毫秒级竞态、生成/保存进行中强制关闭：未执行（见统一真机验收记录第四节）。
- 干净机器安装验收未做；本机安装＋运行验证通过。
- 真机复验采用非打扰方式（CDP 页面事件、离屏窗口截图、定向窗口消息），未干扰机器上正在进行的其它用户操作。
