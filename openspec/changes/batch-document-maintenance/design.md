# 设计：文档维护批量（队列 8d）

## Context

审计队列 8d 三种性质混装中的纯文档半＋两笔零行为杂项（拆分定案见审计补充九）。侦察（2026-09-22，exp-1）确认：39 份 Purpose TBD 零偿还、术语 66 行/13 份规格需改、失效路径 4＋1 处、SAFETY ×3、错误文案 2＋同族 4 处；README 项已被队列 1 闭环。约束：不改历史决策原文；不碰前端与行为；一次只开这一个 change。

## Goals / Non-Goals

**Goals:**

- 55 份规格全部有实义中文 Purpose；术语符合「一个概念一个名字」（讨论＝产品概念，DSH 会话＝运行时状态）。
- 术语改动以规范 delta 承载（13 份 MODIFIED），归档时同步主规格，账目可审计。
- 历史文档失效引用全部有「已归档至」指向。
- Rust 杂项：SAFETY 注释 ×3、错误文案命名统一（含同族），测试全绿。

**Non-Goals:**

- 不改「新建对话」UI 按钮名与其前端文案（含「恢复对话中」占位串）。
- 不重写任何规格的行为语义；不动 Purpose 以外的正文结构。
- 不处理 vendored crate（jetscii）的 unsafe。
- 不清偿 8e 范围（依赖升级、体积分片）。

## Decisions

### D1　Purpose 补齐原则（39＋3）

- 每份 Purpose 用中文一至两句：「本能力是什么＋管什么边界」，信息取自产生该规格的归档 change 的 `proposal.md`（Why 段），**不新造承诺、不引用未来能力**；写不出边界的以「管什么」收尾，宁短勿虚。
- 3 份附加修正：
  - `clear-current-ai-conversation`：现 Purpose 与正文矛盾（称「清除临时对话不留持久历史」，正文是「新建讨论保留旧讨论」），按正文与归档 change 重写；
  - `ai-panel-state-structure`：英文模板句中文化，语义保留（状态职责分离）；
  - `ai-feature-orchestration`：Purpose 含已退场「草稿本/正文本」概念，改为内容树措辞。
- 39＋3 逐份在 tasks 勾账；因 Purpose 不是 requirement，无 delta 机制，apply 期直接编辑主规格（与 D2 的同步机制不同，属有意的不对称）。
- **Purpose 行术语清扫（顺带，2026-09-22 终检后扩围）**：补齐时对全部 55 份 Purpose 行 grep「临时对话／当前对话／对话」**以及退役概念词（草稿本／正文本／思维扩展／双本子）**，概念性使用处一并清理（已知 `resident-ai-session:4`「产品临时对话」、`clear-current-ai-conversation:4`——后者本就在重写清单、`ai-panel-rendering-boundaries:4`「AI 不直接写入草稿本或正文本」→「用户文档」）；迁移性／守护性合法引用保留。apply 期验收含 Purpose 层术语清零。

### D2　术语规则与保留清单

**替换映射**（requirement 正文与场景文本内）：

| 原词 | 改为 | 备注 |
|---|---|---|
| 临时对话 | 讨论 | 全部 23 行 |
| 当前对话 | 当前讨论 | 仅 1 行，与临时对话同句 |
| 指讨论的裸「对话」 | 讨论 | 42 行：统一对话/对话流/对话轮次/对话历史/长对话/多轮对话/对话布局→统一讨论/讨论流/…；「对话上下文」→「讨论上下文」 |
| 「对话事实源」 | 「讨论事实源」 | persistent-ai-panel-entry 3 行 |

**保留清单**（合法引用，出 delta 时逐条排除）：

- 「新建对话」——UI 入口按钮名（29 行/7 份），AGENTS.md 自身用法：入口叫新建对话、产物叫讨论；
- 「对话框」——dialog box（project-word-export 2 行，假阳性）；
- 「恢复对话中」——引用前端实际占位字符串（ai-panel-dom-contract:92）；
- 「DSH 会话」「会话」指驱动运行时状态处——不变。

**定义句重写**：`resident-ai-session:9`「临时对话指产品面板状态中的当前对话」→「讨论指产品面板状态中的当前讨论实例」（一句话消掉双违规）。

**守护句现代化（2026-09-22 终检新发现并入）**：现行守护条款以旧世界词汇作宾语的，统一泛化为「用户文档」——「AI 不得写／插入／保存／修改草稿本或正文本」→「…用户文档」，行为不变、语义为内容树时代的正确表达。范围约 12 处：ai-thinking-panel（×6）、ai-panel-rendering-boundaries（:64）、llm-configuration（×4，其中 :90 的 `作品文本/草稿本.txt` 是旧格式文件路径，路径本身保留、概念措辞现代化）、editor-margin-preference（×2，因此新增为第 14 份 delta 规格）、selection-ai-summon（:53 守护句，已有 delta）。判定规则：草稿本／正文本作为**守护对象**出现→「用户文档」；作为**界面模型描述**（标签页、两个文本区域、本子类型标识 draft/main、文件格式细节）出现→不动，属 D7 登记的结构性失真。

**英文残留**：「temporary conversation」×2（ai-panel-state-structure:7、ai-feature-orchestration:6）→「discussion」，并入各自已有 delta；其余英文 conversation 为「讨论」的代码英文名（capability 名 conversation-* 即用之），保留。

### D3　delta 粒度与同步机制

