# 提案：对外门面——官网、README 顶配与首个发布

## Why

仓库 `irisnb/next-story` 已公开，0.1.0 安装包已打出（2026-10-23，MSI 与 NSIS 双格式），但对外门面停在上个阶段：README 存在多处过时与错误（把已撤出功能写成「已确认的未来方向」、编辑器能力描述严重落后、写了不发行的 macOS/Linux、里程碑表缺八项已归档能力），没有任何下载入口，也没有官网与项目协议文件。需要一个诚实、好看、可下载的对外门面，服务三类受众：未来的用户（写作者）、技术同行、项目自身的档案与仪式感。

## What Changes

- 新增 **GitHub Pages 官网单页**：纯静态、中文；官网所有文件独立成仓——本地专用目录 `Wangye/`（主仓库 `.gitignore` 忽略，永不进入主仓库）＋官网专用仓库 `irisnb/next-story-site`（整仓即站，main 分支根目录发布），免费地址 `https://irisnb.github.io/next-story-site/`；首屏为中文口号＋一句白话定位＋Windows 下载按钮（指向主仓库 Release）＋真机界面截图，往下为特性卡
- **README 全面改版**为顶配结构（居中标志与定位语、徽章、真机截图、能力分区、下载入口、规格驱动开发亮点），并**修正全部事实错误**，口径以 `openspec/specs/` 已归档规格为准
- 建立**首个 GitHub Release v0.1.0**：发布前与 main 重新打包保持一致；上传稳定名安装包（`NextStory-setup.exe` 主推＋MSI 备选），所有下载入口统一用 `releases/latest` 固定链接
- 新增 **LICENSE**：版权所有＋允许免费下载、安装、使用（保留所有权利，不开放代码复用；2026-10-24 用户拍板）
- **品牌视觉（2026-10-24 用户过目后改向）**：鸢尾花重绘方案经用户过目撤出（归档 `Wangye\_archive\`，原手绘件未动）；品牌视觉改用**应用定案图标 04「开口」黑线稿**（2026-10-09 UI v5 拍板，窗口与任务栏在用，SVG 源 `src-tauri/icon-sources/04-aperture.svg`）；配色**黑白为主、点缀色克制**，点缀色设计师出两版、用户过目拍板。另发现 512 `icon.png` 仍为 Tauri 模板残留（当年图标变更明确未覆盖该文件），是否顺手换成定案图标待用户拍板
- 顺带小修：`index.html` 补缺失的 favicon 引用；删除 `src/assets/` 三个脚手架残留无用图标（`vite.svg`、`tauri.svg`、`typescript.svg`，删除前先验证零引用）
- 不改产品行为；不修改任何既有规格

## Capabilities

### New Capabilities

- `public-site`：官网单页的构成（首屏四要素、特性卡、视觉主元素为应用几何图标双色/黑白两用、真机截图）、部署方式（官网专用仓库 `next-story-site` main 分支根目录经 GitHub Pages 发布；本地 `Wangye/` 目录被主仓库忽略）、地址与语言、配色口径（黑白为主、点缀色克制，经用户过目拍板）、文案口径（守项目宪法：降低门槛不承诺能力/结果）、下载入口规则（指向主仓库 Release）
- `repo-readme`：README 的顶配结构、事实口径（以已归档规格为准；已撤出功能不得列为未来方向；平台口径只写 Windows；命名口径「新建讨论」「项目」）、图片资产自包含于主仓库 `assets/`
- `release-download`：GitHub Release 发布物要求（NSIS setup.exe 主推＋MSI 备选＋稳定名副本，版本更名不破坏直链）、下载链接规则（`releases/latest/download/<稳定名>` 固定链接；无可用 Release 时指向 `/releases` 并注明即将发布，不得放会 404 的直链）、未签名安装包 SmartScreen 提示的说明义务

### Modified Capabilities

（无——本变更不修改任何既有规格的需求）

## Impact

- 主仓库文件：`README.md`（重写）、`assets/`（新增，README 用图副本）、`LICENSE`（新增）、`index.html`（补 favicon link）、`.gitignore`（加一行忽略 `Wangye/`）、`src/assets/{vite,tauri,typescript}.svg`（验证零引用后删除）
- 官网体系（不入主仓库）：本地 `Wangye/`（页面＋官网图片，独立 git 仓库）→ 远程新公开仓库 `irisnb/next-story-site`
- 仓库设置与外发动作：新建官网仓库并推送；在官网仓库开启 GitHub Pages（main 分支根目录）；在主仓库创建 Release `v0.1.0` 并上传安装包；发布后官网地址对外可见
- 产品代码：无行为变更；CI（`npm run check`）科目不受影响
- 素材工作：应用图标 SVG 两版（原色＋黑白，设计师完成）；真机运行截图若干
- 用户验收：官网真机预览、README 逐节核对、下载链接可用性
