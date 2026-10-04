## Why

main 分支的 CI 双平台门禁自 2026-09-26 之后持续红灯（近 60 次 CI 运行中，9-26 之后无一成功）。本轮排查确诊两项相互独立的阻塞，且均有本地可复现实验：

1. **Linux 编译阻塞**：`src-tauri/src/pdf_print.rs:366` 的 `#[cfg(not(windows))]` 分支只返回 `Err(...)`，返回类型却是 `Result<impl FnOnce() -> Result<(), String>, String>`——泛型 `T` 无法推断，触发 E0282/E0283 编译错误。本地 1.96.1 最小实验同样复现（`Err`-only 与 `impl Trait` 组合的写法缺陷），**并非编译器版本差异**；本机为 Windows、从不编译该分支，本地检查永远看不到。
2. **Windows 夹具阻塞**：`sidecar/reliability/long-context/materials/coherent-10k.txt` 的内容哈希按 LF 计算；CI 的 Windows 检出按 autocrlf 转为 CRLF 后重新计算的哈希失配，`test:reliability` 的「磁盘夹具全部通过校验」失败。本地 CRLF 模拟精确复现 CI 报错（1 挂 17 过），还原后字节哈希一致。

「本地全绿 ≠ CI 全绿」：Windows 本机既看不到非 Windows 编译分支，也看不到 CI 的检出换行差异。本项验收只能以 CI 双平台全绿为准。

## What Changes

- **修复非 Windows 编译阻塞**：`pdf_print.rs` 非 Windows 分支改为具体返回类型 `Result<Box<dyn FnOnce() -> Result<(), String>>, String>`（语义不变：仍立即返回同一中文错误；调用点 `pdf_print.rs:210–219` 对 Box 与 impl 两种形态均兼容；Windows 分支不动）。
- **修复夹具换行阻塞（双保险）**：新增根 `.gitattributes` 固定 `sidecar/reliability/long-context/materials/*.txt text eol=lf`；`generator.mjs` 读取手写档时做 `\r\n → \n` 归一。两者共同保证"同一内容、同一哈希"跨平台成立；哈希语义保持 LF 基准，存档哈希不变。
- **回归防护**：`long-context.test.mjs` 新增 CRLF 变体用例（CRLF 输入经归一后哈希与存档一致）。
- **同类风险扫描**：扫描仓库内其他"文本夹具参与字节级比对/哈希"的场景；同类一并加固或记录清单。
- **行为保持**：不改产品行为、导出流程语义或任何夹具内容。
- **验证目标**：本地 `npm run check` 全绿 + CRLF 模拟回归；推送后 CI **双平台全绿**。若露出下一层门禁阻塞，同一 change 内逐层清理并记录。

## Capabilities

### New Capabilities

无（工程修复，不新增能力）。

### Modified Capabilities

- `ci-pipeline`：新增两项工程不变量——非 Windows 目标分支必须可编译（跨平台编译覆盖）；文本夹具以 LF 规范化检出与读取（夹具字节稳定性）。

## Impact

- 代码：`src-tauri/src/pdf_print.rs`（非 Windows 分支签名一处）；`sidecar/reliability/long-context/generator.mjs`（读取归一）。
- 配置：新增 `.gitattributes`（目标路径 `text eol=lf`）。
- 测试：`sidecar/reliability/tests/long-context.test.mjs`（CRLF 回归用例）。
- CI：验收以双平台实跑为准；此前从未在 CI 跑完的科目（`test:rust` 等）如暴露同类阻塞，同 change 清理。
- 不涉及：产品功能、UI、档案格式；Rust 工具链钉死（记录为候选，另行讨论）。
