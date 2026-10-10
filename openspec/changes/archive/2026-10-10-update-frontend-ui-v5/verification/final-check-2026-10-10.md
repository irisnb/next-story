# update-frontend-ui-v5 最终工程门禁与 Windows 打包验证（2026-10-10）

执行：validation/package lane（本 lane）。范围：最终源工程门禁（`npm run check`）、离线资源检查（`npm run package:check`）、Tauri 打包（`npm run tauri:build`）、新 PE 图标逐字节核验、Basecoat 离线/CSP、真实任务栏壳层只读检查。未改源码/配置/任务 checkbox，未 Git/archive，未运行安装包、未改系统或 shell 缓存、未读取用户正文/secret。

## 0. 源指纹（构建输入）

- `git rev-parse HEAD` = `791d07cc9334da6cbf8e762258f404c1764e8874`
- 工作树 `git status --porcelain` 文本 SHA-256 = `3b97bb5e8e94c2525886472d22ba559783b92182313fd456ff88d7d9f243f5ea`
- 关键文件 SHA-256 前缀：`package.json` 2D203F530F8626DE、`package-lock.json` A30C338D017C54FF、`sidecar/package-lock.json` EC24ABDCDE5A416E、`index.html` 3D5E8404DD704163、`scripts/generate-icons.mjs` F5BEC4DECC2DB9A5、`src-tauri/tauri.conf.json` B9C46A4E26EBF6AA、`src-tauri/icons/icon.ico` 5C53E2D430E70B55、`src-tauri/Cargo.lock` 221863780C2F6EC7。
- tracked files = 1780。

## 1. 进程与所有权（构建前）

- 构建前存在 owned 验收 debug 实例：PID 32224，exe `D:\Next Story\src-tauri\target\debug\next-story.exe`，父进程 33240（已退出），本地创建时间 2026-10-10 02:14:23，真实 Tauri 顶层窗口 hwnd 3348336、class `Tauri Window`、标题 `Next Story`；WebView2 子进程（PID 21008）持有调试口 9223。与 `verification/v5-launch-owner.json`、`v5-bounded-observer-fix-2026-10-10.md`、`v5-bounded-final-2026-10-10.md` 一致。`Get-Process -Name next-story` 当时仅此一个。
- 处理：确认 owned 后优雅 `CloseMainWindow` 成功关闭；debug 二进制随即解锁，无残留 next-story 进程。未 kill 其他应用或 cargo。
- 说明：owner 记录本身为交接追记（非原始 spawn 日志），本 lane 已按调度要求当场重新核对 PID/路径/创建时间/真实窗口。

## 2. 命令与退出码（依序，前成功才后）

| # | 命令 | 退出码 | 日志 |
| --- | --- | --- | --- |
| 1 | `npm run check` | 0 | `%TEMP%\opencode\final-check-2026-10-10\npm-run-check.log` |
| 2 | `npm run package:check` | 0 | `...\package-check.log` |
| 3 | `npm run tauri:build` | 0 | `...\tauri-build.log`（此轮图标陈旧，见 §4） |
| 4 | `cargo clean --manifest-path src-tauri\Cargo.toml -p next-story` | 0（移除 32672 文件 / 45.5 GiB 可再生构建产物） | `...\cargo-clean.log` |
| 5 | 删除旧 build-script 输出与 fingerprint（见 §4） | 0（人工） | — |
| 6 | `npm run tauri:build`（重跑，图标已生效） | 0 | `...\tauri-build-rerun.log`（仍 7 帧，见 §4） |
| 7 | 再删 build/fingerprint 后 `npm run tauri:build` | 0 | `...\tauri-build-rerun2.log`（8 帧） |
| 8 | `npm run tauri:build`（最终一致包） | 0 | `...\tauri-build-final.log` |
| 9 | `openspec validate update-frontend-ui-v5 --strict` | 0 | `...\openspec-validate.log`（"Change 'update-frontend-ui-v5' is valid"，仅验证文档） |

### 2.1 `npm run check` 结果（exit 0）

