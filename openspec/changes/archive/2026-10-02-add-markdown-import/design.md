# add-markdown-import Design

## Context

- **既有导入管线（add-word-import，2026-10-02 归档）**：`docx_import.rs` 已建文件校验、损耗记账、序列标记识别、名称净化、`import_docx_preview`/`import_docx_commit` 双命令（哈希校验、事务落盘、失败无残留）；前端共享预检对话框（一句话结论＋可折叠损耗明细＋拆分二选一默认不拆＋目标选择器）。本 change 复用全部管线骨架，只新增 md 解析分支。
- **自家 md 导出方言（镜像，`project-markdown-export` 规格）**：标题按层级；列表嵌套与有序 start；`**` 粗体、`*` 斜体、`~~` 删除线、`<u>` 下划线（HTML 内联）、`[文字](地址)` 链接；特殊字符转义保字面；颜色/fontFamily/fontSize/highlight 降级为纯文字。→ 导入认这些即得「往返近无损」。
- **解析器查证（librarian，2026-10-02）**：pulldown-cmark 0.13.4（2026-05 发布、持续修复、1.647 亿下载、MIT、传递依赖仅 bitflags/memchr/unicase）；CommonMark 0.31.2 级合规；`ENABLE_TABLES`/`ENABLE_STRIKETHROUGH`/`ENABLE_TASKLISTS`/`ENABLE_FOOTNOTES` 选项；行内 HTML 产出逐标签 `InlineHtml` 事件（`<u>` 须自行配对）；硬换行 `Event::HardBreak`、软换行 `Event::SoftBreak`；`into_offset_iter()` 提供源码区间。BOM：解析器不处理（查证未确证项，spike 实证），读入后自行剥离。CommonMark 将 LF/CR/CRLF 等价为行尾。备选 comrak（AST、670/670 GFM、BOM 自剥）被否：多遍树操作场景才需要，单遍导入映射下 arena＋RefCell 是额外成本，依赖更宽。
- **依赖现状**：Cargo.lock 无任何 markdown 库——本 change 真新增依赖（与 docx-rs 复用情形不同）。

## Goals / Non-Goals

**Goals:**

- 用户能把真实世界的 `.md` 文件（含自家导出、Obsidian 等纯文本写作工具产物）导入当前作品，标题/列表/粗斜删除/链接/下划线完整保留。
- 「md 导出 → 导入」往返：除导出侧四项已知降级（颜色/字体/字号/高亮）外无损——本 change 的核心验收锚点。
- 一个入口、一条路径：入口与命令泛化为「文档导入」，为 ⑤ Final Draft 复用同一管线。
- 降级如实告知、拆分用户拍板、内容逐字、只建新文档——四条铁律全部沿用。

**Non-Goals:**

- 不做 Final Draft（批次 ⑤）；不做非 UTF-8 编码猜测或转换（中文报错建议转存）；不做 frontmatter 元数据导入（剥离＋告知）；不做 Markdown 渲染/预览。
- 不改导出侧任何行为。

## Decisions

### D1. 解析器：pulldown-cmark 事件流

单遍解析直接映射到自家语法，事件流即目标形态（无中间树、CowStr 零拷贝借用原文、source map 利于报错）。`<u>` 配对用小型状态机：遇 `InlineHtml("<u>")` 开 underline 区间、`InlineHtml("</u>")` 闭合；未配对的闭合/开启按 html_stripped 降级，文字不丢。选项启用 TABLES＋STRIKETHROUGH＋TASKLISTS＋FOOTNOTES。Spike（任务 1.1）以真实文件实证 BOM、`<u>` 事件形态与表格/脚注事件后再全量开发。

### D2. 命令泛化：`import_document_preview` / `import_document_commit`

按扩展名自动分发（`.docx`→既有管线，`.md`→新分支；`.docx` 额外校验 ZIP 结构不变）。**否决平行命令对**：⑤ FD 会造成三对重复命令，违反「一个概念一个名字」。改名触及自家前端封装（内部 API，无外部消费者）；`hash_mismatch:` 协议、事务落盘、失败无残留语义不变。lib.rs 注册与前端 project-api 封装同步改名，契约测试随迁。

### D3. md → 现有语法映射表

