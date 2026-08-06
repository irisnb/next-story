## Why

The current worktree contains mixed planning notes, ignored local notes, and untracked architecture diagrams. Before starting the module decomposition changes, these artifacts need clear ownership so later changes are easy to review and do not accidentally include or discard planning material.

## What Changes

- Establish a workspace artifact governance rule for local notes, architecture diagrams, and generated automation traces.
- Decide which current artifacts should remain local-only, which should become tracked project documentation, and which should be ignored.
- Document the decision path in a dedicated `D-09` decomposition note so future module-splitting changes start from a clean worktree.
- Keep this change limited to repository hygiene and documentation placement; it does not change application runtime behavior.

## Capabilities

### New Capabilities
- `workspace-artifact-governance`: Defines how planning notes, architecture diagrams, and temporary automation artifacts are classified, retained, ignored, or tracked during development.

### Modified Capabilities
- None.

## Impact

- Affected files are expected to be documentation, ignored local notes, `.gitignore`, and files under `docs/diagrams/` or `.omo/notes/`.
- No application code, product UI, Tauri commands, user data formats, AI prompts, LLM configuration behavior, or notebook behavior should change.
- The change should reduce ambiguity in `git status` before later decomposition work begins.
