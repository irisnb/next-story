# 安装包构建证据：fix-ai-and-making-usability

> 角色：构建/打包 owner。日期：2026-10-10（22:38–22:51）。
> 工作目录已 `Test-Path` 确认为 `D:\Next Story`。
> 目的：为当前已修复工作树构建真实 Windows 正式安装包（用户将重新安装后测试）。
> 未改产品代码/version/identifier/配置；未 commit/归档；未运行安装包；未触碰用户正文/密钥。
> 生成物（`dist/`、`sidecar/node_modules/`、`sidecar/node-runtime/`、`src-tauri/target/`）均被 git 忽略，`git status` 中可见的 tracked 改动与本 change 既有实现一致，未被本次打包改动。

## 0. 隔离与标识核实（构建前）

- `src-tauri/tauri.conf.json`：`identifier = com.nextstory.desktop`、`version = 0.1.0`、`productName = Next Story`、`bundle.targets = all`。
- `npm run tauri:build` 仅执行 `tauri build`，**未传 `--config`**，不会带入验收用 `tauri.override.json`（`com.nextstory.acceptance`）。
- 构建前无 release 版 `next-story.exe` 在运行、无文件占用；未关闭任何用户正式应用。
- 现存旧包（构建前基线，将被本次取代）：
  - MSI：121,905,248 bytes，2026-10-10T14:50:50，sha256 `601DAF574ED02D6A309AD6DB0EDA925580A335A36407781E8078AF01E3AC9DF4`
  - NSIS：70,801,551 bytes，2026-10-10T15:04:00，sha256 `FDE31A684CC266AE849EC4515F5DA790503B7BD531A6DF3F53D7EAC7AA9BACB0`

## 1. 官方顺序执行与退出码

| # | 命令 | 退出码 | 结果摘要 |
|---|------|--------|----------|
| 1 | `npm ci --prefix sidecar` | **0** | added 530 packages, audited 531, 40s（6 条 `npm audit` 漏洞提示为依赖审计信息，非构建失败） |
| 2 | `powershell -ExecutionPolicy Bypass -File scripts\vendor-node.ps1` | **0** | 下载 Node v24.15.0，官方 SHA-256 校验通过，安装至 `sidecar/node-runtime/` |
| 3 | `npm run tauri:build` | **0** | 前端 `vite build` 135 modules / 3.30s → `package:check` 通过 → Rust release 编译 2m22s → 产出 MSI + NSIS |

`npm run tauri:build` 的 `beforeBuildCommand` = `npm run build && npm run package:check`，输出：`打包资源检查通过：内置 Node、DSH 入口、常驻驱动、捆绑字体、分页脚本、Basecoat 组件资源与图标重编登记齐备。`

内置 Node 复核实测：`sidecar/node-runtime/node.exe --version` = **v24.15.0**。

## 2. 构建产物（本次新包，绝对路径）

| 类型 | 绝对路径 | 大小(bytes) | mtime | SHA-256 |
|------|----------|-------------|-------|---------|
| NSIS 安装器 | `D:\Next Story\src-tauri\target\release\bundle\nsis\Next Story_0.1.0_x64-setup.exe` | 70,825,771 | 2026-10-10T22:51:50.1064523+08:00 | `ED9DBE4CF4026BAD94A33CA8A1AC71820041F2ECF6BAEBA6FF097FC0874CEA6E` |
| MSI 安装器 | `D:\Next Story\src-tauri\target\release\bundle\msi\Next Story_0.1.0_x64_en-US.msi` | 121,946,208 | 2026-10-10T22:43:34.3250000+08:00 | `D3427FE8C78A0BF96CE0E0646277933D271EB3889ECB2CC3F04F54E6EAB45D4D` |
| 应用主程序 | `D:\Next Story\src-tauri\target\release\next-story.exe` | 34,963,968 | 2026-10-10T22:51:50.2240978+08:00 | `50112A25ED4AE1FA05991E27593D72AA814E8CA55F8965A3AE5B8534D5F38721` |

- 新旧对比：新 MSI/NSIS 的 SHA-256 与第 0 节旧基线**均不同**，mtime 均为本次（22:43 / 22:51）→ 是本次新包，非旧包。
- 两条 bundle 均由同一次 `tauri build` 连续产出，退出码 0。

## 3. 版本与标识（防串包）

- 文件版本信息：`Next Story_0.1.0_x64-setup.exe` 与 `next-story.exe` 均为 `ProductName=Next Story, ProductVersion=0.1.0, FileVersion=0.1.0`。
- 二进制串核验（`release\next-story.exe`）：
  - `com.nextstory.desktop`（正式 identifier）：**存在**。
  - `com.nextstory.acceptance`（验收 identifier）：**不存在**。
  - `tauri.override`、`acceptance-fix-ai`：**不存在**。
  - 结论：正式 identifier 未被验收 override 污染。

## 4. 重新安装说明（给用户）

1. 先关闭正在运行的 Next Story（含托盘/后台窗口），避免文件占用。
2. 推荐用 NSIS 安装器重新安装：双击 `Next Story_0.1.0_x64-setup.exe`，按向导覆盖安装即可（可覆盖已装的 0.1.0）。
3. 也可使用 MSI（`Next Story_0.1.0_x64_en-US.msi`），适用于批量/企业部署习惯；两者二选一即可，不必都装。
4. 若安装时提示“无法写入/文件被占用”，确认没有旧版进程残留后重试；本次未自动运行安装包（按要求）。
5. 安装后首次启动即为本次修复后的版本。

## 5. 构建耗时与结果

- 整体墙钟：约 **13 分钟**（22:38 起，22:51:56 结束）。
- 其中：前端 `vite build` 3.30s；Rust release 编译 2m22s；MSI 于 22:43:34 产出，NSIS 压缩较久，22:51:50 产出。
- 结果：**三步退出码全 0，成功产出 NSIS + MSI 两个正式 Windows 安装包。**

## 6. 本记录未涉及

- 未运行/未安装产物；未 commit/archive；未改产品逻辑、version、identifier、配置；未读写用户正文或密钥。
- 归档前真机验收（`tasks.md` 8.2/8.3 等）不由本记录代替。
