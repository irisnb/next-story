# add-list-numbering-formats 核心（非 UI）实施验证记录

日期：2026-10-05。实施范围：tasks 1.1–5.1 中除 2.2（工具栏子菜单 UI，留后续设计会话）外的全部条目；底层命令与纯查询助手已交付（见下）。未提交 git、未归档。

## 1. 依据与版本核对（任务 1.1 / 1.2 / 1.3）

### 1.1 Tiptap 版本核对结论

**安装版 `@tiptap/extension-list@3.31.3` 已原生含 OrderedList `type` 属性，无需升级、无需自加属性。**源码核对（`node_modules/@tiptap/extension-list/src/ordered-list/ordered-list.ts`）：

- `addAttributes()` 含 `type`（default `null`）；`parseHTML` 依次读取 `ol[type]` → `<ol>` 行内 `list-style-type` → 首个 `<li>` 行内样式（Google Docs 形态），映射 upper/lower-roman、upper/lower-alpha/latin；
- `renderHTML` 在 `type` 非 `"1"` 时输出 `ol[type]`（`start !== 1` 时输出 `start`）——与浏览器 presentational hint 渲染一致；
- 输入规则 `joinPredicate` 只合并缺省样式列表（带样式列表保持独立）。

研究依据（librarian，基于 3.31.4）与安装版 3.31.3 在该属性上无差异。版本零变化。

### 1.2 冻结基线引用

编号条款以归档 `2026-10-03-fix-import-fidelity/验收记录.md` §6.2.6 `:404–418` 为准（`:375–376` 属符号域，引用更正，见 design.md Context）。D-3 预期：样本 `numId 11`（upperLetter）导入渲染 **A./B./C.**；P09=A.、P11=B.、P15=C.、P14=4. 不回卷。真机翻转验证属任务 6.1（未做，见诚实边界）。

### 1.3 CSS 清点与受影响测试

- 全仓 `*.css` 检索 `list-style-type` / `ol {` 覆盖：**零命中**（`src/styles.css`、`src/print.css`、导出页样式均不对 `ol` 设 `list-style-type`，符合规格「样式表 MUST NOT 覆盖」）。
- 受影响测试盘点（均已同步更新或新增）：前端 `structured-notebook` / `rich-text-editor` / `format-commands` / `format-command-behavior` / `controlled-paste` / `shared-document-models` / `selection-serialization` / `export` / `editor` / `editor-persistence`；共享夹具 `tests/fixtures/notebook-samples.json`；Rust `notebook`（经共享夹具）/ `operations`（版本常量断言）/ `project_test`（版本断言 2→3、未来版本 3→4）/ `docx_import` / `export_test` / `markdown_export_test`。

## 2. 实现清单

### 2.1 编辑器与存储（任务 2.1 / 2.3 / 2.4，除子菜单 UI）

