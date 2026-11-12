# rust-dependency-security-hygiene Specification（delta）

## ADDED Requirements

### Requirement: Rust 依赖安全警报的修复路径
Rust 生产依赖树出现在册安全警报时，SHALL 按以下顺序选择修复路径：官方修复版落在受影响包既有语义范围内时，定向最小更新 `Cargo.lock`；受上游包版本要求锁死而无法统一时，钉上游已包含所需修复的 git 提交，并把自身直接依赖的版本下限提到修复版所在区间，使 `Cargo.lock` 全树对受影响包只解析出**单一版本且不低于官方修复门槛**。MUST NOT 以保留双版本、降级处理或忽视告警的方式绕开统一。

#### Scenario: 范围内定向更新
- **WHEN** Rust 树出现在册安全警报且修复版满足既有语义范围
- **THEN** 仅 `Cargo.lock` 中该包条目被更新到修复版，`Cargo.toml` 保持不变

#### Scenario: 上游锁死时钉 git 并提下限统一全树
- **WHEN** 传递依赖的上游包版本要求锁死受影响包（如 docx-rs 要求 `zip ^8.6.0` 而修复版在 9.x）且上游主线已含修复
- **THEN** 上游包改为钉定 git 提交（记录提交号与理由），自身直接依赖下限提升到覆盖最高修复门槛的版本，`cargo tree` 确认全树仅存在一个满足修复门槛的版本

### Requirement: git 钉版的留痕与切回
对上游包钉定 git 提交时，`Cargo.toml` SHALL 记录钉版提交、钉版理由与切回条件；「官方发布满足修复要求的 crates.io 版本后切回」SHALL 挂入长期账本；钉版提交的后续变更（跟进新提交）MUST 作为显式版本决策处理，MUST NOT 静默漂移。

#### Scenario: 钉版留痕完整
- **WHEN** 检查 Cargo.toml 中钉定 git 提交的依赖条目及其注释
- **THEN** 提交号、理由与切回条件可见，且长期账本有对应挂账条目

### Requirement: 修复验证与远端告警如实报告
Rust 依赖安全修复的完成判据 SHALL 为：`cargo tree` 确认受影响包单一版本且不低于修复门槛、`npm run check` 全链全绿、导入保真相关科目无未甄别的行为变化；GitHub 远端告警状态 MUST 在提交推送并复扫后据实报告，MUST NOT 提前宣称关闭。

#### Scenario: 验证留痕
- **WHEN** 修复完成进入验证
- **THEN** 验证记录含 cargo tree 单一版本证据、全链门禁结果与远端告警复扫实数
