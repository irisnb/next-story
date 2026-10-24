# repo-readme Specification

## Purpose

主仓库 README 的顶配结构、事实与命名口径、里程碑覆盖与图片资产规则。

## Requirements

### Requirement: README 顶配结构
README SHALL 采用顶配结构，依次包含：居中标志与定位语、徽章排、能力分区、下载入口、面向技术同行的开发亮点（规格驱动开发与全量门禁）；README MUST NOT 直出堆放界面截图——界面演示收于官网按需画廊，README 仅留官网链接（2026-10-24 用户拍板：截图直出「太丑，去掉」）。

#### Scenario: 结构完整
- **WHEN** 打开仓库首页查看 README
- **THEN** 依次可见居中标志与定位语、徽章排、能力分区、下载入口与开发亮点，无界面截图直出，简介区含官网链接

### Requirement: 事实口径
README 的能力与状态描述 MUST 以 `openspec/specs/` 已归档规格为准；已撤出当前项目范围的功能（思考收束、安全返回写作、AI 内容库、用户确认的作品信息、附近上下文、全文摘要、语义/向量检索、后台预加载、记忆、Agent 循环等）MUST NOT 列为「未来方向」或待办，如需提及 MUST 标注「已撤出、非待办」；平台口径 MUST 只写 Windows 发行，MUST NOT 出现 macOS/Linux 支持表述。

#### Scenario: 撤出功能不列为未来方向
- **WHEN** 核对 README 全部方向性表述
- **THEN** 已撤出功能不出现在「未来方向」「待办」「即将」等语境

#### Scenario: 平台口径
- **WHEN** 核对 README 平台相关表述
- **THEN** 仅表述 Windows 发行（CI 双平台检查事实句须附「只发行 Windows」澄清）

### Requirement: 命名口径
README MUST 使用统一命名：承载文件夹与文档的容器叫「项目」；会话记录叫「讨论」；新建入口叫「新建讨论」；MUST NOT 出现「新建对话」或以「作品」作容器名。

#### Scenario: 命名统一
- **WHEN** 全文检索 README
- **THEN** 无「新建对话」字样，容器统称「项目」

### Requirement: 里程碑覆盖已归档能力
README 的里程碑/能力清单 MUST 覆盖全部已归档规格能力，至少包含：多格式导出（Word/PDF/Markdown）、作品导入（Word/Markdown/FDX）与导入保真、写作宽度三档、有序列表编号样式、单实例与窗口最小尺寸、前端 UI v5、首启软件引导与帮助分区、零卡链路。

#### Scenario: 里程碑完整性
- **WHEN** 将 README 里程碑表与 `openspec/specs/` 能力清单对照
- **THEN** 上述已归档能力均无缺失

### Requirement: 图片资产自包含
README 引用的图片 MUST 放置于主仓库 `assets/` 目录并使用相对路径（主仓库自包含，克隆可见）；与官网仓库的图片为两份副本，图片更新时 MUST 两处同步。

#### Scenario: 资产自包含核对
- **WHEN** 检查 README 图片引用路径
- **THEN** 均指向主仓库 `assets/` 相对路径

#### Scenario: 双仓副本同步
- **WHEN** 官网图片更新
- **THEN** 主仓库 `assets/` 内对应副本同步更新