- 步骤全过：`typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust`。
- 前端：`tests 1362 / pass 1362 / fail 0`（此前失败的编辑器宽度断言已由 designer 修复，本次新证据坐实）。
- 可靠性 121/121；驱动 33/33；离线协议验证 78/78。
- Rust 单元：`510 passed; 0 failed; 1 ignored`；集成套件 0/21/10/4/33/18/6/2/33/5/0 全过；真实链路 3 例按预期 `ignored`（需 `ZHIPU_API_KEY`＋网络，手动 `--ignored`）；doc-tests 0。
- `fmt:rust`、`clippy:rust`（`-D warnings`）无告警。

### 2.2 `npm run package:check`（exit 0）

通过：内置 Node、DSH 入口、常驻驱动、捆绑字体、分页脚本与 Basecoat 组件资源齐备（含 Basecoat 1.0.2/MIT 元数据核对）。

## 3. 打包产物（最终一致包，exit 0）

| 产物 | 路径 | 字节 | mtime | SHA-256 |
| --- | --- | --- | --- | --- |
| 应用主程序 | `src-tauri\target\release\next-story.exe` | 34760192 | 2026-10-10 03:58:20 | `8542C5459547665D698354D94EC2E7CCD7FE0CF630BB5B87820B8AE03E86D526` |
| MSI | `src-tauri\target\release\bundle\msi\Next Story_0.1.0_x64_en-US.msi` | 121933920 | 2026-10-10 03:51:59 | `4C7969AD3C886E88F329A339203ED8483D4ABEA0B79300C00C85E52891D421BA` |
| NSIS 安装器 | `src-tauri\target\release\bundle\nsis\Next Story_0.1.0_x64-setup.exe` | 70807027 | 2026-10-10 03:58:19 | `3DD5FA5E0FA0C06D45855B2DF61742FC3F37954DBDE61F3A80990FFACF9CA031` |

> MSI mtime 早于 exe 约 6 分钟属正常：bundler 先打 MSI，再 patch exe（bundle type=nsis）并打 NSIS。

## 4. 关键发现与有界修复：图标变更未被正常嵌入

**现象**：首次 `npm run tauri:build`（exit 0）后，debug/release exe 与 MSI/NSIS 仍内嵌**旧的 7 帧**图标（无 20px，16/24/32 与新版不符）。

**根因**：`src-tauri/build.rs`（`tauri_build::build()`）只在 `tauri.conf.json`/capabilities/sidecar 等被登记为 `cargo:rerun-if-changed` 的输入变化时重跑；**`icons/icon.ico` 未被登记**（核对了 `target\release\build\next-story-*\output` 的 32806 条 rerun 记录，无 icons 项）。因此仅更新图标文件（本次光学 r2：新增 20px、改 16/24/32 且未动 `tauri.conf.json`）不会让 `resource.rc`/`resource.lib` 重新生成，cargo 复用旧的资源库，导致 exe/安装包图标陈旧。

**有界修复（不改源码/配置）**：删除该 build-script 的陈旧输出与 fingerprint，强制 build.rs 重跑：

