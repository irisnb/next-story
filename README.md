<div align="center">

<img src="assets/app-icon.svg" width="96" alt="Next Story 应用图标：黑线稿「开口」" />

# Next Story

**辅助剧本创作的陪想软件。** 你在写作空间里亲手写；常驻 AI 面板像聊天窗口一样随时可问——AI 陪你想，不替你写。

<p>
  <img src="https://img.shields.io/badge/License-%E4%BF%9D%E7%95%99%E6%89%80%E6%9C%89%E6%9D%83%E5%88%A9%20%C2%B7%20%E5%85%81%E8%AE%B8%E4%BD%BF%E7%94%A8-000000" alt="许可：保留所有权利 · 允许使用" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4" alt="平台：Windows" />
  <img src="https://img.shields.io/badge/Version-0.1.0-000000" alt="版本：0.1.0" />
  <img src="https://img.shields.io/badge/Stack-Tauri%20%C2%B7%20React%20%C2%B7%20Rust-FFC131" alt="技术栈：Tauri · React · Rust" />
</p>

</div>

Next Story 是一个 Windows 桌面应用：写作空间里你亲手创作，旁边的常驻 AI 面板随时回应提问——直接问就行，不需要先配置上下文。AI 只提供观察、问题、假设和带依据的可能性；什么进入作品、故事往哪里走，判断权永远在你手里。它不替代创作所需的感受、思考、实践与坚持，也不保证写出优秀作品；工具降低的，是开始创作和获得帮助的门槛。

官网与界面一览：https://irisnb.github.io/next-story-site/

## 已实现能力

下面只列已经进入 `openspec/specs/` 正式规格的能力。

### 写作空间与项目

- 「项目」就是一个文件夹：欢迎页提供「新建项目」「打开项目」入口和**最近项目**列表（至多 8 条，按路径去重，失效条目自动移除，点击即走打开流程）。
- 项目以「内容树」组织：只有文件夹与文档两种节点，可创建、重命名、移动、排序；删除进入回收站，可恢复。
- 富文本编辑器：一至六级标题；粗体、斜体、下划线、删除线；九种字体选项、八档字号；文字颜色与背景高亮；左对齐、居中、右对齐、两端对齐四种对齐；行距与段前、段后间距；首行、左、右三种缩进；无序与有序列表（支持嵌套，有序列表五种编号样式：数字、大写字母、小写字母、大写罗马、小写罗马）；查找替换；链接；撤销重做。粘贴受控清洗，未知格式与脚本不会混进来。
- 写作宽度三档：窄 640 / 标准 720 / 宽 860，稿纸化显示，偏好持久化保存。

### AI 陪想

AI 通过常驻会话陪想，两种首轮入口进入同一个讨论：

- 面板直接提问：在 AI 面板输入问题即可，编辑器选区会作为可选重点提示自动附带，无选区也可直接问。
- 选区「AI 及时召唤」：选中文字后点旁边的「AI」按钮，以冻结选区直接发起首轮，无需先输入问题。
- 回复流式逐字呈现，纯文本可复制；首次回应成功后可线性追问，追问只发送增量问题；可取消生成、可停止生成（停止只结束对应讨论，已完成内容保留）。
- 自动现场材料：常规提问自动附带关注文档现场（已保存正文，或经校验的未保存快照）、允许查看的目录投影与跨文档字面检索片段；「本次参考了什么」轻量可查看，不打断对话。
- 按需补读：材料不足时模型发起授权请求，你允许后它围绕问题经 `story-list` / `story-read` / `story-search` 受控只读工具补读；授权属于当前讨论，可随时关闭，跨重启保留。
- 受控只读与可见性：每篇文档可单独设置是否允许 AI 查看；隐藏、回收站与越权读取被统一边界拒绝。
- 崩溃恢复：驱动进程意外退出后自动重启，重放显示历史恢复所有在途讨论的业务状态。
- 长对话自动压缩承接，超限明确报错提示新建讨论，绝不静默砍历史；同时生成数达到全局上限时按先到先服务排队，排队状态只在对应讨论呈现。
- **AI 输出永远是临时材料：不写你的文档，界面也没有「应用到正文」之类的入口。** 你亲手复制、粘贴、编辑、保存后，文字才算进入作品。
- API 连接在设置页「API 连接」抽屉配置：唯一一份兼容 OpenAI 接口格式的 API 地址、API Key 与模型名；「测试连接」发起真实请求校验；高级参数提供单次生成上限 max-tokens（默认 131072）。