- 术语改动按 **MODIFIED Requirements** 全块承载：复制受影响 requirement 整块（标题到末场景），应用 D2 映射，仅在措辞变化处动刀；不受影响的 requirement 不进 delta。受影响 requirement 以 exp-1 行号清单定位，生成后逐份 diff 自查（只允许出现映射表内的词形变化）。
- **标题含映射词的 4 个 requirement 走 REMOVED＋ADDED 对**（2026-09-22 裁决：REMOVED 旧标题＋Reason＋Migration，ADDED 新标题＋术语化正文；不用语义不明的 RENAMED 组合）。交叉引用已核实为零。四处：`DOM 契约包含统一对话与追问节点→…统一讨论与追问节点`、`显示决策呈现统一对话与追问→…统一讨论与追问`、`面板采用统一对话布局→…统一讨论布局`、`召唤发起的对话进入新讨论→召唤发起进入新讨论`（按正文流程语义取分支项，避免与既有 requirement「召唤开启新讨论并保留旧讨论」近重复）。同步后该 4 块落点以工具为准，requirement 顺序变化为术语批已接受代价。
- 归档时同步主规格（与 8c 同机制）；**apply 期主规格的 requirement 正文不动**，只做 D1 的 Purpose 直改——避免主规格与 delta 双轨失配。因此 D6-2 的全库术语 grep 归零验收在**归档同步之后**执行；apply 期只验 Purpose 层清零。
- delta 文件内不夹带 Purpose 修正（那是 D1 直改路径），两机制不混。

### D4　失效路径标注方式

沿用队列 1 确立的历史基线模式：**不删不改原文**，在引用处补「（已归档至 `openspec/changes/archive/<实际路径>`）」尾注或行内前缀；5 处清单见 proposal。审计文档自身两处（:206、:162）同法。

### D5　Rust 杂项

- **SAFETY ×3**（lib.rs:696-701）：逐块写 `// SAFETY:` 注释，说明不变量——controller 在窗口附加完成后非空、CoreWebView2/Settings 为同步 COM getter（调用期间对象存活）、SetAreBrowserAcceleratorKeysEnabled 仅在 WebView2 环境下触达。注释为事实陈述，不改变量。
- **「项目」字样统一（2026-09-22 用户确认扩为全量，实测 30 处/4 文件）**：`src-tauri/src/project/` 内 migration.rs ×17、mod.rs ×7、operations.rs ×5、docx_export.rs ×1。判定规则：中文概念指称容器的（注释与用户可见字符串，如「项目结构无效」「项目元信息无法解析」）→「作品」；**文件名／字段名／代码标识保留**（`project.json`、`project_path`、`ProjectError`、`ProjectLocks`、模块路径 `src-tauri/project/` 均不动）；「项目结构版本」这类描述 project.json 结构版本字段的既定技术术语可保留，但逐处列出存疑清单交主控复核。每处先 grep 该字符串的字面断言（侦察确认「项目结构无效」零断言；其余同法核验，有断言随改并记录）。

### D6　验收口径

1. `openspec validate --specs`：55 份全过（Purpose 直改后仍满足严格校验的 Purpose 长度门槛——模板句既然能过，实义中文同样能过，风险低）。
2. 术语 grep：`openspec/specs/` 内「临时对话」「当前对话」0 命中；裸「对话」命中全部落在保留清单（新建对话/对话框/恢复对话中）。
3. `test:rust` 全绿、`cargo check --all-targets` 零新增警告。
4. delta 自查：13 份 delta 与主规格逐 requirement diff，差异仅映射表词形。

### D7　登记：旧世界规格的结构性失真（不进本批）

2026-09-22 终检发现 5 份规格整份或主体描述已被内容树（2026-08）取代的旧双本子世界模型：writing-notebooks（草稿本/正文本双标签页的完整世界）、production-editor-kernel（双本子双文档主体）、basic-rich-text-editing（部分场景）、editor-context-menu（「草稿本与正文本的编辑区」）、selection-ai-invocation（本子类型标识 draft/main 条款）。这不是措辞问题而是**规格与现实的层级对账**——哪些 requirement 已被取代、哪些在新世界仍成立，需要先调查当前编辑器实际行为再修，须单开 change 处理。本批对这 5 份的旧世界描述不动（守护句现代化按 D2 判定规则跳过界面模型描述），归档补记中登记为待办；审计文档收尾时一并补记。

## Risks / Trade-offs

- [Purpose 一句话写虚（变成能力名扩写）] → D1 事实源锁定归档 proposal，宁短勿虚；实施抽查。
- [术语替换误伤合法引用] → 保留清单前置排除＋生成后逐 diff 自查（D3/D6-4）；「新建对话」整词优先匹配。
- [同族文案改动碰上隐藏字面断言] → D5 先核验后改、有断言随改并记录。
- [Purpose 直改与 delta 双轨混淆] → D3 明确机制边界：apply 期主规格只动 Purpose，requirement 正文归档时经 delta 同步。

## Migration Plan

纯文档与注释＋错误文案字符串；无部署面。回滚＝git revert。顺序：delta 生成（带自查）→ 用户确认后 apply（Purpose 直改＋文档标注＋Rust 杂项）→ 验收 → 归档同步。

## Open Questions

（无——保留项判定已由 AGENTS.md 自身用法背书；若用户想把「新建对话」按钮也改名，属另一个 change 的范围，本批不动。）
