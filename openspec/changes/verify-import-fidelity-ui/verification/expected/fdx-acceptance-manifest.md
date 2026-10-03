# FDX 复杂导入验收：独立冻结清单（fdx-acceptance-manifest.md）

> fix-import-fidelity 任务 6.2 / 执行计划 Task 1 之 FDX 项。本清单在**第一次真实 UI 导入之前**冻结：输入哈希、独立期望序列、结构锚、预期损耗与不确定项。期望只由源 XML 与已归档 `openspec/specs/project-fdx-import/spec.md` 推导；**未读取、未调用** Rust 导入器或其任何输出来计算期望。仓库冻结测试（`src-tauri/tests/fdx_import_test.rs::storyboarder_fixture_full_import_verbatim`）仅作事后非独立对照，一致性已在 JSON `cross_checks_non_independent` 记录。

## 1. 文件与哈希

| 文件 | 角色 | SHA-256 |
|---|---|---|
| `D:\Next Story\src-tauri\tests\fixtures\fdx\storyboarder-test.fdx` | 唯一输入，只读（167,716 字节；wonderunit/storyboarder MIT，字节原样入库） | `C0E22DDA570607D57D4686B0A718BD17E67333CBD9D5D5B26A3E0795459005D5` |
| `C:\Users\Administrator\AppData\Local\Temp\opencode\fdx-acceptance-source-manifest.py` | 独立期望生成器（Python 3.11 纯标准库） | `CCAE6C98DCE4C2635B5D43EDE67E781F44EBC2B31554F44E44D5F9A9410FCD9D` |
| `C:\Users\Administrator\AppData\Local\Temp\opencode\fdx-acceptance-expected.json` | 冻结期望（216,021 字节，UTF-8） | `B81B6705C62BDDABDCB5E50B5C843E6322BDF3D0A5F4A317E4A22CF007B5E265` |
| 期望文本数组·完整序列 487 条 | SHA-256(UTF-8(以单个 `\n` 连接的数组)) | `3EB0A3FE12193BCA8BAF6D3B795C1734ED5107385553A14B96E3580DED5CBBE5` |
| 期望文本数组·正文子序列 478 条 | 同上定义 | `01DB42D9B5F10FC0BA8A99E22680385E7A08E6C54A9D6B51941754B95667B107` |

- 输入哈希为本次实测（PowerShell `Get-FileHash`），与编排指令给出的哈希一致；脚本运行时亦强制校验，不符即中止。脚本只读源文件，多次运行后源哈希复验不变。
- 复现：`python fdx-acceptance-source-manifest.py`（在 opencode 临时目录下执行；重写同目录 JSON 并打印汇总）。确定性已验证：连续两次运行 JSON 哈希逐字节一致（`B81B6705…`）；无时间戳、无随机、无 locale 依赖。
- 脚本内置 40 余条硬断言（数量、类型分布、双栏位置、空白特例、锚点文本、ElementSettings 换算、A/B 分歧唯一性等），任一不符即 `FATAL` 退出，不产出半成品 JSON。

## 2. 独立验证的源事实（XML 直接实测）

- 根元素 `FinalDraft DocumentType="Script" Template="No" Version="3"`；28 个根级子元素全部为机器家具（ElementSettings×9、Content、TitlePage、Revisions 等）。
- **主 Content 直接子段恰 475 个**，全部带 Type：Action 190／Scene Heading 30／Character 119／Dialogue 120／Parenthetical 8／Transition 4／General 2／Cast List 1／Shot 1。
- 段落普查：全文件 Paragraph 共 674；**主 Content 之外及之内嵌套共 199**（=标题页 75＋Summary 76＋ScriptNote 34＋DualDialogue 4＋未锚定剧注 4＋页眉脚 4＋水印 1＋ListItem 1＋……按上下文明细见 JSON）；**主 Content 之内嵌套 114**（=DualDialogue 4＋Summary 76＋ScriptNote 34）。
- 双栏对白：唯一包裹段在 **C:276**（0 基，Type=General，无直接 Text），子元素为 ScriptNote(Polish)＋DualDialogue[Character MARY→Dialogue "But Daddy--"→Character LOUIS→Dialogue "I said get!"]。
- 标题页：TitlePage/Content 75 段（**非空 9**：FARMLAND／by／Jeffrey Stoltzfus／Inspired by a true event／Address／Phone Number／Email address／引文／-- Virginia Woolf；**空段 66**），另有 HeaderAndFooter 2 段页面家具跳过。9 条对齐：Center×7、Full×2。
- 30 个 Scene Heading 全带 Number（123，随后 2–30）；**C:6 Action 带 Number="123" 属设置段污染，仅 Scene Heading 读 Number，该值不进正文**。
- 空白特例：正文空段 C:22/C:45（保留为空段落）；换行回声形态 C:10（`'\n        Henry\n      '`→"Henry"）；**C:348 行首两空格**（`'  The horse breaks from the field, dragging the plow behind.'`）；C:259 内部双空格（"wobbling  under"，保留）；拼接全部 Text 后与整体 strip 有异的段共 24 个。
- 多 Text 段（样式 run 切分）：C:54（3 段）、C:184（3 段）、C:198（2 段）。
- 损耗来源计数：SceneProperties 30；ScriptNote 14（正文段内锚定 12＋未锚定 2）；Revision 定义 19；行内 RevisionID 非 0 为 **0** 个（全为默认回声 0）。
- ElementSettings（文件自带布局权威，9 类齐全）：Action/General/Scene Heading/Shot/Cast List 均 L1.50 R7.50；Dialogue L2.50 R6.00；Parenthetical L3.00 R5.50（FirstIndent −0.10）；Character L3.50 R7.25；Transition Alignment=Right。

