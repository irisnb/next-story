# 开发手册

本文档回答「怎么构建、检查、打包、发布」。想了解软件架构与能力边界，见 [ARCHITECTURE.md](ARCHITECTURE.md)；想快速了解这个项目是什么，见 [README](../README.md)。

## Windows 开发准备

本项目使用 Tauri 2。按 2026 年 7 月核对的官方 Windows 前置条件，需要准备：

1. **Microsoft C++ Build Tools**，安装时勾选 **Desktop development with C++** 工作负载。
2. **Microsoft Edge WebView2**。Windows 10 1803 及以后版本通常已经安装，缺失时再从微软安装。
3. **Rust**，通过 rustup 安装，并使用稳定版 `stable-msvc` 工具链。
4. **Node.js 和 npm**：DSH 要求 Node.js **≥ 22.19**；CI 使用 Node.js **22** 系列，开发时也可使用满足下限的 22 系列版本。打包另用脚本准备锁定为 **24.15.0** 的内置 Node，不依赖用户电脑上的 Node。

官方说明见 [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)。Node 须满足上述版本下限，内置 Node 须使用脚本锁定版本；其余开发工具按官方支持的稳定版本准备。

`VBSCRIPT` 不是一般开发的必装项。只有构建 MSI 安装包时报出相关错误时，才按 Tauri 官方故障排查说明启用它。

## 安装依赖

打开 PowerShell 终端，进入仓库根目录。根目录与 `sidecar` 有各自的依赖，需分别安装；请逐条执行，上一条成功后再执行下一条：

```powershell
npm install
npm ci --prefix sidecar
```

第一条安装前端和 Tauri CLI 依赖；第二条按 `sidecar` 的锁定清单安装 DSH 依赖。只做开发时，可以使用系统 PATH 中满足版本要求的 Node，无需准备内置 Node。

