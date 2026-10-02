# add-word-import Design

## Context

- **现有语法（侦察实证）**：文档落盘为 Tiptap JSON v2（`作品文本/documents/<稳定ID>.json`），canonical 块白名单只有 paragraph / heading 1-6 / bulletList / orderedList 四种；marks 白名单 bold / italic / underline / strike / textStyle(color·fontFamily·fontSize) / highlight / link；段落属性白名单 textAlign / lineHeight / spacingBefore / spacingAfter / textIndent / indentLeft / indentRight。后端 `notebook.rs` 有严格 grammar 校验，单文件上限 10MB。前端入口在 `file-management.ts`（新建文档／新建文件夹旁），Tauri command 封装在 `project-api.ts`。
- **导出现状（对称参照）**：Word 导出在 Rust 侧（`docx_export.rs`，docx-rs 0.4.22 生成），本身有降级（列表→文字前缀、link→纯文字、fontSize/fontFamily/highlight 丢弃）。因此「导出→导入」往返不可能无损，验收基准定为**差异可枚举**。
- **真实样本解剖（2026-10-02，61 集短剧剧本，WPS 12.1.0.26375 存档，约 5.5 万字）**：零表格／零图片／零脚注／零批注／零超链接／零修订／零 Word 标题样式（pStyle 使用数为 0）；结构全部靠文字惯例（「第X集」独立成段全加粗 ×61、粗体场景头、粗体人物行）；730 个段落带 `numId=0` 编号墓碑（WPS 不显示，天真映射会凭空长出编号）；191 个空段落充当间距；直接 run 级格式（宋体/黑体、12/14pt、少量红字黄高亮）。解剖报告存 `.omo/word-import-anatomy-2026-10-02/`（apply 时随 fixtures 归档入 change 目录）。
- **WPS 生态调研（librarian，2026-10-02）**：WPS 月活 4.94 亿（2022，另有 12 亿装机口径），政企双高地，日常产出即 .docx。已知怪癖：①系统 MIME 报非标准 `application/wps-office.docx`（Dify 真实踩坑案例：按 MIME 过滤会拒收）；②`mc:AlternateContent` 常缺 `mc:Fallback`（python-mammoth 崩溃案例）；③docProps 写 `KSOProductBuildVer` 版本印记（可作样本归因）；④国内外版本线并行（11.x / 国内 12.1.x / 国际 12.2.x / 信创版）。注意 XML 里 `wps:` 前缀是微软 WordprocessingShape，与金山无关；金山私货是 `wpsCustomData` 命名空间。
- **Rust 生态调研（librarian，2026-10-02）**：docx-rs 0.4.22（Cargo.lock 已锁定）自带读取 API `read_docx()`（段落/run/表格/超链接/编号/样式/眉脚/脚注/批注），557 星、355 万下载、活跃维护、MIT；对 WPS 文件兼容性**无公开测试记录**。业界头部项目（firecrawl/anydoc 22k 星、ironclaw 12.6k、markit 1.3k）全部走 zip＋quick-xml 手写 OOXML 解析——没有事实标准读取库。安全前例：815KB 恶意 docx 可解压膨胀到 1.68GB RSS（xerj 项目实录），解压必须有上限。
- **权限现状**：`dialog:allow-open` 已在 `capabilities/default.json` 授予（文件选择零新增 ACL）。

## Goals / Non-Goals

**Goals:**

- 用户能把真实世界的 .docx 剧本（WPS 优先、微软 Word 兼容）导入当前作品的内容树，文字与既有语法可承载的格式完整保留。
- 损耗如实告知：导入前预检呈现「将创建什么＋会丢什么」，用户确认才动；任何降级都可枚举。
- 拆不拆由用户拍板：机器只识别规整的结构标记并给出建议。
- 导入内容逐字来自用户文件：工具只做格式搬运，不生成、不改写、不碰既有文档。
- 对恶意或畸形文件稳定失败（中文报错、无残留、无崩溃）。

**Non-Goals:**

