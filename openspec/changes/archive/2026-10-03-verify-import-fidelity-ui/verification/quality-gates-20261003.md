# 质量门槛复跑记录（任务 4.1＋4.2）——2026-10-03

> 纯验收记录：本次未修改任何代码文件。唯一产出为本文件。
> 变更：`verify-import-fidelity-ui`；范围判定基准：`fix-import-fidelity`（e7aa4fd）。

## 1. 环境记录

| 项 | 值 |
|---|---|
| cargo | 1.96.1 (356927216 2026-06-26) |
| rustc | 1.96.1 (31fca3adb 2026-06-26) |
| node | v24.15.0 |
| 执行日期 | 2026-10-03 |
| git HEAD | 42a8047 |

**执行前提说明（重要，影响第 1、3、5 条的执行方式）**：验收期间 `npm run tauri:dev` 开发应用正在运行（进程 next-story，PID 28804，运行自 `src-tauri\target\debug\next-story.exe`）。cargo 的测试/检查构建图包含主程序二进制，试图替换该文件时报 `failed to remove file ... next-story.exe`／`拒绝访问 (os error 5)`，属确定性失败（两次重试确认），且无法在不杀进程的前提下于原 `target` 目录完成链接。因此第 1、3、5 条 cargo 命令改在独立目标目录 `C:\Users\Administrator\AppData\Local\Temp\opencode\ns-verify-target`（`CARGO_TARGET_DIR` 环境变量指向，完整冷构建）执行；源代码、git HEAD（42a8047）、工具链与原目录完全一致，仅构建产物位置不同，验收结论等效。此偏差如实记录，不掩盖。原目录下 `cargo test --quiet` 的两次直接尝试均以 os error 5 失败（退出码 101），未产出测试结果。

## 2. e7aa4fd 改动文件清单（当前范围判定基准）

```
src-tauri/src/project/document_import.rs
src-tauri/src/project/docx_import.rs
src-tauri/src/project/md_import.rs
src-tauri/tests/fixtures/docx/README.md
src-tauri/tests/fixtures/docx/acceptance-complex.docx
src-tauri/tests/fixtures/docx/num-having-numbering-part.docx
src-tauri/tests/fixtures/docx/par-known-styles.docx
src-tauri/tests/fixtures/docx/sty-having-styles-part.docx
src-tauri/tests/import_fidelity_test.rs
src-tauri/tests/word_import_test.rs
src/document-import.ts
src/project-api.ts
tests/document-import.test.ts
```

提交标题：`fix: 修复导入保真四项缺陷（md 列表保序、docx 符号／样式／编号）`

## 3. 六条命令逐条记录

### 3.1 `cargo test --quiet`

- 工作目录：`D:\Next Story\src-tauri`（实际构建目录：独立 CARGO_TARGET_DIR，见第 1 节说明）
- 退出码：**0**（原 target 目录直接执行为 101／os error 5，见第 1 节）
- 关键输出：13 个测试二进制全部 `ok`，汇总行完整摘录（顺序＝lib → bin → tests 按字母序 → doc-tests）：

| 测试二进制 | 汇总行 |
|---|---|
| unittests src\lib.rs | `test result: ok. 417 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 16.66s` |
| unittests src\main.rs | `test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s` |
| tests\export_test.rs | `test result: ok. 19 passed; 0 failed; 0 ignored` |
| tests\fdx_import_test.rs | `test result: ok. 10 passed; 0 failed; 0 ignored` |
| tests\import_fidelity_test.rs | `test result: ok. 3 passed; 0 failed; 0 ignored` |
| tests\llm_config_test.rs | `test result: ok. 33 passed; 0 failed; 0 ignored` |
| tests\markdown_export_test.rs | `test result: ok. 16 passed; 0 failed; 0 ignored` |
| tests\markdown_import_test.rs | `test result: ok. 6 passed; 0 failed; 0 ignored` |
| tests\on_demand_reading_negative_test.rs | `test result: ok. 2 passed; 0 failed; 0 ignored` |
| tests\project_test.rs | `test result: ok. 33 passed; 0 failed; 0 ignored` |
| tests\real_link_on_demand_reading_test.rs | `test result: ok. 0 passed; 0 failed; 3 ignored`（真实链路用例默认忽略） |
| tests\word_import_test.rs | `test result: ok. 5 passed; 0 failed; 0 ignored` |
| Doc-tests next_story_lib | `test result: ok. 0 passed; 0 failed; 0 ignored` |

- 计数合计：**544 通过；0 失败；4 忽略**。
- 结论：**通过**。

### 3.2 `npm run test:frontend -- --run`

