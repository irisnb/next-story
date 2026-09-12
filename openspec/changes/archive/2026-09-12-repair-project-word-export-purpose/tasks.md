## 1. 修复主规格文件

- [x] 1.1 在 `openspec/specs/project-word-export/spec.md` 顶部插入规范标题行 `# project-word-export Specification`，作为第一行。
- [x] 1.2 在标题之后、`## Requirements` 之前插入 `## Purpose` 段，正文为：`将当前作品内容树中已保存的文档按内容树顺序导出为一个可继续编辑的 DOCX 文件，同时保持只读、不修改任何作品数据。`
- [x] 1.3 用 `git diff` 核对 `## Requirements` 段及其全部 5 个 Requirement、所有 Scenario 的文本与顺序逐字未变，改动仅新增标题与 Purpose 两处。

## 2. 校验

- [x] 2.1 运行 `openspec validate project-word-export --strict`，确认 0 error、0 warning。
- [x] 2.2 运行 `openspec validate --specs`，确认所有规格通过、无失败（project-word-export 必须通过）。

## 3. 边界确认与归档说明

- [x] 3.1 确认本 change 未新增/修改/删除任何 Requirement 或 Scenario、未改动代码或作品数据、未清理其他规格的 TBD。
- [x] 3.2 归档时使用 `openspec archive repair-project-word-export-purpose --skip-specs`（本 change 无 requirement 级 delta spec，修复由 apply 直接编辑主规格完成）。
