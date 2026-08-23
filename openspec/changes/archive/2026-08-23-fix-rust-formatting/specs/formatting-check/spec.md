## ADDED Requirements

### Requirement: Rust formatting check passes

The repository SHALL keep all Rust source and test files formatted according to the project's configured rustfmt output.

#### Scenario: CI formatting check

- **WHEN** `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` runs
- **THEN** it exits successfully without reporting formatting differences
