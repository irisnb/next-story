# 验证记录：fix-ci-gate-blockers（2026-10-04）

## 1. 上下文摘要

- Linux CI 自 2026-09-26 起止于 clippy 编译：`src-tauri/src/pdf_print.rs:366` 非 Windows 分支 `Err`-only＋`impl FnOnce` 返回类型 → E0282/E0283。
- Windows CI 止于 `test:reliability`「磁盘夹具全部通过校验」：`coherent-10k.txt` 被 autocrlf 检出为 CRLF 后 `validateTier` 的 `deterministic-hash` 重建比对失配（触发链：`validate.mjs:122` `generateTier` 读 .txt → 哈希 ≠ 磁盘 JSON 存档 LF 基准哈希）。
- 两项根因均已有本机复现（诊断阶段）；本记录补齐任务 1.2 扫描、修复内容与本地验证，CI 实跑留待推送后（第 5 节）。
- 环境与工具：Windows／PowerShell 5.1；`rustc/cargo 1.96.1`；`node v24.15.0`；本会话期间无 next-story 进程，cargo 使用默认 `src-tauri/target`。

## 2. 同类风险扫描（任务 1.2）

结论：**除 `sidecar/reliability/long-context/materials/*.txt` 外无同类风险**（2.5 记"无"）。明细：

### sidecar 侧（全部 `readFileSync` 用法逐类归账）

| 类别 | 位置 | 判定 |
|---|---|---|
| 解析式读取（`JSON.parse`／`yaml.load`） | `driver/gen-config.mjs`、`driver/protocol.mjs`、`reliability/runner.mjs:120→loadAndValidate`、`reliability/review.mjs`、`reliability/rescore.mjs`、`reliability/tests/{screening,schema,rescore}.test.mjs`、`long-context/{validate,build-cases}.mjs`（manifest／materials／oracles JSON） | 换行差异被解析器吸收，无字节级比对/哈希 |
| 源码文本检查（禁用 API 扫描等） | `driver/tests/protocol.test.mjs:15-19`、`validation/tests/config-guard.test.mjs:33,54` | 非哈希/字节比对；本机 CRLF 检出（autocrlf 工作区）下 `npm run check` 长期全绿，证明对检出换行不敏感 |
| 运行时自写文件全等比对 | `reliability/tests/rescore.test.mjs:279-280`（"干跑不得改证据文件"） | 比对对象为同轮运行内 `writeFileSync` 写入的文件，同机同写入器自洽，与检出无关 |
| 存在性探测 | `reliability/tests/review.test.mjs:84` | 不比对内容 |
| 手写档 .txt 读取 | `long-context/generator.mjs:186`（唯一被跟踪的 .txt＝`coherent-10k.txt`） | **本次修复对象**（.gitattributes＋读取归一双保险） |
| 非门禁路径 | `probe/probe.mjs:365`（人工诊断工具，不在 test 脚本范围）、`openspec/.../archive/**`（归档证据脚本） | 不参与 CI 门禁 |

- materials 目录其余文件为生成式 JSON（`tier-*.json`）：`JSON.stringify` 把 text 内换行写成 `\n` 转义序列，跨平台检出稳定；sidecar 下其余 .txt 全在 `node_modules`（不入库）。

### src-tauri 侧

- 导入夹具为解析式读取（docx 二进制 `fs::read`＋zip 解析；fdx XML `read_to_string`＋XML 解析），无文本字节级断言。
- 测试断言读取的档案文件（notebook／metadata／tree）均为测试运行时自写，同机自洽；运行时 `content_hash`（导入预检）对用户本机文件计算，同机自洽，与 CI 检出无关。
- `examples/md_parse_spike.rs` 为 spike 工具，非测试断言。

## 3. 修复内容（任务 2.1–2.5）

