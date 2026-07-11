# Next Story

Next Story 是一个剧本写作桌面编辑器，目标是在后续版本加入 AI 思考辅助。

用户在草稿本和正文本里亲手写作。未来 AI 的位置是陪用户想、提问题和提供临时材料，不是替用户写，也不是自动改稿。当前实现还没有 AI 写作交互，现阶段完成的是写作基础与单一 LLM（大语言模型）配置基础。

## 当前里程碑

| 状态 | 内容 |
| --- | --- |
| 已完成 | 写作基础：新建、打开、编辑、手动保存作品，重新打开后读取已保存文本 |
| 已完成 | 单一 LLM 配置基础：本地保存、加载和真实 OpenAI-compatible（兼容 OpenAI 接口格式）连接测试 |
| 尚未完成 | 完整的第一版 AI 闭环，目前不能在编辑器里召唤 AI 或与 AI 对话 |

## 已实现能力

下面只列已经进入 `openspec/specs/` 正式规格的能力。

### 作品与写作

- 启动后显示欢迎页，提供“新建作品”和“打开作品”入口。
- 可以输入作品名、选择保存位置并创建作品。系统会拒绝空名称、当前操作系统不允许的文件名、不可访问的位置和已有的同名文件夹。
- 可以选择并打开结构有效的 Next Story 作品文件夹。打开前会校验必要文件，成功后进入编辑器并默认显示草稿本。
- 编辑器提供草稿本和正文本两个标签页，可以切换并编辑纯文本。
- 手动保存时，无论当前在哪个标签页，草稿本和正文本都会一起保存。
- 重新打开已保存的作品时，两个本子的内容会从各自文本文件读回编辑器。

### LLM 配置

- 整个应用只有一份 LLM 配置，包括兼容 OpenAI 接口格式的 API 基础地址、API Key 和模型名。当前不展示多个服务提供方（provider）、多个模型槽位或预设模型列表。
- 配置可以保存到本地，关闭并重新打开应用后可以再次加载。
- “测试连接”会向填写的基础地址追加 `/chat/completions`，发起一次真实的兼容 OpenAI 接口格式的模型请求。只有响应是有效 JSON，并且包含合法、非空的 `choices` 模型回复，才算连接成功。仅返回 2xx 状态并不够。
- 远程 API 地址必须使用 HTTPS。本机回环地址 `localhost`、`127.0.0.1` 或 `::1` 可以使用 HTTP。
- 从编辑器进入 LLM 配置页再返回时，当前作品、当前本子和未保存文本会保留。
- 配置加载、保存或测试等异步操作不会并发覆盖输入，过期的加载结果也不会盖掉用户后来填写的内容。

## 当前未实现

以下内容可能属于后续方向，但现在都不能使用：

- AI 面板
- 选区召唤 AI
- AI 对话
- 自动保存
- 自动备份
- 崩溃恢复
- 版本快照
- 内置 AI 内容库
- 多服务提供方或多模型选择界面

这些是“还没做”的功能。下一节是永久规则，不是以后要补上的待办。

## 永久 AI 边界

> **AI 永远不能直接写入、插入、替换、改写、删除或移动草稿本和正文本中的任何字符。**

AI 输出永远只是临时材料，不是作品事实。只有用户亲手复制、粘贴、编辑并保存后，文字才会进入项目，成为作品内容。即使未来加入 AI 面板和选区召唤，这条边界也不会改变。

## 数据保存在哪里

Next Story 把用户文本、项目元数据和 LLM 配置分开保存，避免系统配置混进作品文本。

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 草稿本 | `<作品文件夹>/作品文本/草稿本.txt` | 用户文本，由手动保存写入 |
| 正文本 | `<作品文件夹>/作品文本/正文本.txt` | 用户文本，由手动保存写入 |
| 项目元数据 | `<作品文件夹>/next-story-system/project.json` | 保存作品名、时间和结构版本，不包含草稿本或正文本内容 |
| 唯一 LLM 配置 | Tauri 应用本地数据目录中的 `llm-config.json` | 位于作品文件夹之外，不写入草稿本、正文本或 `project.json` |

系统和 Tauri 会决定应用本地数据目录的实际位置，因此这里不虚构一个适用于所有电脑的绝对路径。

**开发期安全提醒：** `llm-config.json` 会在本地以明文保存 API Key。点击“测试连接”时，API Key 会发送给配置的 API 服务用于身份验证；HTTPS 可以保护传输过程，但目标服务仍会收到 API Key。只在可信设备上使用，只填写可信的 API 地址，不要分享这个配置文件，也绝不要把真实 API Key 写进 README、源码或版本记录。

## 架构与数据流

Next Story 的界面用 HTML、CSS 和 TypeScript 编写，文件位于 `src/`。本地文件读写和模型连接由 Rust 处理，Tauri 把两部分装进同一个桌面应用。

- **桥接层（bridge）：** `src/project-api.ts` 像总机，把前端动作翻译成后端能接收的调用。
- **Tauri 桌面命令（Tauri command）：** `src-tauri/src/lib.rs` 暴露六个窄入口，分别负责作品的新建、打开、保存，以及 LLM 配置的加载、保存、测试。
- **业务领域模块（domain）：** 两个 Rust 目录分别封装作品规则和 LLM 配置规则，真正执行校验、文件读写或网络测试。

