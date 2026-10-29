# repo-readme Delta

## MODIFIED Requirements

### Requirement: README 顶配结构
README SHALL 采用双受众导向顶配结构，依次包含：居中标志与定位语、徽章排、简介（创作者一段说清，含官网链接）、核心特性、如实说明、下载入口（含 SmartScreen 提示）、给开发者、协作与协议；README MUST NOT 直出堆放界面截图——界面演示收于官网按需画廊，README 仅留官网链接（2026-10-24 用户拍板维持，2026-10-29 复确认；架构示意图非界面截图，不受此限）。

#### Scenario: 结构完整
- **WHEN** 打开仓库首页查看 README
- **THEN** 依次可见居中标志与定位语、徽章排、简介（含官网链接）、核心特性、如实说明、下载入口、给开发者分区与协作与协议，无界面截图直出

## REMOVED Requirements

### Requirement: 里程碑覆盖已归档能力
**Reason**: 2026-10-29 用户拍板「当前里程碑」表（17 行全「已完成」）不该出现在对外首页——它是内部进度账本，对访客无信息量，且与 `openspec/changes/archive/` 和 Releases 页重复。
**Migration**: README 不再承担能力覆盖自证职责；「协作与协议」区 SHALL 保留单行指引——能力真相源为 `openspec/specs/`，版本历史见 Releases 页。已归档能力的覆盖核对以 `openspec/specs/` 本身为准，不再以 README 为核对对象。

## ADDED Requirements

### Requirement: 核心特性分组短句
README 的能力呈现 SHALL 压缩为「核心特性」分节，按四分组组织：写作空间与项目、AI 陪想、制作模块、导入导出与基础；每组为短句列表；能力表述 MUST 以 `openspec/specs/` 已归档规格为准（逐条可追溯）；MUST NOT 出现内部实现细节——包括后端工具名（如 `story-read`）、存储路径、规格/归档计数（如「76 项规格」）、内部阶段或项目术语（如「阶段五 A」「快车道」「已撤出」）。

#### Scenario: 分组完整
- **WHEN** 查看 README 核心特性区
- **THEN** 四个分组齐全，每组为面向用户的短句列表

#### Scenario: 无内部实现细节
- **WHEN** 全文检索 README
- **THEN** 不出现后端工具名、存储路径、规格/归档计数与内部阶段术语

#### Scenario: 表述可追溯
- **WHEN** 将核心特性任意一条与 `openspec/specs/` 对照
- **THEN** 均能找到对应已归档规格依据

### Requirement: 稀有能力前置
README 核心特性 SHALL 前置呈现三条同类产品少见的已实现能力：未保存快照可问（正在写、未保存的内容经校验后 AI 可见）、授权补读（AI 请求多读几篇，用户允许才读、随时可关）、参考出处可查（AI 本次参考了什么，轻量可看不打断对话）。

#### Scenario: 稀有能力可见
- **WHEN** 查看 README 核心特性的 AI 陪相关分组
- **THEN** 上述三条能力以用户语言呈现，未被埋没在长列表末尾

### Requirement: 如实说明用产品语言
README SHALL 设「如实说明」分节，仅以产品语言呈现访客可据以决策的边界：作品正文为手动保存（无自动保存、自动备份或版本快照；讨论档案由应用自动保存，与正文不同）、全应用仅一份 OpenAI 兼容 API 配置（无多服务方/多模型选择界面）、仅发行 Windows 版；MUST NOT 罗列内部治理概念或内部撤出清单（如「附近上下文」「思考收束」「安全返回写作」「已撤出非待办」等表述）。

#### Scenario: 边界如实且可懂
- **WHEN** 查看 README 如实说明区
- **THEN** 上述三条边界齐备且以产品语言表述，无内部治理词汇

### Requirement: 给开发者一等分区
README SHALL 设「给开发者」分区，依次包含：普遍问题一句话（AI＋本地文件应用如何让模型看见内容又不给它写权限）、Next Story 解法概览（保管者/使用者分离、受控只读接口、文档级可见性与授权补读、AI 无写能力）、架构示意图（ASCII 代码块，非界面截图）、深读链接（`docs/ARCHITECTURE.md` 与 `docs/DEVELOPMENT.md`）；分区收尾 SHALL 含开发者速览——依赖安装两条命令（`npm install`、`npm ci --prefix sidecar`）与常用命令速览小表；完整开发手册 MUST NOT 在 README 内联展开。

#### Scenario: 开发者分区完整
- **WHEN** 查看 README 给开发者分区
- **THEN** 可见问题引入、解法概览、架构示意图、两份文档深读链接与开发者速览

#### Scenario: 架构图不违反截图拍板
- **WHEN** 检查给开发者分区的架构示意图
- **THEN** 示意图为文字示意（ASCII/代码块），非应用界面截图