- 删除 `src-tauri\target\release\build\next-story-5864cd9f762d7341\`
- 删除 `src-tauri\target\release\.fingerprint\next-story-5864cd9f762d7341\`
- 重新 `npm run tauri:build`（exit 0）→ exe 变为 8 帧。

**给父的持久修复建议（未实施）**：让构建跟踪 `icons/*.ico`（或把图标嵌入移到一个总是重跑/被跟踪的步骤），否则今后任何仅改图标的提交都需要手工失效缓存才会进入安装包。这是流程缺陷，不是本次图标本身的问题。

### 4.1 新 PE 图标逐字节核验（复用 `verification/icon-diagnosis.mjs`）

- `src-tauri/icons/icon.ico`：8 帧 `16/20/24/32/48/64/128/256`，字节 1128/1720/2440/4264/9640/16936/67624/3723。
- release `next-story.exe`：`RT_GROUP_ICON` 声明 8 帧，逐帧 `matchesIcoFrame=true`（与 `icon.ico` 完全一致）。
- NSIS 内嵌 `next-story.exe`（7z 提取）：34760192 字节，声明 8 帧。
- MSI 内嵌应用 exe（7z 解包 `app.cab` 的 `Path`）：34760192 字节，声明 8 帧。
- bundle 复制件 `target\release\resources\icon.ico` 与 `src-tauri\icons\icon.ico` SHA-256 一致（`5C53E2D430E70B5575651E04C2AE4850FC613C33AE86DB01D611DB3FC325570D`）。

## 5. Basecoat 离线与 CSP

- `dist/vendor/basecoat-css/` 含 5 文件（`basecoat.cdn.min.css` 218225、`js/all.min.js` 43909、`LICENSE.md` 1068、`package.json` 5471、`README.md` 3939）。
- `dist/index.html` 引用 `/vendor/basecoat-css/basecoat.cdn.min.css` 与 `/vendor/basecoat-css/js/all.min.js`。
- CSS 内 `https?://` 仅 1 处 `https://tailwindcss.com`（`/*! tailwindcss v4.3.1 | MIT License */` 注释）与 6 处 SVG `xmlns`；无运行时外链。
- CSP：`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self' data:; connect-src ipc: http://ipc.localhost blob:; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`。Basecoat 走 `'self'`，满足离线打包。

## 6. 真实任务栏壳层只读检查（release exe）

脚本 `verification/final-check-taskbar.ps1`（只读；启动 release exe→查询→截图→停止自身启动的实例）：

- 启动最终 release exe（PID 32420）；真实 Tauri 顶层窗口 class `Tauri Window`、标题 `Next Story`。
- `WM_GETICON ICON_SMALL = 16×16`、`ICON_SMALL2 = 16×16`（该 16×16 位图与 `icon.ico` 的 16 帧 **meanAbsDiff=0.0，逐像素一致**，即新版光学稿）；`ICON_BIG = 0`、`GCLP_HICON = 0`、`GCLP_HICONSM = 0`。
- 结论（技术）：窗口未设大图标；小图标为**新版** 16 帧。任务栏/标题栏对“大图标”会回退到 exe 内嵌图标（现为 8 帧新版）。
- 截图（交父/observer 视觉判定，本 lane 不声称目测结论）：
  - `openspec\changes\update-frontend-ui-v5\verification\icon-final-taskbar-2026-10-10\taskbar-strip.png`（2560×64 任务栏条）
  - `...\taskbar-fullscreen.png`（2560×1440 全屏）
  - `...\WM-GETICON-ICON-SMALL.png`、`...\WM-GETICON-ICON-SMALL2.png`（窗口 16×16 图标）
- 检查后立即停止该 `owned` 实例（`stopped=True`）。未安装安装包、未改 shell 图标缓存、未请求用户授权。

## 7. 未完成/限制（不虚称）

- 真实用户点击、用户视觉验收未做；任务栏/开始菜单/快捷方式/浅深壁纸/小尺寸光学的**实际安装后**验证（tasks 7.6）仍未完成。
- DPI：本机 96 dpi（100%）单档；125%/150%/200% 未实测。
- 未跑真实模型链路、未启用/改动 global chain、未读取用户正文或 secret（本 lane 全程未触发）。
- 未运行 MSI/NSIS 安装包；未提交、未归档；未改动 `tasks.md` 任何 checkbox。
- 本次有界修复删除了 45.5 GiB 可再生构建产物（`cargo clean -p`），不影响源码/存储。

## 8. 日志路径（approved temp，无密钥）

`C:\Users\Administrator\AppData\Local\Temp\opencode\final-check-2026-10-10\`：`npm-run-check.log`、`package-check.log`、`tauri-build.log`、`cargo-clean.log`、`tauri-build-rerun.log`、`tauri-build-rerun2.log`、`tauri-build-final.log`、`openspec-validate.log`、`msi-listing.txt`、`pe-frames.mjs`、`compare-window-icon.py`，及解包目录 `v-msi\`、`v-nsis\`。
