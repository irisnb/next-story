## Why

`openspec/specs/project-word-export/spec.md` 完全缺少 `## Purpose` 段，导致 `openspec validate` 报 "Spec must have a Purpose section"，全量规格校验失败（49 通过、1 失败），并会阻塞未来归档任何再次改动该规格的 change。需要补齐规范标题与真实 Purpose，使该规格重新通过校验，同时不触碰任何既有行为。

## What Changes

- **project-word-export**: 在 `openspec/specs/project-word-export/spec.md` 顶部补齐规范标题（`# project-word-export Specification`）与 `## Purpose` 段，写入真实 Purpose；不新增、不修改、不删除任何 Requirement 或 Scenario。
- 不改变任何 Word 导出功能、需求、场景、作品数据或代码。
- 不清理其他规格中已有的 TBD Purpose。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。本 change 不改动任何 Requirement 或 Scenario，因此不列出 capability，也不产生 requirement 级 delta spec；对 `project-word-export` 的修改仅是其规范级标题与 Purpose 元数据，见 What Changes。）

## Impact

仅修改 `openspec/specs/project-word-export/spec.md` 一个文件（新增标题与 Purpose 两处）。不改动代码、API、依赖、作品数据、导出行为或任何其他规格。
