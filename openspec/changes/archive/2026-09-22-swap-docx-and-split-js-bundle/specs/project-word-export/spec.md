# project-word-export Delta

## ADDED Requirements

### Requirement: 导出实现依赖链卫生

Word 导出实现的 Rust 依赖链 SHALL 保持可维护：DOCX 生成库 MUST 为仍在维护（能够接收修复发布）的版本；依赖链 MUST NOT 触发 future-incompat 警告（未来 Rust 版本将拒绝编译的旧写法）；依赖链 MUST NOT 依赖仓库内 vendored 兼容垫片或经 `[patch.crates-io]` 改写来满足编译。依赖链组件出现在册安全警报时，有修复版可用 SHALL 升级至修复版；无修复版可用 MUST 在仓库内记录已接受风险与理由，不得静默搁置。

#### Scenario: 依赖链不含死库与垫片

- **WHEN** 检查 Word 导出实现的 Cargo 依赖链
- **THEN** DOCX 生成库为活跃维护版本（近期能接收修复发布）
- **AND** 链中不存在为满足编译而维护的仓库内 vendored 垫片或 `[patch.crates-io]` 改写

#### Scenario: future-incompat 清零

- **WHEN** 在仓库执行 `cargo report future-incompat`
- **THEN** 导出实现的依赖链不产生任何 future-incompat 警告

#### Scenario: 安全警报有修复版时升级

- **WHEN** 导出依赖链中的组件出现有修复版可用的在册安全警报
- **THEN** 依赖链升级至修复版，警报随升级关闭

#### Scenario: 无修复版时登记已接受风险

- **WHEN** 导出依赖链中的组件出现暂无修复版可用的在册安全警报
- **THEN** 仓库内记录该警报的接受理由与复评条件