### 制作模块

制作模块是独立的第四页面，定制 AI 的回应方向与说话方式：

- 左侧全局链路库：多链路并存，版本不可变、可回退；显式启用/停用，启用从下一轮生效；链路与卡随应用走，不进项目文件夹。
- 右侧「导图｜制作对话」双标签：导图把「固定底座＋要求/姿态卡＋每轮动态」的组装结构可视化；制作对话起草卡与试问都走真实会话/链路，制作保存须用户确认。
- 零卡链路允许：链路可以不含任何卡；新建链路即含零卡第 1 版，可直接启用。
- 与日常 AI 讨论在会话与上下文上相互隔离：日常聊天不能修改链路配置，制作页也不显示正文保存按钮。

### 讨论管理

- 同一项目下多个讨论并存并发生成，一次只显示一个当前讨论视图；隐藏面板、收起或切换讨论不删除讨论、不停止生成、不取消排队，迟到结果只进入所属讨论。
- 会话列表按最后活动时间分组（置顶 / 今天 / 昨天 / 本周 / 上周 / 本月 / 上月 / 更早），支持重命名、置顶、删除确认与撤销、按标题或文档名过滤。
- 讨论保存到项目文件夹 `next-story-system/conversations/`，与作品正文分开；重启后可重开查看已保存轮次。

### 导入导出

- 导出：Word（.docx）、PDF、Markdown。
- 导入：Word（.docx）、Markdown、Final Draft（.fdx）。
- 导入保真已验收：Markdown 与 FDX 零偏差；DOCX 的导入保真遗留缺陷已全部修复（含字母/罗马编号样式、格式降级如实告知）。

### 其他

- 首启软件引导：首次启动自动弹出四卡引导，可跳过；设置页「帮助」分区可重看，并附常见问题（含「API 是什么？怎么获取？」）。
- 应用单实例：重复启动不会弹出第二个窗口，而是把已有窗口带到前台；主窗口最小尺寸 1024×670 逻辑像素，不能再小。
- 前端 UI v5：整套视觉更新、单 AI 面板、界面统一称「项目」。

## 当前没有的能力（已撤出，非待办）

以下方向曾出现在早期讨论里，2026-10-05 已拍板**撤出当前项目范围**——不是搁置、不排后、不自动恢复，也不再是待办：附近上下文（光标周边取材）、全文摘要、语义 / 向量检索、完整作品认知、后台预加载、记忆、Agent 循环、AI 内容库、用户确认的作品信息、思考收束、安全返回写作。

另外如实说明：作品正文没有自动保存、自动备份或版本快照（讨论档案由应用自动保存，与正文不同）；也没有多服务提供方或多模型选择界面——整个应用只有一份 API 配置。

## 当前里程碑

