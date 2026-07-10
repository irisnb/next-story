## 1. 建立 README 的事实基线

- [x] 1.1 对照 `desktop-project-lifecycle`、`writing-notebooks` 和 `llm-configuration` 三份正式规格，核对 README 可写为“已实现”的产品能力
- [x] 1.2 对照 `package.json`、`src/project-api.ts`、`src-tauri/src/lib.rs`、两个 Rust domain 和当前项目配置，核对命令、文件位置、数据位置与调用路径

## 2. 按读者路径重写 README

- [x] 2.1 重组 `README.md`，依次写清项目身份、当前里程碑状态卡、已实现能力、未实现项目和永久边界
- [x] 2.2 在 `README.md` 中明确保留硬边界：AI 永远不能直接写入、插入、替换、改写、删除或移动草稿本和正文本，AI 输出只作为临时材料，用户亲手处理并保存后才进入作品事实
- [x] 2.3 在 `README.md` 中说明用户文本、`next-story-system/project.json` 系统元数据和应用本地数据目录内 `llm-config.json` 的位置与分离关系
- [x] 2.4 在 `README.md` 中说明“前端 → bridge → Tauri commands → Rust domain”的单向责任链、结果返回路径、作品生命周期数据流和 LLM 配置与连接测试数据流
- [x] 2.5 在 `README.md` 中补全前置条件和依赖安装方式，并将会执行完返回的检查或构建命令与需要手动停止的开发命令分组说明
- [x] 2.6 将现有大文件树压缩为按职责组织的简明文件索引，并说明 `AGENTS.md`、`openspec/specs/`、`方向/` 和 `openspec/changes/archive/` 各自的文档职责

## 3. 核对范围与验证

- [x] 3.1 逐项交叉核对新版 README 的“已实现”声明，确认未来方向均有明确未实现标签，且没有把 AI 面板、选区召唤、备份、版本快照、多 provider 或多模型支持写成已实现
- [x] 3.2 检查本 change 的实现只修改 `README.md`，没有改动应用代码、依赖、正式产品规格、归档 change、`AGENTS.md` 或 `方向/` 文档
- [x] 3.3 运行 `openspec validate refresh-project-readme --strict`，确认严格校验通过