- **`src/structured-notebook.ts`**：`NOTEBOOK_VERSION` 升 **3**；`orderedList.attrs` 可另含 `type`（五值域，`"1"` 或缺失必须省略——显式 `"1"` 与非法值拒绝）；`validateNotebookDocument` 接受版本 1/2/3；canonical 序列化保留四值样式、`"1"`/null/非法省略。
- **`src-tauri/src/project/notebook.rs`**：上述校验/版本的 Rust 镜像（前后端同一份共享夹具判定一致）。
- **`tests/fixtures/notebook-samples.json`**：未来版本断言 3→4；新增 7 个样例（v3 空文档、字母样式、嵌套罗马样式、显式 `"1"`、非法值、非字符串值）。
- **`src/shared-document-models.ts`**：`letterMarker`（双射二十六进制 1→A、27→AA）、`romanMarker`（标准减法式，>3999 与浏览器 `ol[type=I]` 一致重复 M）、`orderedListMarker` 分派；列表文本前缀按样式生成（`A. ` / `iv. ` 等）；块记录的列表上下文增补 `style` 与列表节点范围（`listStart`/`listEnd`）。`SharedDocumentNode.attrs` 放宽为 `unknown`（列表按 `{start,type}` 收窄读取）。
- **`src/list-numbering.ts`**：新增 `setOrderedListStyleInSelection`（底层命令：按选区触及的**列表项自身段落**定位其**直接所属**的完整 `orderedList` 节点，逐列表 `setNodeMarkup` 进同一事务——可整体撤销；`"1"` 写回 `null`；选区位于嵌套子列表内只改该子列表、父项被触及不牵动其内子列表——见 §5 修订记录）。
- **`src/format-commands.ts`**：新增命令种类 `{ kind: "orderedListStyle"; style }` 与纯查询 `orderedListStyleState`（null／统一值／"mixed"，与命令同一「按触及列表项直接所属层」判定口径，见 §5 修订记录）。
- **`src/rich-text-editor.ts`**：`runCommand` 接线 `orderedListStyle`（经 `setOrderedListStyleInSelection`）。**未触碰 `editor-toolbar.ts` 与 `dom.ts`。**
- **`src/controlled-paste.ts`**：新增 `orderedListType`（`ol[type]` → `<ol>` 行内样式 → 首 `<li>` 行内样式，非法/无法识别按 `"1"`；与 Tiptap 解析口径一致）；`ParsedNode.orderedList` 携带 `listType`，`nodesToDocument` 非十进制写入 `attrs.type`。粘贴完整性比较与拒绝规则不变。
- 拆分保留：抬出中段的尾段列表经 ProseMirror lift 保留原 attrs（含 `type`），`fixSplitOrderedListStart` 展开尾段 attrs 仅改 `start`——样式天然保留（测试钉住）。
- 渲染：复用 Tiptap 原生 `ol[type]`（presentational hint），项目零新增 CSS。

### 2.2 Word 导入（任务 3.1 / 3.2 / 3.3 / 3.4）

- **`src-tauri/src/project/docx_import.rs`**：
  - numFmt 五值映射（`decimal`→`"1"`、`upperLetter`→`"A"`、`lowerLetter`→`"a"`、`upperRoman`→`"I"`、`lowerRoman`→`"i"`）；`bullet`→无序、`none`→无编号（既有行为）；
  - 其余 numFmt（ordinal/decimalZero/chineseCounting/cardinalText…）与**非 `%N.` 简单模板**的 lvlText（`%1)`、`第%1章`、`%1.%2.` 等）→ 十进制导入＋`numbering_format_degraded`（计数＋去重详情，形态参照既有 `numbering_degraded`/`symbol_dropped`）；
  - **F06**：`lvlOverride.lvl` **整套替换**抽象层对应级别（起点与格式均取覆盖值；docx-rs `override_level` 字段开始消费）；起点优先链 `startOverride` ＞ 覆盖层 `lvl.start` ＞ 抽象定义起点；计数器层级查找由「恒取第 0 层」修正为按 ilvl 取生效层定义；
  - **F08**：`ilvl>0` 维持降级普通段落＋`numbering_degraded` 告知；补回归测试钉住「深层定义绝不产出貌似正确的列表」；`lvlRestart`/完整多级语义留 D-2（未实现，如实）；
  - 列表归组元组扩为 `(numId, ordered, start, style)`，`flush_list` 输出 `attrs.type`（`"1"` 省略）。
- **`src-tauri/src/project/document_import.rs`**：`LossCounter` 新增 `numbering_format_degraded`＋详情清单，`into_losses` 输出中文告知。
- **前端预检呈现链路核对**：`src/project-api.ts` kind 联合与 `src/document-import.ts` `IMPORT_LOSS_LABELS`（`Record` 全量映射，TypeScript 强制完备）均已补 `numbering_format_degraded: "编号格式降级为数字"`，预检明细完整呈现。

### 2.3 导出（任务 4.1 / 4.2 / 4.3 / 4.4）

