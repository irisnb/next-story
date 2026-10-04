# 验证记录：fix-rust-format-and-clippy-hygiene（2026-10-04）

## 1. 环境与工具版本

- 平台：Windows / PowerShell 5.1，仓库根 `D:\Next Story`。
- `rustc 1.96.1 (31fca3adb 2026-06-26)`；`cargo 1.96.1 (356927216 2026-06-26)`；`node v24.15.0`。
- 开发应用占用检查：`Get-Process next-story` 无进程（整个执行期间未出现）。
- **CARGO_TARGET_DIR 方式：未设置覆盖，使用仓库默认 `src-tauri/target`**（因无 next-story 进程占用，链接期替换无冲突；proposal D4 的两个选项中走了"关闭开发应用"一支）。

## 2. 基线复跑（任务 1.1，动手前存证）

### 2.1 `npm run fmt:rust`（= `cargo fmt --manifest-path src-tauri/Cargo.toml --check`）

- 退出码 **1**；原始输出存 `logs/fmt-check-before.txt`。
- 按文件统计差异处数（对含 ANSI 颜色码的原始输出做正则统计），**共 11 文件 150 处，与归档记录零漂移**：

| 分账类别 | 文件 | 归档处数 | 实测处数 |
|---|---|---|---|
| 当前范围（5 文件 91 处） | `src/project/document_import.rs` | 14 | 14 |
| | `src/project/docx_import.rs` | 42 | 42 |
| | `src/project/md_import.rs` | 18 | 18 |
| | `tests/import_fidelity_test.rs` | 4 | 4 |
| | `tests/word_import_test.rs` | 13 | 13 |
| 既有范围外（2 文件 30 处） | `examples/docx_read_spike.rs` | 5 | 5 |
| | `src/project/fdx_import.rs` | 25 | 25 |
| 待分诊（4 文件 29 处） | `examples/fdx_read_spike.rs` | 4 | 4 |
| | `src/project/mod.rs` | 2 | 2 |
| | `tests/fdx_import_test.rs` | 14 | 14 |
| | `tests/markdown_import_test.rs` | 9 | 9 |
| 合计 | 11 文件 | 150 | **150** |

- 统计方法注记：逐行匹配会漏掉被 ANSI 颜色码包裹的 `Diff in` 行（只得 134），以对原始文本的正则统计（150）为准，与归档一致。

### 2.2 `npm run clippy:rust`（= `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`）

- 退出码 **101**；原始输出存 `logs/clippy-before.txt`。
- 唯一错误与归档完全一致，零漂移：

```text
error: manual check for common ascii range
  --> examples\docx_read_spike.rs:59:18
   = note: `-D clippy::manual-is-ascii-check` implied by `-D warnings`
error: could not compile `next-story` (example "docx_read_spike") due to 1 previous error
```

## 3. 修复内容（任务 2.1、2.2）

- 2.1：仓库根执行 `cargo fmt --manifest-path src-tauri/Cargo.toml`，随后 `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 退出码 **0**。
- 2.2：`src-tauri/examples/docx_read_spike.rs` 第 59 行，唯一一处改动：

```text
- .all(|c| matches!(c, '0'..='9') || "一二三四五六七八九十百零两".contains(c))
+ .all(|c: char| c.is_ascii_digit() || "一二三四五六七八九十百零两".contains(c))
```

- 按 lint 建议做等价改写（`'0'..='9'` 全集 ≡ `is_ascii_digit()`），未加 `#[allow]`、未顺手改任何其他内容。改后复跑 `cargo fmt --check` 退出码仍为 **0**。

## 4. 全量 diff 复核（任务 2.3）

- `git status --short`：src-tauri 下恰好 **11 个 Rust 文件**被修改；另有预先存在的 `M AGENTS.md` 与未跟踪的 `openspec/changes/fix-rust-format-and-clippy-hygiene/`（非本任务改动，未触碰）。
- `git diff --stat -- src-tauri`：**11 files changed, 628 insertions(+), 357 deletions(-)**（完整 diff 存 `logs/git-diff-after-fmt.txt`）。逐文件：

```text
 src-tauri/examples/docx_read_spike.rs    |  42 ++--
 src-tauri/examples/fdx_read_spike.rs     |  21 +-
 src-tauri/src/project/document_import.rs |  79 ++++---
 src-tauri/src/project/docx_import.rs     | 347 ++++++++++++++++++++-----------
 src-tauri/src/project/fdx_import.rs      | 161 +++++++++-----
 src-tauri/src/project/md_import.rs       |  85 ++++++--
 src-tauri/src/project/mod.rs             |  6 +-
 src-tauri/tests/fdx_import_test.rs       |  87 +++++---
 src-tauri/tests/import_fidelity_test.rs  |  32 ++-
 src-tauri/tests/markdown_import_test.rs  |  45 ++--
 src-tauri/tests/word_import_test.rs      |  80 +++----
```

