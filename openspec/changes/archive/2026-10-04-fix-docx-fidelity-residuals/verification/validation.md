# 验证记录：fix-docx-fidelity-residuals（2026-10-04）

## 1. 依据核对（任务 1.1／1.2）

- **公开表核对（1.1）**：`verification/audit-mapping-verification.md`（@librarian 独立取证，Alan Wood Wingdings 表＋Unicode 托管 Adobe Symbol 表）——21＋5 条修正值与审计 F01/F02 清单逐条一致、零差异；对照组合规。实施以该文档为唯一映射依据。
- **验收基线核对（1.2）**：归档 `verify-import-fidelity-ui` §2.2／§5.1 偏差表（D-1～D-5）与 `fix-import-fidelity` 冻结清单 §6.2（:375–376 符号预期、:427 编号预期）。冲突项与裁定：
  - 冻结 :375 `F0FC→U+2713`：公开表为 **U+2714**（F01 记录瑕疵）→ 以公开表为准修代码，**不回改冻结清单**。
  - 冻结 :376 `F0FB→U+2717`：公开表为 **U+1F5F6**（F03）→ 同上。
  - 冻结 :378 `Symbol F0B7→U+2022`：属 Symbol 字体，为**对照组不变**（与本 change 的 Wingdings B7→U+1F550 修正是两个不同字体的同码位，见 §4 出入记录）。
  - D-2／D-3（编号域）不在本 change 范围（后续「编辑器编号格式」change）。

## 2. 测试清点（任务 1.3）

清点仓库中断言旧映射／旧字体／旧间距行为的用例：

| 用例 | 与本 change 的关系 | 处置 |
|---|---|---|
| `docx_import.rs` 内嵌 `repro_symbol_characters_mapped_to_unicode`（原 :2366） | 断言 F0FC→U+2713 旧错误值 | **已更新**为 U+2714（注明 F01 依据） |
| `docx_import.rs` 内嵌 run marks 测试（原 :1818 `fontFamily=="宋体"`） | 中文 run＋仅 eastAsia 键——类别规则下仍取宋体 | 不需改；回归通过验证 |
| `word_import_test.rs` 往返测试 :479–521（docDefaults fontFamily 断言） | 导出侧 `export_run_fonts()` 三键同名（ascii/hiAnsi/eastAsia 均 Source Han Sans CN），类别选键结果恒同 | 不需改；回归通过验证 |
| `docx_import.rs` `paragraph_attrs_mapped_to_editor_units`（:1853 起） | 直接属性全子属性，与样式链合并正交 | 不需改；回归通过验证 |
| acceptance-complex 样本级导入测试 | **tests/ 下不存在既有断言**（任务书 2.4 所述"既有断言"实无；fixtures 目录仅有生成脚本与 README） | **新增** `acceptance_complex_symbol_count_and_mapping` |
| 其余 | 无任何用例断言旧 Symbol 错误值（D6/D7/B2/A1/D1 旧映射）或其余旧 Wingdings 错误值（grep 全仓核对） | 无 |

## 3. 修复内容（任务 2.1／2.1 表／3.1／3.2）

- **2.1 符号表**（`docx_import.rs` `wingdings_char`／`symbol_font_char`）：
  - Wingdings：按公开表修正 21 条（FC→U+2714、FD→U+1F5F7、FE→U+1F5F9、4C→U+2639、A8→U+25FB、B7→U+1F550、CB→U+1F66A、D8→U+2B9A、E8→U+1F87A、E9→U+1F879、EA→U+1F87B、EB→U+1F87C、F2→U+21E9、AB→U+2605、BB→U+1F554、E7→U+1F878、DC→U+2B8A、C7→U+2BB4、28→U+1F57F、3F→U+270D）＋新增 FB→U+1F5F6；对照组 6 条（4A/4B/6E/6F/71/A7）保持。全表 27 条统一 `'\u{...}'` 写法＋Unicode 名称注释，表头注明 Alan Wood 公开表依据；删除"近似/保守"旧注释。
  - Symbol：修正 5 条（D6→U+221A、D7→U+22C5、B2→U+2033、A1→U+03D2、D1→U+2207）；对照组（B1/B4/B8/B9/BB/A3/B3/A5/B0/B7/6C/44/57/6D）保持。表头注明 Adobe Symbol 表依据。
