# operations-module-map 增量规格

## ADDED Requirements

### Requirement: 写入核心模块携带可核对的模块地图
`src-tauri/src/project/operations.rs`（作品数据唯一写入通道）SHALL 以模块级文档（`//!`）承载四块内容：模块职责、安全不变式清单、分区地图、保持单文件的结构理由；地图 MUST 与当前实现一致，MUST NOT 承诺实现中不存在的能力。

#### Scenario: 维护者改造前先读地图
- **WHEN** 维护者或自动化代理准备修改 operations 模块
- **THEN** 模块头列出职责、安全不变式清单、分区地图与保持单文件的理由
- **AND** 维护者可据此定位目标分区并核对需要保持的不变式

### Requirement: 安全不变式逐条可核对
模块地图列出的每条安全不变式 SHALL 能对应到模块内实现、测试或既有规格中的锚点；无法核对的条目 MUST NOT 列入地图。

#### Scenario: 抽查一条不变式
- **WHEN** 读者任选地图中的一条不变式
- **THEN** 可按地图指引在实现、测试或既有规格中找到对应锚点
- **AND** 不变式表述与锚点行为一致

### Requirement: 结构决策延续
后续提出拆分或大规模迁移 operations 模块的变更 SHALL 重新评估"恢复与提交共享同一套清单/前滚机制"这一前提是否仍然成立；前提未改变时，拆分 MUST NOT 仅以文件行数或导航性为由进行。

#### Scenario: 未来拆分提案的前提复核
- **WHEN** 出现拆分 operations 模块的变更提案
- **THEN** 提案重新评估共享清单/前滚机制的前提
- **AND** 前提未变的提案不得仅以行数或导航为由拆分