- **2.1** `src-tauri/src/pdf_print.rs` 非 Windows 分支（361–368 行区域）仅改签名一行：`Result<impl FnOnce() -> Result<(), String>, String>` → `Result<Box<dyn FnOnce() -> Result<(), String>>, String>`。`Err` 消息与语义不变；调用点 `pdf_print.rs:210–219`（`Ok(wait_completed) => wait_completed()`）对 `Box<dyn FnOnce>` 与 `impl FnOnce` 两种形态均兼容（`Box<dyn FnOnce>` 实现 `FnOnce`）。**Windows 分支（约 255–359 行）零改动**（diff 确认仅 1 行）。改后 `cargo fmt --manifest-path src-tauri/Cargo.toml --check` 退出码 **0**。
- **2.2** 新建仓库根 `.gitattributes`（144 字节，两行＋末尾换行）：

```gitattributes
# 内容哈希夹具：跨平台检出统一 LF（Windows autocrlf 不得转换）
sidecar/reliability/long-context/materials/*.txt text eol=lf
```

- **2.3** `generator.mjs`：`materialHash` 之后新增并导出 `normalizeHandwrittenText`（`/\r\n?/g → "\n"`）；手写档读取行改为 `text = normalizeHandwrittenText(readFileSync(txtPath, "utf8"))`。哈希语义保持 LF 基准，存档哈希不变。
- **2.4** `long-context.test.mjs`：import 加入 `normalizeHandwrittenText`（与 materialHash 同一 import，改多行式）；「磁盘夹具全部通过校验」测试后新增用例「CRLF 变体手写档经归一后哈希不漂移（跨平台防护）」——CRLF 变体经归一后等于 LF 文本、哈希等于存档。
- **2.5** 无（按第 2 节扫描结论）。
- diff 复核：本 change 工作区改动恰好为 `pdf_print.rs`（1 行）、`.gitattributes`（新）、`generator.mjs`（函数＋1 行改动）、`long-context.test.mjs`（import＋用例）、change 目录内文件；无意外改动。注：上一 change（fix-rust-format-and-clippy-hygiene）的改动在本会话开始前已由协调方提交入库，工作区不再显示。

## 4. 本地验证（任务 3.1–3.3）

### 4.1 `npm run check`（任务 3.1）

- 退出码 **0**，全链一次通过（typecheck→lint→test:frontend→test:reliability→test:driver→test:validation→build→fmt:rust→clippy:rust→test:rust）；输出尾部存 `logs/npm-check.txt`。
- 计数（与基线零回退，reliability＋1 为新增回归用例）：前端 **tests 1181／pass 1181／fail 0**；reliability **121**／121／0（120＋新用例）；driver **13**／13／0；validation **78**／78／0；build 过（vite built in 1.17s）；fmt:rust／clippy:rust 过；Rust 合计 **544 passed／0 failed／4 ignored**（lib 417+1ig；export 19；fdx 10；import_fidelity 3；llm_config 33；markdown_export 16；markdown_import 6；on_demand_negative 2；project 33；real_link 0+3ig；word 5；main/doc 0）。

### 4.2 CRLF 模拟复跑（任务 3.2，决定性回归）

| 步骤 | 命令/操作 | 结果 |
|---|---|---|
| 备份原始字节 | 复制到 `C:\Users\Administrator\AppData\Local\Temp\opencode\coherent-10k.txt.bak` | 完成；原文件 **0 CR／211 LF**（纯 LF） |
| 原始 SHA-256 | `Get-FileHash` | `CD056B57A6F9EE0C6F02CB8F1E2F599D789E4B9581C2E105EA14A62A00195DC1` |
| 按字节 LF→CRLF 写入 | node 逐字节 `0x0A → 0x0D 0x0A` | 完成；SHA-256 变为 `D5B068BE1AFBE5FCB7022FDB742F95088C712DF57DE90BBAD929EB9DE560E903` |
| CRLF 状态跑测试 | `node --test sidecar/reliability/tests/long-context.test.mjs` | **退出码 0；tests 19／pass 19／fail 0**（修复前同状态为 1 挂 17 过——归一层生效） |
| 按备份字节还原 | 复制回写 | SHA-256 还原为 `CD056B57...95DC1`＝原值；字节回 **0 CR／211 LF** |
| 工作区核对 | `git status --short -- <该文件>` | 输出为空（干净） |