- 不做 .doc 二进制老格式（用户先另存为 .docx）。
- 不做 Markdown / Final Draft 导入（后续独立 change）、不做 PDF 导入（已撤出路线图）。
- 不做样式表深度合并、复杂编号体系（多级重启编号）完整还原——超出部分降级＋告知。
- 不做导入后的结构整理（移动、重命名、再拆分交给既有文件管理操作）。
- 不承诺「导出→导入」往返无损（导出侧本身降级，见 Context）。

## Decisions

### D1. 解析放 Rust 后端，两步无状态命令

作品数据的解析与入库属 Rust 职责（架构边界）。新增两个 command：`import_docx_preview`（解析→返回预览：字数、拟创建文档结构、损耗清单、拆分建议）与 `import_docx_commit`（重新解析并落盘）。**commit 时重新解析而不是暂存解析结果**：无服务端持态、无预览-提交间文件被改的 stale 问题（重新解析时校验文件内容哈希与预览一致，不一致则要求重新预览）；docx 体量小（55k 字样本解析毫秒级），重复解析成本可忽略。

### D2. 解析库：先试 docx-rs `read_docx`，金样本 spike 定生死

**路线 A**（首选）：用现有依赖 docx-rs 0.4.22 的 `read_docx()`。零新增依赖、覆盖面大。**路线 B**（fallback）：zip＋quick-xml 手写（参考 anydoc/markit/xerj 实现，只解析剧本导入需要的子集）。
**开工第一个任务就是 spike**：拿真实 WPS 金样本跑 `read_docx`，验证四点——能否容忍缺 Fallback 的 AlternateContent、wpsCustomData 私货、编号墓碑、样式引用。全过走 A；任一硬崩走 B。此决策只看 spike 结果，不预设立场。

### D3. 映射规则（OOXML → 现有语法）

| OOXML | 映射 | 说明 |
|---|---|---|
| `w:p` 普通段落 | `paragraph` | 消费 `jc`→textAlign、`ind`→indentLeft/Right·textIndent、`spacing`→lineHeight·spacingBefore/After |
| pStyle 标题样式（Heading1-6／WPS 标题样式名） | `heading` level N | 真实样本为 0 使用，但微软 Word 用户会用 |
| `numPr` 指向有效定义且 `lvlText` 非空 | `bulletList`/`orderedList`（按 numFmt） | **`numId=0` 墓碑一律忽略**（样本 730 处实证）；多级/重启编号等复杂情形降级普通段落＋告知 |
| run 级 `w:b`/`w:i`/`w:u`/`w:strike` | bold/italic/underline/strike | 直接格式全保留 |
| `w:color`/`w:sz`/`w:rFonts`/`w:highlight` | textStyle(color/fontSize/fontFamily)、highlight mark | 语法可承载（比导出侧还全） |
| `w:hyperlink` | link mark | |
| `w:tbl` 表格 | **拍平保文字**：逐格文字按「每格一段」生成段落 | 结构丢失，预检告知表格数 |
| 图片 / 脚注 / 批注 | 丢弃 | 预检告知数量 |
| 修订（w:ins/w:del） | 取最终态：留 ins 去 del | 预检告知修订数 |
| 空段落 | 保留为空段落 | 样本 191 处，是作者的间距表达 |
| `mc:AlternateContent` | 只读 `mc:Fallback`；缺失时跳过该块＋告知 | WPS 常缺 Fallback（D5） |
| `wpsCustomData` 等私货命名空间 | 忽略 | |

样式表继承：v1 只解析 run 级直接格式＋heading 的 pStyle＋docDefaults 的基准字体字号；样式表链式合并的字符格式不追求完整还原（真实证据：WPS 用户用直接格式），缺漏计入告知。**编号可见性规则**：引用有效定义（numId≠0 且定义存在且 lvlText 非空）才转列表；判断不确定时按普通段落处理并告知。

### D4. 拆分：默认整文件一个文档，序列标记识别为可选建议

- 默认：整个文件 → 一个文档，文档名 = 文件名去扩展名。
- 预检时识别**序列标记段落**：独立成段、整段仅含短序列文本（如「第X集」「第X章」「Chapter N」）、全文重复出现 ≥3 次、格式一致（如全加粗）。识别到则给出建议：「按 N 个标记拆为 N 个文档，放在以文件名命名的新文件夹下」。
- **是否拆分由用户在预览中拍板**（判断权在用户）；识别不出或用户拒绝 → 整文件一个文档。
- v1 不识别「一、二、三、」式章节号、不做嵌套层级推断（样本里它们与正文混排，误拆风险高）。

