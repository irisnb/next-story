# 提案：文档维护批量（审计修复队列 8d）

## Why

审计队列 8d 的既定范围（P2-3 / P2-4 / P2-15 文档半＋杂项），2026-09-22 侦察实数坐实欠账未变且有新发现：**39 份规格 Purpose 仍是归档模板 TBD**（51→55 份规格期间零偿还，其中 `clear-current-ai-conversation` 的 Purpose 还与正文矛盾——写着「清除临时对话不留持久历史」，正文已是「新建讨论并保留旧讨论」）；**术语混用 66 行需改**（「临时对话」23 行＋「当前对话」1 行＋裸「对话」42 行，分布于 13 份规格——多讨论并存后「当前对话」世界观已过期，属语义修正而非措辞卫生）；**4 处（＋1 处短式）历史文档引用失效 change 路径**（含 8b 归档后新产生的 1 处）；lib.rs **3 处 WebView2 unsafe 零 SAFETY 注释**；用户可见错误文案「**项目**结构无效」违反「作品」统一命名（应为「作品结构无效」，测试用变体匹配、改前缀安全）。README「AI 参考优先级」措辞经核实**已由队列 1 修复**，从本批划除。按补充九的门槛规则，本批赶在后续新规格立项前完成，防止「临时对话」旧词渗入新规格。

## What Changes

- **P2-3 Purpose 批量补齐（39 份）**：每份规格用中文一至两句写明「能力是什么、管什么边界」，事实取自产生它的归档 change 的 proposal，不新造承诺；另加 3 份附加修正——`clear-current-ai-conversation` 矛盾 Purpose 重写、`ai-panel-state-structure` 模板句中文化、`ai-feature-orchestration` 去除已退场的「草稿本/正文本」旧概念措辞。
- **P2-4 术语统一（13 份规格）**：「临时对话」「当前对话」及指讨论的裸「对话」统一改为「讨论」（对话轮次→讨论轮次、对话历史→讨论历史、统一对话→统一讨论等）；`resident-ai-session` 的术语定义句重写。**保留项**（判定为合法引用，不改）：「新建对话」——产品 UI 入口按钮名，AGENTS.md 自身亦如此使用（入口叫新建对话，产物叫讨论，不违一概念一名）；「对话框」（dialog box，假阳性）；「恢复对话中」占位串（引用前端实际字符串，前端文案不在本批范围）。「DSH 会话」仅指驱动运行时状态，维持不变。
- **P2-15 文档半（4＋1 处失效路径标注）**：`docs/dsh-migration-spike.md:381`、`docs/superpowers/plans/2026-09-13-snapshot-version-validation.md:54`、`方向/全量地基审计-2026-09-14.md:206` 与 `:162`（短式）、`方向/第一版方向共识-2026-07-01.md:57`——一律补「已归档至 `archive/…`」指向，不改历史决策原文。
- **杂项 A（SAFETY 注释 ×3）**：`lib.rs:696-701` 三处 WebView2 unsafe 补 `// SAFETY:` 不变量说明（COM 接口调用前提），零行为变化。
- **杂项 B（错误文案与「项目」字样命名统一，2026-09-22 用户确认扩为全量）**：`project/mod.rs` Display 前缀「项目结构无效」→「作品结构无效」；同批统一 `src-tauri/src/project/` 四文件内全部中文「项目」概念字样（注释与用户可见字符串，实测 30 处：migration.rs ×17、mod.rs ×7、operations.rs ×5、docx_export.rs ×1）——文件名/字段名/代码标识（`project.json`、`project_path`、`ProjectError` 等）保留，逐处判定并记录。
- **守护句现代化（2026-09-22 终检新发现，用户确认并入）**：现行守护条款用旧世界词汇表达的（如「AI 不得写草稿本或正文本」→「AI 不得写用户文档」），在已有术语 delta 的规格中顺手现代化（约 12 处/4 份规格，行为不变）；`editor-margin-preference` 因此新增为第 14 份 delta 规格。英文残留「temporary conversation」×2 处一并改「discussion」。Purpose 行清扫范围扩大到退役概念词（草稿本/正文本/思维扩展）。
- **登记（不进本批）**：5 份老规格（writing-notebooks、production-editor-kernel、basic-rich-text-editing、editor-context-menu、selection-ai-invocation 部分）整份描述已被内容树取代的旧世界模型，属规格与现实的结构性对账，须单开 change 处理；本 change 仅在 design 与归档补记中登记。
- **验收**：55 份规格严格校验通过；术语 grep 清零（「临时对话」「当前对话」全库 0 命中，裸「对话」仅存合法清单内条目）；源码「项目」概念字样清零（仅存代码标识与文件名）；`test:rust` / `cargo check --all-targets` 全绿。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

术语统一涉及 13 份既有规格的 requirement 措辞（改措辞不改行为，各出 MODIFIED delta；Purpose 补齐属元数据修订，不走 delta、直接落主规格并在任务中逐份勾账）：

- `ai-feature-orchestration`
- `ai-panel-dom-contract`
- `ai-panel-rendering-boundaries`
- `ai-panel-state-structure`
- `ai-thinking-panel`
- `automatic-story-context`
- `clear-current-ai-conversation`
- `llm-configuration`
- `persistent-ai-panel-entry`
- `resident-ai-session`
- `selection-ai-invocation`
- `selection-ai-summon`
- `project-readme`

## Impact

- **规格**：`openspec/specs/`——39 份 Purpose 补齐＋3 份附加修正（直接编辑）；13 份术语 delta（change 目录内，归档时同步主规格）。
- **文档**：`docs/` 2 处、`方向/` 2 处失效路径标注。
- **代码**：`src-tauri/src/lib.rs`（3 处注释）、`src-tauri/src/project/mod.rs` 与 `operations.rs`、`migration.rs`（错误文案字符串）。
- **不碰**：前端、生产 driver、行为逻辑、历史决策原文；「新建对话」按钮与其前端文案不动。
- **风险**：低——文档与注释零行为；错误文案为用户可见字符串变更（前缀「项目」→「作品」），已验证测试以变体匹配不断言前缀。
