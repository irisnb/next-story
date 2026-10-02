# add-fdx-import Design

## Context

- **.fdx 格式事实（librarian 查证，2026-10-02）**：明文 UTF-8 XML，根元素 `<FinalDraft DocumentType="Script" Version="1|3|5">`；正文为 `<Content><Paragraph Type="...">` 序列，段落类型含 Scene Heading / Action / Character / Parenthetical / Dialogue / Transition / Shot / Cast List / New Act / Lyrics / More / Outline N（层级大纲）；**DualDialogue 是结构而非类型**（无 Type 的 Paragraph 包 `<DualDialogue>`，内含两套 Character/Dialogue）；TitlePage 独立部件；SceneProperties（Color/Length/Page/Summary/SceneArcBeats＝Story Map 场景数据）；ScriptNote（作者自留注）；Revisions（19 套修订体系＋行内 RevisionID）；无官方现行规范、版本间元素有增减；Rust 无现成解析库（Python screenplain/Trelby、TS lumenx、ObjC Beat 可参照）。
- **管线现状**：`import_document_preview/commit` 已按扩展名分发（.docx/.md）；共享骨架（损耗记账、序列标记框架、名称净化、哈希、事务落盘）在 `document_import.rs`；md 分支 1203 行为"纯文本解析→语法映射"的最新范本。
- **依赖现状**：树内无 XML 解析器（docx-rs 内部自带，不暴露）。
- **测试样本**：无本机真实 .fdx（用户 FD 版本待确认）；采用两个公开真实 FD 生成样本入库——`wonderunit/storyboarder` 的 `test/fixtures/final-draft/test.fdx`（FD Version="3"、含 TitlePage/SceneProperties/ScriptNote/Revisions 全套）与 `vilcans/screenplain` 的 `tests/files/dual-dialogue.fdx`（双栏对白最小例）。

## Goals / Non-Goals

**Goals:**

- 用户能把真实 `.fdx` 剧本导入当前作品，**文字 100% 保留**、场次结构成为标题（后续 AI 取材与 md/docx 同构）。
- 剧本语义映射优于视觉猜测：场景头/人物/对白/转场各得其所，观感近似原软件。
- 降级如实告知（双栏对白/标题页/场景元数据/剧注/修订标记），绝不静默。
- 真实 FD 生成字节驱动开发（公开 fixture 入库），版本差异容忍。

**Non-Goals:**

- 不做 `.fdr` 二进制解析（拒绝＋中文提示）；不做 FD 导出；不做 Beat Board 数据导入（未确证部分如实丢告知）；不还原修订色；不做双层 Outline 深度语义（只按 N 映射标题层级）。

## Decisions

### D1. 解析：roxmltree 一次性 DOM，真实样本驱动

roxmltree（成熟轻量 DOM、单遍载入后遍历，无流式需求）＋两个公开 fixture 入库（`src-tauri/tests/fixtures/fdx/`）。**Spike（任务 1.1）**先实证：根元素/Version 属性、Paragraph Type 全集（以 fixture 对照 lib-1 清单）、Text 的 Style 属性形态（Bold/Italic/Underline 如何表达——查证未细及处）、DualDialogue/TitlePage 实际嵌套、Alignment（对齐）属性是否存在。未知元素一律忽略＋计数（容忍 V1–V5 差异），不因未确证元素失败。

### D2. 管线接入与文件识别

`.fdx` 扩展名 → fdx 分支（`import_document_*` 分发，`fdx_import.rs` 新建）；16MB 上限（明文 XML 同 md 口径）；UTF-8＋BOM 剥离；XML 良构性与根元素 `<FinalDraft>` 校验，畸形中文报错；`.fdr` 扩展名直接拒绝：中文提示「Final Draft 1–7 老格式，请在 Final Draft 中打开并另存为 .fdx 后导入」。generator 印记＝根元素 Version 属性＋DocumentType（样本归因）。

### D3. 段落类型映射表