### 4.3 最小实验复核（任务 3.3）

- 实验文件：`C:\Users\Administrator\AppData\Local\Temp\opencode\rpit_bad.rs`／`rpit_good.rs`（诊断阶段创建，本次原样复核）。
- `rustc --edition 2021` 编译 `rpit_bad.rs`（`Err`-only＋`impl FnOnce`）：**退出码 1，error[E0282]（type annotations needed，cannot infer type of `T` on `Result`）＋error[E0283]**——复现 CI Linux 报错，证明是写法缺陷而非编译器版本差异。
- `rustc --edition 2021` 编译 `rpit_good.rs`（`Box<dyn FnOnce() -> Result<(), String>>` 写法，含调用）：**退出码 0，编译通过**——修复写法有效。

## 5. CI 验证与逐层清理记录

### 5.1 第 1 轮（commit `60a76b4`，run `37211806698`）

- **Windows：全绿**——夹具换行双保险生效。
- **Linux：越过签名修复后暴露下一层**——clippy `-D warnings` 下 3 项 `dead_code`，均只被 `#[cfg(windows)]` 分支引用、非 Windows 编译时成为死代码：`PRINT_CALLBACK_TIMEOUT`（`pdf_print.rs:45`）、`enum PrintSignal`（:190）、`PDF_SDK_UNSUPPORTED`（:252）；失败点 `Run unified checks` → clippy `could not compile next-story (lib) due to 3 previous errors`（退出码 101）。
- 处置（第 2 轮，2026-10-04）：三项分别加 `#[cfg(windows)]` 门控；共享代码不引用它们（grep 核实），Windows 分支不受影响。

### 5.2 第 2 轮（commit `1a1ff54`，run `37212615363`）

- 修复内容：`pdf_print.rs` 三处 `#[cfg(windows)]`（+3 行）。本地 `cargo fmt --check`／`npm run clippy:rust` 退出码 0。
- **CI 双平台全绿**（linux＋windows 均 success；2026-09-26 以来首次）——`test:rust` 等此前从未在 CI 跑完的科目完整通过，Linux 未再暴露下一层阻塞。

### 5.3 收口结论

- 两个初始阻塞（非 Windows 编译、夹具换行）＋逐层清理发现的第三项（Windows 专用条目死代码）全部清除；CI 双平台门禁恢复可信。
- 全程记录：第 1 轮 run `37211806698`（Windows 绿／Linux 死代码层）；第 2 轮 run `37212615363`（双平台绿）。

## 6. 诚实边界

- **非 Windows 分支本地不可编译**：本机为 Windows，`#[cfg(not(windows))]` 分支不参与本地编译；按约定未做无意义的 cross-target 尝试（会因系统依赖失败）。该修复的本地证据＝最小实验（4.3）＋签名等价性；**最终验收以 CI Linux 实跑为准**。
- **`.gitattributes` 检出层效果未在本地端到端验证**：`eol=lf` 规则对 CI 干净检出直接生效；本机已有工作区需下次 touch／checkout 才重写。本地 4.2 验证的是"读取归一"层（双保险的另一层），两层共同生效的完整证据在 CI。
- **CI 双平台是本 change 的最终验收标准（design D4）**：尚未提交、未推送、未归档；本地全绿≠CI 全绿。
- 扫描（第 2 节）覆盖 `readFileSync`／Rust 文件读取的可 grep 路径与测试断言形态，未穷尽 hypothetical 的其他哈希入口（当前仓库内容哈希入口仅 materialHash 一族）。
- 工作区状态：本 change 之外无其他未提交改动（上一 change 已由协调方提交入库）。

## 7. 原始日志与证据清单（`verification/logs/`）

| 文件 | 内容 |
|---|---|
| `npm-check.txt` | 任务 3.1 `npm run check`（退出码 0）输出尾部（含各科测试计数与 Rust test result 行） |

实验与模拟证据以第 4 节表内原始数值为准（哈希、退出码、CR/LF 字节计数）；备份文件 `coherent-10k.txt.bak` 留存于 `C:\Users\Administrator\AppData\Local\Temp\opencode\`。