- 审查方法：除人工逐段核对外，用 `git diff --word-diff=plain -- src-tauri` 做词级机械筛查（词级标记是语义改动的可靠信号）。结论：**除 `docx_read_spike.rs:59` 一处预期等价改写外，全部词级变化均为格式类**——方法链/参数/结构体字面量的换行与缩进重排、rustfmt 拆行/并行时的尾逗号增删、`mod` 声明按字母序重排（`mod.rs`）、`use` 导入排序（`mod.rs`、`word_import_test.rs`）。未发现任何可疑语义改动。
- 三类文件分账与第 2.1 节实测表一致（当前范围 91 处、既有范围外 30 处、待分诊 29 处）。
- 工程噪音注记：git 对这 11 个文件提示 "LF will be replaced by CRLF"（仓库 autocrlf 行为 + rustfmt 输出 LF），为既有换行约定提示，不影响 diff 与构建。

## 5. 验证结果（任务 3.1–3.3）

### 5.1 单项门槛（本 change 直接目标）

| 命令 | 退出码 | 备注 |
|---|---|---|
| `npm run fmt:rust`（修复后） | **0** | 任务 3.1 ✅ |
| `npm run clippy:rust`（修复后） | **0** | 任务 3.2 ✅，`Finished dev profile ... in 10.43s` |

### 5.2 总门禁 `npm run check`（任务 3.3）

- **整链结果（2026-10-04 复跑，经 3.5 忽略名单修复后）：退出码 0，全链全绿**；输出尾部存 `logs/npm-check-after.txt`。首跑曾在 lint 步失败（史实与处置见 5.3／5.4），当时链上其余科目已逐科单独补跑确认全绿，本次为整链一次通过。
- 链定义：`typecheck && lint && test:frontend && test:reliability && test:driver && test:validation && build && fmt:rust && clippy:rust && test:rust`。
- 各步实测（复跑，整链内）：

| 步骤 | 结果 | 退出码 | 计数 |
|---|---|---|---|
| typecheck | 通过 | 0（链继续） | — |
| lint | **通过（经 3.5 修复后）** | 0 | 0 errors（首跑的 363 错误全部来自被忽略的本地目录，见 5.3／5.4） |
| test:frontend | 通过 | 0 | **tests 1181 / pass 1181 / fail 0 / skipped 0**，与基线 1181 一致 |
| test:reliability | 通过 | 0 | tests 120 / pass 120 / fail 0 |
| test:driver | 通过 | 0 | tests 13 / pass 13 / fail 0 |
| test:validation | 通过 | 0 | tests 78 / pass 78 / fail 0 |
| build | 通过 | 0 | vite built in 1.20s |
| fmt:rust | 通过 | 0 | 见 5.1 |
| clippy:rust | 通过 | 0 | 见 5.1 |
| test:rust | 通过 | 0 | **合计 544 passed / 0 failed / 4 ignored / 0 measured**（lib 417+1 ignored；export 19；fdx 10；import_fidelity 3；llm_config 33；markdown_export 16；markdown_import 6；on_demand_negative 2；project 33；real_link 0+3 ignored；word 5；main/doc 0），与基线 544／0／4 一致 |

### 5.3 lint 失败定性：预先存在、范围外、与本 change 无关

