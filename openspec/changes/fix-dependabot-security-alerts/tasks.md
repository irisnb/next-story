# Tasks: fix-dependabot-security-alerts

## 1. Rust 侧（zip 五条：1 严重 3 高 1 中）

- [x] 1.1 `src-tauri/Cargo.toml`：docx-rs 改钉 `bokuweb/docx-rs @ ad7fede6a7`（注释记录提交号、理由、切回条件）；zip 改 `{ version = "9.0.5", default-features = false, features = ["deflate"] }`；`cargo update` 后 `cargo tree -i zip` 确认全树仅一个 zip 且 ≥9.0.5——实测全树单一 zip v9.5.1（docx-rs git 源与直接依赖共用）
- [x] 1.2 编译适配 zip 9 / docx-rs 主线的 API 变化（预期集中在 docx_import.rs 测试夹具的 ZipWriter 用法与读侧错误路径）；`npm run fmt:rust` 与 `npm run clippy:rust` 通过——适配两处 `name()` 返回 Result（CVE-2026-115905 修复语义：文件名无法安全解析＝失败关死拒绝导入）：docx_import.rs 预扫描、export_test.rs 名单收集；ZipWriter/SimpleFileOptions 用法未受影响；fmt＋clippy（--all-targets -D warnings）通过
- [x] 1.3 `npm run test:rust` 全绿；导入金样本/哈希冻结测试若有差异，逐条归因（上游保真改进 vs 回归）并记录甄别结论；改进类如实更新预期，回归类修代码——exit=0（单元 537＋集成全过），上游主线相对 0.4.22 在全部导入保真测试上零行为漂移，金样本无一调整
- [x] 1.4 长期账本挂账：docx-rs 官方发布要求 zip ≥9.0.5 的 crates.io 版本后切回并移除 git 钉版——已记入「四、长期账本」表

## 2. npm 侧（happy-dom 三条：2 高 1 中）

- [x] 2.1 `package.json` happy-dom `^20.14.5` → `^21.0.4`，`npm install` 更新 lock；确认无 `overrides`、无目标包外条目变动（`git diff package-lock.json` 核对）——diff 仅 happy-dom 20.14.5→21.0.4 及嵌套 entities 条目，另含锁内 version 字段 0.1.0→0.1.1 的 npm 自动归一（对齐 package.json，无害元数据同步）
- [x] 2.2 `npm run test:frontend` 全量；happy-dom 行为怪癖变化导致的夹具失效逐条甄别修正——1413/1413 全过，行为怪癖零变化，夹具无一调整

## 3. 收口验证

- [x] 3.1 `npm run check` 全链全绿（typecheck → lint → 前端 → 可靠性 → 驱动 → 验证 → 构建 → fmt → clippy → Rust）——exit=0
- [x] 3.2 提交推送后 `gh api repos/irisnb/next-story/dependabot/alerts` 复扫，8 条告警关闭状态如实记录（GitHub 复扫有延迟属预期，不提前宣称）；结果记入本 change 验证记录——推送 `f502226` 后复扫：**原 8 条全部自动关闭**（zip 五条＋happy-dom 三条）；复扫同时新出现 #35 minimatch medium（公告 2026-11-12T13:37 新发，dev 工具链传递依赖、非本次引入——HEAD~1 锁文件已含同版本；范围内无修复版，挂账另议，见验证记录）
