# 任务：GitHub 门面重整

## 1. docs/ 两份新文档（先建新家，再搬内容）

- [x] 1.1 新建 `docs/DEVELOPMENT.md`，按 `repo-dev-docs` 规格承载完整手册：Windows 开发环境准备、依赖安装、`npm run check` 全科目顺序与单科命令、持续运行命令、打包三步、简明文件索引、数据保存明细表与 API Key 安全说明（内容自现行 README「运行、检查与打包」「简明文件索引」「数据保存在哪里」等节外移，信息不丢失）
- [x] 1.2 在 DEVELOPMENT.md 末尾新增「发布流程」一节：Release 说明一律 `--notes-file` 传 UTF-8 文件、禁止 PowerShell 内联中文 `--notes` 参数（含根因一句话）、发布后 `gh release view <tag>` 复查
- [x] 1.3 新建 `docs/ARCHITECTURE.md`，按 `repo-architecture-doc` 规格承载：保管者/使用者分离总述与示意图、六组基础能力清单（内容保管 / 受控只读接口 / 可见性与授权 / 常驻会话可靠性 / 材料可追溯 / 隔离边界），每组标注对应 `openspec/specs/` 规格名；只写已归档能力，无越界宣称；末尾指回 DEVELOPMENT.md

## 2. README 全量改写

- [x] 2.1 按双受众结构改写：居中标志与定位语、徽章排（保留现状）、简介（创作者一段说清＋官网链接）→ 核心特性五分组（写作空间与项目 / AI 陪想 / 讨论管理 / 制作模块 / 导入导出与基础，保留能力具体细节，三条稀有能力前置）→ 如实说明（手动保存、单一 API 配置、仅 Windows 三条，产品语言）→ 下载（含 SmartScreen 提示，保留现状）→ 给开发者（问题引入→解法概览→ASCII 架构示意图→ARCHITECTURE.md 与 DEVELOPMENT.md 链接→速览：两条安装命令＋命令小表）→ 协作与协议（含能力真相源 `openspec/specs/` 与 Releases 单行指引）
- [x] 2.2 删除「当前里程碑」整表与「当前没有的能力（已撤出，非待办）」整节（后者的如实边界并入「如实说明」）
- [x] 2.3 清除全文内部实现细节：后端工具名（`story-list`/`story-read`/`story-search`）、存储路径（`next-story-system/conversations/` 等）、规格/归档计数（76 项、124+ 个）、内部术语（阶段五 A、快车道、已撤出等）

## 3. 验收

- [x] 3.1 口径核对：README 命名口径（项目/讨论/新建讨论，无「新建对话」「作品」容器名）、平台口径（仅 Windows 发行，CI 双平台句含澄清）、界面截图不直出（ASCII 架构示意图不受限）、图片引用均为主仓库 `assets/` 相对路径
- [x] 3.2 事实核对：README 核心特性与 ARCHITECTURE.md 能力清单逐条与 `openspec/specs/` 对照可追溯；ARCHITECTURE.md 无未实现或已撤出方向宣称；如实说明三条与现状一致
- [x] 3.3 `npm run check` 跑绿
- [ ] 3.4 README 全文与两份 docs 交用户过目验收（含观感确认）后归档
