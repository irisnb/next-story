## Context

The project lifecycle backend currently validates a project folder by checking that the expected directories and files exist, then reads metadata and notebook text with `read_to_string`. These checks follow filesystem indirections, so a structurally valid-looking project can point required project files outside the selected project root. Project creation also performs broad cleanup after a failure, even though the target directory may have been created by another process between the pre-check and the cleanup path.

This change is limited to the Rust project-domain boundary. It does not change the frontend workflow, the project file layout, or the rule that user text is only written by explicit project save operations.

## Goals / Non-Goals

**Goals:**

- Treat the selected project root as a hard local filesystem boundary for required project directories and files.
- Reject required project directories or files that are symlinks, Windows reparse points, or canonicalize outside the selected project root.
- Prevent failed project creation from deleting a directory that the current create operation did not create.
- Reject oversized metadata, draft notebook, and main notebook files before reading them into memory.
- Cover the new behavior with Rust tests.

**Non-Goals:**

- Do not redesign the project folder layout.
- Do not add autosave, backups, crash recovery, version snapshots, or multi-file save transactions.
- Do not change frontend UI copy unless an existing backend error must be surfaced more clearly.
- Do not change AI generation, AI panel, LLM configuration, or notebook editing behavior.

## Decisions

### Use metadata-aware path validation for required project paths

Required project directories and files will be validated with filesystem metadata APIs that do not follow the final path component when checking for symlinks or reparse points. After that, canonical paths will be compared against the canonical selected project root so every accepted required path remains under the project root.

Alternative considered: rely only on canonical path prefix checks. This is not enough because callers also need to reject symlink/reparse-point project components explicitly, not just accept whichever target they resolve to.

### Keep cleanup ownership explicit during create

Project creation will track which directories and files the current operation created. Cleanup after failure will remove only those tracked paths, in reverse creation order, and will not call broad `remove_dir_all` on a target directory that may no longer be owned by this operation.

Alternative considered: create the full project in a temporary directory and rename it into place. That can be a good future hardening step, but it is larger than needed for this change and has cross-filesystem rename edge cases on user-selected save locations.

### Add bounded reads before parsing or loading text

Before reading `project.json`, `草稿本.txt`, or `正文本.txt`, the backend will inspect file size and reject files above explicit limits. The limits should be constants in the project domain so tests can exercise them and future changes can adjust them deliberately.

Alternative considered: stream-read the notebooks. The editor still needs full text in memory today, so a bounded whole-file read is the smaller correct boundary for this version.

## Risks / Trade-offs

- Symlink/reparse-point detection differs by platform -> Keep platform-specific checks inside small helper functions and test the behavior where the platform supports creating such paths.
- Existing manually altered projects that use symlinks will stop opening -> This is intentional because project text and metadata must stay inside the selected project folder boundary.
- Size limits may reject unusually large real drafts -> Use limits high enough for plain-text screenplay work and return a clear project-structure/read error rather than hanging or exhausting memory.
- Cleanup tracking can leave partial empty parent directories if an unexpected cleanup operation fails -> Prefer leaving a partial failed create over deleting paths the operation did not own.