- 工作目录：`D:\Next Story`
- 退出码：**0**
- 关键输出（node --test 汇总）：
  - `ℹ tests 1181`
  - `ℹ pass 1181`
  - `ℹ fail 0`
  - `ℹ cancelled 0`／`ℹ skipped 0`／`ℹ todo 0`
- 备注：输出中有一处 `读取最近作品失败: Error: 存储读取失败` 控制台日志，属通过中的用例（welcome page fails open）故意注入的失败路径日志，非测试失败。
- 结论：**通过**（1181 通过 / 0 失败）。

### 3.3 `cargo clippy --lib --bins --tests -- -D warnings`

- 工作目录：`D:\Next Story\src-tauri`（独立 CARGO_TARGET_DIR，见第 1 节说明）
- 退出码：**0**
- 关键输出：`Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 4m 04s`，零警告零错误。
- 结论：**通过**。

### 3.4 `npm run build`

- 工作目录：`D:\Next Story`
- 退出码：**0**
- 关键输出：`tsc && vite build` 成功；`✓ 126 modules transformed`；`✓ built in 2.88s`（产物：dist/index.html 44.39 kB、main-*.js 250.74 kB、editor-vendor-*.js 373.53 kB 等）。
- 结论：**通过**。

### 3.5 `cargo clippy --all-targets -- -D warnings`

- 工作目录：`D:\Next Story\src-tauri`（独立 CARGO_TARGET_DIR，见第 1 节说明）
- 退出码：**101**
- **逐条完整摘录**（本次唯一一条 error；lib／bins／tests 目标在第 3.3 条与本次运行中均零警告，`--all-targets` 额外纳入 examples 目标后暴露下述问题）：

```
error: manual check for common ascii range
  --> examples\docx_read_spike.rs:59:18
   |
59 |         .all(|c| matches!(c, '0'..='9') || "一二三四五六七八九十百零两".contains(c))
   |                  ^^^^^^^^^^^^^^^^^^^^^^
   |
   = help: for further information visit https://rust-lang.github.io/rust-clippy/rust-1.96.0/index.html#manual_is_ascii_check
   = note: `-D clippy::manual-is-ascii-check` implied by `-D warnings`
   = help: to override `-D warnings` add `#[allow(clippy::manual_is_ascii_check)]`
help: try
   |
59 -         .all(|c| matches!(c, '0'..='9') || "一二三四五六七八九十百零两".contains(c))
59 +         .all(|c: char| c.is_ascii_digit() || "一二三四五六七八九十百零两".contains(c))
   |

