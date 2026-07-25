## Why

Manual save currently replaces `草稿本.txt`, `正文本.txt`, and `project.json` as three independent file writes. If a write fails or the process stops between steps, the project can be left with notebooks and metadata from different save attempts, while the UI reports a single save result.

This matters now because the first project lifecycle hardening pass fixed unsafe open/create boundaries, leaving save consistency as the next highest-risk data integrity issue in the reviewed list.

## What Changes

- Treat a manual save as one generation of project data rather than three unrelated writes.
- Add a project-domain commit marker or manifest so the backend can distinguish the last complete save from an interrupted save.
- Recover from an interrupted save before opening a project, so the editor never loads a mixed-generation draft/main/metadata set as if it were complete.
- Preserve the existing user-facing rule: AI still cannot write into the two notebooks, and user text changes still happen only through explicit manual save.
- Add Rust tests for failures after draft staging, after main staging, before metadata commit, and recovery on reopen.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `desktop-project-lifecycle`: Manual save consistency and interrupted-save recovery requirements for the existing project lifecycle.

## Impact

- Affected Rust project-domain code: `src-tauri/src/project/operations.rs` and nearby project module helpers if extraction is needed.
- Affected Rust tests: `src-tauri/tests/project_test.rs` and/or project-domain unit tests in `src-tauri/src/project/operations.rs`.
- Affected project files on disk: `草稿本.txt`, `正文本.txt`, `next-story-system/project.json`, plus a small system-owned save transaction file or directory under `next-story-system`.
- No frontend UI redesign, no autosave, no version history, no AI behavior changes, and no change to the notebook file names.