### D5. WPS 兼容与安全硬要求

1. **不信任系统 MIME**：文件过滤按扩展名 .docx ＋ ZIP 结构（`[Content_Types].xml` 存在）判断；拒收时中文报错。
2. **AlternateContent 容错**：缺 `mc:Fallback` 不崩溃，跳过该块并计入告知。
3. **解压上限**：单部件解压上限与总解压上限（防压缩炸弹，参照 xerj 前例），超限稳定失败。
4. **私货忽略**：`wpsCustomData` 命名空间、customXml 部件（样本实测 144KB 私货）不解析、不入库。
5. **样本归因**：读 docProps 版本印记（Application/KSOProductBuildVer）记入测试证据，跨版本对照。

### D6. UI 流（简化率原则）

文件管理区新按钮「导入 Word 文档」→ `open()` 选 .docx（已有权限）→ **预检对话框**（一句话结论：「共 55,331 字，全部保留」或「保留 54,000 字，丢弃 2 张图、1 处脚注」；拟创建结构；拆分选择，默认整文件；目标位置 = 当前文件管理区选中文件夹或根）→ 确认导入 → 完成后新文档出现在树中。任何一步取消＝零副作用。无打开作品时入口禁用并提示先打开作品。导入的文档 AI 可见性默认值与既有新建文档一致。**简化的是路径，不是诚实**：损耗告知必须完整（可折叠展开明细，但不可省略）。

**apply 落地注记（2026-10-02）**：①文件树无选中状态，目标位置改为预检对话框内选择器（根级默认＋全部文件夹下拉，树序缩进）——D6「当前选中文件夹或根级」按此落地；②损耗 kind 实装七个，新增 `numbering_degraded`（复杂编号降级为普通段落并告知）；③docx-rs 读侧对 `mc:AlternateContent` 解析 Choice 内容、跳过 Fallback（与 design 表述相反，可观察行为仍满足规格：不崩溃、块跳过、计数告知）；④多级编号（ilvl>0）v1 一律降级普通段落＋告知；⑤`w:br` 按同属性拆为相邻段落（文字零丢失）；⑥文档名做文件系统非法字符净化与同级唯一化（元数据层面，正文逐字保真不受影响）；⑦docDefaults 基准字体字号不产生 textStyle 标记（等价编辑器默认）。

### D7. 边界合宪性

导入内容 100% 逐字来自用户选定文件（格式映射不改字符），导入只创建新文档、不修改既有文档；这是用户主动搬运自己的材料，与版本恢复同属「用户主动重放自己的稿子」豁免类别，不违反「AI／系统不写用户文档」边界。此约束写进 spec 成为可验收条款。

## Risks / Trade-offs

- [docx-rs 对 WPS 文件兼容性未确证] → D2 spike 第一时间定生死；路线 B 参考实现充分，切换成本可控。
- [序列标记识别误判（把正文误当标记 / 漏识别）] → 识别条件保守（≥3 次重复、独立成段、格式一致）；只建议不执行，用户拍板；拆错可删重来（导入的是新文档，可整删）。
- [表格拍平后可读性下降] → 预检明示表格数量与处理方式；剧本类文件表格占比极小（样本为零）。
- [复杂编号体系降级] → 告知＋文字保全，不静默。
- [预览与提交之间文件被换] → commit 重解析并比对内容哈希，不一致要求重新预览。
- [超大 / 恶意文件] → D5.3 解压上限；文件读取设大小上限，超限中文报错。
- [往返不无损引发用户困惑] → 文档与告知明确「差异可枚举」基准；验收用例覆盖往返差异清单。

## Migration Plan

新功能，无数据迁移。回滚＝移除导入入口与两个 command，不影响既有链路（导入只新增文档，回滚后已导入文档作为普通文档存在，不受影响）。

## Open Questions

- 序列标记识别的格式阈值（全加粗？字号偏大？）在 apply 时以金样本＋2~3 份补充样本调准，不阻塞设计。
- 导入文档的 AI 可见性默认值：apply 时核对现有新建文档的默认值并保持一致（预计「允许」，与现状对齐）。
- WPS「智能识别」等新私货元素是否随版本涌现：以真实样本驱动的兼容性测试持续覆盖，不在 v1 预设。

