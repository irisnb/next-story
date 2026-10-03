# acceptance-complex.docx 独立预期清单（fix-import-fidelity Task 1）

> 冻结时间：2026-10-03。本文件在仓库之外，供 `openspec/changes/fix-import-fidelity/验收记录.md` 冻结引用。
> **独立性声明**：下述全部预期只来自源文件设计与公开字体编码常识（Wingdings/Symbol 字体编码表），生成与核对过程从未读取 `docx_import.rs` 或任何导入器输出。凡不确定处均如实标注"不确定"，不以导入结果反推正确答案。

## 1. 身份与哈希

| 项 | 值 |
|---|---|
| 路径 | `D:\Next Story\src-tauri\tests\fixtures\docx\acceptance-complex.docx` |
| 大小 | 4,307 字节 |
| SHA-256 | `6ac33826f7ad1f2e24b80fcb58dabd3a88135c491c13291b3e9c7e1abd86dcf8` |
| 生成方式 | Python 3.11 标准库（zipfile＋手写 OOXML），**非 Word/WPS 产物**，无外部依赖 |
| 生成脚本 | `C:\Users\Administrator\AppData\Local\Temp\opencode\generate-acceptance-docx.py`（SHA-256 `4f3f79d3ac04448a7df5d1662be9973d8d4ba520f0ca77d05dca64f5249dea3d`） |
| 确定性 | 固定条目顺序、固定时间戳（2026-10-03）、固定 XML 字符串；二次构建字节一致（脚本内置断言） |
| 哈希双源核对 | Python `hashlib` 与 PowerShell `Get-FileHash` 结果一致 |
| 复现命令 | `python generate-acceptance-docx.py`（生成＋校验）；`python generate-acceptance-docx.py --verify-only`（只读校验） |
| 结构核对结论 | 26 段、43 run、7 个 `w:sym`；无 `w:br`/`w:tab`/`w:tbl`/`w:drawing`/`w:hyperlink`/脚注（脚本负向断言通过） |

## 2. ZIP 条目（顺序即写入顺序）

`[Content_Types].xml`、`_rels/.rels`、`docProps/app.xml`、`docProps/core.xml`、`word/document.xml`、`word/numbering.xml`、`word/styles.xml`、`word/_rels/document.xml.rels`，共 8 条。document 经 rels 指向 styles 与 numbering；Content_Types 声明五个 Override。

## 3. 源级段落／run 全表（26 段，按文档顺序）

