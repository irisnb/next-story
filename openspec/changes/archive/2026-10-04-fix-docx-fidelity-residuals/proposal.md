## Why

`verify-import-fidelity-ui`（2026-10-03 归档）随附的独立规范审计（`audit-docx-normative.md`，F01–F09）确认 DOCX 导入存在静默失真，直接违反已归档 `project-word-import` 的保真与告知承诺：

- **① 符号（F01/F02/F03）**：Wingdings 表 20 条与 Alan Wood 公开表不符、Symbol 表 5 条与 Adobe 表不符（B7、BB、3F、E9、EA 等为含义或方向改变）；F0FB 缺映射被丢弃。错误映射零提示，比丢弃更伤信任。
- **③ 字体（F05/D-4）**：`docx_import.rs` 无条件优先 `eastAsia`，拉丁文字全部落盘 Microsoft YaHei（冻结预期 Calibri）——数据层错误，影响导出与未来功能。
- **④ 行距（F04/D-5）**：样式链合并仅对 `fonts` 做子字段合并，其余对象整块替换——仅覆盖段后间距时丢失继承行距。
- **⑤ 损耗告知**：③④确有真实损耗，预检却无 `style_degraded` 条目（触发而未呈现）。

本项＝事项 11「导入保真遗留缺陷修复（六项清单）」的 ①③④⑤（用户拍板：①③④⑤ 合一为一个 change；② 编号格式与 F06/F08 由后续「编辑器编号格式」change 承接；D-2／多级编号维持长期账本）。修复依据＝公开编码表与 OOXML 间距语义；验收基线＝归档验收 §5.1 偏差表与 §6 冻结清单（**D-1/D-4/D-5 翻转为相符即修复生效**，D-3 属后续 change；冻结清单不回改）。

## What Changes

- **符号映射修正（F01/F02/F03）**：按公开表修正 Wingdings 20 条、Symbol 5 条、补 F0FB；无法可靠映射仍走 `symbol_dropped`、不静默。冻结记录 :375–376 对 FC/FB 的预期经审计判定为记录瑕疵——以公开表为准，不回改冻结清单。
- **字体选择（F05）**：按 run 文字字符类别选择字体（含东亚字符→`eastAsia`；纯拉丁→`ascii/hAnsi`）；不再无条件 `eastAsia`。
- **行距继承（F04）**：`overlay_map` 对 `lineSpacing` 按子属性逐项合并（`before`／`after`／`line`／`lineRule`）；不做无差别递归合并。
- **损耗告知（⑤）**：③④修复后仍真实发生的样式损耗计入 `style_degraded`（沿用既有计数与输出形态）；未触发不虚报；以样本实测损耗与预检呈现一致为准。
- **行为保持**：不扩大导入能力；不改编辑器模型与落盘结构；不触碰编号行为。
- **验证目标**：修正条目逐条单测＋符号覆盖样本断言；复杂样本真机验收复跑（D-1/D-4/D-5 翻转；与冻结清单冲突的字形预期按 F01/F03 裁定如实记录）；`npm run check` 全绿；CI 双平台绿。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-word-import`：新增三项要求——字体选择按文字字符类别；复合间距属性按子属性合并（继承行距不因段距覆盖丢失）；符号映射表以公开编码表为规范依据且错误映射与丢弃不得静默。

## Impact

- 代码：`src-tauri/src/project/docx_import.rs`（符号表、字体选择、`overlay_map`、损耗计数）；`document_import.rs` 预计不改（沿用既有输出形态）。
- 测试：修正条目逐条单测；符号覆盖样本（扩展生成脚本＋集成断言）；既有断言中依赖旧映射处按公开表修正并注明 F01/F02。
- 验收：真机复跑复杂样本（原生文件对话框需用户在场点选，其余 CDP 驱动）；证据义务按 `import-fidelity-acceptance`；CI 双平台绿。
- 不涉及：编号格式（②）／F06／F08（后续 change）；多级编号方向（长期账本）；编辑器与 UI。