| .fdx | 映射 | 损耗 kind |
|---|---|---|
| Scene Heading | heading 2；Number 属性（场景编号）并入标题文字前缀（如「12 外景 书店门口—日」） | — |
| New Act | heading 1 | — |
| Outline N | heading N（clamp 1–6） | — |
| Shot | heading 2（同场景头处理） | — |
| Action / General | paragraph | — |
| Character | paragraph＋indentLeft（视觉近似） | — |
| Parenthetical | paragraph＋更深 indentLeft | — |
| Dialogue | paragraph＋indentLeft | — |
| Transition | paragraph＋textAlign right | — |
| Lyrics / More / Cast List | paragraph（未知类型兜底同此） | — |
| Text 的 Style（Bold/Italic/Underline） | bold/italic/underline marks（spike 实证形态） | — |
| DualDialogue 结构 | 拆为先后两组段落（顺序：第一组 Character→Dialogue→第二组 Character→Dialogue，括注随组） | dual_dialogue_degraded |
| TitlePage | 文字逐段并入文档开头（保字；空段丢弃） | titlepage_inlined |
| SceneProperties（含 Summary/SceneArcBeats） | 丢弃 | scene_metadata_dropped |
| ScriptNote | 丢弃 | scriptnote_dropped |
| Revisions（体系/RevisionID 标记） | 忽略标记、全部文字无损导入 | revision_marks_ignored |
| TagData/Watermarking/ElementSettings/MoresAndContinueds/LockedPages/SpellCheckIgnoreLists/SplitState 等 | 丢弃（机器家具，无感） | — |
| Alignment 属性（若 spike 实证存在） | textAlign | — |

缩进量取编辑器既有缩进语义的固定档（Character/Dialogue 一档、Parenthetical 更深一档），不做像素级复刻——「近似观感、精确文字」。

### D4. 拆分建议：复用标题序列规则

场景头已成 heading，既有「同层级短序列标题重复 ≥3」框架直接适用（如场景头为「第X集」序列）；New Act 不作特例拆分界（避免两套拆分逻辑）。默认不拆、用户拍板。

### D5. word→document 命名清理（des-1 遗留，随本 change 落地）

`src/word-import.ts`→`document-import.ts`、`tests/word-import.test.ts` 与 `tests/project-api-word-import.test.ts` 文件名、DOM id（`fm-import-word`、`word-import-*`）→document 措辞；**纯机械重命名、零行为变化**，与功能改动分开提交（一个 rename commit＋一个 feat commit），便于 review 与回滚。

## Risks / Trade-offs

- [fdx 版本差异（V1–V5 元素增减、无官方规范）] → 未知元素忽略＋计数；真实 fixture 驱动；用户侧真实文件到位后再补实测（诚实边界记录）。
- [Text Style 属性形态未实证] → spike 首任务实证；查不到按无标记处理（文字无损），不猜。
- [Alignment/其他段落属性存在性未确证] → 同上，spike 实证后决定映射或忽略。
- [缩进映射的观感主观性] → 固定档位可预期；用户可导入后自行调整（段落属性是编辑器一等公民）。
- [场景编号并入标题 vs 独立信息丢失] → 并入保信息（编号进文字），预检不作为损耗（信息未丢）。

## Migration Plan

纯新增格式分支＋机械重命名；无数据迁移。回滚＝移除分支与重命名还原。已导入文档不受影响。

## Open Questions

- 用户所用 FD 版本与真实文件（`.fdx` 还是 `.fdr`）：已两次询问未获答复——不阻塞本 change（.fdr 拒绝提示已覆盖），但真机验收若能拿到用户真实文件更佳。
- TitlePage 是否某天需要独立成文档：v1 并入开头保字；真实需求出现再议。

## Spike 补记（2026-10-02，apply 阶段任务 1.1 结论）

roxmltree 0.20 已入依赖；两真实样本入库 `src-tauri/tests/fixtures/fdx/`（storyboarder-test.fdx 167KB＝FD Version 3 全套；screenplain-dual-dialogue.fdx 575B＝Version 1 双栏对白最小例；均来自 MIT 开源仓库的测试文件，来源注明于 fixtures README）。实证：

1. **根元素与版本**：`<FinalDraft DocumentType Template Version>`；V1 极简与 V3 全套 roxmltree 均一次解析通过；两样本均无 BOM（读入仍剥 BOM 兜底）。
2. **Paragraph Type 实测全集**：Action／Cast List／Character／Dialogue／General／Parenthetical／Scene Heading／Shot／Transition（＋lib-1 清单的 Outline N 按前缀识别）；另有 195 个无 Type 段落——按上下文分发：TitlePage 内部段、ScriptNote 内部段、DualDialogue 包裹段、SmartType／ElementSettings 设置段。
3. **样式编码（查证未细及处已补全）**：`Text@Style` 属性、`+` 分隔词组——实测取值 Bold／Italic／Underline／AllCaps／Underline+AllCaps／空＝无样式。映射：Bold→bold、Italic→italic、Underline→underline；AllCaps 与 AdornmentStyle 为显示属性，忽略不计损耗（文字字符不变）。
4. **DualDialogue 结构实证**：无 Type 的包裹 Paragraph ＞ DualDialogue ＞（Character 段＞Dialogue 段）×2（可含 Parenthetical）；**ScriptNote 嵌套在段落内部**（实测包裹段内含「Dual Dialogue」剧注）。
5. **段落布局属性＝FD 元素默认值的冗余回声**：Alignment／LeftIndent／RightIndent／FirstIndent／SpaceBefore／Spacing／Leading／StartsNewPage 逐段存在——按 Type 固定档映射、忽略这些属性（D3 加固：属性是回声不是信息）。
6. **场景编号 Number 有污染**：设置段的示例段落也带 Number（实测出现「123」）——**只在 `Type="Scene Heading"` 段落读取 Number**。
7. 其他实测在档：SceneProperties×30、ScriptNote×14、TitlePage×1、Transition×10、Summary×29、Watermarking／SplitState 等机器家具。Spike 工具保留于 `src-tauri/examples/fdx_read_spike.rs`。