- **3.1 字体选择**（`marks_from_char_map`）：新增 `run_text: &str` 参数（调用点由 `run.children` 的 `w:t` 子项拼接，符号/Tab 不参与判类）；新增 `is_east_asian_char`（区间：CJK 符号标点 3000–303F、平假名 3040–309F、片假名 30A0–30FF、注音 3100–312F、谚文兼容 3130–318F、片假名注音扩展 31F0–31FF、CJK 扩展 A 3400–4DBF、CJK 统一 4E00–9FFF、谚文扩展 A A960–A97F、谚文音节 AC00–D7AF、谚文扩展 B D7B0–D7FF、CJK 兼容 F900–FAFF、全角 FF00–FFEF；后六个黑体区间为任务书基准外的合理扩充，均已注释）。选键：含东亚（或空文本 run）→ `eastAsia→ascii→hiAnsi`（原回退链，混排取东亚、不拆 run——已知取舍不计损耗）；纯拉丁 → `ascii→hiAnsi→eastAsia`。主题键仍不解析。
- **3.2 `overlay_map`**：新增 `lineSpacing` 子属性合并分支（与 `fonts` 并列；`before/after/line/lineRule` 逐子键覆盖；非通用递归）。其余键行为不变。
- 改动面（diff 复核）：`docx_import.rs`（符号表＋字体＋overlay＋调用点＋内嵌测试 4 新 1 更新）、`tests/import_fidelity_test.rs`（新增样本级测试）、change 目录文档；无其他文件。word-diff 筛查无意外语义改动。

## 4. 符号验证数据（任务 2.2／2.3／2.4）

- **2.2 单测** `symbol_tables_match_public_codecharts`：Wingdings 修正 21 条经 `symbol_to_unicode`（含 F0 前缀归一化）逐条断言；对照 6 条＋Symbol 修正 5 条＋对照 14 条直接断言；未知字体（Webdings）、未知码位（Wingdings F040、Symbol F090）、非法十六进制（ZZ）→ `None`（→ `symbol_dropped`，不静默）。**通过**。
- **2.3 符号样本** `symbol_spike_docx_covers_all_corrected_entries`：docx-rs 构造 26 个 `w:sym` run（覆盖全部 21 修正条目＋Symbol 5 条；混用 F0 前缀与裸写法）经完整导入管线逐字符断言、`losses.symbols==0`。**通过**。未重新生成 acceptance-complex.docx（遵任务书）。
- **2.4 样本级** `acceptance_complex_symbol_count_and_mapping`（新增；fixtures 真实文件）：
  - **`symbol_dropped`＝2**（仅 UnmappedFont/0047、BogusSymbol/002A）——**D-1 翻转**（修复前 3）。
  - **总字数＝1,141**（源侧口径）——D-1 同根翻转（修复前 1,140）。
  - P07 段逐 run 断言：F0FC→U+2714、F0FB→U+1F5F6（注明 F01/F03 裁定与证据文档，不改冻结清单）、Symbol 006C→λ、Symbol F0B7→U+2022、Wingdings F0A7→▪；旧值（U+2713/U+2717/U+25CF）不得出现；run 边界形态已按实测固化（符号字符独立成片段——符号 run 空文本走 eastAsia 链与拉丁文本 run 的 fontFamily 不同故不合并；两个丢弃位相邻文本合并、呈现双空格，12 片段）。
  - **任务书出入记录（如实）**：任务书 2.4 原文要求断言"F0B7→U+1F550"，与样本事实矛盾——解包 `document.xml` 实证样本 F0B7 属 **Symbol** 字体（`<w:sym w:font="Symbol" w:char="F0B7"/>`），且任务书自身权威表规定 Symbol B7→U+2022 属"不得改"对照组、U+1F550 是 **Wingdings** B7 的修正值。判定为任务书笔误，按权威表＋样本事实处理：样本断言 U+2022（Wingdings B7→U+1F550 的修正由 2.2/2.3 覆盖）。

## 5. 字体与行距验证（任务 3.3／3.4）

- **3.3 字体单测** `font_selection_by_script_class`：纯拉丁→Calibri（ascii）；纯中文→YaHei（eastAsia）；混排→YaHei（取东亚不拆 run）；纯拉丁缺 ascii 键→回退至 eastAsia；空文本 run（纯符号）→原回退链 eastAsia。**通过**。
- **3.3 行距单测** `style_chain_line_spacing_subproperty_merge`（Style Base line=276 auto＋Mid 仅 after=80）：仅样式链→lineHeight 1.15＋spacingAfter 4pt 同段（F04 修复：继承行距不再丢失）；直接属性另覆盖 before→lineHeight/spacingAfter 继承保留＋spacingBefore 6pt 生效；直接覆盖 line→1.5 优先且 after 保留。**通过**。
- **3.4 WPS 金样本**（`本地测试文档\导入测试样本\导入测试-短剧剧本.docx`）：以临时 example（`docx_gold_reprobe.rs`，走完整 preview→commit→读落盘 notebook 管线）脚本化复验，跑完删除、输出留档 `logs/wps-gold-reprobe.txt`。结果：
  - `char_count`＝**55,331**，与既往基线分毫不差；段落 2,718／块 2,719。
  - 损耗清单仅 `numbering_degraded x2`（既往已知、编号域范围外）；**`style_degraded` 保持 0**（与既往"WPS 金样本零 style_degraded"口径一致——字体选键策略不产生损耗条目）。
  - fontFamily 分布：含东亚字符 run→宋体 x2,527＋黑体 x31（全部正确取东亚字体）；纯拉丁 run 无 fontFamily mark（该样本拉丁字符均处混排 run 或无显式字体键的 run，不存在可观察的修复前后差异面；如实记录：本样本**不能直接对比**修复前"拉丁被强标东亚字体"的表现，其验证力在计数与损耗零回退）。
  - 段落 lineHeight/spacingAfter 均 0 段：样本未设置段落 spacing——**F04 在该样本无可观察面**（由 3.3 单测＋acceptance 样本的 docDefaults 组合覆盖）。
  - 结论：金样本**既有回归零回退**（计数／损耗一致）；字体规则改动未引入新损耗或新 mark 面。

