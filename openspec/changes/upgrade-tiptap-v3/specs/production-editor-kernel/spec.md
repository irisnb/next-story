# production-editor-kernel 增量

## ADDED Requirements

### Requirement: 编辑器内核依赖单一入口且安全锁版

生产编辑内核的 `@tiptap/*` 依赖 MUST 全部精确锁版（不得使用范围版本），`@tiptap/pm` MUST 作为直接依赖显式声明，并 MUST 作为 ProseMirror 系列包（prosemirror-model/state/view/transform 等）的唯一引入入口；前端源码 MUST NOT 直接依赖裸 `prosemirror-*` 包名。完成本 change 后，编辑内核版本 MUST 不低于 3.31.2（该版起 `@tiptap/pm` 依赖锁含修复 GHSA-c8x8-7fp4-3x9w 的 prosemirror-view ≥ 1.42.3），依赖树中的 prosemirror-view MUST 不低于 1.42.3。

#### Scenario: 依赖清单全部精确锁版且声明唯一入口

- **WHEN** 检查 package.json 的 `@tiptap/*` 区块与前端源码 import
- **THEN** 所有 `@tiptap/*` 为精确版本号，`@tiptap/pm` 在直接依赖中
- **AND** 源码中 ProseMirror 系列 API 只从 `@tiptap/pm/*` 子路径引入，无裸 `prosemirror-*` 依赖声明

#### Scenario: 依赖树不含带洞 prosemirror-view

- **WHEN** 安装依赖后检查 `@tiptap/pm` 解析到的 prosemirror-view 版本
- **THEN** prosemirror-view 不低于 1.42.3
- **AND** 整个前端依赖树中 prosemirror-view 只存在一个版本

### Requirement: 内核升级以金样本锁定存量文档与粘贴行为

系统 SHALL 维护冻结的金样本语料作为编辑器内核升级的前置回归门禁：任何更换编辑器内核依赖版本的改动 MUST 在合入前通过两层金样本回归。金样本语料 MUST 全部为合成文档，MUST NOT 包含用户真实作品内容。

A 层（序列化兼容）：覆盖格式版本 2 grammar 全部结构与边界情形的合成文档，经内核装载、读出并规范化序列化后，MUST 与冻结预期逐字节相等，且 MUST 通过格式版本 2 grammar 校验。

B 层（粘贴行为）：代表性粘贴样本经自研白名单归一化并注入编辑器的代表性位置后，规范化文档 MUST 与冻结预期相等。冻结预期 MUST 在升级前的现行内核上生成，生成后不得随升级修改；若升级后确需更新冻结预期，MUST 记录差异原因且规范形态差异构成阻塞。

#### Scenario: 存量结构文档升级后逐字节不变

- **WHEN** 用覆盖全部格式版本 2 结构（全部块类型、全部标记、段落属性、嵌套列表、空文档与空段落边界）的合成文档在新内核中装载、读出并规范化序列化
- **THEN** 结果与冻结预期逐字节相等
- **AND** 通过格式版本 2 grammar 校验

#### Scenario: 粘贴管线升级后输出不变

- **WHEN** 代表性粘贴样本（格式映射、嵌套列表、表格降级、换行拆分）经白名单归一化并注入代表性位置（空文档、同格式中部、异格式边界、列表项内）
- **THEN** 规范化文档与冻结预期相等

#### Scenario: 金样本不含用户内容

- **WHEN** 建立或扩充金样本语料
- **THEN** 全部样本为合成内容，不引用任何用户真实作品