## 交叉验证轮补记（2026-10-02 晚，用户验收质疑触发）

用户质疑 FADE OUT 对齐引出**缩进保真问题**，随后按用户指令展开多样本交叉验证（oracle 独立审计＋librarian 样本搜寻＋两轮修复）。事实与决定：

1. **布局权威改判**：spike 时"段落布局属性＝默认值回声、忽略"的判断**错误**——ElementSettings（每类型一块，`<ParagraphSettings Type>` 携带 Alignment/LeftIndent/RightIndent/FirstIndent）是 FD 渲染的权威数据。实测语义（librarian 双样本交叉验证）：LeftIndent/RightIndent＝**从纸张左/右缘起算的英寸绝对坐标**（非页边距相对）；PageLayout 边距用磅（72=1"）；Alignment 合法全集 **Left/Center/Right/Full**（Full=justify）；用户自定义版式＝数值直接落盘（rsdoiel 样本 Action 基准 1.25"≠默认 1.50"，证明必须读文件值不能猜）。
2. **修正后的映射**（fix-1 两轮）：ElementSettings 为权威——Alignment 三态（显式 Left 不触发转场右对齐回退；Full→justify；缺失回退）；相对缩进＝类型值−正文基准（基准按文件 Action/General 实际值，左右独立）换算 pt；FirstIndent→textIndent（负值悬挂合法）；Transition 只消费对齐（页面几何缩进不搬运，流式编辑器无页面概念）。**回退固定档修正相对顺序**：Dialogue 2em／Parenthetical 3em／Character 4em（1:1.5:2，修正原"括注深于人物"的倒挂）。Text 的显式 Font/Size/Color→textStyle（Font→fontFamily、Size→pt、**Color 12 位 48bit 截前 6 位**）；类型级 FontSpec 默认仍是回声不搬运。
3. **新增损耗 kind `unknown_element_skipped`**：design D1"未知元素忽略＋计数"承诺落实——根级家具白名单（四真实样本实证并集）之外计数，note 带去重元素名。
4. **TitlePage 段落对齐保留**（实测片名/署名 Center→textAlign）；首行行首空白保留（indentation 样本实证作者缩进语义，仅后续行剥除回声空白）。
5. **样本矩阵**（新增）：入库 edge/ 五份 MIT 边角（utf-8-bom——上游文件实无 BOM，测试前置字节驱动剥离路径；indentation 前导空格；extended-characters 多语种；parenthetical 回退档序；forced-action）；本地三份（rsdoiel×2 自定义版式 AGPL 不入库、Big-Fish V1 435KB 疑似真实 FD8）——**Big-Fish 压力实测：141,883 字／2,780 块，预检 31ms／提交 112ms，落盘 797KB 过严格校验**；rsdoiel 自定义基准 1.25" 实测缩进换算正确（Character +2.50"＝180pt 等）。**Version 5 真实样本公开渠道不存在——待用户 FD12/13 导出补齐（最大空白）**。
6. **oracle 独立审计对 docx/md 的发现**（另立 change 修，不在本 change 范围）：md 复杂列表会重排文字顺序（P1）、docx 符号字符 Sym 静默丢弃（P1）、docx 样式继承链未生效（P1）、docx 编号覆盖/续编被忽略（P1）、md HTML 剥标签边角与未闭合 `<u>` 误伤（P2）、docx rightChars/atLeast（P2）、损耗清单缺口（P2）——详见审计报告，待归档后开修复 change。
7. 测试基线：510→**528 passed 0 failed**（缩进修正＋审计修复＋边角集，全部零回归）。
