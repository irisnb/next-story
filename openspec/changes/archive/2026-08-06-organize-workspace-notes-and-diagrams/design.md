## Context

The module decomposition table recommends starting with `D-09 工作区卫生与文档归位` before product-code refactors. The current worktree contains three kinds of non-product artifacts: ignored `.omo/notes` planning material, untracked `docs/diagrams` architecture exports, and `.gitignore` changes for local automation output.

This change defines how those artifacts are classified and then applies the classification. It is repository hygiene only. It must not change runtime behavior, user-facing UI, AI request payloads, notebook persistence, project formats, or Tauri commands.

## Goals / Non-Goals

**Goals:**

- Create a narrow rule for deciding whether planning notes, diagrams, and temporary automation artifacts are tracked, ignored, restored, or left local-only.
- Record the D-09 decision in a dedicated local decomposition note so later changes have a clear starting point.
- Leave `git status --porcelain=v1 -uall` in an intentional state where any remaining changes are either part of this change or explicitly accepted by the user.

**Non-Goals:**

- No application source code changes.
- No product behavior changes.
- No OpenSpec archive changes.
- No deletion of user material unless the user explicitly confirms the material is disposable.
- No expansion into D-01 through D-08 module refactors.

## Decisions

1. Classify by artifact role, not by file extension.

   Architecture diagrams that explain the repository can be tracked under `docs/diagrams/`. Temporary local notes and workbench planning stay under ignored `.omo/notes/`. Generated automation traces stay ignored through `.gitignore`.

   Alternative considered: track all current artifacts to make the worktree clean. That would commit local planning notes that are explicitly treated as workbench material, so it is too broad.

2. Preserve user-controlled local notes unless their fate is explicit.

   The deleted `.omo/notes` file and any new D-09 note must be handled as local notes first because `.omo/` is ignored. If a note should become durable project truth, it needs to move into a tracked documentation location through an explicit task.

   Alternative considered: restore or remove ignored notes automatically. That can erase or resurrect user-local planning state without a product reason, so the implementation must surface the decision instead.

3. Keep the acceptance signal in Git output.

   The implementation should verify the final `git status --porcelain=v1 -uall` and explain any remaining entries. A perfectly empty status is not required if the user wants to keep local-only material outside Git.

   Alternative considered: require an empty worktree. That conflicts with ignored local notes and with intentionally uncommitted user material.

## Risks / Trade-offs

- User-local notes may contain context not meant for Git -> Treat `.omo/notes` as local-only unless the user explicitly asks to promote a note into tracked docs.
- Diagrams can become stale after later refactors -> If diagrams are tracked, include source/export relationship clearly enough that future updates know which file is authoritative.
- `.gitignore` changes can hide useful artifacts too broadly -> Keep ignore rules specific to generated/local tooling outputs.
- A clean-looking status can still omit ignored files -> Use both Git status and explicit note classification when reporting completion.

## Migration Plan

1. Review the current non-product artifacts and classify each as tracked documentation, ignored local note, ignored generated output, restored local material, or user-decision-needed material.
2. Update only documentation, diagram placement, and ignore rules needed for those classifications.
3. Create `.omo/notes/D-09-工作区卫生与文档归位.md` as the local decision record.
4. Verify OpenSpec status and Git status.

Rollback is ordinary Git/file reversal for tracked docs and `.gitignore`; ignored local notes should not be deleted as part of rollback.

## Open Questions

- During implementation, confirm whether the currently deleted `.omo/notes/下一阶段任务-确认弹窗与项目审查-2026-08-05.md` is intentionally obsolete or should be restored as local-only context.
