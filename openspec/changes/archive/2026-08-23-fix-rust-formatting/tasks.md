## 1. Apply Formatting

- [x] 1.1 Run the repository rustfmt command.
- [x] 1.2 Inspect the diff and confirm it contains formatting-only changes in Rust files.

## 2. Verify

- [x] 2.1 Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [x] 2.2 Run `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`.
- [x] 2.3 Run `npm run test:rust`.
- [x] 2.4 Run `openspec validate --all`.
