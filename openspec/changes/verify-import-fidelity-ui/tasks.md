# verify-import-fidelity-ui Tasks

> 验收对象＝当前工作区构建（含未提交的 fix-import-fidelity 实现）；冻结预期＝归档 `openspec/changes/archive/2026-10-03-fix-import-fidelity/验收记录.md` §6（只读引用，不复制、不改写）。执行门槛见 `docs/superpowers/plans/2026-10-03-fix-import-fidelity-acceptance.md`。
> 边界：不改产品代码；不重写归档记录与冻结清单；不重复导入既有小样本；不使用 `C:\Users\Administrator\Desktop\test\导出验收-20261001`；验收材料统一收纳于本变更 `verification/`，**目的地作品不得建在仓库目录内**（此前两个误建空作品已清理）；发现疑似缺陷记录可复现证据后另行立项；未经用户确认不提交、不推送。浏览器级 invoke／文件注入仅作辅助，不充当 UI 证据；比对只读进行，不经任何 AI 路径写入文档。

## 1. 基线与输入核对

- [ ] 1.1 执行前核对输入：`verification/inputs/acceptance-complex.md`、`verification/expected/`（`acceptance-markdown-manifest.md`、`acceptance-docx-manifest.md`、`fdx-acceptance-manifest.md`、`fdx-acceptance-expected.json`）、`src-tauri/tests/fixtures/docx/acceptance-complex.docx`、`src-tauri/tests/fixtures/fdx/storyboarder-test.fdx` 均存在且字节哈希符合归档 §6.0；记录 `git rev` 与工作区 dirty 清单作为验收对象版本；记录应用构建／运行证据（`http://localhost:1420/` 属于当前重建的 Tauri 应用）。
- [ ] 1.2 经用户确认建立**新鲜可弃作品**并记录空树基线（绝不用既有作品，绝不使用导出验收目录；**目的地不得位于仓库目录内**）；记录三个样本导入前的输入哈希。

## 2. 逐格式真实 UI 验收（对照归档 §6 冻结清单）

- [ ] 2.1 Markdown（§6.1）：经 `#fm-import-document` 走真实原生选择器（自动化不可靠时由用户选择确切路径）；记录预检字数／段落数／`list_overflow_degraded` 计数与详情／拆分选项与目的地；经 `#btn-document-import-confirm` 确认；记录新增文档 ID／名称与既有树条目不变；经 `#current-doc-toggle` 打开，逐条对照 §6.1.3 阅读顺序、§6.1.4 列表结构与起点、§6.1.5 预测损耗、§6.1.6 字数口径与未验证项；保存重开；视觉抽查开头／中段／结尾／结构转换处。
- [ ] 2.2 DOCX（§6.2）：同流程；对照 §6.2.3 完整预期文本、§6.2.4 符号映射（2 处未知＝允许损耗）、§6.2.5 样式解析预期、§6.2.6 编号预期序列、§6.2.7 损耗预期与未验证项。
- [ ] 2.3 FDX（§6.3，只读样本）：同流程；对照 §6.3.3 代表性锚点、§6.3.4 预测损耗表、§6.3.5 矛盾披露与完整对照序列（487 条，含标题页并入正文规则）；专项核对双栏对白拆分顺序。
- [ ] 2.4 偏差处理：实测与冻结预期不符时记录「预期 vs 实测」原始对照，冻结清单保持原样；疑似产品缺陷记录可复现证据并停止扩大该样本验证范围。

## 3. 三个新增损耗标签 UI 链路

- [ ] 3.1 逐项核对 `list_overflow_degraded`／`symbol_dropped`／`style_degraded`：样本实际触发的类别必须在预检呈现标签、计数与详情且与冻结预期一致；未触发的不虚报；触发而未呈现记为缺陷。

## 4. 质量门槛（如实分账）

- [ ] 4.1 必跑并记录退出码与通过／忽略计数：`cargo test --quiet`（src-tauri）、`npm run test:frontend -- --run`（根）、`cargo clippy --lib --bins --tests -- -D warnings`（src-tauri）、`npm run build`（根）。
- [ ] 4.2 复跑并如实报告 `cargo clippy --all-targets -- -D warnings` 与 `cargo fmt --check`（src-tauri）；既有范围外差异（如 `src-tauri/examples/docx_read_spike.rs`、`src-tauri/src/project/fdx_import.rs`）与当前范围问题分账；不擅改范围外文件、不宣称未通过项通过。
- [ ] 4.3 独立规范审计：DOCX 符号映射、样式覆盖与编号规则由独立于实现作者的审计核对；结论引用 OOXML/ECMA-376 或冻结预期，不以实现／合成测试为规范依据；findings 入档。

## 5. 记录与收口

- [ ] 5.1 在本 change 新建 `验收记录.md`：汇总输入哈希、冻结清单引用、逐项实测（预检／确认／全文比对／保存重开／视觉抽查）、门槛结果、审计 findings、偏差与未验证项显式清单；观察范围与限制如实标注。
- [ ] 5.2 逐项判定：仅有证据项可标通过；向用户呈报逐项结果并由用户拍板后续（缺陷另行立项；未经确认不提交、不推送、不改归档记录）。