| 状态 | 内容 |
| --- | --- |
| 已完成 | 写作基础：新建、打开、编辑、手动保存项目，重新打开后读取已保存文本（2026-07 建基） |
| 已完成 | 单一 API 配置基础：本地保存、加载和真实 OpenAI-compatible（兼容 OpenAI 接口格式）连接测试（2026-07-10 归档） |
| 已完成 | AI 思考闭环：常驻 AI 会话（直接提问、选区及时召唤、流式回复、线性追问、取消/停止生成、崩溃恢复、讨论保存与会话列表重开），多讨论并存互不覆盖（2026-08-30 起归档） |
| 已完成 | 单 AI 面板与快车道：一次只显示一个当前讨论、列表切换、多讨论后台并存并发、及时召唤快车道、全局并发上限与先到先服务排队（快车道 2026-09-11、单面板迁移 2026-10-10 归档） |
| 已完成 | 会话列表重做：按最后活动时间分组、重命名、置顶、删除确认与撤销、按标题或文档名过滤、入口常驻（2026-09 归档） |
| 已完成 | 受控只读与可见性：文档级 AI 可见性开关、统一受控只读项目服务、未保存快照与选区授权、讨论材料出处与权限变化隔离（2026-09-13 归档） |
| 已完成 | 常规讨论自动现场材料：关注文档现场、允许目录投影、跨文档字面检索（输出有硬上限）、材料出处轻量可查看、发送回执不伪造（2026-09-14 归档） |
| 已完成 | Agent 按需补读：材料不足时请求用户授权，允许后围绕问题经受控只读工具补读；授权属于讨论、可随时关闭、跨重启保留（2026-09-21 归档） |
| 已完成 | 制作模块：独立第四页面、全局链路库（多链路、版本不可变与回退、启用下一轮生效）、「导图｜制作对话」双标签、提示词装配与注入、制作对话／试问与日常讨论隔离（2026-10-07 归档） |
| 已完成 | 多格式导出：Word（2026-08-25 归档）、PDF 与 Markdown（2026-10-02 归档） |
| 已完成 | 作品导入（Word / Markdown / FDX，2026-10-02 归档）与导入保真验收（2026-10-03 归档，遗留缺陷修复至 2026-10-05） |
| 已完成 | 写作宽度三档：窄 640 / 标准 720 / 宽 860，偏好持久化（2026-10-01 归档） |
| 已完成 | 有序列表五种编号样式：数字、大写/小写字母、大写/小写罗马（2026-10-05 归档） |
| 已完成 | 应用单实例与主窗口最小尺寸 1024×670（2026-09-30 归档） |
| 已完成 | 前端 UI v5 全量更新：单 AI 面板、界面统一称「项目」（2026-10-10 归档） |
| 已完成 | 首启软件引导与帮助分区：四卡引导、设置页三分区抽屉、常见问题（2026-10-22 归档） |
| 已完成 | 零卡链路：链路可不含任何卡、新建即含零卡第 1 版（2026-10-22 归档） |

## 下载

当前状态：**v0.1.0 已发布**，下方链接直达最新版安装包。

