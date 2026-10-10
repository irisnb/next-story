# 最终门禁与打包 + designer 终态整合（2026-10-10）

执行：validation/package lane。范围：owned 验收进程清场 → 依序 `npm run check` → `npm run package:check` → `npm run tauri:build` → 产物/图标/离线资源核验。未改 source/UI/spec/方向/icons，未 Git/archive，未安装器，未发模型，未写全局链路，未读正文/secret。`build.rs` 图标跟踪为永久修复，本轮**未**再 `cargo clean`。

## 0. designer 终态（已 terminal，final 源码）

- 定向 9 文件 **169 项**通过、typecheck/lint 各 exit 0（`verification/ui-cleanup-final-2026-10-10.md`）。
- 状态/窗口清理：`windows` 存储字段移除，`ai-panel-state.ts` 派生 getter 改名 `openDiscussionIds`（L229）；`WindowPlacement`/`set_window_placement`/`reset_layout`/`focus_window`/`close_window` 在 `src/` 零命中；`index.html` 已删 `i-float/i-grip/i-dock/i-sbs` sprite（精确 id 0 命中）；`ai-window-docked`→`ai-discussion-projection`。
- 发送彩蛋 6.1：`src/assets/user-mark.png` 原字节（SHA256 `b8296fa14dc2f9c3e889e9dcd9d8677be1fc9ada57b1f46edfea2ed7dd8a9d96`，988×789，32bppArgb，alpha 0–255）；真实 1024/1440：按钮 72×32、图案 28×22.3594、aspect-ratio 988/789、功能名（follow-up 按钮 `发送`、direct-question 按钮 `提问`）、禁用灰度/启用深色、focus-visible 2px；`tests/ui-send-mark.test.ts` 断言 hash/比例/禁用/focus。
- 说明：上述为 designer 记录与源码核对；最终同尺寸图像视觉仍交 observer。

## 1. owned 进程清场（stop-owned-only）

- 依据 `verification/v5-launch-owner.json`、temp `ui-v5-app-owned.json`（pid 25588，`D:/Next Story/src-tauri/target/debug/next-story.exe`，started 2026-10-09T20:46:27.572Z）与 `ui-cleanup-final-2026-10-10.md`。
- 当场核验：CIM `PID=25588`，`ExecutablePath=D:\Next Story\src-tauri\target\debug\next-story.exe`，`ParentProcessId=34616`，`CreationDate=2026/10/10 04:46:27`；顶层窗口 class 含 `Tauri Window`。与记录一致。
- 处理：`CloseMainWindow` 优雅关闭（owned）；随后无 `next-story` 进程，debug/release exe 均**未锁定**。
- 另停 owned vite dev server（temp `ui-v5-vite-owned.json` pid 31884，命令与记录一致）。未触碰其它 node/cargo/用户进程。

## 2. 命令与退出码（依序，前成功才后）

| 命令 | 退出码 | 日志 |
| --- | --- | --- |
| `npm run check` | 0 | `%TEMP%\opencode\final-cleanup-2026-10-10\npm-run-check.log` |
| `npm run package:check` | 0 | `...\package-check.log` |
| `npm run tauri:build` | 0 | `...\tauri-build.log` |
| `openspec validate update-frontend-ui-v5 --strict` | 0（"valid"） | `...\openspec-validate.log` |

### 2.1 `npm run check` 计数（exit 0）

- 前端 `tests 1358 / pass 1358 / fail 0`（**非旧 1362**：旧多窗口几何用例已删、新增 `ui-send-mark` 等，净数按实际）。
- 可靠性 `121/121`；驱动 `33/33`；离线协议 `78/78`。
- Rust 单元 `510 passed / 0 failed / 1 ignored`；集成套件全过；真实链路 3 例按预期 `ignored`；`fmt:rust`/`clippy:rust`（`-D warnings`）无告警。

### 2.2 `npm run package:check`（exit 0）

通过：内置 Node、DSH 入口、常驻驱动、捆绑字体、分页脚本、Basecoat 组件资源与**图标重编登记**（`build.rs` 跟踪 `bundle.icon`）齐备。

## 3. 最终产物（本轮唯一有效哈希）

| 产物 | 路径 | 字节 | mtime | SHA-256 |
| --- | --- | --- | --- | --- |
| 应用主程序 | `src-tauri\target\release\next-story.exe` | 34759680 | 2026-10-10 08:47:07 | `595AF632C81805E91575EB3D65E156EB51A8E0703600D42F1B44C1AEE785E699` |
| MSI | `src-tauri\target\release\bundle\msi\Next Story_0.1.0_x64_en-US.msi` | 121884768 | 2026-10-10 08:40:47 | `C4A9515F96A84709229CD73F4F94F3D48AAF1224A83DC682DF757284ECABED26` |
| NSIS 安装器 | `src-tauri\target\release\bundle\nsis\Next Story_0.1.0_x64-setup.exe` | 70808552 | 2026-10-10 08:47:07 | `661C2619216FF4FDD9A923B7C75725973EF6C0DB97F1DFCAA8EF1B79BB56553E` |

## 4. 图标与离线资源核验

- `icon.ico` 8 帧 `16/20/24/32/48/64/128/256`；`target\release\resources\icon.ico` 与 `src-tauri\icons\icon.ico` 同 SHA-256（`5C53E2D430E70B5575651E04C2AE4850FC613C33AE86DB01D611DB3FC325570D`，107609 字节）。
- release（与 debug）exe：`RT_GROUP_ICON` 声明 8 帧，逐帧 `matchesIcoFrame=true`（`verification/icon-diagnosis.mjs`）。
- NSIS 内嵌 `next-story.exe`（7z 提取）：34759680 字节 → 8 帧；MSI 内嵌 `app.cab\Path`：34759680 字节 → 8 帧。
- Basecoat：`dist/vendor/basecoat-css/` 5 文件齐全；`dist/index.html` 引用 CSS+JS；CSS 内 `https?://` 仅 tailwind 许可注释与 SVG `xmlns`，无运行时外链。
- CSP：`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self' data:; connect-src ipc: http://ipc.localhost blob:; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`（离线自持）。

## 5. 限制/未完成（不虚称）

- 未运行 MSI/NSIS 安装包；未改 shell 缓存。
- 真实用户点击/视觉、安装后壳层（7.6）、其它 DPI（7.2）、真实模型（7.4）、真实保存/中文输入/导入导出（7.5）未做。
- 未归档；未提交。

## 6. 日志（approved temp，无密钥）

`C:\Users\Administrator\AppData\Local\Temp\opencode\final-cleanup-2026-10-10\`：`npm-run-check.log`、`package-check.log`、`tauri-build.log`、`openspec-validate.log`、`e-nsis\next-story.exe`、`e-msi\Path`。