## 3. 空白规则（显式，两套口径）

- **A（主口径，产品已文档化行规则）**：拼接段落全部直接 Text 子元素→按 `\n` 拆行；第 0 行保留行首空白（作者缩进语义）只剥行尾；其余行两侧剥（XML 回声）；纯空白行丢弃；全空段保留一条空串条目。
- **B（简化口径，编排指令表述）**：整段 strip（只剥两端、保留内部空白）。
- **两套分歧恰一处**：C:348 行首两空格（A 保留／B 剥除）。其余 486 条（含 C:10 换行形态）两套逐字一致——已由脚本断言「分歧数=1 且仅 C:348」。主口径取 A；任务 3 对照以 JSON `expected_editor_sequence` 为准。

## 4. 期望编辑器序列（冻结）

- 组成：**完整序列 487 条 = 标题页非空 9 ＋ 正文顶层非包裹段 474 ＋ 双栏拆分 4**；**正文子序列 478 条 = 475 − 1（包裹段）＋ 4（拆分）**。完整序列按已归档 spec「标题页并入正文开头」为对照主序列；478 为编排指令口径，JSON 两套齐备（`expected_editor_sequence` 487／`content_only_view` 478）。
- 位置换算：全序列 pos(C:n)=9+n（n≤275）；双栏子块占 285–288；pos(C:n)=12+n（n≥277）。正文子序列内双栏恰在 **276–279**（与编排指令「idx276 展开 4」一致）。
- 块型分布：heading2 31（Scene Heading 30＋Shot 1）；paragraph 192＋标题页 9；character 121；dialogue 122；parenthetical 8；transition 4。每条含 `src` 回溯索引与 `type_src`。
- 布局期望（ElementSettings 独立换算，基准 Action L1.50/R7.50，英寸×72=pt，右向取基准减类型值）：Dialogue 72pt/108pt；Parenthetical 108pt/144pt；Character 144pt/18pt；Transition 右对齐不带缩进；其余无缩进属性。标题页 9 条保留自带对齐（Center→居中×7、Full→两端对齐×2）。
- 预检数字预测（待任务 3 实测）：段落数 **487**、字数 **19253**（期望块文字字符总和；两条空段计 0）。

## 5. 结构锚（任务 3 抽查落点）

| 全序列 pos | src | 内容 | 说明 |
|---|---|---|---|
| 0 | TP:17 | FARMLAND | 首条＝标题页并入；居中；源 Style=Underline+AllCaps |
| 8 | TP:74 | -- Virginia Woolf | 标题页末条；Italic |
| 9 | C:0 | Fade in: | 正文首条；源 Style=AllCaps，文字原样 |
| 10 | C:1 | 123 EXT. Mast 2 3 farm - nIGHT | 首个场景头＝二级标题带编号前缀 |
| 31／54 | C:22／C:45 | （空串） | 空段落作者间距保留 |
| — | C:10 | Henry | 换行回声形态（两端空白剥除后单行） |
| — | — | (confused) | 括注缩进锚 108pt/144pt |
| — | — | WaLTER | 人物缩进锚 144pt/18pt |
| — | — | Was it like this with me? | 对白缩进锚 72pt/108pt |
| 334 | C:322 | FADE OUT. | 转场右对齐锚 |
| 285–288 | C:276#0–3 | MARY／But Daddy--／LOUIS／I said get! | 双栏拆分先后两组；正文子序列 276–279 |
| 360 | C:348 | （行首两空格）The horse breaks… | 规则 A/B 唯一分歧；保留行首缩进 |
| — | C:259 | wobbling  under | 内部双空格保留（在「Mary attempts to traverse the log…」段内） |
| 486 | C:474 | He can hear Henry screaming, … get inside fast. | 末条 |

