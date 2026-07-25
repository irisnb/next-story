## Context

The project backend currently saves a project by replacing `草稿本.txt`, then `正文本.txt`, then `project.json`. Each individual file write is atomic at the file level, but the three-file save has no shared commit boundary. A write error or process stop between steps can leave a visible project state where one notebook is from the new save and another file is from the old save.

The project constitution treats saved notebook text as the user's content fact source. A manual save can fail, but after a failure or restart the app must not silently present a mixed-generation project as if it were a complete save.

This design stays inside the Rust project lifecycle domain. It does not add autosave, history, snapshots, AI write-back, or a new project format visible to users.

## Goals / Non-Goals

**Goals:**

- Give manual save one explicit consistency boundary across draft, main, and metadata.
- Ensure interrupted saves are recovered before a project is opened or loaded into the editor.
- Keep the existing notebook file names and project folder layout recognizable.
- Cover failure points with Rust tests that can force save interruption at specific steps.

**Non-Goals:**

- Do not add user-facing version history, backups, autosave, or crash recovery UI.
- Do not redesign the frontend save flow or leave guard.
- Do not allow AI or AI panel code to write into notebooks.
- Do not attempt full database-style durability guarantees across every filesystem and power-loss mode in this change.

## Decisions

### Use a system-owned save transaction directory

Manual save will stage the next generation under `next-story-system/save-transaction/` before replacing visible project files. The transaction directory will contain staged copies of the draft, main, and metadata plus a small manifest that records the intended generation.

Rationale: staging in the existing system directory keeps temporary implementation details outside the user notebooks while preserving the current project file names. It also gives recovery code a single place to inspect when open/save starts.

Alternative considered: rename the entire project folder. That is too broad for a user-selected folder and has more cross-filesystem and permission edge cases.

### Treat metadata commit as the visible completion marker

The backend will replace draft and main from staged files, then replace metadata last. If a save is interrupted before metadata is committed, recovery will restore or finish to a coherent state based on the manifest and staged files rather than loading the mixed visible files directly.

Rationale: `project.json` already carries `updated_at`, so making metadata the final marker matches current semantics: a save is complete only when both notebooks and metadata belong to the same generation.

Alternative considered: add a separate committed marker file. That creates another file whose relationship to `project.json` can drift. For this scope, a manifest plus metadata-last commit is simpler.

### Recover before validating loaded project contents

Opening a project will first validate the required fixed paths enough to safely access `next-story-system`, then run transaction recovery before reading notebook text and metadata for the editor. Saving will also recover any previous transaction before starting a new transaction.

Rationale: users should not need to understand transaction files. If a previous save was interrupted, the next open/save should converge the on-disk project to one coherent generation or return a clear project error.

Alternative considered: fail open whenever a transaction directory exists. That avoids guessing but leaves users stuck with manual filesystem repair for recoverable interrupted saves.

### Add injectable save failure points only for tests

The implementation can use a small internal save plan or test-only hook to force errors after specific transaction steps. Public Tauri commands and frontend APIs will not expose fault injection.

Rationale: issue 3 specifically requires tests for failures after different write stages. Precise tests are more reliable than trying to simulate crashes with timing.

Alternative considered: integration tests that kill a child process mid-save. Those are slower, more fragile on Windows, and not necessary to prove the project-domain recovery logic.

## Risks / Trade-offs

- Recovery policy could overwrite a partially visible file in a way that surprises someone inspecting files manually -> Keep transaction files system-owned, deterministic, and covered by tests for each staged point.
- Metadata-last commit does not guarantee power-loss durability without directory sync on every platform -> Add file sync where practical, but limit this change to logical consistency and recovery rather than promising universal hardware durability.
- A broken transaction manifest may make recovery impossible -> Return a clear project read/write error rather than loading mixed notebook generations.
- Existing projects may contain stale `save-transaction` folders from manual experiments -> Recovery should only act on valid manifests and otherwise fail safely.

## Migration Plan

Existing valid projects require no user action. The first save after this change may create and then remove `next-story-system/save-transaction/` as an internal implementation detail.

Rollback is the existing application behavior: visible `草稿本.txt`, `正文本.txt`, and `project.json` remain the canonical files. Transaction directories are ignored by older versions unless a save was interrupted during the new flow, in which case older versions do not know how to recover them.

## Open Questions

- None for proposal scope. Exact manifest field names can be decided during implementation as long as tests prove recovery behavior and no user text is stored in `project.json`.
