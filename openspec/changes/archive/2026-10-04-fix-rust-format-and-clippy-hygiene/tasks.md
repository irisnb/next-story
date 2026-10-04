## 1. 准备与复核

- [x] 1.1 复跑 `cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings`，核对清单与归档 `verification/quality-gates-20261003.md` 一致；如有漂移以实测为准并记录
- [x] 1.2 确认执行环境：关闭运行中的开发应用，或设独立 `CARGO_TARGET_DIR`，并记录所选方式

## 2. 修复

- [x] 2.1 执行 `cargo fmt`（`--manifest-path src-tauri/Cargo.toml`），归零 11 文件 150 处格式差异
- [x] 2.2 修复 `src-tauri/examples/docx_read_spike.rs:59` clippy 告警：`matches!(c, '0'..='9')` → `c.is_ascii_digit()`（等价）
- [x] 2.3 全量 git diff 复核：唯一语义改动为 2.2 一处等价改写，其余仅为换行／缩进／导入排序；按当前范围／既有范围外／待分诊三类分账

## 3. 验证与记录

- [x] 3.1 `npm run fmt:rust` 退出码 0
- [x] 3.2 `npm run clippy:rust` 退出码 0
- [x] 3.3 `npm run check` 全绿（Rust 544／前端 1181 基线零回退；Rust 门槛运行前确保开发应用未占用 target）——2026-10-04 复跑退出码 0（全链全绿；Rust 544／前端 1181 零回退）；首跑曾在 lint 步被本地未跟踪证据目录阻塞，经 3.5 忽略后闭合（过程见 verification/validation.md 第 5 节）
- [x] 3.4 `verification/validation.md`：记录门禁结果、三类文件分账、行为零变化说明与诚实边界（本项无需真机冒烟）
- [x] 3.5 eslint.config.js 忽略本地工作目录（本地测试文档/**、.omo/**）；整链 npm run check 复跑退出码 0
