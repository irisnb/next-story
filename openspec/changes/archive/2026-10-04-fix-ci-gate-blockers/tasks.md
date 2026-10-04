## 1. 准备与扫描

- [x] 1.1 两处根因复现证据整理入档（CRLF 模拟：1 挂 17 过、还原哈希一致；最小实验：`Err`-only + `impl FnOnce` 报 E0282、`Box` 写法通过）→ `verification/validation.md`
- [x] 1.2 扫描同类风险：仓库内其他"文本夹具参与字节级比对/哈希"场景，列清单并决定加固范围（初查：docx/fdx 为解析式读取、运行时 `content_hash` 自洽，暂不需要）

## 2. 修复

- [x] 2.1 `src-tauri/src/pdf_print.rs` 非 Windows 分支签名改为 `Result<Box<dyn FnOnce() -> Result<(), String>>, String>`；复查调用点（`pdf_print.rs:210–219`）两种形态均兼容
- [x] 2.2 新增根 `.gitattributes`：`sidecar/reliability/long-context/materials/*.txt text eol=lf`
- [x] 2.3 `sidecar/reliability/long-context/generator.mjs`：手写档读取做 `\r\n → \n` 归一（导出可复用归一函数，供测试共用）
- [x] 2.4 `sidecar/reliability/tests/long-context.test.mjs`：新增 CRLF 变体哈希回归用例（与读取路径共用归一函数）
- [x] 2.5 按 1.2 清单加固同类场景（无则记录"无"）——扫描结论"无"，见 `verification/validation.md` 第 2 节

## 3. 本地验证

- [x] 3.1 `npm run check` 全绿（Windows 本地；Rust／前端测试计数不回退）
- [x] 3.2 CRLF 模拟复跑：临时转 CRLF 后 reliability/long-context 全部通过（验证归一生效），随后按字节还原并核对哈希与工作区干净
- [x] 3.3 最小实验复核：`Box` 写法在本地 rustc 1.96.1 编译通过（实验文件与结果记录）

## 4. CI 验证与收尾

- [x] 4.1 提交并推送（用户确认后；遵守 git-master 规范）——commit `60a76b4`＋`1a1ff54` 已推送 origin/main
- [x] 4.2 盯 CI：双平台全绿 → 记录 run id 与结论；若露出下一层门禁阻塞 → 修复（回第 2/3 节）→ 重推，直至双绿——第 1 轮 run `37211806698`：Windows 绿、Linux 暴露死代码层（已清）；第 2 轮 run `37212615363`：**双平台全绿**
- [x] 4.3 `verification/validation.md`：根因复现、修复内容、本地验证、CI run 记录与诚实边界（含第 5 节逐层清理记录）
- [x] 4.4 归档（用户确认）并更新行动计划与进度清单——归档 `openspec/changes/archive/2026-10-04-fix-ci-gate-blockers/`；行动计划 2026-10-04 更新（二）＋账本第 23 条