| # | 段落 id | pStyle | numPr (numId,ilvl) | run 明细 |
|---|---|---|---|---|
| 1 | P01 | 无（Normal） | 无 | t:"BEGIN marker paragraph A01 plain docDefaults baseline." |
| 2 | P02 | 无 | 无 | t:"Run A02a inherits docDefaults. "＋t:"A02b 中文运行保持原样。" |
| 3 | P03 | AcceptanceBase | 无 | t:"A03 AcceptanceBase expects 12pt color 1F4E79 not bold." |
| 4 | P04 | AcceptanceMid | 无 | t:"A04 AcceptanceMid expects bold italic 12pt color 7030A0." |
| 5 | P05 | AcceptanceLeaf | 无 | t:"A05 AcceptanceLeaf expects bold italic underline 14pt color C00000." |
| 6 | P06 | AcceptanceLeaf | 无 | R1 t:"A06R1 chain "（无 rPr）；R2 t:"A06R2 charstyle "（rStyle=AcceptanceChar）；R3 t:"A06R3 direct"（rStyle=AcceptanceChar＋直接 b＋sz32＋color FFC000） |
| 7 | P07 | 无 | 无 | 15 个 run：t"SYM01 wingdings F0FC then "／sym Wingdings F0FC／t" then wingdings F0FB then "／sym Wingdings F0FB／t" then symbol 006C then "／sym Symbol 006C／t" then symbol F0B7 then "／sym Symbol F0B7／t" then wingdings F0A7 then "／sym Wingdings F0A7／t" then unknown unmappedfont 0047 then "／sym UnmappedFont 0047／t" then unknown bogussymbol 002A then "／sym BogusSymbol 002A／t" SYM01 end" |
| 8 | P08 | AcceptanceMid | (10,0) | t:"C01 first decimal item" |
| 9 | P09 | AcceptanceMid | (11,0) | t:"C02 first alpha interleave item" |
| 10 | P10 | AcceptanceMid | (10,0) | t:"C03 second decimal item" |
| 11 | P11 | AcceptanceMid | (11,0) | t:"C04 second alpha interleave item" |
| 12 | P12 | AcceptanceMid | (10,0) | t:"C05 third decimal item before interruption" |
| 13 | P13 | AcceptanceLeaf | 无 | t:"C06 interruption paragraph without list numbering." |
| 14 | P14 | AcceptanceMid | (10,0) | t:"C07 decimal resumes after interruption" |
| 15 | P15 | AcceptanceMid | (11,0) | t:"C08 alpha resumes after interruption" |
| 16 | P16 | 无 | 无 | t:"MIDDLE marker paragraph M00 for middle inspection." |
| 17 | P17 | AcceptanceMid | (10,0) | t:"C09 parent item five" |
| 18 | P18 | AcceptanceMid | (10,1) | t:"C10 first child under five" |
| 19 | P19 | AcceptanceMid | (10,1) | t:"C11 second child under five" |
| 20 | P20 | AcceptanceMid | (10,2) | t:"C12 grandchild under second child" |
| 21 | P21 | AcceptanceMid | (10,1) | t:"C13 third child after grandchild" |
| 22 | P22 | AcceptanceMid | (10,0) | t:"C14 parent item six" |
| 23 | P23 | AcceptanceMid | (10,1) | t:"C15 first child under six resets" |
| 24 | P24 | AcceptanceMid | (10,0) | t:"C16 last parent item seven" |
| 25 | P25 | AcceptanceLeaf | 无 | t:"Z01 final chain paragraph." |
| 26 | P26 | 无 | 无 | t:"END marker paragraph Z02 with direct bold black."（直接 b＋color 000000） |

开头／中段／结尾检查锚点：P01（BEGIN，第 1 段）、P16（MIDDLE，第 16/26 段）、P26（END，第 26 段）。

## 4. 独立预期完整阅读顺序文本

阅读顺序＝文档顺序（无表格/文本框/脚注，深度优先即线性）。按第 3 节段落顺序逐段拼接 run 文本即可；其中 7 个 sym run 按"主映射代入、未知符号按允许损耗剔除"处理，得每段预期存储文本：

- P01 `BEGIN marker paragraph A01 plain docDefaults baseline.`
- P02 `Run A02a inherits docDefaults. A02b 中文运行保持原样。`
- P03 `A03 AcceptanceBase expects 12pt color 1F4E79 not bold.`
- P04 `A04 AcceptanceMid expects bold italic 12pt color 7030A0.`
- P05 `A05 AcceptanceLeaf expects bold italic underline 14pt color C00000.`
- P06 `A06R1 chain A06R2 charstyle A06R3 direct`
- P07 `SYM01 wingdings F0FC then ✓ then wingdings F0FB then ✗ then symbol 006C then λ then symbol F0B7 then • then wingdings F0A7 then ▪ then unknown unmappedfont 0047 then  then unknown bogussymbol 002A then  SYM01 end`（两个未知符号剔除后各留一个空位，即双空格）
- P08 `C01 first decimal item`
- P09 `C02 first alpha interleave item`
- P10 `C03 second decimal item`
- P11 `C04 second alpha interleave item`
- P12 `C05 third decimal item before interruption`
- P13 `C06 interruption paragraph without list numbering.`
- P14 `C07 decimal resumes after interruption`
- P15 `C08 alpha resumes after interruption`
- P16 `MIDDLE marker paragraph M00 for middle inspection.`
- P17 `C09 parent item five`
- P18 `C10 first child under five`
- P19 `C11 second child under five`
- P20 `C12 grandchild under second child`
- P21 `C13 third child after grandchild`
- P22 `C14 parent item six`
- P23 `C15 first child under six resets`
- P24 `C16 last parent item seven`
- P25 `Z01 final chain paragraph.`
- P26 `END marker paragraph Z02 with direct bold black.`

