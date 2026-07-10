## Why

当前 README 中的大部分事实仍然准确，但阅读顺序从命令和文件树开始，项目所有者和开发初学者难以先看清项目是什么、当前做到哪里，以及哪些边界永远不能跨越。现在需要按读者理解路径重组 README，让当前里程碑、已实现事实、未来方向和技术结构在任何 Git 操作前都能被准确理解。

## What Changes

- 将 README 重组为面向项目所有者和开发初学者的阅读路径，依次说明项目身份、当前里程碑、已实现能力、未实现项目和永久边界。
- 只把正式规格 `desktop-project-lifecycle`、`writing-notebooks` 和 `llm-configuration` 已确认的能力写成已实现，未来方向必须明确标注为未实现。
- 明确 AI 永远不能直接写入、插入、替换、改写、删除或移动草稿本和正文本内容，AI 输出只能作为临时材料供用户自行处理。
- 说明用户文本、项目系统元数据和应用级 LLM 配置各自的保存位置与分离关系。
- 用初学者能跟随的方式说明“前端 → bridge → Tauri commands → Rust domain”单向架构，并分别解释作品生命周期、LLM 配置与连接测试两条数据流。
- 补充前置条件、安装、运行和验证命令，明确区分会执行完并退出的检查命令与需要手动停止的开发命令。
- 将现有大文件树压缩成简明文件索引，并解释 `AGENTS.md` 是项目宪法、`openspec/specs/` 是已实现真相源、`方向/` 是未来方向、归档 change 是历史记录。
- 保留当前 README 中仍然准确且有助于理解的事实，但不改动代码、产品行为、依赖或正式产品能力要求。

## Capabilities

### New Capabilities

- `project-readme`: 规定 README 如何向项目所有者和开发初学者准确说明当前状态、产品边界、数据位置、技术路径、运行方式和文档真相层级。

### Modified Capabilities

无。`desktop-project-lifecycle`、`writing-notebooks` 和 `llm-configuration` 的正式要求均不改变。

## Impact

本 change 只影响根目录 `README.md` 及本 change 的 OpenSpec 提案文件。它不影响应用代码、API、数据格式、依赖、构建配置、现有正式规格、归档 change、`AGENTS.md` 或 `方向/` 文档。
