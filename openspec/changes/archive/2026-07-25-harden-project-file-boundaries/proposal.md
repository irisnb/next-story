## Why

Current project open/create flows trust filesystem paths after shallow structure checks. A crafted or racing project folder can redirect required project files outside the selected project, trigger unbounded reads, or cause failed creation cleanup to delete a directory that this create operation did not own.

This change protects the user's project boundary before adding broader save-recovery work, because these issues can affect existing local files or make the app unresponsive before the editor opens.

## What Changes

- Reject project folders whose required directories or files are symlinks, reparse points, or otherwise resolve outside the selected project root.
- Ensure project creation cleanup only removes directories and files created by the current create attempt.
- Add read-size limits for project metadata, draft text, and main text before reading them into memory.
- Preserve the existing visible workflows for creating valid projects, opening valid projects, and manually saving user text.
- Defer multi-file save transaction/recovery semantics to a separate change.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `desktop-project-lifecycle`: tighten project folder creation/opening requirements so accepted project paths cannot escape the selected root, failed creation cleanup is ownership-scoped, and oversized project files are rejected before unbounded reads.

## Impact

- Affected Rust project-domain code: `src-tauri/src/project/mod.rs`, `src-tauri/src/project/operations.rs`, and likely `src-tauri/src/project/validation.rs`.
- Affected tests: `src-tauri/tests/project_test.rs` and any new Rust tests needed for path-boundary, cleanup, and file-size rejection cases.
- No new frontend surface, no AI behavior change, and no change to the permanent boundary that AI never writes into the draft notebook or main notebook.