来源侧统计：26 段、43 run；按主映射代入并剔除未知符号后的存储字符总数 **1,141**（含 1 个 CJK run 的 10 个全角字符；此数为源侧口径，预检"保留 X 字"的计数口径若不同，如实记录差异，不反推）。段落数应保持 26（无 `w:br`，不应触发拆段）。

## 5. 符号映射预期（font／hex → 预期字符）

| 序 | font | w:char | 预期（主） | Unicode | 置信度与歧义 |
|---|---|---|---|---|---|
| 1 | Wingdings | F0FC | ✓ | U+2713 | 高：公开 Wingdings 映射表一致 |
| 2 | Wingdings | F0FB | ✗ | U+2717 | 中高：个别表用 U+2715/U+00D7，如实记录实际映射并核对映射表出处 |
| 3 | Symbol | 006C | λ | U+03BB | 高：Symbol 字体拉丁键位＝希腊字母的标准编码 |
| 4 | Symbol | F0B7 | • | U+2022 | 中：目标码点存在 U+2022/U+2219 两说（F0 前缀即 00B7 的私用区形式，两写法同指一个字形）；按"字形为圆点符号"判定，码点差异如实记录 |
| 5 | Wingdings | F0A7 | ▪ | U+25AA | 中高：个别表用 U+25A0（大小方块之别） |
| 6 | UnmappedFont | 0047 | **未知 → 允许损耗** | — | 虚构字体，无任何公开映射；预期进入损耗告知 |
| 7 | BogusSymbol | 002A | **未知 → 允许损耗** | — | 虚构字体；预期进入损耗告知 |

设计说明：Symbol 字体刻意同时用"裸写法 006C"与"F0 前缀写法 F0B7"两种 hex 形态，覆盖导入器对私用区前缀的归一化处理；二者语义等价（去 F0 前缀后按同字形映射）。

## 6. 样式解析预期

依据 ECMA-376 样式优先级：docDefaults → 段落样式链（根到叶）→ 字符样式 → 直接 rPr（后者逐属性覆盖前者）。

**docDefaults**：字体 ascii/hAnsi/cs＝Calibri、eastAsia＝Microsoft YaHei；颜色 #262626；字号 sz22（11pt）；段落默认 spacing after=120、line=276。

**样式链**：Normal（空）← AcceptanceBase（color 1F4E79、sz24=12pt、spacing after=80）← AcceptanceMid（+b、+i、color 7030A0）← AcceptanceLeaf（color C00000、sz28=14pt、+u=single）。
**字符样式** AcceptanceChar：b=0（关粗体）、color 00B050、sz26=13pt。

| 对象 | 预期解析结果 |
|---|---|
| P01/P02/P16（Normal） | Calibri 11pt，#262626，非粗斜无下划线；P02 R2 的 CJK 字体按 eastAsia＝Microsoft YaHei |
| P03（Base） | 12pt，#1F4E79 |
| P04（Mid） | 12pt（继承 Base），粗＋斜，#7030A0 |
| P05/P13/P25（Leaf） | 14pt，粗＋斜（继承 Mid），下划线，#C00000 |
| P06 R1 | 同 Leaf 全链 |
| P06 R2（字符样式） | **非粗**（b=0 覆盖 Mid 的粗）、13pt、#00B050；斜体与下划线仍来自段落链（字符样式未涉及） |
| P06 R3（字符样式＋直接） | 粗（直接 b 覆盖字符样式的 b=0）、16pt（sz32）、#FFC000；斜体＋下划线仍来自链 |
| P26（Normal＋直接 rPr） | Calibri 11pt，粗，#000000 |

## 7. 编号预期序列

