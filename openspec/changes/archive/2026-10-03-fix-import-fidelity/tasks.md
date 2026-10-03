# fix-import-fidelity Tasks

## 1. Spike

- [x] 1.1 docx-rs 暴露面验证：①`RunChild::Sym` 字段 pub、直读零补通道；②`Docx.styles` 的 doc_defaults/based_on pub 但内层字段私有——经 derive Serialize 通道提取；唯一缺口 `w:default` 默认样式标志走 styles.xml 预扫描＋roxmltree（实测坑：前缀属性须按本地名迭代比对，`Node::attribute()` 不命中）；③numbering 的 `LevelOverride.override_start` 全 pub 直读零补通道——结论记 design（无需为 numbering 新增预扫描）
- [x] 1.2 真实样本入库：python-docx fixtures（MIT）三份至 `src-tauri/tests/fixtures/docx/`（num-having／sty-having／par-known＋README）；预检记录了修复前错误基线

## 2. md 列表保序

- [x] 2.1 复现测试先行：`list_overflow_preserves_source_reading_order` 当前实现下失败（5 块期望实得 2 块——续段被合并、子列表被后移的证据入档）
- [x] 2.2 保序就近降级实现：`ListEntry` 重构——溢出内容按原文顺序在该项结束处输出普通段落＋`list_overflow_degraded` 计数（note 区分段落/子列表）；仅首子列表之前无溢出时，首段＋首子列表留项内；有序列表溢出冲刷后重续块 start 续算；单测（续段/双子列表/深层嵌套/重续编号）。补充回归 `continuation_before_first_sublist_preserves_reading_order`：先观察到 A,C,B,D 被重排为 A,B,C,D，再修正首子列表回填和空首段占位条件；三种输入的文字顺序与严格语法校验通过，详见验收记录。

## 3. docx 符号字符

- [x] 3.1 复现测试先行：`repro_symbol` 期望「✓ 已完成」实得「 已完成」（符号静默丢失证据入档）
- [x] 3.2 映射表约 50 项（Wingdings 勾叉笑脸方块箭头系＋Symbol 希腊全集与常用数学符）；`F0` 私用区前缀剥除；成功插入 Unicode、失败 `symbol_dropped` 计数；单测正反例

## 4. docx 样式链

- [x] 4.1 复现测试先行：`repro_style_chain` 三层 basedOn 链 panic（样式格式全丢证据）；真实 par-known 样本基线
- [x] 4.2 样式上下文实现：docDefaults（Serialize 通道）＋styleId→{basedOn, rPr, pPr}＋环防护（深度 8）＋默认样式标志（styles.xml 预扫描）；生效＝默认←段落样式链←rStyle 链←直接属性（fonts 按属性位合并）；字符与段落属性分别走既有映射器（map 形态重构）；未解析计 `style_degraded`（tabs 空回声不计）；「等价编辑器默认」注释撤回；**WPS 金样本零 style_degraded 达成**；真实样本端到端（par-known：docDefaults 11pt＋Heading1 链 14pt/bold/#365f91 生效）

## 5. docx 编号续算

- [x] 5.1 复现测试先行：`repro_numbering` 重续 start 实得 1 期望 3、`repro_start_override` 实得 1 期望 5（证据入档）
- [x] 5.2 计数器实现：`HashMap<(numId, ilvl), u64>` 跨打断持续、更深层级在更浅出现时重置、`startOverride` 消费（直读）、重续有序列表 start＝当前值、样式链携带编号同样生效；单测矩阵（连续/打断/嵌套重置/覆盖/双列表交错/墓碑并存）

## 6. 前端与全量回归

- [x] 6.1 损耗标签表 +3（`list_overflow_degraded`／`symbol_dropped`／`style_degraded`）＝22 项；断言扩项；1181/1181 全绿
- [ ] 6.2 全量回归与真机验收（未完成——已移交，未通过）：后续本地复验 `cargo test --quiet` 已明确为 **544 passed / 0 failed / 4 ignored，退出码 0**；本轮新鲜执行的 `cargo clippy --lib --bins --tests -- -D warnings`、`cargo test --test import_fidelity_test --quiet`（3/3）和 `npm run test:frontend -- --run`（1181/1181）均通过，但不等于 all-targets；`cargo clippy --all-targets -- -D warnings` 仍被本地 `examples/docx_read_spike.rs:59` 的 `manual_is_ascii_check` 阻塞；`cargo fmt --check` 仍有格式差异，尚未通过。par-known 文字内层只读探针已确认标题 #365f91／14pt／粗体、正文 11pt，外层 H1 单独取样不能代表实际文字。三格式真实 UI 的局部样本已完成，但复杂 DOCX 组合、完整视觉抽查、修复后三个新增损耗标签的 UI 链路及独立规范审计仍未完成。详见 `验收记录.md`（§6 冻结期望与哈希、既有证据原样保留）。**移交而非通过（2026-10-03 用户拍板）**：本项未完成、保持未勾选；用户确认本变更在 6.2 未竟情况下归档——此为对原「禁止提前归档」要求与「验收未完成不归档」口径的显式用户特例，不改变本项未通过的事实。未竟验收（含三个复杂样本真实 UI 导入与 §6 冻结期望比对、all-targets Clippy、格式检查、独立规范审计）移交后续仅验收型 change `verify-import-fidelity-ui`（待创建，尚未存在）继续跟踪，本变更内不宣称任何 UI 验收成功。

## 附：行为决定与遗留（如实记档）

- docx 往返差异清单更新第⑤项（docDefaults 现保留）；`szCs`／`vanish`（隐藏文字，内容取舍非格式）／主题字体引用（asciiTheme）不计 style_degraded——口径：金样本直接格式文件零降级；keep/widow 等排版引擎提示不映射不计（类比机器家具）
- 审计 P2 项记档待后续 batch：md HTML 实体／未闭合 `<u>` 误伤范围、docx rightChars、atLeast 行距语义、损耗清单的样式/布局缺口
- `sty-having-styles-part.docx` 正文为空（上游如此）——样式链生效的真实断言靠 par-known 与合成链