| 格式 | 链接 | 说明 |
| --- | --- | --- |
| Windows 安装包（推荐） | [NextStory-setup.exe](https://github.com/irisnb/next-story/releases/latest/download/NextStory-setup.exe) | NSIS 安装向导 |
| Windows 安装包（备选） | [NextStory-setup.msi](https://github.com/irisnb/next-story/releases/latest/download/NextStory-setup.msi) | MSI 格式 |

> 首次运行时 Windows 可能提示「未知发布者」。点「更多信息」→「仍要运行」即可，属预期现象（未购买代码签名证书）。

## 给技术同行

### 规格驱动开发

本项目用 OpenSpec 做规格驱动开发：先提出变更（propose）、用户确认后再实现（apply）、完成后归档进真相源（archive）。目前 `openspec/specs/` 有 **76 项已归档规格**，`openspec/changes/archive/` 有 **124+ 个归档变更**。README 说「已实现」的能力，都能在规格里找到正式依据；行为真相以 `openspec/specs/` 为准。

### 全量门禁 CI

CI 在 Linux 与 Windows 双平台执行同一条 `npm run check`：typecheck → lint → 前端测试 → 可靠性测试 → 常驻驱动测试 → 离线协议验证 → 前端构建 → Rust fmt → clippy（警告即失败）→ Rust 测试。任何一步失败即停止；本地与 CI 跑同一套清单。CI 双平台检查不代表发行双平台安装包；当前只发行 Windows 版。

### 架构责任与数据边界

- **Rust / Tauri 后端是项目数据的可靠保管者**：内容树、文档保存、格式校验、版本迁移、事务一致性和崩溃恢复等确定性工作。
- **DSH 是项目内容的智能使用者**：AI 推理、思考回应和陪想能力。AI 需要参考项目时，只能通过受控只读接口取得被允许提供的内容；AI 运行环境不获得写入用户文档的能力。
- **项目数据与 AI 路径隔离**：项目服务不注册为 AI 可调用的写文件工具。任何 AI 输出都只留在用户文档之外，用户亲手复制、编辑并保存后才成为项目内容——**AI 永远不写用户文档**。

### 数据保存在哪里

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

## 运行、检查与打包

### Windows 开发准备

本项目使用 Tauri 2。按 2026 年 7 月核对的官方 Windows 前置条件，需要准备：

1. **Microsoft C++ Build Tools**，安装时勾选 **Desktop development with C++** 工作负载。
2. **Microsoft Edge WebView2**。Windows 10 1803 及以后版本通常已经安装，缺失时再从微软安装。
3. **Rust**，通过 rustup 安装，并使用稳定版 `stable-msvc` 工具链。
4. **Node.js 和 npm**：DSH 要求 Node.js **≥ 22.19**；CI 使用 Node.js **22** 系列，开发时也可使用满足下限的 22 系列版本。打包另用脚本准备锁定为 **24.15.0** 的内置 Node，不依赖用户电脑上的 Node。

官方说明见 [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)。Node 须满足上述版本下限，内置 Node 须使用脚本锁定版本；其余开发工具按官方支持的稳定版本准备。

`VBSCRIPT` 不是一般开发的必装项。只有构建 MSI 安装包时报出相关错误时，才按 Tauri 官方故障排查说明启用它。

### 首次安装

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

### 会执行完并返回的命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 标准总检查，依次执行下文列出的全部检查科目；CI 执行同一套 |
| `npm run typecheck` | 只检查 TypeScript 类型，不生成文件 |
| `npm run test:frontend` | 运行 `tests/*.test.ts` 前端状态测试 |
| `npm run build` | 执行 TypeScript 检查并构建前端产物 |
| `npm run test:rust` | 运行 `src-tauri/Cargo.toml` 对应的 Rust 测试 |
| `npm run tauri:build` | 构建桌面应用安装包，耗时通常比前端构建长 |

`npm run check` 按以下顺序执行，某一步失败就停止；修好后重新运行：

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

### 构建 Windows 安装包

先完成上面的开发准备与根目录依赖安装，再在仓库根目录逐条执行；每条成功后再执行下一条：

```powershell
npm ci --prefix sidecar
powershell -ExecutionPolicy Bypass -File scripts\vendor-node.ps1
npm run tauri:build
```

这三步依次准备 sidecar 依赖、准备锁定版本的内置 Node、构建安装包。Tauri 构建前会自动运行资源校验（`package:check`），检查内置 Node、DSH 入口和常驻驱动脚本是否齐备。缺件会以中文报错并中止构建，提示补救步骤，不会继续产出缺少运行资源的安装包；发布产物不依赖用户电脑 PATH 中的 Node。

### 会持续运行的开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 只启动 Vite 前端开发服务器，不启动桌面外壳 |
| `npm run tauri:dev` | 启动完整 Tauri 桌面开发模式，可操作应用窗口 |

持续运行、不自动返回是正常行为。`npm run dev` 需要回到终端按 `Ctrl+C` 停止。`npm run tauri:dev` 可以关闭桌面应用窗口，也可以在终端按 `Ctrl+C` 停止。

第一次运行 `npm run tauri:dev` 时，Rust 需要编译依赖，可能等待几分钟。期间暂时没有新日志不一定表示卡住，只要没有明确报错，可以继续等待。

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

## 协作与协议

本项目用 OpenSpec 流程协作：propose（写清要做什么）→ 用户确认 → apply（实现）→ archive（归档进真相源），一次只开一个 change。项目级红线与协作规则见 [`AGENTS.md`](AGENTS.md)，长期使命见 [`方向/核心方向宪章.md`](方向/核心方向宪章.md)。

许可：版权所有 © 2026 irisnb。允许免费下载、安装、使用本软件；未经书面许可，不得复用、修改、再分发本仓库的代码与文档，或用于商业用途（见 [LICENSE](LICENSE)）。

### 文档权威地图

| 位置 | 该信什么 |
| --- | --- |
| [`方向/核心方向宪章.md`](方向/核心方向宪章.md) | 长期使命、永久架构原则和产品立场的完整真相源 |
| `AGENTS.md` | 项目级可执行红线和协作规则 |
| `openspec/specs/` | 当前已经实现的真相源。README 说「已实现」时，应当能在这里找到正式依据 |
| `openspec/changes/` | 正在提议或实现中的 change，内容可能尚未进入当前实现真相 |
| `openspec/changes/archive/` | 已完成 change 的实现历史，记录当时为什么改、怎么改 |

归档 change 负责回答「过去发生了什么」，主规格 `openspec/specs/` 负责回答「现在已经做成什么」。两者冲突或表述不同的时候，以当前主规格描述已实现状态。