numbering.xml：abstractNum 100→numId 10（L0 decimal "%1."／L1 lowerLetter "%2."／L2 lowerRoman "%3."，均 start=1，无 lvlOverride）；abstractNum 101→numId 11（L0 upperLetter "%1."）。所有编号均经段落直接 numPr（不经样式携带）。

**规则（冻结口径）**：同一 numId 各层计数独立累计；使用层 L 时，该 numId 中比 L 更深的层计数清零（新父项下子层重置，Word/ECMA-376 默认行为，未写 w:restart）；更深层的使用不清零浅层；无 numPr 的中断段不影响任何计数；不同 numId 计数完全独立。

**预期标记序列**（按文档顺序）：

```
P08=1.  P09=A.  P10=2.  P11=B.  P12=3.      ← 双 numId 交错，计数互不干扰
P13=（无编号，中断段）
P14=4.  P15=C.                             ← 中断后续算，不得回到 1./A.
P17=5.  P18=a.  P19=b.  P20=i.  P21=c.    ← 嵌套：入深不断浅层，回 L1 继续 c.
P22=6.  P23=a.  P24=7.                     ← 层级重置：新父项下 L1 重回 a.
```

关键断言：P14 必须是 4.（不是 1.）；P15 必须是 C.（不是 A.）；P21 必须是 c.（不是重置的 a.）；P23 必须是 a.（不是延续的 d.）。

## 8. 损耗类别预期

| 类别 | 预期 |
|---|---|
| 未知符号 | **2 处**（UnmappedFont/0047、BogusSymbol/002A），属允许损耗，但必须出现在预检损耗告知中；损耗标签文案不在本清单冻结范围 |
| 已知符号 | 5 处应映射为字符进入正文，不应计入损耗 |
| 文本 | 26 段全部保留，无段落丢弃/合并/拆分（源无 w:br） |
| 编号 | 交错、续算、重置按第 7 节成立，不应出现"编号降级为普通段落"类损耗 |
| 无计划损耗项 | 源中不存在表格/图片/脚注/修订/超链接，这些类别的损耗计数应为 0 |

## 9. 不确定与未验证（如实冻结，不以导入结果反推）

1. **U+2022/U+2219 之别**：Symbol F0B7 的目标码点两说并存（见第 5 节）；判定口径为"圆点字形成立"，码点差异需核对导入器映射表出处后记录。
2. **Wingdings F0FB、F0A7 的次要映射差异**：个别公开表给出 U+2715/U+00D7、U+25A0；若导入结果落在这些等价集内，需记录其映射表依据，超出等价集才算差异。
3. **嵌套列表标记样式的呈现**：源层标记为 lowerLetter/lowerRoman；编辑器能否保留字母/罗马数字标记样式**不确定**。最低要求：嵌套层级、起始值、续算与重置语义正确；若标记样式退化为十进制等，应能被观察到并如实记录（是否计为损耗按产品规范判定，本清单不预设）。
4. **字体族呈现**：Calibri／Microsoft YaHei 在 Web 编辑器中的实际渲染取决于字体可用性；第 6 节冻结的是源侧解析值，屏幕字体替换本身不判为保真失败。
5. **缩进/间距**：numbering 层缩进（left 720/1440/2160、hanging 360）与 spacing 值不列入冻结预期；文字顺序与编号语义不因缩进处理方式而改变。
6. **szCs/cs 属性**：源无复杂文种文本，复杂文种字号不纳入断言。
7. **预检字数口径**：1,141 为源侧字符数（主映射代入、未知剔除、含 CJK）；预检计数的口径差异如实记录即可。

## 10. 交接说明

- 本清单为 Task 1 的 DOCX 冻结材料；`验收记录.md` 引用时应整节转录或明确指向本文件路径与哈希。
- 生成脚本在仓库外，`src-tauri/tests/fixtures/docx/README.md` 已附结构配方与复现说明（脚本路径、哈希、条目清单）。
- 导入对比（Task 3）时发现与本清单任何不符，按差异记录，不得回改本清单来迎合导入结果；若确属本清单设计错误（如映射表出处错误），须在记录中显式修订并注明理由。
