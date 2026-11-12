# 验证记录：fix-dependabot-security-alerts（2026-11-12）

## 告警清单（8 条，2026-11-12 查明）

- zip（Rust，src-tauri/Cargo.lock，8.6.0）：#30 critical CVE-2026-115905（Zip Cloaking，修复 9.0.5）、#34/#33/#31 high（修复 9.0.0）、#32 medium（修复 9.0.0）。zip 8.x 全系已被 crates.io 下架（zip-rs/zip2#1075）。
- happy-dom（npm，package-lock.json，20.14.5）：#27 high（修复 21.0.4）、#29 high（修复 21.0.0）、#28 medium（修复 20.14.6）。
- 阻塞关系：docx-rs 0.4.22（最新发布）要求 `zip ^8.6.0`；上游主线 ad7fede6a7（2026-10-17 合并，即 zip 9.0.4 升级提交）接受 zip 9。

## 实施

- `src-tauri/Cargo.toml`：docx-rs `=0.4.22` → git 钉 `bokuweb/docx-rs @ ad7fede6a7`（注释含提交号/理由/切回条件）；zip `8.6` → `9.0.5`（deflate-only 不变）。
- `cargo tree -i zip`：**全树单一 zip v9.5.1**（≥9.0.5，覆盖全部五条修复门槛），docx-rs（git 源）与直接依赖共用。
- 代码适配两处（zip 9 的 `name()` 返回 `Result`，即 CVE-2026-115905 修复语义）：
  - `src/project/docx_import.rs` 预扫描：文件名无法安全解析 → 失败关死，中文报错「压缩包内文件名无法安全解析，已拒绝导入（可能是恶意文件）」。
  - `tests/export_test.rs` 名单收集：自家导出包名必然可解析，`.expect("entry name")`。
  - ZipWriter/SimpleFileOptions（测试夹具）未受 zip 9 影响，零适配。
- `package.json`：happy-dom `^20.14.5` → `^21.0.4`；lock diff 仅该包及嵌套 entities，另含锁内 version 字段 0.1.0→0.1.1 的 npm 自动归一（对齐 package.json 0.1.1，无害）。
- 长期账本挂账：docx-rs 切回 crates.io 的条件已记入行动计划「四、长期账本」。

## 验证（全绿）

- `cargo check` / `npm run fmt:rust`（--check）/ `npm run clippy:rust`（--all-targets -D warnings）：通过。
- `npm run test:rust`：exit=0（单元 537 过 1 既有忽略＋集成全过）；**docx-rs 主线相对 0.4.22 零行为漂移，导入金样本无一调整**。
- `npm run test:frontend`：1413/1413 全过；happy-dom 21 行为怪癖零变化，夹具无一调整。
- `npm run check` 全链：exit=0。
- 本地 `npm audit` 因 registry TLS 瞬断未跑成（网络间歇问题，与 git push 首次失败同源）；告警真相以 GitHub 复扫为准（见 3.2）。

## 3.2 远端复扫（推送 `f502226` 后，2026-11-12 实测）

- **原 8 条告警全部自动关闭**：zip #30/#31/#32/#33/#34（critical 1 high 3 medium 1）与 happy-dom #27/#28/#29（high 2 medium 1）。`gh api` 复扫实数 total=35、open=1（仅下述新条目）。
- **复扫新出现 #35 minimatch medium**（DoS via globparts amplification，修复版 11.0.1）：
  - **非本次引入**：`git show HEAD~1:package-lock.json` 已含相同 minimatch ^10.2.x 条目；告警 created_at 2026-11-12T13:37，公告随复扫新发。
  - **范围**：eslint / typescript 等开发工具链传递依赖，不随产品分发；中危 DoS，实际风险可忽略。
  - **处置**：唯一修复版 11.0.1 跨大版本、父级范围锁 ^10.2.x，范围内无修复版（root-dev-dependency-hygiene 既有路径不适用，MUST NOT 以 overrides 钉版）。挂长期账本：待上游工具链采纳 minimatch 11 后随例行升级收敛；若期间需要主动处置另立 change 拍板。

