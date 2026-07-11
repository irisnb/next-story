# project-readme Specification

## Purpose
TBD - created by archiving change refresh-project-readme. Update Purpose after archive.
## Requirements
### Requirement: README follows the reader's understanding path
项目 README SHALL 面向项目所有者和开发初学者，先说明项目身份与当前里程碑，再说明能力边界、数据位置、技术路径、运行方式和文件入口。

#### Scenario: Reader checks the project before running commands
- **WHEN** 读者从 README 开始了解项目
- **THEN** README 在安装、运行命令和文件索引之前说明项目是什么
- **AND** README 在这些操作信息之前提供当前里程碑或状态卡

#### Scenario: Reader follows the full document
- **WHEN** 读者按 README 顺序继续阅读
- **THEN** README 依次说明已实现能力、未实现项目、永久 AI 边界、数据位置、架构与数据流、准备与命令、简明文件索引和文档地图

### Requirement: README distinguishes implemented truth, future direction, and permanent boundaries
项目 README MUST 只将正式规格确认的产品能力描述为已实现，MUST 将未来方向标记为未实现，并 MUST 将永久 AI 边界与普通未实现项目分开说明。

#### Scenario: README lists implemented capabilities
- **WHEN** README 声明当前已实现的产品能力
- **THEN** 每项声明都有当前正式规格中的要求作为依据
- **AND** 在本 change 归档后，README 可以将“只使用选区原文的 AI 最小实验闭环”写为已实现
- **AND** README 不得把附近文本、整本摘要、AI 内容库、多轮对话、会话历史、持久化、流式输出、停止生成、多 provider 或多模型支持写成已实现
- **AND** README MUST NOT 把该最小实验闭环宣称为已经完成带上下文的完整第一版 AI 闭环

#### Scenario: README refers to future direction
- **WHEN** README 提及尚未归档进正式规格的产品方向
- **THEN** README 将该内容明确标记为未来方向或当前未实现
- **AND** README 不把方向文档当作已实现事实来源

#### Scenario: README states the permanent AI notebook boundary
- **WHEN** README 说明 AI 与草稿本、正文本的关系
- **THEN** README 明确说明 AI 永远不能直接写入、插入、替换、改写、删除或移动草稿本和正文本内容
- **AND** README 说明 AI 输出只属于临时材料
- **AND** README 说明内容只有经过用户亲手复制、粘贴、编辑并保存后才进入作品事实

### Requirement: README explains where each kind of data lives
项目 README SHALL 区分用户文本、项目系统元数据和应用级 LLM 配置，并 SHALL 准确说明三者的位置与分离关系。

#### Scenario: Reader locates user text and project metadata
- **WHEN** 读者查看作品文件的数据说明
- **THEN** README 将用户文本定位到作品文件夹内的 `作品文本/草稿本.txt` 与 `作品文本/正文本.txt`
- **AND** README 将项目系统元数据定位到同一作品文件夹内的 `next-story-system/project.json`
- **AND** README 说明项目元数据不包含两个本子的正文内容

#### Scenario: Reader locates LLM configuration
- **WHEN** 读者查看 LLM 配置的数据说明
- **THEN** README 将唯一应用级 LLM 配置定位到 Tauri 的应用本地数据目录中的 `llm-config.json`
- **AND** README 不虚构跨操作系统通用的绝对路径
- **AND** README 说明 LLM 配置不写入草稿本、正文本或项目元信息正文内容

### Requirement: README explains the one-way architecture and current data flows
项目 README SHALL 用初学者可理解的语言说明“前端 → bridge → Tauri commands → Rust domain”的单向责任传递，并 SHALL 说明作品生命周期与 LLM 配置和测试两条当前数据流。

#### Scenario: Reader follows the architecture chain
- **WHEN** 读者查看架构说明
- **THEN** README 将前端定位到 `src/`
- **AND** README 将 bridge 定位到 `src/project-api.ts`
- **AND** README 将 Tauri commands 定位到 `src-tauri/src/lib.rs`
- **AND** README 将 Rust domain 定位到 `src-tauri/src/project/` 与 `src-tauri/src/llm_config/`
- **AND** README 说明结果和错误会沿调用链返回前端

#### Scenario: Reader follows project lifecycle data
- **WHEN** 读者查看新建、打开或手动保存作品的流程
- **THEN** README 说明前端动作经 bridge 和对应 Tauri command 进入 Rust project domain
- **AND** README 说明 project domain 负责校验并读写作品目录
- **AND** README 说明处理结果返回界面

#### Scenario: Reader follows LLM configuration and test data
- **WHEN** 读者查看 LLM 配置加载、保存或连接测试流程
- **THEN** README 说明配置表单经 bridge 和对应 Tauri command 进入 Rust llm_config domain
- **AND** README 说明该 domain 负责校验和应用本地配置读写，或使用当前唯一配置发出真实 OpenAI-compatible 测试请求
- **AND** README 说明成功状态或可读错误返回界面

### Requirement: README separates setup, terminating checks, and long-running development commands
项目 README SHALL 说明经核对的开发前置条件和依赖安装步骤，并 MUST 区分会执行完并返回的命令与需要用户主动停止的开发命令。

#### Scenario: Reader prepares the development environment
- **WHEN** 读者准备首次运行项目
- **THEN** README 列出与当前 Tauri、前端和 Rust 项目一致的前置条件
- **AND** README 给出当前仓库适用的依赖安装步骤

#### Scenario: Reader runs a terminating command
- **WHEN** 读者查看 `npm run check`、`npm run typecheck`、`npm run test:frontend`、`npm run build`、`npm run test:rust` 或 `npm run tauri:build`
- **THEN** README 说明这些命令执行完成后会返回终端
- **AND** README 简要说明各命令验证或生成什么

#### Scenario: Reader runs a development command
- **WHEN** 读者查看 `npm run dev` 或 `npm run tauri:dev`
- **THEN** README 说明这些开发命令会持续运行且不自动返回
- **AND** README 说明用户需要关闭窗口或按 `Ctrl+C` 停止
- **AND** README 说明首次 Rust 编译可能需要较长时间，持续运行或暂时安静不代表卡死

### Requirement: README provides a concise file index and document authority map
项目 README SHALL 提供按职责组织的简明文件索引，并 MUST 准确说明项目宪法、已实现真相源、未来方向和变更历史各自的位置。

#### Scenario: Reader looks for implementation files
- **WHEN** 读者使用文件索引定位实现
- **THEN** README 简要指向前端、bridge、Rust project domain、Rust llm_config domain、测试和主要配置入口
- **AND** README 不使用遮蔽当前状态说明的完整生成文件树

#### Scenario: Reader checks which document to trust
- **WHEN** 读者查看文档地图
- **THEN** README 说明 `AGENTS.md` 是项目宪法
- **AND** README 说明 `openspec/specs/` 是已经实现的真相源
- **AND** README 说明 `方向/` 记录未来方向而不是当前实现
- **AND** README 说明 `openspec/changes/archive/` 中的归档 change 是变更历史