error: could not compile `next-story` (example "docx_read_spike") due to 1 previous error
```

- 计数：**1 error / 0 warning**。
- 结论：**未通过**（唯一失败项位于 examples\docx_read_spike.rs，属既有范围外，见第 4 节分账）。

### 3.6 `cargo fmt --check`

- 工作目录：`D:\Next Story\src-tauri`（fmt 不依赖构建，直接原目录执行）
- 退出码：**1**
- **diff 文件完整清单**（11 个文件、150 处 hunk，逐文件逐处列行号）：

| # | 文件 | diff 处数 | hunk 行号 |
|---|---|---|---|
| 1 | examples\docx_read_spike.rs | 5 | 146, 195, 231, 238, 244 |
| 2 | examples\fdx_read_spike.rs | 4 | 17, 31, 52, 123 |
| 3 | src\project\document_import.rs | 14 | 150, 170, 177, 190, 203, 210, 234, 244, 286, 487, 542, 610, 668, 837 |
| 4 | src\project\docx_import.rs | 42 | 23, 196, 227, 291, 301, 312, 321, 455, 462, 482, 676, 764, 1007, 1041, 1118, 1174, 1278, 1319, 1351, 1380, 1595, 1750, 1757, 1764, 1809, 1858, 1868, 1999, 2020, 2035, 2106, 2125, 2182, 2229, 2247, 2290, 2315, 2325, 2390, 2521, 2553, 2607 |
| 5 | src\project\fdx_import.rs | 25 | 191, 340, 408, 564, 702, 720, 776, 919, 938, 1042, 1053, 1062, 1080, 1088, 1098, 1133, 1152, 1170, 1206, 1216, 1350, 1374, 1383, 1402, 1421 |
| 6 | src\project\md_import.rs | 18 | 35, 293, 300, 335, 342, 475, 533, 600, 631, 886, 1030, 1094, 1114, 1127, 1284, 1291, 1349, 1359 |
| 7 | src\project\mod.rs | 2 | 1, 18 |
| 8 | tests\fdx_import_test.rs | 14 | 128, 160, 185, 226, 257, 276, 340, 380, 391, 413, 439, 482, 567, 574 |
| 9 | tests\import_fidelity_test.rs | 4 | 43, 83, 101, 121 |
| 10 | tests\markdown_import_test.rs | 9 | 181, 234, 263, 351, 391, 412, 428, 438, 460 |
| 11 | tests\word_import_test.rs | 13 | 15, 45, 84, 119, 132, 171, 192, 250, 300, 428, 495, 513, 522 |

（合计：11 个文件、150 处 hunk：5+4+14+42+25+18+2+14+4+9+13＝150。）

- diff 性质备注：均为换行／缩进／导入排序类纯格式差异（如 assert_eq! 多行改写、链式调用折行、`mod` 声明按字母序重排、行内注释对齐），无语义改动诉求。
- 结论：**未通过**（11 个文件中 5 个属当前范围、2 个属既有范围外、4 个待分诊，见第 4 节）。

## 4. 差异分账表（clippy all-targets 与 fmt）

分账规则：e7aa4fd 清单内＝「当前范围」；`src-tauri/examples/docx_read_spike.rs` 与 `src-tauri/src/project/fdx_import.rs`＝「既有范围外（归档已记录）」；其余＝「待分诊」（原样列出，不自行归类了事）。

### 4.1 clippy --all-targets 分账（共 1 条）

| 文件：行 | lint 名 | 内容 | 归类 |
|---|---|---|---|
| examples\docx_read_spike.rs:59:18 | `manual_is_ascii_check` | `matches!(c, '0'..='9')` 应用 `c.is_ascii_digit()` | 既有范围外（归档已记录） |

### 4.2 cargo fmt --check 分账（11 个文件）

**当前范围（e7aa4fd 清单内，5 个文件、91 处）**：

| 文件 | 处数 | 归类依据 |
|---|---|---|
| src\project\document_import.rs | 14 | e7aa4fd 改动文件 |
| src\project\docx_import.rs | 42 | e7aa4fd 改动文件 |
| src\project\md_import.rs | 18 | e7aa4fd 改动文件 |
| tests\import_fidelity_test.rs | 4 | e7aa4fd 改动文件 |
| tests\word_import_test.rs | 13 | e7aa4fd 改动文件 |

**既有范围外（归档已记录，2 个文件、30 处）**：

| 文件 | 处数 | 归类依据 |
|---|---|---|
| examples\docx_read_spike.rs | 5 | 任务书明列既有范围外 |
| src\project\fdx_import.rs | 25 | 任务书明列既有范围外 |

**待分诊（4 个文件、29 处，原样列出）**：

| 文件 | 处数 | 原样说明 |
|---|---|---|
| examples\fdx_read_spike.rs | 4 | 不在 e7aa4fd 清单，也不在任务书点名的两个既有范围外文件中 |
| src\project\mod.rs | 2 | 同上（其 diff 内容为 `mod` 声明排序与 `pub use` 折行，与导入模块相关但文件本身不在 e7aa4fd 清单） |
| tests\fdx_import_test.rs | 14 | 同上 |
| tests\markdown_import_test.rs | 9 | 同上 |

## 5. 诚实结论

| # | 门槛 | 退出码 | 结论 |
|---|---|---|---|
| 1 | `cargo test --quiet` | 0 | **通过**（544 通过 / 0 失败 / 4 忽略；独立 CARGO_TARGET_DIR 执行，见第 1 节） |
| 2 | `npm run test:frontend -- --run` | 0 | **通过**（1181 通过 / 0 失败） |
| 3 | `cargo clippy --lib --bins --tests -- -D warnings` | 0 | **通过**（零警告） |
| 4 | `npm run build` | 0 | **通过**（tsc + vite build 成功） |
| 5 | `cargo clippy --all-targets -- -D warnings` | 101 | **未通过**（1 error：examples\docx_read_spike.rs:59 `manual_is_ascii_check`，既有范围外；但门槛命令整体退出码非零，如实记为未通过） |
| 6 | `cargo fmt --check` | 1 | **未通过**（11 个文件 150 处格式差异，其中当前范围 5 文件 91 处） |

**要点（不粉饰）**：

1. 六条门槛中 4 条通过、2 条未通过（第 5、6 条），未通过绝不写成通过。
2. 第 5 条唯一失败项属「既有范围外」，第 6 条的当前范围文件（document_import.rs / docx_import.rs / md_import.rs / import_fidelity_test.rs / word_import_test.rs，共 91 处）是 e7aa4fd 提交自身留下的未格式化代码——fix-import-fidelity 提交前未跑 `cargo fmt`。
3. 第 6 条另有一批「待分诊」文件（examples\fdx_read_spike.rs、src\project\mod.rs、tests\fdx_import_test.rs、tests\markdown_import_test.rs，共 29 处），本次仅原样列出，归属待任务方裁定。
4. 本次验收遵守边界：未修改任何代码文件（未 fmt 写入、未 clippy --fix、未动 fixtures）；开发应用进程未受影响，仍在运行。