## Spike 补记（2026-10-02，apply 阶段任务 1.2 结论）

**路线 A 确认**：docx-rs 0.4.22 `read_docx_with_options(&buf, ReadDocxOptions::default().with_image_previews(false))` 完整解析真实 WPS 金样本，无错误。与解剖基准精确一致：段落 2718、表格 0、run 4681、文本节点 4680、**字符 55331（逐字一致）**、空段落 191、numPr 732（numId=0 墓碑 730、真编号 [1,1]）、pStyle 0、独立成段集标记 61（且 61 个全加粗——拆分规则输入成立）。bold/color/sz/highlight 计数与解剖有差系口径原因（解剖的 XPath 计入了段落级 pPr/rPr、szCs、`highlight val="none"`、eastAsia 专属属性），非数据丢失；实现时以 **run 级属性为映射输入**，段落级 rPr 不参与正文映射。

**API 速查**（读侧，全部已实证）：`Docx.document.children: Vec<DocumentChild>`；`DocumentChild::Paragraph(Box<Paragraph>) | Table(Box<Table>)`；`Paragraph { id, children: Vec<ParagraphChild>, property: ParagraphProperty }`；`ParagraphChild::{Run(Box<Run>), Hyperlink(Hyperlink{children: Vec<ParagraphChild>}), Insert, Delete, ...}`；`Run { run_property: RunProperty, children: Vec<RunChild> }`；`RunChild::Text(Text{text: String})`；`ParagraphProperty { style: Option<ParagraphStyle>, numbering_property: Option<NumberingProperty{id: Option<NumberingId{id: usize}>, level: Option<IndentLevel{val: usize}>}>, alignment: Option<Justification>, indent: Option<Indent>, line_spacing: Option<LineSpacing>, ... }`；`RunProperty` 的 bold/italic/underline/strike/color/highlight/sz/fonts 均为 `Option<...>`。

**解压上限实现方式（D5.3 与路线 A 的适配）**：docx-rs 内部自行解压、无法注入逐条目限额 → 在调用 `read_docx` **之前**用 `zip` crate 预扫描（`zip` 已是 docx-rs 的传递依赖，将其同为直接依赖不扩大依赖树；须与 docx-rs 所用版本保持同一棵树）；校验每条目 `uncompressed_size` 单项上限与总和上限，超限直接中文报错；输入文件整体字节数先设上限。Spike 工具保留于 `src-tauri/examples/docx_read_spike.rs` 作调试用途。

**导入 command 契约（前后端共同依据，字段名 snake_case）**：

```
import_docx_preview(project_path: String, file_path: String)
  → ImportPreview {
      char_count: usize,             // 全文字符数
      paragraph_count: usize,
      default_doc_name: String,      // 文件名去扩展名
      losses: Vec<ImportLoss>,       // { kind: "table_flattened"|"image_dropped"|"footnote_dropped"
                                     //        |"comment_dropped"|"revision_finalized"|"numbering_degraded"
                                     //        |"block_skipped",
                                     //   count: usize, note: String }
                                     // numbering_degraded＝复杂编号（多级/样式链/解析不到定义）降级为普通段落并告知
      split_suggestion: Option<SplitSuggestion>,
                                     // { marker_sample: String(如「第X集」), count: usize,
                                     //   doc_names: Vec<String> }
      content_hash: String,          // 文件字节 sha256
      generator: Option<String>,     // docProps 生成器印记（样本归因）
    }

import_docx_commit(project_path: String, file_path: String,
                   parent_id: Option<String>,   // 目标文件夹（None=根级）
                   split: bool,                 // 用户拍板结果，默认 false
                   expected_hash: String)       // 预览时的 content_hash
  → ImportCommitResult { created_doc_ids: Vec<String>, created_folder_id: Option<String> }
  // content_hash 与重解析结果不一致 → 错误信息以 "hash_mismatch:" 前缀返回，前端提示重新预检
  // split=true 时：以 default_doc_name 建新文件夹，标记段落为边界拆分为 N 个文档置于其下
```