- 363 个错误的 **16 个涉事文件全部**位于 `本地测试文档\导入冒烟证据\`（fdx / md / word / 保真 / 对话框冒烟脚本）。
- `git check-ignore` 证实 `本地测试文档/` 整目录在 `.gitignore` 第 26 行被忽略，`git ls-files 本地测试文档` 计数为 **0**（git 零跟踪）；文件时间戳均为 2026-10-02/03，早于本次会话（2026-10-04）——即 2026-10-03 导入冒烟验收当场所留。
- 本 change 的 diff 仅触及 `src-tauri` 下 11 个 Rust 文件，与 lint 结果零交集；失败机制是 lint 脚本 `eslint .` 不读 `.gitignore`，把未跟踪的本地证据脚本扫入。
- CI（干净检出）不存在这些文件，同一门禁不受影响。
- **处置：按"不相关且范围外 → 不动"执行**——未修改这些 .mjs、未改 eslint 配置、未改 .gitignore；如实记录并上报，由用户决定后续（属工程卫生⑥之外的新事项，如需处理应另立 change）。**后续：2026-10-04 用户拍板补 lint 忽略名单，已由任务 3.5 闭合（见 5.4）。**

### 5.4 lint 阻塞处置（2026-10-04 补充，任务 3.5）

- **根因与证据**：`npm run lint`（`eslint .`）不读 `.gitignore`，把未跟踪本地证据目录扫入——首跑 363 个错误全部位于 `本地测试文档\导入冒烟证据\` 下 16 个 `.mjs`（`git check-ignore` 证实整目录被 `.gitignore:26` 忽略、`git ls-files` 计数 0、文件时间戳 2026-10-02/03 早于本次会话）；本 change 的 diff 与 lint 结果零交集；CI 干净检出不存在这些文件、同一门禁不受影响（此为推断，CI 未实测）。
- **探针**：`npx eslint . --ignore-pattern "本地测试文档/**"` 退出码 **0**（零输出）。如实注明：探针在配置已修补后执行，忽略名单与 CLI 参数同时生效。
- **修复**：仓库根 `eslint.config.js` 的 `ignores` 数组追加两项＋一行中文注释（参照 `public/vendor/**` 既有注释风格），不改任何 lint 规则、不动 `.gitignore`、不动其他文件：

```diff
       // 离线捆绑的第三方静态资产（Paged.js 压缩版）：不是本仓库源码，不参与 lint。
       "public/vendor/**",
+      // 本地工作目录（gitignored 的测试证据/草稿，不入库）：不是仓库源码，不参与 lint。
+      "本地测试文档/**",
+      ".omo/**",
```

- **复跑**：`npm run check` 整链退出码 **0**（全链全绿；各步计数见 5.2——前端 1181／Rust 544 通过／0 失败／4 忽略，与基线零回退）；输出尾部存 `logs/npm-check-after.txt`。

## 6. 行为零变化说明

- 150 处格式差异全部为 rustfmt 默认风格的换行／缩进／尾逗号／`mod` 与 `use` 排序，不改任何 token 语义（word-diff 词级筛查佐证）。
- 唯一代码改写为 `docx_read_spike.rs:59` 的等价表达（`matches!(c, '0'..='9')` ≡ `c.is_ascii_digit()`，并为闭包参数补类型标注 `|c: char|`），且该文件是 examples 冒烟脚本，不进产品二进制。
- 行为面证据：Rust 全量测试 544 通过／0 失败／4 忽略（与基线逐位一致）、前端 1181 通过（一致）、clippy 全目标零告警后编译测试均通过——无任何行为回归迹象。

## 7. 诚实边界

- **本项无需真机冒烟**：不涉及新窗口、插件权限、CSP、外部进程、文件对话框（proposal Impact 明示），未做 CDP 端到端驱动。
- **首跑本地 lint 阻塞已由任务 3.5 闭合（2026-10-04 用户拍板补 eslint 忽略名单），复跑 `npm run check` 退出码 0、全链全绿**（Rust 544／前端 1181 零回退）；首跑失败史实与处置过程完整保留于 5.2–5.4，不抹除。
- 未做：git 提交／推送、`openspec archive`、`.gitignore` 修改、`本地测试文档` 内容修改、AGENTS.md／行动计划／前端代码／依赖清单改动（`eslint.config.js` 的忽略名单两项＋注释为 3.5 经用户拍板的唯一例外）。
- 未验证：CI 双平台实际运行（本地无法代表；CI 干净检出不受 5.3 所述本地文件影响，此为推断而非实测）；macOS/Linux 非目标平台。
- 本地与 CI 工具链若存在 rustfmt/clippy 版本差异，残余差异以 CI 实测为准（design 风险条目预留）。

## 8. 原始日志清单（`verification/logs/`）

| 文件 | 内容 |
|---|---|
| `fmt-check-before.txt` | 修复前 `npm run fmt:rust` 完整原始输出（退出码 1，11 文件 150 处） |
| `clippy-before.txt` | 修复前 `npm run clippy:rust` 完整原始输出（退出码 101，唯一错误 docx_read_spike.rs:59） |
| `git-diff-after-fmt.txt` | 格式化＋clippy 修复后的完整 `git diff -- src-tauri` |
| `npm-check.txt` | 首跑 `npm run check`（lint 阻塞）输出尾部（lint 363 错误原文＋汇总行；史实证据） |
| `npm-check-after.txt` | 3.5 修复后复跑 `npm run check`（退出码 0，全链全绿）输出尾部 |
