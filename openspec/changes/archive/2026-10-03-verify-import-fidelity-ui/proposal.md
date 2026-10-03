## Why

`fix-import-fidelity` 已于 2026-10-03 归档，四项 P1 修复与规格同步完成，但任务 6.2 保持未勾选（**移交而非通过**）：三个复杂样本（Markdown／DOCX／FDX）的真实 UI 导入与冻结预期比对、三个新增损耗标签的 UI 链路、`cargo clippy --all-targets`／`cargo fmt --check`、独立规范审计均未完成（见归档 `openspec/changes/archive/2026-10-03-fix-import-fidelity/验收记录.md` §5、§6.4）。在这些验收完成之前，导入保真度不得宣称通过；本 change 仅承接这份未竟验收清单，不改动产品行为。

## What Changes

- **复杂样本真实 UI 验收**：按 `docs/superpowers/plans/2026-10-03-fix-import-fidelity-acceptance.md` 的既定门槛，对三个已冻结复杂样本逐一执行真实路径——原生选文件 → 预检（字数／段落数／损耗标签与计数）→ 确认导入 → 编辑器全文与结构／格式比对 → 保存重开比对 → 视觉抽查。预期一律以归档 §6 冻结清单与哈希为准；实测与预期不符时如实记录，不得改写冻结清单，也不得以导入结果反推预期。
- **三个新增损耗标签 UI 链路**：`list_overflow_degraded`／`symbol_dropped`／`style_degraded` 按样本实际触发情况在预检中逐项核对；未触发的不虚报，触发而未呈现即为缺陷入档。
- **质量门槛复跑与如实分账**：复跑全量测试、限定范围 Clippy、构建、`cargo clippy --all-targets` 与 `cargo fmt --check`；既有的范围外差异（含 `src-tauri/examples/docx_read_spike.rs`、`src-tauri/src/project/fdx_import.rs`）如实区分记录，不擅改范围外文件，不宣称未通过的检查通过，亦不以门槛结果替代真实 UI 证据。
- **独立规范审计**：对 DOCX 符号映射、样式覆盖与编号规则做独立核对，规范依据独立于当前实现与合成测试本身。
- **偏差记录与边界**：任何实测偏差、矛盾与未验证项进入本 change 验收记录并保持显式；发现产品缺陷不在此 change 内修复，另行立项；不改产品代码、不重写归档验收记录、未经用户确认不提交不推送。

## Capabilities

### New Capabilities

- `import-fidelity-acceptance`: 复杂样本导入验收的证据义务与完成判定——独立冻结预期、真实 UI 路径、全量比对、保存重开、损耗告知核对、质量门槛分账与诚实记录。

### Modified Capabilities

（无——本 change 不改变任何产品行为要求；导入行为以已归档的 `project-markdown-import`／`project-word-import`／`project-fdx-import` 规格为准。）

## Impact

- **验收对象与材料**：输入 `verification/inputs/acceptance-complex.md`（自临时目录收纳，字节哈希见归档 §6.0）、`src-tauri/tests/fixtures/docx/acceptance-complex.docx`（§6.2；生成脚本 `generate-acceptance-docx.py` 同目录入库）、`src-tauri/tests/fixtures/fdx/storyboarder-test.fdx`（§6.3，只读）。预期清单与工具已收纳于 `verification/expected/` 与 `verification/tools/`；若某材料丢失，以归档 §6 内嵌内容重建并核对哈希。
- **证据落点**：本 change 新建验收记录；冻结预期引用归档 `验收记录.md` §6，不复制、不修改。
- **质量门槛**：`cargo test --quiet`、`npm run test:frontend -- --run`、`cargo clippy --lib --bins --tests -- -D warnings`、`npm run build`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
- **不涉及**：产品代码、依赖、数据格式变更；验收会话需真实应用与原生文件选择（自动化不可靠时由用户在场确认路径）。
