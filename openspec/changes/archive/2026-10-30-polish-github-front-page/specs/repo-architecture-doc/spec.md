# repo-architecture-doc Specification

## ADDED Requirements

### Requirement: 架构文档完整性
主仓库 SHALL 提供 `docs/ARCHITECTURE.md`，向开发者说明框架能做什么、基础功能有哪些，依次包含：保管者/使用者分离总述与示意图、六组基础能力清单——内容保管（内容树、文档保存、格式校验、版本迁移、事务一致性、崩溃恢复）、受控只读接口（目录投影、正文读取、跨文档字面检索及其输出硬上限）、可见性与授权（文档级 AI 可见性、越权拒绝、讨论级授权补读、失控保险丝）、常驻会话可靠性（流式回复、多讨论并发与排队、上下文自动压缩、生成停滞看护、崩溃恢复重放）、材料可追溯（「本次参考了什么」、出处持久化）、隔离边界（AI 无写文件能力、项目服务不注册为 AI 可调用写工具、日常与制作上下文相互隔离）；每组能力 SHALL 标注对应的 `openspec/specs/` 规格名作为依据。

#### Scenario: 章节完整
- **WHEN** 查看 `docs/ARCHITECTURE.md`
- **THEN** 保管者/使用者分离总述与六组能力清单齐备，每组附对应规格名

#### Scenario: 能力可追溯
- **WHEN** 将架构文档任意一条能力与 `openspec/specs/` 对照
- **THEN** 均能找到对应已归档规格依据

### Requirement: 架构文档事实边界
`docs/ARCHITECTURE.md` MUST 只描述已归档规格背书的能力；MUST NOT 宣称未实现的能力，MUST NOT 将已撤出方向（语义/向量检索、完整作品认知、后台预加载、记忆、Agent 循环等）写成已有或将有能力；文档定位 SHALL 为「可读可学的参考实现」，MUST NOT 作出「可复用框架」「开放许可」之类的承诺（许可维持现状）。

#### Scenario: 无越界宣称
- **WHEN** 核对架构文档全部能力表述
- **THEN** 无未实现能力宣称，无已撤出方向的呈现，无复用或许可承诺

### Requirement: README 与架构文档的衔接
README「给开发者」分区 SHALL 链接到 `docs/ARCHITECTURE.md`；架构文档内 SHALL 提供返回 `docs/DEVELOPMENT.md`（怎么跑起来）的指引，两份文档分工明确：ARCHITECTURE.md 回答「是什么、能做什么」，DEVELOPMENT.md 回答「怎么构建、检查、打包、发布」。

#### Scenario: 分工与互链
- **WHEN** 检查 README 给开发者分区与两份文档
- **THEN** README 链至 ARCHITECTURE.md，ARCHITECTURE.md 指回 DEVELOPMENT.md，二者内容不重复展开
