# update-frontend-ui-v5 打包产物记录（2026-10-09）

来源命令：`npm run tauri:build`（exit 0，日志 `%TEMP%\opencode\package-v5\tauri-build.log`）。目标 x64、bundle targets = all。仅记录产物，未运行安装包。

## 可执行与安装包

| 产物 | 路径 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| 应用主程序 | `src-tauri\target\release\next-story.exe` | 34655232 | `2BFB99802F462F574D9237DCDB94D4091ACA0F306381D6321AD8EC6F8440FB3B` |
| MSI | `src-tauri\target\release\bundle\msi\Next Story_0.1.0_x64_en-US.msi` | 121872480 | `10A840102E4AB2163F3FB91AE76E007C17B137BBF6517A9C8FFD1444B3847626` |
| NSIS 安装器 | `src-tauri\target\release\bundle\nsis\Next Story_0.1.0_x64-setup.exe` | 70799849 | `A2B7EDAD75C02417723DB41F70B76F065F593429A21A93C57E76D3F3ADA23EC6` |

## 包内资源证据

- `target\release\resources\icon.ico`（105873 字节）SHA-256 与 `src-tauri\icons\icon.ico` 一致：`376E98F8A60A79559522BD6484934A609446392F0C7ECF282A25F7B9B0E7DCA4`。
- `target\release\sidecar\` 下已暂存：`node-runtime\node.exe`（91694408 字节）、`node_modules\@deepseek-ai\dsh\lib\bin.js`、`driver\driver.mjs` 等，与 `bundle.resources` 映射一致。
- NSIS 安装器内容清单（`7z l`，共约 32807 个条目，证据 `package-v5\nsis-listing.txt`）确认内嵌：
  - `next-story.exe`（34655232 字节，构建日期 2026-10-09 23:40:04，与上表一致）；
  - `sidecar\node-runtime\node.exe`（91694408 字节）；
  - `sidecar\node_modules\@deepseek-ai\dsh\lib\bin.js`；
  - `sidecar\driver\` 下 `driver.mjs`、`adapter.mjs`、`protocol.json`、`cordis.driver.yaml` 等。
- 前端 `dist/`（含 `vendor/basecoat-css/*`）由 Tauri 内嵌进 `next-story.exe`（Tauri `frontendDist`），不在安装器清单中单列，符合预期。

## 说明（不夸大）

- 数字与哈希为本次本机构建结果，构建可复现但不承诺跨机器字节一致。
- **未**运行 MSI/NSIS，**未**验证安装后的窗口/任务栏/快捷方式图标与壁纸对比；7.6 仍需真人安装验收。
- MSI/NSIS 内嵌 `sidecar\driver\.gen-home`、`.test-home`、`tests`、`test-driver.mjs` 等测试残留（随 `sidecar/driver/` 整目录打包的既有行为）；如实记录，非本 change 引入，未在本次处理。
