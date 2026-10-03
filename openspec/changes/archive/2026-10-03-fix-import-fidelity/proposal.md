# fix-import-fidelity Proposal

## Why

用户验收质疑触发的独立审计（oracle，2026-10-02，见 `archive/2026-10-02-add-fdx-import/design.md` 交叉验证轮补记）在已归档的 Word/md 导入中发现**四项 P1 保真缺陷**——全部违反「文字逐字／顺序保留」的规格承诺：md 复杂列表会重排文字阅读顺序；docx 符号字符静默消失；docx 样式定义的格式未生效且无告知（design 承诺的 docDefaults 未实现）；docx 编号被普通段落后错误重起。用户拍板排 ⑥ UI 之前修复（2026-10-02）。

## What Changes

- **md 列表保序**：列表项承载不了的续段与多余子列表不再合并进首项／后移——按**原文顺序**就近降级为普通段落，新损耗 `list_overflow_degraded` 计数告知；导入 MUST NOT 改变文字阅读顺序。
- **docx 符号字符**：`w:sym` 不再静默丢弃——常见符号字体（Wingdings／Symbol）字符映射为对应 Unicode 字符（忠实解码源文件的字符引用）；不可靠映射的计数并以新损耗 `symbol_dropped` 告知。
- **docx 样式链生效**：docDefaults 基准＋`basedOn` 继承链解析（字符属性：粗斜下划删除／颜色／字号／字体／高亮；段落属性：对齐／缩进／行距段距），与直接属性合并后映射；仍无法解析的计数并以新损耗 `style_degraded` 告知——兑现 word-import design 的承诺，撤回「docDefaults 等价编辑器默认」的无依据等价。
- **docx 编号续算**：同 `numId` 的编号跨普通段落打断后**继续计数**（Word 语义），更深层级在更浅层级出现时重置，`startOverride` 覆盖被消费；重续的有序列表以当前计数值为 start；不可表达时按既有 `numbering_degraded` 降级告知——不再输出貌似正确的错号。
- **范围外**（审计 P2 项，记档待后续 batch）：md 剥 HTML 标签的属性／实体边角、未闭合 `<u>` 误伤范围、docx rightChars 右侧字符缩进、atLeast 行距语义、样式／布局类损耗清单缺口。

## Capabilities

### New Capabilities

（无——全部为既有能力的修正）

### Modified Capabilities

- `project-markdown-import`: 「Markdown 结构映射保真与降级」需求修改——列表溢出内容改为保序就近降级并计数告知，导入 MUST NOT 重排文字顺序。
- `project-word-import`: 「结构映射保真与降级」需求修改——新增符号字符映射与告知、样式链（docDefaults＋basedOn）解析应用与告知、编号续算（跨打断续算／层级重置／覆盖消费）三项行为要求。

## Impact

- **Rust**：`md_import.rs` 列表溢出逻辑重做为保序降级；`docx_import.rs` 符号映射表／样式链解析／编号计数器三处；`document_import.rs` 损耗计数扩展三项。
- **前端**：损耗标签表 +3（`list_overflow_degraded`／`symbol_dropped`／`style_degraded`，共 22 项）。
- **测试**：每项修复先写**复现测试**（当前错误行为即失败证据）再修；真实样本回归——WPS 金样本逐字复验、python-docx 真实样式／编号样本（MIT 可入库）、md 往返零回归。
- **依赖**：零新增。
