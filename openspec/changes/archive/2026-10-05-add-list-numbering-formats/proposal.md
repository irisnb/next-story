## Why

事项 11 第 3 步（② 编号格式丢失；audit F09，同域 F06/F08）。归档验收实证：样本 `numId 11` 为 `upperLetter`（Word 侧 `lvlText` `%1.`），冻结预期渲染 `A./B./C.`，实测全按十进制渲染且预检无告知（D-3，静默失真）；审计另有 F06（`lvlOverride/lvl` 整层忽略，可静默输出错误起点/类型，P1）与 F08（深层起点取 L0、`lvlRestart` 未存，P2）。用户拍板走**大修**：编辑器原生支持字母/罗马编号（本次单列 change），而非仅"如实告知降级"。

两路侦察结论：Tiptap 3.31 的 OrderedList **原生支持 `type` 属性**（`1`/`A`/`a`/`I`/`i`）与 `ol[type]` 渲染，无需自造节点视图；官方 DOCX 导入/导出不搬运 `numFmt`，映射层须自研（本次补齐）。Markdown 规范（CommonMark/GFM）只支持数字标记，字母/罗马导出必降级（用户已确认口径：降级数字＋缩进保层级＋如实告知）。

## What Changes

- **编辑器与存储（编号样式能力）**：有序列表携带编号样式（`1`/`A`/`a`/`I`/`i`），渲染、保存、重开、拆分、粘贴均保留；工具栏有序列表按钮旁新增**紧邻子菜单**（PS 风格）用于创建/切换样式；文档格式版本升至 **3**（`orderedList.attrs` 可另含可选样式键；v1/v2 为 v3 子集，可读、保存写 v3、拒绝 >3）。
- **Word 导入（F09/F06）**：`numFmt` 五值映射（`decimal`→数字、`upperLetter`→大写字母、`lowerLetter`→小写字母、`upperRoman`→大写罗马、`lowerRoman`→小写罗马）；`bullet`→无序、`none`→无编号；其余格式（中文数字、序数词、`decimalZero`、自定义模板等）与不符合 `%N.` 简单模板者 → 十进制＋**新增损耗类别**（计数＋详情）如实告知；`lvlOverride.lvl` 按**整套替换**生效（起点优先链 `startOverride` ＞ 覆盖层 `lvl` 起点 ＞ 抽象定义起点，样式同链）。F08：嵌套维持既有降级＋告知，补回归测试钉住"深层不产生貌似正确的编号"；完整多级语义随 D-2 方向。
- **导出**：Word 字面前缀按样式生成（`A.`/`a.`/`I.`/`i.`/数字）；Markdown 字母/罗马降级为数字（缩进保层级）＋导出结果如实告知；PDF 透传 `ol[type]`（并保证样式表不覆盖）。
- **行为边界**：不引入"层级→样式"自动规则；不支持自定义编号文本；Markdown 不保字形（规范限制）。
- **验证目标**：D-3 翻转（样本 `numId11` → `A./B./C.`；P09=A.、P11=B.、P15=C.、P14=4. 不回卷）；①②③④⑤ 既有成果零回归；真机验收（原生对话框需用户手选）；导出三格式回归；`npm run check` 与 CI 双平台绿。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `structured-notebook-storage`：文档格式版本 v3——`orderedList.attrs` 可另含可选编号样式键；打开接受 1/2/3，保存写 3，拒绝 >3。
- `nested-lists`：有序列表编号样式（值域、每层独立、工具栏子菜单切换、拆分/渲染保留；样式表不得覆盖 `ol[type]`）。
- `controlled-rich-text-paste`：外部粘贴保留 `ol[type]`／行内 `list-style-type` 映射的编号样式。
- `project-word-import`：`numFmt` 映射与格式降级告知；`lvlOverride.lvl` 整套替换优先链。
- `project-word-export`：导出字面前缀按编号样式生成。
- `project-markdown-export`：字母/罗马降级为数字并如实告知。
- `project-pdf-export`：编号样式随编辑器渲染透传、跨页不重编号。

## Impact

- 前端：`src/list-numbering.ts`、`src/editor-extensions.ts`、`src/rich-text-editor.ts`、`src/editor-toolbar.ts`、`src/format-commands.ts`、`src/dom.ts`、`src/structured-notebook.ts`、`src/controlled-paste.ts`、`src/shared-document-models.ts`、`src/styles.css`、`src/print.css`／`src/print-page.ts`。
- Rust：`src-tauri/src/project/docx_import.rs`（numFmt／lvlOverride）、`notebook.rs`（v3 校验）、`document_import.rs`（新损耗类别输出）、`docx_export.rs`／`markdown_export.rs`／`export.rs`。
- 规格增量 7 个能力；前端与 Rust 测试同步。
- 真机验收：D-3 翻转＋导出三格式＋保存重开（原生对话框需用户手选）。
- 依赖核对：安装版 `@tiptap/extension-list@3.31.3` 是否含 `type` 属性（研究基于 3.31.4 源码）——不含则升级含该属性的补丁版或最小自加属性。
- 不涉及：多级编号（D-2，长期账本）、自定义编号文本、Markdown 保字形。
