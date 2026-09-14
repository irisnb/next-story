# 设计：诚实告知与文档同步

## Context

- 阶段 5 A（`2026-09-14-add-automatic-story-context`）归档后，常规讨论自动向所选模型发送关注文档现场材料、允许目录投影与跨文档字面检索片段；但 `index.html` 配置页三段告知（`index.html:494-502`）与 `README.md` 仍描述旧链路（审计 P0-5）。
- `llm-configuration` 规格现有要求「LLM 配置页必须告知模型服务会收到哪些数据」的告知范围停留在「问题原文、可选选区原文、当前对话问答上下文」，未覆盖阶段 5 A 材料；`project-readme` 规格的已实现清单、数据位置（仍指向 v2 双本子路径）与 AI 流程说明同样落后。
- 当前真实存储（已在 `src-tauri/src/project/mod.rs:116-157` 核实）：正文每篇文档一个文件 `作品文本/documents/<稳定ID>.json`（Tiptap JSON）；树元数据 `next-story-system/content-tree.json`；作品元信息 `next-story-system/project.json`；讨论档案 `next-story-system/conversations/`。`作品文本/草稿本.json`、`正文本.json` 为 v2 迁移遗留路径。
- 约束：本 change 不改任何行为、协议、存储与 UI 结构；架构图治理须遵守 `workspace-artifact-governance`（源/导出物关系可识别）；命名遵守「作品 / 讨论 / 及时召唤」现行概念，不复活「两个本子」「AI 参考优先级」。

## Goals / Non-Goals

**Goals:**
- 用户在 LLM 配置页看到与真实发送范围一致的告知，按链路（测试连接 / 常规讨论 / 及时召唤）区分。
- README 的状态、能力清单、隐私表述、数据位置、AI 流程与已归档规格一致。
- 方向文档（第一版方向共识、行动计划、阶段 0 整体设计）获得历史标注，不再冒充现行事实。
- 告知文案被测试锁定，防止未来再次漂移。

**Non-Goals:**
- 不重写 `AGENTS.md` 当前实现摘要（已是最新）；只往文档地图加一行。
- 不扩充 `project-mission-governance` 的已实现枚举、不补 39 份规格 Purpose、不做「临时对话→讨论」全局统一（队列第 8 项批量文档维护）。
- 不重绘架构图（只标注历史快照）；不改 UI 布局与交互。

## Decisions

1. **告知保持在配置页三段 `config-warning` 结构内重写**，不新建隐私页。理由：配置页是用户决定使用哪个模型服务前的位置；改结构扩大 UI 范围，违背本 change「只做诚实修复」的边界。备选（独立隐私说明页）被拒绝。
2. **文案按链路分通道组织**，每通道一段：
   - 测试连接：仅固定测试语句与身份凭据，不发剧本文字或讨论内容；
   - 常规讨论：问题原文、可选选区、当前讨论问答上下文（常驻会话维护），加自动附带的关注文档现场材料（已保存正文或经校验的未保存快照）、允许目录投影、跨文档字面检索片段；说明关闭 AI 可见性与回收站内的文档内容不会被读取或发送；
   - 及时召唤：以冻结选区为材料发起，不经过常规自动取材；
   - 共同句：第三方服务如何处理数据取决于用户与服务协议；AI 回复是作品之外的临时材料，不会写入作品。
3. **README 状态段以 `AGENTS.md`「当前实现的诚实边界」为上游摘要源**：README 概括并指向 `openspec/specs/`；每个新增「已实现」声明逐条对照归档规格（`controlled-story-read-visibility`、`automatic-story-context`）。验证缺口（应用级真实材料 E2E、等待基线、并发上限数值）单列为「尚未完成的验证」，不与「未实现能力」混写。
4. **README 数据表采用第 Context 节核实的真实路径**；旧双本子路径标注为「仅旧作品迁移读取」，不再列为当前存储。
5. **方向文档只加带日期的标注横幅，不重写历史正文**：第一版方向共识 §6 顶部加「2026-07 历史基线，现行状态以 openspec/specs 为准」；阶段 0 设计加文档头「截至 2026-09-09 快照」注记；行动计划更新状态注释并把失效的活跃 change 路径改为 archive 路径。
6. **架构图**：`project-structure-v2.html` 顶部加历史快照横幅（含日期与「现行结构见 openspec/specs」指针）；`docs/diagrams/README.md` 加状态注记，说明 v2 无 `.drawio` 源、HTML 为可读权威版本、PNG 为导出快照，满足 `workspace-artifact-governance` 的源/导出物关系要求。不重绘。
7. **测试锁定**：`tests/llm-config-form.test.ts`（已有读取 `index.html` 的模式）新增断言，覆盖稳定子串：测试连接句、常规讨论材料列举（「关注文档」「未保存」「目录」「检索」）、及时召唤与冻结选区、可见性生效、第三方处理句。断言选短语而非整句，降低脆性。

## Risks / Trade-offs

- [未来 change 改变发送范围时告知再次漂移] → 本 change 把告知范围写进 `llm-configuration` 规格要求；后续任何扩大发送面的 change 都必须在 delta 中同步该要求（tasks 中显式提醒）。
- [README 出现无规格依据的声明] → 实现时逐条对照归档规格；评审检查「每条已实现声明有规格出处」。
- [文案改动影响其他读取 `index.html` 文本的测试] → 跑全量前端测试（`npm run test:frontend`），不只跑新增用例。
- [历史标注横幅过多干扰阅读] → 每份文档只加一处横幅，短句、带日期、指向 `openspec/specs/`。

## Migration Plan

纯文案与文档改动，无数据迁移；回滚即 git 还原对应文件。

## Open Questions

无阻塞项。告知与 README 的最终字句在 apply 实现时给出完整文本供用户过目后再定稿。
