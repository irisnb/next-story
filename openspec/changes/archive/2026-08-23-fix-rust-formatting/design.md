## Context

Rust formatting checks currently fail because rustfmt would reflow a small set of source and test expressions. The change is limited to repository formatting and must not alter behavior.

## Goals / Non-Goals

**Goals:**

- Apply the repository's installed rustfmt output to the files reported by `cargo fmt --check`.
- Confirm formatting, linting, and Rust tests after the edit.

**Non-Goals:**

- No logic, API, data-format, dependency, or architecture changes.
- No refactoring of `src/editor.ts` or other unrelated files.

## Decisions

- Use `cargo fmt --manifest-path src-tauri/Cargo.toml` as the formatter because it is the same toolchain check used by CI.
- Accept only the formatter's deterministic whitespace and line-wrapping changes; inspect the diff before verification.
- Do not create a capability delta because this change has no product behavior change.

## Risks / Trade-offs

- [Risk] A formatter version difference could produce broader changes than the current check. → Inspect the diff and keep only rustfmt output from the repository toolchain.
- [Risk] Formatting could accidentally include unrelated generated files. → Verify the changed-file list and restrict the change to `src-tauri` Rust files.
