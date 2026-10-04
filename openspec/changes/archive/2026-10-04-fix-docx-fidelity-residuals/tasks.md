## 1. 准备与依据核对

- [x] 1.1 逐条核对修正值：对照 Alan Wood（Wingdings）与 Adobe Symbol 编码表复核 F01/F02 修正清单及 F0FB 目标值（必要时经 @librarian 取权威来源并留证）——已由 `verification/audit-mapping-verification.md` 独立核对，零差异
- [x] 1.2 核对验收基线：归档 §5.1 偏差表与 §6 冻结清单；标记与公开表冲突的字形预期（FC/FB/B7 等，F01/F03）及"不回改冻结清单"原则
- [x] 1.3 清点现有测试中断言旧映射／旧字体／旧间距行为的用例清单——见 `verification/validation.md` §2

## 2. 符号映射修复

- [x] 2.1 `wingdings_char` 修正 20 条＋补 F0FB；`symbol_font_char` 修正 5 条（逐条依公开表）
- [x] 2.2 单测：全部修正条目逐条断言；未知码位仍 `symbol_dropped`、不静默
- [x] 2.3 符号覆盖样本：扩展／新增生成脚本构造覆盖全部修正条目的 `.docx`，集成测试逐条断言——以 docx-rs 测试内构造（既有先例形态）实现，未重新生成 acceptance-complex.docx
- [x] 2.4 样本级：复杂样本重导入 → `symbol_dropped`=2、字数=1,141（D-1）——新增 `acceptance_complex_symbol_count_and_mapping`；F0B7 出入裁定见 `verification/validation.md` §4

## 3. 字体与行距修复

- [x] 3.1 字体选择按字符类别（东亚→`eastAsia`；纯拉丁→`ascii`，按既有键序回退；混排取东亚）
- [x] 3.2 `overlay_map` 增加 `lineSpacing` 子属性合并
- [x] 3.3 单测：字体规则（拉丁／中文／混排）；行距组合（仅 after 覆盖时 line 保留、直接属性、多子属性）
- [x] 3.4 WPS 金样本（55,331 字）复验与既有回归零回退——脚本化复验完成（55,331 分毫不差、损耗零回退），字体分布对比局限如实记录见 `verification/validation.md` §5

## 4. 损耗告知

- [x] 4.1 修复后重跑复杂样本，核定剩余真实样式损耗；确保凡真实损耗计入 `style_degraded`（零则验证不虚报）——实测零残余样式损耗，清单恰为 numbering_degraded x5＋symbol_dropped x2，断言固化
- [x] 4.2 记录损耗计数与详情的"实测 vs 呈现"一致性

## 5. 本地验证

- [x] 5.1 `npm run check` 全绿（Rust／前端计数零回退）——退出码 0；前端 1181／可靠性 121／驱动 13／验证 78 零回退，Rust 549/0/4＝基线 544＋新增 5
- [x] 5.2 样本级测试全绿（符号／字体／行距）

## 6. 真机验收与收尾

- [x] 6.1 真机冒烟（用户配合原生文件选择）：预检核对 → 确认导入 → 保存重开 → 落盘核对（符号／字体／行距）——2026-10-04 完成；D-1/D-4/D-5 翻转；详见 `verification/验收记录.md`
- [x] 6.2 验收记录：D-1/D-4/D-5 翻转为相符；与冻结清单冲突的字形预期按 F01/F03 裁定记录；质量门槛分账；证据义务按 `import-fidelity-acceptance`——`verification/验收记录.md`＋`evidence-docx/`＋`screenshots/`＋`tools/` 已就位
- [x] 6.3 提交推送 → CI 双平台绿（若露新层，同 change 清理）——commit `46e5c74` 已推送；run `37216393559` 双平台全绿（归档提交随后验证）
- [x] 6.4 归档（用户确认）＋行动计划与进度清单更新——归档 `2026-10-04-fix-docx-fidelity-residuals`；行动计划 2026-10-04 更新（三）；进度清单 2.5 勾选
