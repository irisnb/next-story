# repo-architecture-doc Specification（delta）

## MODIFIED Requirements

### Requirement: 架构文档事实边界
`docs/ARCHITECTURE.md` MUST 只描述已归档规格背书的能力；MUST NOT 宣称未实现的能力，MUST NOT 将已撤出方向（语义/向量检索、完整作品认知、后台预加载、记忆、Agent 循环等）写成已有或将有能力；文档定位 SHALL 为「可读可学的参考实现」，MUST NOT 作出「可复用框架」之类的夸大宣称；许可表述 SHALL 与仓库 MIT 口径一致（见 `repo-license` 规格），MUST NOT 作出 MIT 之外的许可承诺。

#### Scenario: 无越界宣称
- **WHEN** 核对架构文档全部能力表述
- **THEN** 无未实现能力宣称，无已撤出方向的呈现，无「可复用框架」夸大宣称，许可表述与 MIT 口径一致
