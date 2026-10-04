## ADDED Requirements

### Requirement: Rust 格式检查全仓通过

仓库中全部 Rust 源码与测试文件 SHALL 保持与项目工具链 rustfmt 输出一致；`cargo fmt --check` MUST 以退出码 0 结束，且不报告任何文件差异。

#### Scenario: 格式检查通过

- **WHEN** 执行 `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- **THEN** 退出码为 0，且不输出任何格式差异

### Requirement: Rust clippy 全目标零告警

仓库 SHALL 在 `cargo clippy --all-targets -- -D warnings` 下全目标（含 examples）编译通过，零 warning、零 error。

#### Scenario: clippy 全目标通过

- **WHEN** 执行 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- **THEN** 退出码为 0，无任何 warning 或 error