## 6. 损耗告知（任务 4.1／4.2）

- **4.1 实测**（临时探针跑 acceptance 样本后删除，结论固化为测试断言）：修复后完整损耗清单恰为 `numbering_degraded x5`（D-2 冻结基准冲突、范围外、有告知）＋`symbol_dropped x2`（虚构字体、冻结允许损耗）。F04/F05 修复后样本中不再有静默样式损耗——**`style_degraded` 不出现＝零残余真实样式损耗，未触发不虚报**（既有计数机制无需新增条目：修复消除的正是"该触发未触发"的两个静默损耗源头本身）。断言固化于样本级测试（sorted kinds 精确等于上述清单）。
- **4.2 实测 vs 呈现一致性**：预检 `losses` 数组即预检面板呈现数据源——实测清单与呈现条目一一对应、无静默项、无虚报项；由测试钉住。

## 7. 本地验证（任务 5.1／5.2）

- **5.1 `npm run check` 退出码 0，全链全绿**（输出尾部存 `logs/npm-check.txt`）：
  - typecheck／lint／build 过（vite built in 1.17s）；fmt:rust／clippy:rust 退出码 0。
  - 前端 **tests 1181／pass 1181／fail 0**；reliability **121**／121／0；driver **13**／13／0；validation **78**／78／0——四科与基线零回退。
  - Rust 合计 **549 passed／0 failed／4 ignored**——基线 544 ＋ 新增 5（内嵌 4：符号表单测、符号样本、字体规则、行距合并；样本级 1：acceptance 符号基线）。计数增加如实记录，非回退。
  - 过程如实：首跑失败于 clippy（`if_same_then_else`——本 change 新代码中东亚与空文本两分支数组相同），最小修复＝合并条件（`run_text.is_empty() || …any(east_asian)`，语义等价）后复跑全绿；无其他失败。
- **5.2 样本级测试全绿**：`import_fidelity_test` 4/4（含新增样本级）；内嵌新增 4 测全过（含在 lib 421 内）。

## 8. 诚实边界

- **真机验收已完成（2026-10-04）**：用户亲手经原生对话框选文件＋CDP 驱动生产控件；D-1/D-4/D-5 翻转为相符、全序列 26 块唯一差异为 SYM01 公开表修正、保存重开一致、视觉抽查无异常——详见本目录 `验收记录.md` 与 `evidence-docx/`、`screenshots/`。
- **CI 未跑**（6.3）、**未提交未归档**；4.x／6.x 任务保持未勾选。
- 金样本字体分布的对比局限（§5）：修复前表现未留基线，无法直接对比拉丁 run 的字体标记差异；验证力限于零回退与正确性断言。
- F04 的行距保留覆盖面：单测构造组合＋acceptance 样本（docDefaults line=276＋样式链 after=80 的冻结组合）；WPS 金样本无 spacing 设置、无可观察面。未覆盖：`atLeast`/`exact` 规则下的样式链合并组合（输出侧规则映射为既有实现，本 change 未改）。
- 任务书 2.4"F0B7→U+1F550"与样本事实的出入已如实记录（§4），按权威表处理；如协调方另有意图请复核。
- 未重新生成 acceptance-complex.docx；冻结清单与验收记录零改动（只读）。

## 9. 原始日志与证据清单（`verification/logs/`）

| 文件 | 内容 |
|---|---|
| `npm-check.txt` | 任务 5.1 `npm run check`（退出码 0）输出尾部（各科计数＋Rust test result） |
| `wps-gold-reprobe.txt` | 任务 3.4 金样本脚本复验完整输出（损耗／字体分布／行距统计） |

其余证据：`audit-mapping-verification.md`（既有，公开表取证）；acceptance 样本 `document.xml` 解包实证（`w:sym` 字体清单，见 §4）；临时 example 与探针测试均已删除（仓库习惯），结论以本记录与固化测试为准。