- **Word（`docx_export.rs`）**：有序前缀按样式生成——`letter_marker`（双射进位 AA/BA）、`roman_marker`（标准减法式 MCMLIV）、`ordered_prefix`；顶层与嵌套均生效，嵌套缩进策略不变；缺省样式保持 `N. `。
- **Markdown（`markdown_export.rs` + `export.rs` + 前端 `src/export.ts`）**：字母/罗马降级为从 `start` 起的数字、嵌套 4 空格缩进保持（既有行为核对成立）；`export_project_to_markdown` 检测带样式列表（`has_styled_ordered_lists`，顶层与嵌套）时在结果 `message` 如实告知；前端成功提示复用既有结果提示位追加 message（不新增对话框）。
- **PDF（`export.rs` + `print-page.ts`）**：投影 `ExportBlock::OrderedList` 新增 `listType`（serde camelCase）；`print-page.ts` 透传输出 `ol[type]`（`"1"`/null 不输出）；跨页编号由浏览器原生 `<ol>` 保持（Chromium 下安全，规格场景由样式表不覆盖保证）。CSS 清点确认无覆盖（见 1.3）。

## 3. 测试与验证

### 3.1 新增测试清单

- 前端：
  - `structured-notebook.test.ts`：serializer 保留非十进制样式／`"1"`·null·非法省略／v3 往返（另共享夹具 +7 样例）；
  - `rich-text-editor.test.ts`：带样式（含嵌套）schema 往返用例＋`orderedList` 节点 `type` 属性断言（Tiptap 原生核对）；
  - `format-command-behavior.test.ts`：带样式拆分首尾段均保留 `type`（start 修正为实际编号）／`setOrderedListStyleInSelection` 只作用触及列表、未触及不变、`"1"` 写 null、未触及/同样式零步骤幂等、嵌套内只改当前层（父层不变）、父项触及不牵动子列表、跨层选区各按直接所属层处理＋整事务一次撤销还原（见 §5）；
  - `format-commands.test.ts`：`orderedListStyleState` 无触及 null／统一值／跨列表 mixed／嵌套独立（子列表内查询只报子列表样式，跨层 mixed，见 §5）；
  - `controlled-paste.test.ts`：`orderedListType` 的 type 属性五值与非法回退／行内 `list-style-type` 与首个 `<li>` 回退／`nodesToDocument` 样式写入与缺省省略；
  - `shared-document-models.test.ts`：字母/罗马前缀生成、嵌套独立、`letterMarker`（1/26/27/52/53）、`romanMarker`（1/4/9/14/1954/2026/3999/4000 重复 M）、`orderedListMarker` 分派；
  - `selection-serialization.test.ts`：完整列表项投影带样式标记（`C. 甲项`／`iv. 丙项`）；
  - `export.test.ts`：导出成功提示附带后端降级告知。
- Rust：
  - `docx_import.rs`（+8）：numFmt 五值逐值映射（缺省省略 type、零降级）／不可映射四格式降级计数与详情／非简单 lvlText 三形态降级／预检 `ImportLoss` 呈现／F06 覆盖层起点整套替换／覆盖层样式替换／startOverride 优先于覆盖层起点／F08 深层永不产出列表；
  - `export_test.rs`（+2）：前缀按样式（A./B.、i./ii./iii.、AA./BA.、MCMLIV.、缺省数字）／嵌套样式前缀＋缩进策略不变；
  - `markdown_export_test.rs`（+2）：带样式列表降级数字＋缩进（渲染级逐字断言）／命令级 message 告知（有样式→告知；无样式→无告知）。
- 既有断言波及更新（版本 2→3、未来版本 3→4）：`editor.test.ts`、`editor-persistence.test.ts`、`operations.rs` 测试、`project_test.rs`、共享夹具「unsupported future version」。

### 3.2 `npm run check` 结果（任务 5.1）

**退出码 0，全绿**（2026-10-05，Windows）：

- `typecheck` ✓、`lint` ✓；
- `test:frontend`：**1210 通过 / 0 失败**（含全部新增与波及更新）；
- `test:reliability` / `test:driver` / `test:validation` ✓（随 check 通过）；
- `build` ✓；
- `fmt:rust` ✓（已按 rustfmt 整理）、`clippy:rust` ✓（`-D warnings` 零告警）；
- `test:rust` 全部套件通过：lib **429**（docx_import 53，含 +8 新增）、`export_test` **21**（+2）、`markdown_export_test` **18**（+2）、`project_test` **33**、`import_fidelity_test` **4**（acceptance-complex 基线不变：numbering_degraded×5＋symbol_dropped×2，无新增静默损耗）、其余套件全过。

