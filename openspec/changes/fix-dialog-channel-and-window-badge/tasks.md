## 1. 对话框管道修复

- [x] 1.1 `src/app-dialog.ts`：新增 `installNativeDialogs(impls?)`——默认以 `@tauri-apps/plugin-dialog` 的 `confirm` / `message` 为实现，安装为 `globalThis.confirm` / `globalThis.alert`（alert 侧吞拒绝）；`confirmDialog` / `showMessage` 的失败语义保持不变
- [x] 1.2 `src/main.ts`：启动装配处调用一次 `installNativeDialogs()`（早于任何用户交互，覆盖插件注入的不可用覆写）
- [x] 1.3 `src-tauri/capabilities/default.json`：移除 `dialog:allow-confirm`（已废弃且仅为 `allow-message` 别名）；保留 `dialog:allow-open` / `dialog:allow-save` / `dialog:allow-message`
- [x] 1.4 `tests/native-dialog.test.ts` 扩充：安装器替换全局函数并路由到注入实现、alert 吞拒绝、capabilities 断言更新；既有全局桩测试全回归

## 2. 徽标残留修复

- [x] 2.1 `src/ai-window.ts`：`applyBadgeClass` 不再以整体赋值重置类名（不得抹掉 `hidden`）；终态（已完成 / 空闲）徽标正确隐藏，生成中 / 排队 / 已停止 / 失败照旧
- [x] 2.2 测试（`tests/ai-panel-dom.test.ts`）：生成中徽标可见且文本「生成中」；完成后徽标带 `hidden`、不显示；已停止状态文本与类正确

## 3. 离线验证

- [x] 3.1 `npm run check` 全绿（前端 1137/1137、可靠性 120、驱动 13、离线验证 78、构建、fmt/clippy、Rust）

## 4. 真机复验（重建安装包并继续统一真机测试轮）

- [x] 4.1 重建安装包并静默安装（内置 Node 已就绪；安装时间 21:05）
- [x] 4.2 确认框取消路径：原生确认框出现；取消后开关状态不变
- [x] 4.3 确认框确认路径：确认后开关翻转、锁存落盘（讨论档案 `restriction` 字段写入）
- [x] 4.4 徽标检查：生成中可见「生成中」；真实生成完成后徽标带 `hidden`、不再残留
- [x] 4.5 继续统一真机测试轮其余场景：受限讨论打开（提示 + 追问禁用）、重启保持、重新开启可见性不解除、停止生成（「已停止」终态）、优雅关闭（2 秒退出）、冒烟——全过；**授权撤销持久仅单元级为据**（未操作应用级授权开关，如实记录于统一真机验收记录）

## 5. 归档与记录

- [x] 5.1 `verification/validation.md`：离线证据 + 真机复验证据 + 上游插件缺陷如实记录
- [ ] 5.2 归档核对：规格 delta 同步；统一真机测试轮总记录产出（`方向/统一真机验收-2026-09-26.md`）
