## Why

`cargo fmt --check` 当前检测到 Rust 源码和测试文件存在未格式化差异，可能导致 CI 的格式检查失败。需要将这些文件统一到项目当前使用的 rustfmt 输出，恢复工程检查的一致性。

## What Changes

- 使用项目工具链的 `rustfmt` 格式化当前 Rust 源码和测试文件。
- 只接受格式化产生的排版变化，不改变运行逻辑、接口、数据格式或测试行为。
- 用 `cargo fmt --check`、Clippy 和 Rust 测试确认修复结果。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。此 change 只修复代码格式，不改变产品或系统行为。

## Impact

- 受影响范围限于 `src-tauri/src/` 和 `src-tauri/tests/` 中被 rustfmt 报告的文件。
- 不新增依赖，不修改前端、Tauri 命令契约、作品数据格式或 DSH 行为。