| Markdown | 映射 | 损耗 kind |
|---|---|---|
| ATX 标题 `#`~`######` | heading 1-6 | — |
| 段落 | paragraph | — |
| `**` / `*` / `~~` | bold / italic / strike | — |
| `<u>…</u>` | underline mark | 未配对→html_stripped |
| `[文字](地址)` | link mark | — |
| 无序/有序列表（嵌套、start） | bulletList / orderedList(start) | — |
| 行内代码 `` `x` `` | 纯文字 | code_degraded |
| 代码块 | 逐行拍平为段落 | code_degraded |
| 引用块 `>` | 普通段落 | quote_degraded |
| 表格 | 逐格拍平（同 docx 策略） | table_flattened |
| 图片 `![]()` | 丢弃＋计数 | image_dropped |
| 脚注引用/定义 | 引用字面保留、定义丢弃 | footnote_dropped |
| 任务列表 `- [x]` | bulletList＋勾选框字面保留 | tasklist_degraded |
| 分隔线 `---` | 丢弃 | hr_dropped |
| 其他 HTML 标签 | 剥标签保文字 | html_stripped |
| 转义 `\*` | 还原字面字符 | — |
| 硬换行（尾两空格/反斜杠） | 拆为相邻段落（同 docx `w:br` 策略） | — |
| 软换行 | **CJK 接合规则**：两侧均 CJK 则直接连接、否则插入空格 | —（规则，非损耗） |
| YAML frontmatter（文件头 `---`…`---`） | 剥离不入正文 | frontmatter_dropped |

软换行接合说明：CommonMark 软换行的渲染语义即空格；中文排版习惯 CJK 间无空格，故按邻接字符类型决定——这是格式规则的一部分，不构成「改写文字」，在规格中明示。

### D4. 拆分建议：重复标题序列

同款「机器识别、默认不拆、用户拍板」UX，识别对象换为**标题**：同层级（如全部 `##`）、标题文本为短序列（第X章/第X集/Chapter N 类，中文数字规则与 docx 版一致）、全文重复 ≥3。md 的标题是真结构（非猜测），识别可靠性高于 docx 的全加粗启发式。

### D5. 编码与上限

仅 UTF-8：读入字节后剥 `EF BB BF`，再做严格 UTF-8 校验；失败以中文报错并建议用编辑器转存 UTF-8（不猜 GBK 等）。输入上限 16MB（纯文本，约千万字级，宽松于 docx 的 64MB 因为无解压膨胀问题）；无 zip 防护需求。

## Risks / Trade-offs

- [pulldown-cmark BOM 行为未确证（查证唯一存疑点）] → 任务 1.1 spike 实证；无论内部行为如何，读入侧自行剥离兜底。
- [`<u>` 配对状态机边界（嵌套、跨块、未闭合）] → 只做平坦配对；异常一律 html_stripped 降级保文字，单测覆盖正反例。
- [命令改名引发回归] → 契约测试同步改名＋Rust/前端全量测试＋真机冒烟（账本 21 条）；改名触及 lib.rs 注册面，真机必须重验。
- [软换行接合插入空格被理解为改字] → 规则写进规格与预检说明（md 导入说明文案提示「换行按文字接合处理」）；自家导出无软换行，往返不受影响。
- [md 方言差异（setext 标题、列表松紧、GFM 扩展）] → 以 pulldown-cmark 的 CommonMark＋GFM 行为为准；实测样本驱动，不另造方言。

## Migration Plan

命令改名是内部 API 变更，前端同仓同步；无数据迁移。回滚＝入口文案还原＋命令名还原＋移除 md 分支；已导入文档是普通文档不受影响。

## Open Questions

- frontmatter 是否在某天需要作为「作品信息」结构化导入：v1 剥离＋告知，真实需求出现再立项。
- 脚注引用字面保留（`[^1]` 原样文字）vs 清除：倾向字面保留（不擅动文字），apply 时以真实样本观感复核。

## Spike 补记（2026-10-02，apply 阶段任务 1.1 结论）

pulldown-cmark 0.13 已入依赖（Cargo.toml，选项 TABLES＋STRIKETHROUGH＋TASKLISTS＋FOOTNOTES）；spike 工具保留于 `src-tauri/examples/md_parse_spike.rs`。四点全部实证：

1. **BOM**：解析器不剥离——U+FEFF 进入首个 `Text` 事件字面（Debug 显式 `\u{feff}`）→ 读入侧自行剥离的兜底（D5）正确且必要。
2. **`<u>`**：逐标签 `InlineHtml` 事件（`<u>` → 文本 → `</u>`），配对状态机方案成立；同段 Strong／Emphasis／Strikethrough 容器齐全。
3. **表格／脚注／任务列表**：表格＝`Start(Table([...]))`＋TableHead／TableCell／TableRow；脚注＝段内 `FootnoteReference(id)` ＋块级 `FootnoteDefinition(id)`；TaskListMarker(bool) 依 lib-3 文档结论（本轮控制台截断未见原样输出），由实现单测覆盖。
4. **换行**：行尾两空格＝`HardBreak`、普通换行＝`SoftBreak`，区分清晰。

金样本（自家导出 `直接invoke-work.md`，104 事件）额外确认：`Start(Link{dest_url})` 携带目标地址可完整恢复链接；`List(Some(3))` 保留有序起始编号；导出侧转义由解析器自动还原为字面 `Text`（含转义反引号产生纯文本而非 Code 事件）——**往返近无损路径全部畅通**。
