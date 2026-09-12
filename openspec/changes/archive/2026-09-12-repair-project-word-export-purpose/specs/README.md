# specs 目录说明（repair-project-word-export-purpose）

本 change 不产生任何 requirement 级 delta spec。

原因：本 change 只修复 `openspec/specs/project-word-export/spec.md` 缺失的 `## Purpose` 段与规范标题。OpenSpec 的 delta spec 仅支持 Requirement 级操作（`## ADDED/MODIFIED/REMOVED/RENAMED Requirements`），不支持修改规范级 `## Purpose` 元数据；且本 change 明确不新增、不修改、不删除任何 Requirement 或 Scenario。

修复方式：apply 阶段直接编辑 `openspec/specs/project-word-export/spec.md` 补齐标题与 Purpose（见 tasks.md）。归档使用 `openspec archive repair-project-word-export-purpose --skip-specs`，跳过 delta spec 应用（本 change 没有 requirement 级 delta）。
