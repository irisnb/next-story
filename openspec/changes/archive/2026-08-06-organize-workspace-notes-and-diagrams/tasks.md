## 1. Artifact Classification

- [x] 1.1 Run `git status --porcelain=v1 -uall` and list every current non-product workspace artifact.
- [x] 1.2 Classify `.gitignore`, `.omo/notes/*`, and `docs/diagrams/*` entries as tracked documentation, ignored local note, ignored generated output, restored local material, or user-decision-needed material.
- [x] 1.3 Confirm whether `.omo/notes/下一阶段任务-确认弹窗与项目审查-2026-08-05.md` should remain deleted, be restored as local-only context, or be promoted into tracked documentation.

## 2. Documentation And Ignore Placement

- [x] 2.1 Update `.gitignore` only for specific generated or local tooling outputs that should stay out of Git.
- [x] 2.2 Place retained architecture diagram files under `docs/diagrams/` with source and export files kept together.
- [x] 2.3 Create `.omo/notes/D-09-工作区卫生与文档归位.md` documenting the artifact classification decisions and any remaining user-owned local material.

## 3. Verification

- [x] 3.1 Verify no application source code, product UI, AI prompt, AI request payload, notebook persistence, project file format, or Tauri command changed.
- [x] 3.2 Run `git status --porcelain=v1 -uall` and explain every remaining entry as intentional tracked change, intentional local-only material, or unresolved user decision.
- [x] 3.3 Run `openspec status --change "organize-workspace-notes-and-diagrams" --json` and confirm the change is apply-ready.
