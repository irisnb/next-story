## Context

诊断（2026-10-04，均有本机复现）：
- CI 最近一次成功为 2026-09-26；其后运行全部失败（近 60 次运行分账：失败 31／成功 29，成功均在 9-26 之前）。
- Linux 任务止于 `Run unified checks` 的 clippy 编译：`pdf_print.rs:366` 报 E0282/E0283；本地 1.96.1 最小实验（`Err`-only + `impl FnOnce` 返回类型）同样报错，改为 `Box<dyn FnOnce() -> Result<(), String>>` 后通过——写法缺陷，与编译器版本无关。
- Windows 任务止于 `test:reliability` 的「磁盘夹具全部通过校验」：把 `coherent-10k.txt` 临时转 CRLF 后本地精确复现（1 挂／17 过），按字节还原后哈希一致、工作区干净。
- 本地 Windows 的 `npm run check` 无法覆盖上述两类：非 Windows 分支不参与编译；本机检出为 LF。

## Goals / Non-Goals

**Goals:**

- 清除两个已确诊阻塞，并按 CI 实跑结果逐层清理"门禁阻塞类"问题，直至双平台全绿。
- 让"内容哈希夹具跨平台稳定"成为有规格、有回归用例的不变量。

**Non-Goals:**

- 不改 Windows 导出路径逻辑与任何产品行为。
- 不钉死 Rust 工具链版本（记录为后续候选；本项以 CI 实跑对齐）。
- 不处理与本门禁无关的既知遗留（如导入保真缺陷①–⑤）。

## Decisions

- **D1：`pdf_print.rs` 非 Windows 分支只改签名、不改语义。** 采用 `Result<Box<dyn FnOnce() -> Result<(), String>>, String>`：`Err` 仍立即返回、错误消息不变；调用点 `Ok(wait_completed) => wait_completed()` 对 Box 与 impl 两种形态均成立。替代方案：Windows 分支一并统一 Box（多余改动、风险大，不取）；`fn()` 函数指针（可行但可读性差，不取）。最小实验已验证。
- **D2：夹具换行"双保险"。** `.gitattributes` 固定 `text eol=lf`（检出层面）＋ `generator.mjs` 读取归一 `\r\n → \n`（读取层面）——任一层生效即可全绿，两层同留以防手工编辑／本机换行差异。哈希对"LF 规范化内容"计算；已入库哈希（LF 基准）不变。替代：仅 gitattributes（手工编辑仍可破坏）或仅归一（检出仍是 CRLF、文件语义含糊），均不如双保险。
- **D3：回归用例模拟 CRLF。** 归一逻辑应导出为可复用函数（如 `normalizeHandwrittenText`），读取路径与回归用例共用同一实现；用例断言 CRLF 变体经归一后哈希与存档一致。
- **D4：验收以 CI 实跑为准。** 本地无法编译非 Windows 分支、无法复刻 CI 检出环境；本地做等价模拟（CRLF 复现／最小编译实验）作为先行证据，最终以推送后 CI 双平台全绿收口；若再暴露同类阻塞，同 change 内清理并重推。

## Risks / Trade-offs

- [修完一层仍有下一层（`test:rust` 从未在 CI 跑完）] → 以 CI 为准逐层清理；每轮记录 run id 与失败点；与门禁无关的大问题另议。
- [`.gitattributes` 误伤其他文件] → 规则精确到目标路径，不写全仓规则。
- [归一化改变哈希语义] → 仅对读取入口归一；存档哈希已是 LF 基准，回归用例钉住不漂移。
- [本地与 CI 仍有环境差异（Node 版本等）] → 以 CI 结果为准；差异若成阻塞，同 change 内处理并记录。