另注：`Fade in:` 在 C:0 与 C:26 出现两次；`The horse breaks from the field, dragging the plow behind.` 在 C:344（无缩进）与 C:348（行首两空格）成对出现，是空白口径的天然对照样本。

## 6. 预期损耗（独立推导；预检应逐项给出计数）

| 类别 | 计数 | 依据 |
|---|---|---|
| titlepage_inlined | 1 | 恰 1 个 TitlePage：9 非空行并入开头、66 空段丢、页眉脚 2 段跳过 |
| scene_metadata_dropped | 30 | 30 个 SceneProperties（含 Summary 76 段与 SceneArcBeats 全部 Story Map 数据）不进正文 |
| scriptnote_dropped | 14 | 12 锚定（含 C:276 包裹段内 1 个）＋2 未锚定；其 38 个内嵌段全部不进正文 |
| dual_dialogue_degraded | 1 | 1 组双栏拆先后两组（文字与顺序保留） |
| revision_marks_ignored | 19 | 19 套修订定义忽略；行内非 0 修订标记为 0 个，文字无损 |
| unknown_elements_skipped | 0（预测） | 全文件 80 种元素名均为已知家具/已处理种类，未见白名单外元素 |

**不属损耗的格式规则**：24 个正文段与标题页行的两端空白剥除；C:10 换行回声；30 个场景编号并入标题前缀；标题页 66 空段丢弃；C:276 包裹段自身不产出条目。

**样式 run（编辑器可见 14 处带 Style 的 Text）**：应保留——Bold 2（C:3、C:36）、Underline 2（C:54、C:198）、Italic 4（C:192、C:314、TP:72、TP:74）、Underline（TP:17 FARMLAND，组合样式中的下划线部分）；预期丢弃/不确定——AllCaps 显示语义 5 处＋FARMLAND 组合的 AllCaps 部分（预期按源文字原样导入不升大写，属预测）；显式 Font/Size/Color 共 209 个 Text 全为默认值（Courier Final Draft／12／黑），唯一非默认字体 Arial×1 位于 ListItems 家具（不可见、无感丢弃），无可见字体损耗。

## 7. 已验证 / 预测 / 矛盾 / 不确定

**已验证（本清单独立实测）**：第 2 节全部源事实；第 3 节 A/B 分歧唯一性；第 4 节序列组成与位置换算（脚本断言）；确定性重跑一致。

**预测（推导自源＋spec，待任务 3 真实 UI 验证）**：第 4 节布局换算值与对齐；第 6 节损耗计数与「预检段落数 487／字数 19253」；AllCaps 丢弃行为。

**矛盾（如实记录）**：
1. 前探员称「Content 内嵌套 118」——实测 **114**（DualDialogue 4＋Summary 76＋ScriptNote 34）；全文件嵌套 **199** 与前探员一致。118 无独立成团解释（114＋4 恰为未锚定剧注段数，疑误并入，仅记猜测）。
2. 编排指令「编辑器期望序列 478 条」仅对正文子序列成立；按已归档 spec 标题页须并入正文开头，完整对照序列为 **487**（＝9＋474＋4）。JSON 双套齐备。
3. 编排指令空白规则「只剥两端」与产品已文档化行规则在 **C:348** 一处分歧（行首两空格：文档化规则保留）。主口径取文档化规则 A。

**不确定（不作断言依据）**：Parenthetical FirstIndent=−0.10 悬挂缩进的产品换算值（冻结断言未覆盖）；标题页 Full→两端对齐的编辑器属性具体取值；样式标记在编辑器中的具体 DOM 形态。

## 8. 边界合规

- 本任务只写上述三个临时目录文件；**未写仓库任何文件**，未运行/导入 UI，未修改源 FDX 或既有作品。
- 仓库冻结测试的对照属非独立来源，只用于一致性确认（全部一致：损耗 1/30/14/1/19、首块 FARMLAND、heading2「123 EXT…」、缩进 72/108、108/144、144/18、FADE OUT. 右对齐），不参与期望计算。