一次请求的责任传递链是：

```text
src/ 前端界面与状态
  → src/project-api.ts 桥接层
  → src-tauri/src/lib.rs 中的六个 Tauri 桌面命令
  → src-tauri/src/project/ 或 src-tauri/src/llm_config/ Rust 业务领域模块
```

箭头表示一次请求怎样逐层交给下一层，不代表调用后没有回应。处理结果和错误会沿原路返回前端，再由界面显示给用户。

### 作品新建、打开、保存流程

1. 用户在前端新建、打开或手动保存作品。
2. `src/project-api.ts` 调用对应的 `create_project`、`open_project` 或 `save_project` Tauri 桌面命令。
3. 桌面命令把任务交给 `src-tauri/src/project/`。
4. 作品业务领域模块校验作品名、保存位置或作品结构，并创建、读取或保存作品目录。
5. 路径、作品内容、成功结果或可读错误返回前端。

### LLM 配置加载、保存、测试流程

1. 用户在 LLM 配置页加载、填写、保存配置，或点击测试连接。
2. `src/project-api.ts` 调用对应的 `load_llm_config`、`save_llm_config` 或 `test_llm_connection` Tauri 桌面命令。
3. 桌面命令把任务交给 `src-tauri/src/llm_config/`。
4. LLM 配置业务领域模块校验唯一配置。加载和保存会读写应用本地数据目录中的 `llm-config.json`，测试会使用当前表单配置发起真实的兼容 OpenAI 接口格式请求。
5. 成功状态或可读错误返回配置页。

这层分工保护了两个本子的边界。在应用内部，前端不能绕过限定用途的桌面命令随意碰硬盘，作品文本只能经过作品业务领域模块的明确保存流程，LLM 配置和网络测试则留在独立的 LLM 配置业务领域模块，不会把 API Key 或 AI 输出写进草稿本、正文本或项目元数据。

## Windows 开发准备

本项目使用 Tauri 2。按 2026 年 7 月核对的官方 Windows 前置条件，需要准备：

1. **Microsoft C++ Build Tools**，安装时勾选 **Desktop development with C++** 工作负载。
2. **Microsoft Edge WebView2**。Windows 10 1803 及以后版本通常已经安装，缺失时再从微软安装。
3. **Rust**，通过 rustup 安装，并使用稳定版 `stable-msvc` 工具链。
4. **Node.js LTS 和 npm**。

官方说明见 [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)。不要照 README 硬装固定版本，使用官方当前支持的稳定工具即可。

`VBSCRIPT` 不是一般开发的必装项。只有构建 MSI 安装包时报出相关错误时，才按 Tauri 官方故障排查说明启用它。

### 首次安装

打开终端进入仓库根目录，然后安装前端和 Tauri CLI 依赖：

```bash
npm install
```

## 运行、检查与打包

命令分两类。第一类完成后会自己返回终端，第二类会持续运行，必须由用户停止。

### 会执行完并返回的命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 依次运行类型检查、前端测试、前端构建和 Rust 测试，适合日常总检查 |
| `npm run typecheck` | 只检查 TypeScript 类型，不生成文件 |
| `npm run test:frontend` | 运行 `tests/*.test.ts` 前端状态测试 |
| `npm run build` | 执行 TypeScript 检查并构建前端产物 |
| `npm run test:rust` | 运行 `src-tauri/Cargo.toml` 对应的 Rust 测试 |
| `npm run tauri:build` | 构建桌面应用安装包，耗时通常比前端构建长 |

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
| 新建和打开作品界面逻辑 | `src/new-project-form.ts` |
| 草稿本、正文本与手动保存界面逻辑 | `src/editor.ts` |
| LLM 配置界面与异步状态 | `src/llm-config-form.ts`、`src/llm-config-state.ts` |
| 前端与 Rust 的桥接层 | `src/project-api.ts` |
| Tauri 桌面命令注册与应用入口 | `src-tauri/src/lib.rs`、`src-tauri/src/main.rs` |
| 作品校验和文件读写 | `src-tauri/src/project/` |
| LLM 配置校验、保存和连接测试 | `src-tauri/src/llm_config/` |
| 前端测试 | `tests/` |
| Rust 测试 | `src-tauri/tests/` |
| npm 命令与前端依赖 | `package.json` |
| TypeScript、Vite 与 Tauri 配置 | `tsconfig.json`、`vite.config.ts`、`src-tauri/tauri.conf.json` |
| Rust 包与依赖 | `src-tauri/Cargo.toml` |

## 文档权威地图

| 位置 | 该信什么 |
| --- | --- |
| `AGENTS.md` | 项目宪法，规定产品铁律、协作方式和永久边界 |
| `openspec/specs/` | 当前已经实现的真相源。README 说“已实现”时，应当能在这里找到正式依据 |
| `方向/` | 产品未来方向和版本边界，不代表当前已经实现 |
| `openspec/changes/` | 正在提议或实现中的 change，内容可能尚未进入当前实现真相 |
| `openspec/changes/archive/` | 已完成 change 的实现历史，记录当时为什么改、怎么改 |

归档 change 负责回答“过去发生了什么”，主规格 `openspec/specs/` 负责回答“现在已经做成什么”。两者冲突或表述不同的时候，以当前主规格描述已实现状态。
