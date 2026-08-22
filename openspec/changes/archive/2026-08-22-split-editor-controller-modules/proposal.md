## Why

`src/editor.ts` currently combines the editor facade, lifecycle and document persistence with toolbar/format drawer, find/replace, link popover, context menu, and global keyboard handling. This makes the next editor changes harder to isolate and forces tests to reason about a large shared dependency surface. The second hardening batch has finished, so this is the next bounded step in the roadmap: reorganize the existing frontend responsibilities without changing user-visible behavior.

## What Changes

- Freeze the current editor behavior tests as regression guards before refactoring.
- Extract keyboard handling, toolbar/format drawer, find/replace, link popover, and context-menu responsibilities from `src/editor.ts` into focused modules.
- Connect extracted modules through narrow explicit interfaces rather than importing or receiving the complete editor controller.
- Keep `EditorController` and the existing editor adapter capability boundary compatible for current consumers.
- Keep lifecycle, document switching, saving, AI attachment, document formats, labels, keyboard behavior, and AI zero-write boundaries unchanged.
- Add minimal behavior tests for newly isolated editor interactions where coverage is currently missing.
- Do not modify Rust/Tauri code, AI behavior, or already-independent editor modules.

## Capabilities

### New Capabilities

- `editor-module-boundaries`: Focused frontend editor modules with explicit narrow dependencies and a compatible editor facade.

### Modified Capabilities

- None. This change reorganizes implementation boundaries only; it does not intentionally change a user-facing requirement.

## Impact

- Affected production code: `src/editor.ts` and new focused editor interaction modules.
- Affected tests: `tests/editor.test.ts` plus focused interaction tests as needed.
- Public TypeScript contracts consumed by `src/main.ts`, AI selection entry, and leave protection remain compatible.
- No Rust, Tauri command, storage format, network request, or dependency changes.