既有测试零回退；计数增加均来自上述新增测试（如实记录，未逐项比对改动前基线总数）。

## 4. 诚实边界

- **任务 2.2（工具栏紧邻子菜单 UI）未实施**——留给后续设计会话；本次已交付其底层命令（`FormatCommand.orderedListStyle` → `setOrderedListStyleInSelection`，可撤销）与纯查询助手（`orderedListStyleState`），未触碰 `editor-toolbar.ts` / `dom.ts`。
- **任务 6.x 未做**：真机验收（D-3 翻转 A./B./C.、P14=4.、①③④⑤ 零回归、导出三格式抽查、保存重开）、验收记录、提交推送与 CI、归档——均待后续。`npm run check` 与单测全绿**不等价于**真机冒烟（项目宪法门槛）。
- Word 导出维持**字面前缀**策略（未引入 numbering.xml 重构，proposal Non-Goal）；多级编号语义（lvlRestart、深层起点渲染）留 D-2 方向。
- 罗马数字 >3999 采用与浏览器 `ol[type=I]` 一致的重复 M 形态（前后端与导出三处一致）；不引入上划线扩展。
- 旧版本安装包打开 v3 文档将报「文档版本不受支持」（清晰失败，不损坏）——按 design 风险条目如实记录。
- 未提交 git、未归档；工作区含本 change 全部改动（`git status` 见实施报告）。

## 5. 修订记录：样式命令与查询作用范围收窄（2026-10-05 第二轮）

**规格依据**：`specs/nested-lists/spec.md` 命令条款修订为「按选区触及的列表项生效——只完整设置这些列表项**直接所属**的有序列表，父层 MUST NOT 因选区位于其嵌套子列表而改变、子层 MUST NOT 因父项被触及而改变」，并新增场景「嵌套内切换只影响当前层」。

**收窄前问题**：第一版 `setOrderedListStyleInSelection` 与 `orderedListStyleState` 以「列表节点范围与选区相交」判定——光标落在嵌套子列表内时父层与子层被同时改样式/同时计入查询，与「每层独立」不符。

**收窄后口径**（命令与查询同一判定）：

- 「触及的列表项」＝该列表项**自身段落**范围与选区 `[from, to)` 相交（列表项首子节点段落；其嵌套子列表范围不计入父项的触及范围——两条 MUST NOT 由此自然成立）；
- 每个被触及的列表项 → 其**直接所属**的完整有序列表被设置样式（实现：`doc.descendants` 遍历 listItem、按 parent 判定直接所属层、`resolve(pos).before(depth)` 定位列表节点后 `setNodeMarkup`；查询侧直接以共享块记录的段落范围判定，天然同口径）；
- 典型行为：光标在嵌套子列表内 → 只改该子列表；只选父项文字 → 只改父列表（其内子列表不动）；选区跨父项文字与子列表 → 两层各自的直接所属列表分别被设置（查询为 mixed）；未触及列表不动；
- `"1"` 写回 `null`、整事务可撤销（同一事务承载全部步骤）等语义不变。

**测试变化**：

- `format-command-behavior.test.ts`：改写嵌套用例——「嵌套内只改当前层（父层保持缺省）」新增「父项触及不牵动其内子列表」「跨层选区各按直接所属层处理＋整事务一次撤销整体还原」；修正一处旧选区位置（[6,7] 实不落在「乙」文字上，旧口径按范围相交侥幸通过，改为真实文字位置 [8,9]）；未触及不动/同值幂等/`"1"` 写 null 用例保持通过。
- `format-commands.test.ts`：嵌套用例改为——子列表内查询只报子列表样式（`"i"`）、父项文字查询只报父层、跨层选区 mixed；无触及 null／统一值用例不变。

**验证**：`npm run check` 复跑全绿（退出码 0；前端 1210 过/0 败，Rust 各套件与第一轮相同计数，本轮仅改前端两文件及其测试）。边界不变：未提交 git、未归档、未触碰 `editor-toolbar.ts` 与 `dom.ts`。
