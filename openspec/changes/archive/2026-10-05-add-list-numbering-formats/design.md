## Context

- 基线：归档 `2026-10-03-verify-import-fidelity-ui` §6.2.6 编号语义实证（D-3＝编号格式丢失、无告知）；`2026-10-03-fix-import-fidelity/验收记录.md` §6.2.6 `:404–418` 为编号冻结条款（**`:375–376` 属符号域，引用更正**）；审计 `audit-docx-normative.md` F06（`:256–282`）、F08（`:284–315`）、F09（`:317–331`）。
- 现行实现锚点（explorer 侦察）：docx 导入 `ordered = num_fmt != "bullet"`（`docx_import.rs:75`）、`numFmt/lvlText` 丢弃（`:70–77`）、输出仅 `start`（`:1120`）、`override_level` 零引用（F06）、深层起点回退 L0（`:487–491`）；前端 `orderedList.attrs{start}` 严格校验（`structured-notebook.ts:440–463`、`notebook.rs:391–424`）；拆分 `list-numbering.ts`；Word 导出字面前缀 `N. `（`docx_export.rs:188–194`）；Markdown 数字＋缩进（`markdown_export.rs:102–105`）；PDF `ol`＋`start`（`print-page.ts:132–152`）。
- 外部依据（librarian）：Tiptap 3.31 OrderedList 原生 `start`＋`type`（`ol[type]` 渲染）；HTML LS §15.3.7 presentational hint——作者样式 `ol{list-style-type}` 会覆盖 `type`；CommonMark/GFM 仅数字标记；Word `numFmt` 与 `numbering.xml` 字段；`lvlOverride.lvl` 整套替换、`startOverride` 优先于 `lvl.start`、`lvlRestart` 语义。
- 用户拍板：创建入口＝工具栏紧邻子菜单（PS 风格）；Markdown＝降级数字＋缩进保层级＋如实告知。

## Goals / Non-Goals

**Goals:**

- 编辑器（前端＋存储）原生支持有序列表编号样式：创建/切换、渲染、保存重开、拆分保留、粘贴保留。
- Word 导入按 `numFmt` 保真映射；不支持格式降级且如实告知；修复 F06（`lvlOverride` 整套替换与优先链）。
- 三种导出格式口径明确（Word 保样式前缀；Markdown 降级＋告知；PDF 保样式）。
- 验收：D-3 翻转、①②③④⑤ 零回归、真机与 CI 收口。

**Non-Goals:**

- 多级嵌套编号语义（D-2，长期账本）；"层级→样式"自动规则。
- 自定义编号文本／中文数字等超出五值的格式（降级＋告知）。
- Markdown 保留字母/罗马字形（规范限制）。
- 本项不含 Word 导出改用 `numbering.xml` 的重构（维持字面前缀策略，仅前缀随样式）。

## Decisions

- **D1 复用 Tiptap 原生 `type` 属性（值 `1`/`A`/`a`/`I`/`i`），渲染走 `ol[type]`；项目样式表 MUST NOT 对 `ol` 设 `list-style-type`**（HTML LS presentational hint 零特异性，会被覆盖；编辑区/打印/导出页均须守）。实施首步核对安装版 3.31.3 是否含该属性（研究基于 3.31.4）；不含则升级至含该属性的补丁版或最小自加属性（记录依据）。替代（自定义 NodeView／自造 CSS 计数器）被否：徒增复杂度，且 Paged.js 对自造计数器有已知缺陷。
- **D2 每层独立。** 每个有序列表节点各自携带样式；父子层样式与 `start` 互不影响。不引入层级→样式推导（属 D-2）。
- **D3 创建/切换入口。** 工具栏有序列表按钮旁**紧邻子菜单**（PS 风格）提供五值；命令只作用于选区触及的完整列表节点、可撤销；拆分时后段同时保留样式与编号（`list-numbering.ts` 逻辑扩展）；粘贴解析 `ol[type]`／行内 `list-style-type`（非法值按数字）。
- **D4 存储 v3。** `orderedList.attrs` 可另含样式键（缺省或 `"1"` 时规范化省略）；外层 `version` 升为 **3**；打开接受 1/2/3（1、2 为 3 的严格子集，正文不改），保存写 3，拒绝 >3。前后端校验/规范化同步（`structured-notebook.ts`＋`notebook.rs`）。替代（不升版本、就地扩展 v2）被否：偏离仓库"grammar 变更即升版本"惯例，且旧版本遇未知字段只会报 schema 错而非清晰的"版本不受支持"。
- **D5 导入映射与优先链。** `numFmt` 五值→样式；`bullet`→无序、`none`→无编号；其余与不合规 `lvlText` → 十进制＋新损耗类别（形态参照既有 `numbering_degraded`/`symbol_dropped`：类别＋计数＋详情）。F06：级别定义＝抽象层叠加 `lvlOverride.lvl`（**整套替换**）；起点优先链 `startOverride` ＞ 覆盖层 `lvl.start` ＞ 抽象起点；样式同链取 `numFmt`。F08：嵌套（`ilvl>0`）维持降级＋告知；补测试钉住"深层不产生貌似正确的编号"；完整 `lvlRestart`/深层起点语义随 D-2。
- **D6 导出。** Word：字面前缀改按样式生成（`A.`/`a.`/`I.`/`i.`/数字；不引入 `numbering.xml`）。Markdown：降级数字＋缩进保层级＋复用导出结果提示位如实告知（不新增对话框）。PDF：`ol[type]` 透传；跨页列表视觉冒烟（Chromium 下原生 `<ol>` 安全）。
- **D7 验收。** 复用 `import-fidelity-acceptance` 方法论（真机＋CDP＋用户手选文件）；D-3 翻转以 §6.2.6 为基线（P09=A.、P11=B.、P15=C.、P14=4. 不回卷）；①②③④⑤ 全序列零回归；导出三格式抽查。

## Risks / Trade-offs

- [安装版 3.31.3 与 3.31.4 属性差异] → 实施首步核对源码；缺则升级补丁版或自加属性（留记录）。
- [样式表 `list-style-type` 覆盖坑] → 规格场景钉住；实施时全仓 CSS 检查。
- [拆分/粘贴遗漏样式导致静默丢失] → 单测覆盖两条路径；真机抽查。
- [版本升级兼容] → 旧安装版打开 v3 文档报"版本不受支持"（清晰失败，不损坏）；如实记录。
- [Paged.js 跨页] → 仅用原生 `<ol>`；跨页列表冒烟。
- [共享文本前缀随样式改变] → `shared-document-models` 的前缀与相关序列化测试同步核对。
