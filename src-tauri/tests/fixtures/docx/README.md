# docx 导入测试样本（fix-import-fidelity）

三份真实 Word 生成样本（Microsoft Word 保存的 OOXML），作为样式链／编号
保真修复（fix-import-fidelity）的端到端测试夹具。取自 python-docx 仓库
（[python-openxml/python-docx](https://github.com/python-openxml/python-docx)，
MIT 许可）的 `features/steps/test_files/` 目录，字节原样入库。

| 文件 | 内容 | 用途 |
|---|---|---|
| `num-having-numbering-part.docx` | 单段落挂 `ListNumber` 段落样式（编号经样式 pPr numPr→numId 6→abstract 8 携带，非直接 numPr） | 样式链携带编号（D3+D4 联合路径）端到端 |
| `sty-having-styles-part.docx` | 正文为空、styles.xml 含完整样式定义（含 docDefaults） | styles.xml 解析健壮性（不崩溃） |
| `par-known-styles.docx` | 五段文本挂不同 pStyle（无样式／缺失样式／Heading1／BodyText 等） | 样式链格式生效（docDefaults 基准＋样式属性合并）端到端 |

## acceptance-complex.docx 构建配方（复杂保真验收样本）

**非真实 Word 生成**：本文件由 Python 3 标准库（zipfile＋手写 OOXML）确定性构建，无外部依赖、无 Word/WPS 参与。生成脚本随夹具入库：`generate-acceptance-docx.py`（同目录；SHA-256 `4f3f79d3ac04448a7df5d1662be9973d8d4ba520f0ca77d05dca64f5249dea3d`）。

- **复现**：`python generate-acceptance-docx.py`（生成＋自校验），或 `--verify-only` 只读校验。固定 zip 条目顺序与时间戳（2026-10-03），同机重建字节一致。
- **SHA-256**：`6ac33826f7ad1f2e24b80fcb58dabd3a88135c491c13291b3e9c7e1abd86dcf8`（4,307 字节，Python 与 PowerShell 双源核对一致）。
- **ZIP 条目（8 个，按写入顺序）**：`[Content_Types].xml`、`_rels/.rels`、`docProps/app.xml`、`docProps/core.xml`、`word/document.xml`、`word/numbering.xml`、`word/styles.xml`、`word/_rels/document.xml.rels`。
- **覆盖结构**：26 段／43 run。① `w:sym` 已知 5 处（Wingdings F0FC/F0FB/F0A7、Symbol 006C/F0B7，Symbol 刻意混用裸 hex 与 F0 前缀两种写法）＋未知 2 处（虚构字体 UnmappedFont/0047、BogusSymbol/002A，允许损耗）；② docDefaults（Calibri 11pt #262626、eastAsia Microsoft YaHei）＋ basedOn 段落链 Normal→AcceptanceBase→AcceptanceMid→AcceptanceLeaf（12pt #1F4E79→+粗斜 #7030A0→14pt #C00000+下划线）＋字符样式 AcceptanceChar（b=0、13pt、#00B050）＋直接 rPr 覆盖（P06R3：b/sz32/FFC000；P26：b/000000）；③ 编号：numId 10（decimal/lowerLetter/lowerRoman）与 numId 11（upperLetter）交错、P13 中断后续算（4./C.）、嵌套重置（P22 新父项下 P23 重回 a.）。
- **独立预期清单**（冻结，勿用导入结果反推）：`openspec/changes/verify-import-fidelity-ui/verification/expected/acceptance-docx-manifest.md`，含源级段落/run 全表、预期完整阅读顺序文本（源侧 1,141 字符）、符号映射与置信度、样式解析表、编号标记序列（P08=1. …P24=7.）与损耗类别预期。
- 若需重建等价文件而脚本不可得：按上一条清单的 8 条目结构手写各 XML，段落/run/样式/编号的精确内容均以清单第 3/5/6/7 节为准。
