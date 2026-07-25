## 1. Project Path Boundary Validation

- [x] 1.1 Add project-domain helpers that reject required project directories or files when they are symlinks, Windows reparse points, or canonicalize outside the selected project root.
- [x] 1.2 Update project structure validation to use the new helpers for the project root, `作品文本`, `next-story-system`, `草稿本.txt`, `正文本.txt`, and `project.json`.
- [x] 1.3 Add Rust tests proving projects with required symlink/reparse-point paths or paths resolving outside the selected root are rejected before opening.

## 2. Bounded Project Reads

- [x] 2.1 Add explicit project-domain size limits for `project.json`, `草稿本.txt`, and `正文本.txt` before reading file contents into memory.
- [x] 2.2 Replace unbounded project metadata and notebook reads with bounded read helpers that return existing project error types with clear messages.
- [x] 2.3 Add Rust tests proving oversized metadata, draft notebook, and main notebook files are rejected before full file reads.

## 3. Create Cleanup Ownership

- [x] 3.1 Refactor project creation to track only filesystem entries created by the current create attempt.
- [x] 3.2 Replace broad failed-create cleanup with reverse-order removal of tracked entries only.
- [x] 3.3 Add Rust tests proving failed creation cleanup does not delete a pre-existing same-name folder or untracked content.

## 4. Regression Verification

- [x] 4.1 Run the existing Rust project lifecycle tests and update only expectations affected by the new boundary requirements.
- [x] 4.2 Run the repository check command for TypeScript, frontend tests, frontend build, and Rust tests.
- [x] 4.3 Manually verify a normal create-open-save-reopen workflow still preserves both notebooks and project metadata.
