## Context

`openspec/specs/project-word-export/spec.md` 目前只有 `## Requirements` 段，完全缺少 `## Purpose` 段与 `# project-word-export Specification` 标题。`openspec validate project-word-export` 因此报 "Spec must have a Purpose section"（ERROR），导致全量 `openspec validate --specs` 失败（49 通过、1 失败），并会阻塞未来任何改动该规格的 change 在归档时的 spec 校验。

根因：该规格由旧版 OpenSpec 工具归档（change `2026-08-25-export-project-to-word`），当时归档不会自动生成规范标题与 `## Purpose` 段。新版工具对新建规格会生成 `# <name> Specification` 标题与 `## Purpose`（内容为 `TBD - created by archiving change ...`）。本规格因归档时走的是旧版路径，成为唯一缺少标题与 Purpose 的异常项。

## Goals / Non-Goals

**Goals:**

- 补齐 `project-word-export` 的规范标题与 `## Purpose` 段，写入真实 Purpose。
- 使 `openspec validate project-word-export --strict` 与 `openspec validate --specs` 通过。
- 不改动任何既有 Requirement、Scenario、Word 导出功能或代码。

**Non-Goals:**

- 不新增、修改、删除任何 Requirement 或 Scenario。
- 不清理其他规格中的 TBD Purpose。
- 不改变导出行为、作品数据或任何依赖。

## Decisions

### 1. 直接编辑主规格，而非通过 delta spec

OpenSpec 的 delta spec 仅支持 Requirement 级操作（`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`），无法表达对规范级 `## Purpose` 元数据的修改。若走 delta/archive 路径，`buildUpdatedSpec` 只重建 `## Requirements` 段、无法补上 Purpose，归档校验仍会失败。因此本 change 由 apply 阶段直接编辑 `openspec/specs/project-word-export/spec.md`，归档使用 `--skip-specs` 跳过 delta 应用。

### 2. 同时补齐规范标题（一致性）

校验只强制要求 `## Purpose` 与 `## Requirements` 两段，标题并非校验必需。但仓库内其余 49 个规格均以 `# <name> Specification` 开头，且新版工具的规格骨架也包含该标题。为保持一致性，本 change 一并补齐标题，与仓库惯例对齐。

### 3. Purpose 文案与长度

Purpose 正文定为：`将当前作品内容树中已保存的文档按内容树顺序导出为一个可继续编辑的 DOCX 文件，同时保持只读、不修改任何作品数据。`（约 58 字）。该文案准确表达"导出已保存内容、按内容树顺序、可继续编辑的 DOCX、不修改作品数据"，且长度超过 strict 校验的 50 字阈值，不会触发 "Purpose section is too brief" 警告。

### 4. 不产生 requirement 级 delta spec

本 change 不改动任何 Requirement/Scenario，故 `specs/` 目录内不放置 delta spec（仅 `README.md` 说明原因）。归档用 `--skip-specs`。

## Risks / Trade-offs

- [Purpose 文案被误认为行为变更] → Purpose 只做概括，不改任何 Requirement/Scenario；apply 后用 `git diff` 确认仅新增标题与 Purpose 两处。
- [误改其他规格或 TBD] → 本 change 只允许编辑 `project-word-export` 一个文件，明确不清理其他规格的 TBD。
- [--skip-specs 被遗忘] → 本 change 没有 delta spec，即便不加该标志也不会误应用 delta；但 tasks.md 中明确写出归档命令，防止歧义。

## Migration Plan

1. apply 阶段直接编辑 `openspec/specs/project-word-export/spec.md`，新增标题与 Purpose。
2. 运行 strict 校验与全量 specs 校验确认通过。
3. 用 `git diff` 确认仅新增两处、无 Requirement/Scenario 变化。
4. 归档使用 `openspec archive repair-project-word-export-purpose --skip-specs`。

## Open Questions

- 无。Purpose 文案与标题已在本设计中确定，apply 可据此直接执行。
