# root-dev-dependency-hygiene Specification（delta）

## ADDED Requirements

### Requirement: 修复版跨大版本时的显式提升路径
root npm 树开发依赖的在册安全警报，当修复版超出受影响包既有语义范围（跨大版本）且无范围内修复版时，SHALL 显式提升 `package.json` 中该包的版本要求至覆盖修复版的大版本，并全量运行受该包行为影响的测试科目；MUST NOT 为守住旧语义范围而引入 `overrides`、锁定旧版或搁置告警。跨大版本提升后测试夹具对包行为怪癖的依赖若失效，SHALL 逐条甄别修正，不为兼容而保留旧版。

#### Scenario: 跨大版本显式提升
- **WHEN** root npm 树出现在册安全警报，修复版全部落在下一大版本（如 happy-dom 20.x 树的修复需 21.0.4）
- **THEN** `package.json` 该包版本要求提升至覆盖修复版，`package-lock.json` 同步更新，受影响测试科目全量通过

#### Scenario: 行为怪癖失效逐条甄别
- **WHEN** 大版本提升后既有测试因该包行为变化而失败
- **THEN** 逐条归因（包行为变化 vs 真实回归）并修正夹具或代码，不无解释重录、不锁回旧版
