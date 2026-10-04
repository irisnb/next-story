## Why

2026-10-03 导入保真 UI 验收（`verify-import-fidelity-ui` 归档）如实记录两条未通过门槛：`cargo fmt --check` 共 11 个文件、150 处格式差异；`cargo clippy --all-targets -- -D warnings` 有唯一一处错误（`examples/docx_read_spike.rs:59`，`manual_is_ascii_check`）。两者使标准门禁 `npm run check` 无法全绿（fmt 步骤先失败；修复后 clippy 步骤仍会在该处失败），CI 双平台执行同一门禁随之受阻；后续导入保真修复的代码 diff 也会被格式噪音淹没。本项＝事项 11「导入保真遗留缺陷修复（六项清单）」第 ⑥ 项，用户拍板先单列先行。

## What Changes

- **格式清理（fmt）**：对 `cargo fmt --check` 列出的全部 150 处差异执行 `cargo fmt`，共 11 个文件——当前范围 5 文件 91 处（`document_import.rs` 14、`docx_import.rs` 42、`md_import.rs` 18、`import_fidelity_test.rs` 4、`word_import_test.rs` 13）、既有范围外 2 文件 30 处（`examples/docx_read_spike.rs` 5、`src/project/fdx_import.rs` 25）、待分诊 4 文件 29 处（`examples/fdx_read_spike.rs` 4、`src/project/mod.rs` 2、`tests/fdx_import_test.rs` 14、`tests/markdown_import_test.rs` 9）。全部为换行／缩进／导入排序类纯格式差异，行为零变化；范围外与待分诊文件的改动独立记录。
- **clippy 修复**：`examples/docx_read_spike.rs:59` 按 lint 建议由 `matches!(c, '0'..='9')` 改为 `c.is_ascii_digit()`（等价表达，行为零变化）。
- **lint 范围修正（收尾补项，2026-10-04 用户拍板）**：`eslint.config.js` 忽略名单补充本地工作目录 `本地测试文档/**` 与 `.omo/**`（均为 `.gitignore` 忽略的本地文件；`eslint .` 不读 `.gitignore`，本次实测被扫入 16 个 `.mjs`、363 个错误）。仅改扫描范围，不改任何 lint 规则；补后整链 `npm run check` 在本机实测全绿。
- **行为保持**：不改任何产品行为、档案格式、接口或依赖；不改任何既有能力规格。
- **验证目标**：`npm run fmt:rust`、`npm run clippy:rust` 退出码 0；`npm run check` 全绿（Rust 544／前端 1181 测试基线零回退）。

## Capabilities

### New Capabilities

- `rust-code-hygiene`：仓库级 Rust 代码卫生不变量——全部 Rust 源码与测试保持项目工具链 rustfmt 输出；`cargo clippy --all-targets -- -D warnings` 全目标（含 examples）零告警。

### Modified Capabilities

无。不涉及任何现有规格的行为要求。

## Impact

- 修改文件（纯格式，11 个）：`src-tauri/src/project/document_import.rs`、`docx_import.rs`、`md_import.rs`、`fdx_import.rs`、`src-tauri/src/project/mod.rs`、`src-tauri/tests/import_fidelity_test.rs`、`word_import_test.rs`、`markdown_import_test.rs`、`fdx_import_test.rs`、`src-tauri/examples/docx_read_spike.rs`、`fdx_read_spike.rs`。
- 语义修改（1 处等价改写）：`src-tauri/examples/docx_read_spike.rs:59`。
- 配置：`eslint.config.js` 忽略名单 +2 项（`本地测试文档/**`、`.omo/**`；无 lint 规则变化）。
- 验证：`npm run check`（含 fmt／clippy／全部测试）；无需真机冒烟（不涉及新窗口、插件权限、CSP、外部进程、文件对话框）。
- 运行前提：执行 Rust 门槛时关闭正在运行的 `tauri:dev` 开发应用（或使用独立 `CARGO_TARGET_DIR`），否则链接期替换 `next-story.exe` 失败（os error 5；2026-10-03 已如实记录于归档 `verification/quality-gates-20261003.md`）。
- 不涉及：导入保真缺陷①–⑤（后续 change 承接）；多级编号方向；UI 与文档。