**仅在 Windows 打包时**，还需从仓库根目录运行以下脚本，准备锁定为 **24.15.0** 的内置 Node。脚本会下载 Windows 运行时、核验官方 SHA-256 校验和并确认版本，再供安装包使用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\vendor-node.ps1
```

## 检查与测试

### 会执行完并返回的命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 标准总检查，依次执行下文列出的全部检查科目；CI 执行同一套 |
| `npm run typecheck` | 只检查 TypeScript 类型，不生成文件 |
| `npm run test:frontend` | 运行 `tests/*.test.ts` 前端状态测试 |
| `npm run build` | 执行 TypeScript 检查并构建前端产物 |
| `npm run test:rust` | 运行 `src-tauri/Cargo.toml` 对应的 Rust 测试 |
| `npm run tauri:build` | 构建桌面应用安装包，耗时通常比前端构建长 |

### `npm run check` 的执行顺序

按以下顺序执行，某一步失败就停止；修好后重新运行：

1. `typecheck`：TypeScript 类型检查。
2. `lint`：代码规范检查。
3. `test:frontend`：前端测试。
4. `test:reliability`：可靠性测试。
5. `test:driver`：常驻驱动测试。
6. `test:validation`：离线协议验证。
7. `build`：前端构建。
8. `fmt:rust`：Rust 格式检查（`cargo fmt --check`，只检查，不改文件）。
9. `clippy:rust`：Rust 静态检查（clippy，`-D warnings` 表示警告也会让检查失败）。
10. `test:rust`：Rust 测试。

单科还可单独运行：`npm run lint`、`npm run test:reliability`、`npm run test:driver`、`npm run test:validation`、`npm run fmt:rust`、`npm run clippy:rust`。单测单跑：前端 `node --test tests/<文件>.test.ts`；Rust `cargo test --manifest-path src-tauri/Cargo.toml <测试名>`。

顺序依赖：`npm run check` 先构建前端、后编译/测试 Rust（Tauri `generate_context!` 需要前端产物）；单独跑 Rust 科目时先跑过 `npm run build`。

### CI

CI 在 Linux 与 Windows 双平台执行同一条 `npm run check`，与本地同一套清单。CI 双平台检查不代表发行双平台安装包；当前只发行 Windows 版。

## 持续运行的开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 只启动 Vite 前端开发服务器，不启动桌面外壳 |
| `npm run tauri:dev` | 启动完整 Tauri 桌面开发模式，可操作应用窗口 |

持续运行、不自动返回是正常行为。`npm run dev` 需要回到终端按 `Ctrl+C` 停止。`npm run tauri:dev` 可以关闭桌面应用窗口，也可以在终端按 `Ctrl+C` 停止。

第一次运行 `npm run tauri:dev` 时，Rust 需要编译依赖，可能等待几分钟。期间暂时没有新日志不一定表示卡住，只要没有明确报错，可以继续等待。

## 构建 Windows 安装包

先完成上面的开发准备与根目录依赖安装，再在仓库根目录逐条执行；每条成功后再执行下一条：

```powershell
npm ci --prefix sidecar
powershell -ExecutionPolicy Bypass -File scripts\vendor-node.ps1
npm run tauri:build
```

这三步依次准备 sidecar 依赖、准备锁定版本的内置 Node、构建安装包。Tauri 构建前会自动运行资源校验（`package:check`），检查内置 Node、DSH 入口和常驻驱动脚本是否齐备。缺件会以中文报错并中止构建，提示补救步骤，不会继续产出缺少运行资源的安装包；发布产物不依赖用户电脑 PATH 中的 Node。

## 数据保存在哪里

Next Story 把用户文本、项目元数据和 API 配置分开保存，避免系统配置混进作品文本。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 用户文本（每篇文档一个文件） | `<项目文件夹>/作品文本/documents/<稳定文档ID>.json` | 结构化文档正文，由手动保存写入；切换文档前也会先保存当前文档，保存失败则保留当前内容并提示，不切换。这不等于编辑时自动保存 |
| 内容树元数据 | `<项目文件夹>/next-story-system/content-tree.json` | 文件夹 / 文档节点、父子、排序与回收站信息，不含正文 |
| 项目元数据 | `<项目文件夹>/next-story-system/project.json` | 保存项目名、时间和结构版本，不包含任何文档正文 |
| 讨论档案 | `<项目文件夹>/next-story-system/conversations/` | AI 讨论记录，由应用自动保存，保存失败会明确提示；与作品正文分开，可重开查看已保存内容 |
| 唯一 API 配置 | Tauri 应用本地数据目录中的 `llm-config.json` | 位于项目文件夹之外，不写入任何项目文件 |

旧版双本子文件（`作品文本/草稿本.json` 与 `正文本.json`）仅用于旧项目迁移读取，不再是当前存储格式。系统和 Tauri 会决定应用本地数据目录的实际位置，因此这里不虚构一个适用于所有电脑的绝对路径。

**安全提醒：** API Key 保存在操作系统的 **Windows 凭据管理器** 中，不会以明文写进 `llm-config.json`。点击「测试连接」时，API Key 会发送给你配置的 API 服务用于身份验证；HTTPS 可以保护传输过程，但目标服务仍会收到 API Key。只在可信设备上使用，只填写可信的 API 地址，也绝不要把真实 API Key 写进 README、源码或版本记录。

## 简明文件索引

| 责任 | 入口 |
| --- | --- |
| 页面骨架和前端启动 | `index.html`、`src/main.ts` |
| 页面元素和切换 | `src/dom.ts`、`src/views.ts` |
| 新建和打开项目界面逻辑 | `src/new-project-form.ts` |
| 文档编辑、切换与手动保存界面逻辑 | `src/editor.ts` |
| 富文本编辑器内核与坐标适配 | `src/rich-text-editor.ts` |
| API 连接界面与异步状态 | `src/llm-config-form.ts`、`src/llm-config-state.ts` |
| AI 选区快照与及时召唤入口 | `src/selection-adapter.ts`、`src/selection-entry.ts` |
| 常驻会话传输层与面板状态 | `src/ai-session-transport.ts`、`src/ai-request.ts`、`src/ai-request-scheduler.ts`、`src/ai-panel-state.ts`、`src/ai-window.ts`、`src/ai-dock.ts`、`src/ai-feature.ts` |
| 前端与 Rust 的桥接层 | `src/project-api.ts` |
| Tauri 桌面命令注册与应用入口 | `src-tauri/src/lib.rs`、`src-tauri/src/main.rs` |
| 项目校验和文件读写 | `src-tauri/src/project/` |
| API 配置校验、保存和连接测试 | `src-tauri/src/llm_config/` |
| 前端测试 | `tests/` |
| Rust 测试 | `src-tauri/tests/` |
| npm 命令与前端依赖 | `package.json` |
| TypeScript、Vite 与 Tauri 配置 | `tsconfig.json`、`vite.config.ts`、`src-tauri/tauri.conf.json` |
| Rust 包与依赖 | `src-tauri/Cargo.toml` |

## 发布流程（GitHub Release）

**规则一：Release 说明一律走 `--notes-file` 文件。** 把说明写进一个 UTF-8 编码的 `.md` 文件，用文件参数发布：

```powershell
gh release create <tag> --title "<标题>" --notes-file <说明文件路径>
gh release edit <tag> --notes-file <说明文件路径>
```

**禁止在 PowerShell 里内联中文 `--notes` 参数。** 根因：Windows PowerShell 5.1 向外部程序传参数时按系统 ANSI 代码页（中文系统即 GBK）编码，而 GitHub 按 UTF-8 解释——2026-10-24 首个 Release 的说明乱码即此造成。

**规则二：发布后复查。** 用 `gh release view <tag>` 确认中文渲染无误、附件齐全，再对外公布链接。

安装包构建与上传步骤（四附件：NSIS/MSI 原名＋`NextStory-setup.exe`/`NextStory-setup.msi` 稳定名副本）沿用 `site-and-readme-launch`（2026-10-24）的既有流程；`releases/latest/download/NextStory-setup.exe` 固定链接依赖稳定名附件持续存在。

## 发版（两阶段一条命令）

从带自动更新的版本起，日常发版改用脚本 `scripts/release.mjs` 一条命令完成（change `add-auto-updater`），上面「发布流程」一节的两条规则（`--notes-file` 与发布后复查）已内建在脚本里，保留作对照。发版分两个阶段，中间由维护者本人完成 git 提交与打标签——脚本不代替做任何 git 写操作，每一步都看得见。

### 准备阶段（`--prepare`）

```powershell
npm run release -- --prepare
```

脚本依次做七件事，任一步失败即以中文报错中止并打印「失败阶段＋已完成步骤＋安全重试指引」：

1. **前置断言**：git 工作区干净、当前分支是 `main`、gh 已安装且已登录、origin 指向 `irisnb/next-story`、当前账号对该仓库有发布权限。
2. **识别上一正式 Release**：仓库没有任何正式 Release＝**首次发布**，合法分支，跳过版本比对；网络／认证／API 失败与「没有上一版」严格区分，绝不会被误当作首次发布。
3. **总门禁**：运行 `npm run check`（依次 10 个科目，可能 5–15 分钟），任一科目失败即止，不产出 Release。
4. **版本严格递增检查**：读 `src-tauri/tauri.conf.json` 的 `version`（**版本号单一真相源，唯一手改处**），必须严格大于上一正式 Release 的标签版本，否则中止——忘了升版本号用户就收不到更新。
5. **版本号同步**：把 `package.json`、`package-lock.json`（根对象与 `packages[""]` 两处）、`src-tauri/Cargo.toml` 同步到该版本，再运行 `cargo check` 同步 `src-tauri/Cargo.lock`，最后校验六处一致。
6. **打包准备检查**：内置 Node（`sidecar/node-runtime/node.exe`）、DSH 依赖、常驻驱动三项齐备。
7. **打印应提交的文件清单与下一步指引**。

### 中间的维护者步骤（脚本不代做）

准备阶段完成后，按脚本打印的指引**本人执行**：

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "发版 v0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

（版本号以脚本输出为准。）

### 发布阶段（`--publish`）

```powershell
node scripts/release.mjs --publish
```

私钥不在默认位置时用 `--key <路径>` 指定。脚本依次做九件事：

1. 校验工作区干净、`main` 分支、当前 HEAD 上有标签 `v<版本号>` 且与配置版本一致、远端已有该标签（不满足＝准备阶段没做完，中文报错指引回去补）。
2. 检查私钥文件存在（默认 `C:\Users\Administrator\.tauri\next-story-updater.key`）。
3. **交互输入中文更新说明**：每行一条、建议 1–5 条、每条一句话说用户能感知的变化；输入完展示预览，确认后同一份文字既进 `latest.json` 也进 Release 正文。
4. **输入私钥密码**：密码只经环境变量传给打包工具，不写入任何文件、不落盘。
5. 签名打包 `npm run tauri:build`（自动产出 `-setup.exe` 与 `.sig` 签名文件）。
6. 收集产物：版本化 NSIS 安装包、`.sig`、MSI 备选，任一缺失即失败。
7. 生成 `latest.json`（版本、更新说明、RFC 3339 时间、`windows-x86_64` 平台签名与下载直链），并复制稳定名副本 `NextStory-setup.exe` / `NextStory-setup.msi` 到临时目录。
8. 创建 **draft** Release 并上传全部 5 件附件，逐项核验：附件齐备、`latest.json` 可下载可解析、其中版本／签名／直链与产物一致（GitHub 若改写含空格的附件直链，脚本按实际直链重写清单后再核验）。**核验全过才转正式发布**；正式发布前，上一正式 Release 始终是 `latest`，部分上传失败不会污染更新渠道。
9. 转正式后复查 `releases/latest` 已指向新标签。

### 各阶段失败恢复表

| 失败位置 | 脚本行为 | 恢复方式 |
| --- | --- | --- |
| 前置断言（工作区不干净／非 main／gh 不可用） | 立即中止，未做任何改动 | 按报错修复环境后重跑同一阶段 |
| 识别上一版（网络／认证失败） | 中止，不误判为首次发布 | 修网络或 `gh auth login` 后重跑 `--prepare` |
| 总门禁任一科目失败 | 中止，不产出 Release | 把 `npm run check` 跑绿后重跑 `--prepare` |
| 版本未严格大于上一版 | 中止，不写任何文件 | 手改 `tauri.conf.json` 的 `version` 后重跑 `--prepare` |
| 版本同步／一致性校验失败 | 文本补丁是原子操作，失败即一个文件都不写 | 按报错修复后重跑 `--prepare` |
| 签名打包失败 | 中止；工作区与标签未动 | 排查构建报错后直接重跑 `--publish` |
| draft 上传／核验中途失败 | **draft 保留**，上一正式 Release 仍是 `latest`，已装应用不受影响 | 直接重跑 `--publish`：同标签 draft 自动复用并以 `--clobber` 覆盖附件 |
| 标签已存在**正式发布**的 Release | 拒绝替换产物 | 升版本号发新版本；**不要**删除或重传已发布版本的附件与标签 |
| 转正式发布这一步失败 | draft 与附件已就绪且核验通过 | 手动 `gh release edit v<版本> --draft=false`，或重跑 `--publish` |

任何情况下都**不需要**（也不应该）删除已发布的版本或标签来「重来」。

### 私钥保管

更新签名私钥的位置、两处备份、三条铁律与换钥匙规则见 [updater-key-custody.md](updater-key-custody.md)。一句话后果：**私钥或密码丢失＝永远无法再向已装用户推送任何更新**，没有找回渠道。

### 现有用户的最后一次手动升级

自动更新从 0.2.0 起生效，但已装旧版的用户收不到更新提示——**由维护者经现有联系渠道逐个通知，完成最后一次手动升级**（人数 ≤5）。通知消息模板（版本号按实际填写）：

> Next Story 出新版了（v0.2.1）。请手动下载安装一次，以后软件会自动检查更新、不再需要手动装：
>
> 下载地址：https://github.com/irisnb/next-story/releases/latest/download/NextStory-setup.exe
>
> 安装时 Windows 可能弹 SmartScreen 提示，属预期：点「更多信息」→「仍要运行」即可。
>
> 如果 GitHub 打不开或下载不动，跟我说一声，我直接把安装包发给你。

### 安装阶段故障恢复方式

（占位：安装器接管后的故障注入验证与恢复方式，待任务 7.3 真机验收后回填。）
