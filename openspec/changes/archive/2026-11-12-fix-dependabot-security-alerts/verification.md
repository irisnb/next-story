# 验证记录：fix-dependabot-security-alerts（2026-11-12）

## 告警清单（8 条，2026-11-12 查明）

- zip（Rust，src-tauri/Cargo.lock，8.6.0）：#30 critical CVE-2026-115905（Zip Cloaking，修复 9.0.5）、#34/#33/#31 high（修复 9.0.0）、#32 medium（修复 9.0.0）。zip 8.x 全系已被 crates.io 下架（zip-rs/zip2#1075）。
- happy-dom（npm，package-lock.json，20.14.5）：#27 high（修复 21.0.4）、#29 high（修复 21.0.0）、#28 medium（修复 20.14.6）。
- 阻塞关系：docx-rs 0.4.22（最新发布）要求 `zip ^8.6.0`；上游主线 ad7fede6a7（2026-10-17 合并，即 zip 9.0.4 升级提交）接受 zip 9。

## 实施

- `src-tauri/Cargo.toml`：docx-rs `=0.4.22` → git 钉 `bokuweb/docx-rs @ ad7fede6a7`（注释含提交号/理由/切回条件）；zip `8.6` → `9.0.5`（deflate-only 不变）。
- `cargo tree -i zip`：**全树单一 zip v9.5.1**（≥9.0.5，覆盖全部五条修复门槛），docx-rs（git 源）与直接依赖共用。
- 代码适配两处（zip 9 的 `name()` 解码 API 变化，返回 `Result`；归因勘误见下方「独立审查与加固」）：
  - `src/project/docx_import.rs` 预扫描：文件名解码失败 → 失败关死，中文报错「压缩包内文件名无法安全解析，已拒绝导入（可能是恶意文件）」。
  - `tests/export_test.rs` 名单收集：自家导出包名必然可解析，`.expect("entry name")`。
  - ZipWriter/SimpleFileOptions（测试夹具）未受 zip 9 影响，零适配。
- `package.json`：happy-dom `^20.14.5` → `^21.0.4`；lock diff 仅该包版本/地址/摘要条目（嵌套 entities 无变化——原文误记已纠正），另含锁内 version 字段 0.1.0→0.1.1 的 npm 自动归一（对齐 package.json 0.1.1，无害）。
- 长期账本挂账：docx-rs 切回 crates.io 的条件已记入行动计划「四、长期账本」。

## 验证（全绿）

- `cargo check` / `npm run fmt:rust`（--check）/ `npm run clippy:rust`（--all-targets -D warnings）：通过。
- `npm run test:rust`：exit=0（单元 537 过 1 既有忽略＋集成全过）；**现有全部测试未观察到 docx-rs 主线相对 0.4.22 的行为差异**，导入金样本无一调整（审查指正后如实收敛表述：上游存在读侧保真改进、脚注解析、导出压缩方式等实现变化，现有断言未覆盖这些差异面，不宣称「零行为漂移」）。
- `npm run test:frontend`：1413/1413 全过；happy-dom 21 行为怪癖零变化，夹具无一调整。
- `npm run check` 全链：exit=0。
- 本地 `npm audit` 因 registry TLS 瞬断未跑成（网络间歇问题，与 git push 首次失败同源）；告警真相以 GitHub 复扫为准（见 3.2）。

## 独立审查与加固（oracle，2026-11-12；P1×2 修复、P2×2 采纳）

1. **[P1→已修] 声明大小分配炸弹**：预扫描原先只限真实解压量，而 docx-rs 主线 `read_zip.rs:18-19` 按条目**声明大小** `Vec::with_capacity` 预留内存——「声明超大、实际极小」的恶意包可穿透真实量设卡后触发巨额分配。修复：预扫描新增逐条目声明大小上限（>`MAX_IMPORT_ENTRY_BYTES` 即中文拒绝）；新增恶意夹具测试 `declared_size_bomb_rejected_before_allocation`（手工改写本地头＋中央目录的未压缩大小字段构造畸形包，实测拒绝、报错文案断言）。
2. **[P1→已修] CVE 归因勘误**：`name()` 返回 `Result` 是 zip 9 的解码 API 变化，**不是** CVE-2026-115905 双头校验本身。源码核查：zip 9.5.1 `types.rs:137-146`（UTF-8 失败回退 CP437）＋`cp437.rs:17-31`（含高位字节走 256 全表映射、纯 ASCII 恒成功）⇒ **Err 路径对任何真实字节输入不可达**；失败关死处理保留为纵深防御（未来 zip 收紧解码语义即就位）。双头一致性（Zip Cloaking）实际防线＝docx-rs 主线 `read_zip.rs:31-61 validate_ascii_part_names`（本地头与中央目录原始 ASCII 名与解析名逐一比对）。注释与本文档原「即 CVE-2026-115905 修复语义」表述已纠正。
3. **[P2→已采纳] 目录短路后移**：文件名解码校验移到 `is_dir()` 短路之前，目录条目的名字也必经校验。
4. **[P2→已采纳] 锁文件 diff 误记**：「及嵌套 entities 条目」删除（审查核对 HEAD~2：entities 无变化）。
5. **[审查撤销一项] 不可达 Err 路径的可构造测试**：曾尝试构造「UTF-8 标志＋非法序列名字」夹具（0xFF 字节），实测 CP437 全表回退解出 `ÿ…` 后安全放行（怪名字匹配不到任何部件名，无害）——证实该路径不可达，测试撤销，结论如实记录。
6. 通过项（审查核对，未改动）：实际解压量限额逻辑、cargo tree 单一 zip 9.5.1、image feature 关闭、export_test `expect` 语义、会话列表夹具相对时间的日历边界安全、happy-dom 21 依赖树无冲突、账本挂账在案。

加固后复验：docx_import 科目 54/54（含新恶意夹具）；全链 `npm run check` 结果见下方复验记录。

## 加固后全链复验（2026-11-12）

- `npm run fmt:rust`（--check）/ `npm run clippy:rust`（--all-targets -D warnings）：通过。
- `npm run test:rust`：exit=0。
- `npm run check` 全链：exit=0（回填于提交前最终复跑）。

## 3.2 远端复扫（推送 `f502226` 后，2026-11-12 实测）

- **原 8 条告警全部自动关闭**：zip #30/#31/#32/#33/#34（critical 1 high 3 medium 1）与 happy-dom #27/#28/#29（high 2 medium 1）。`gh api` 复扫实数 total=35、open=1（仅下述新条目）。
- **复扫新出现 #35 minimatch medium**（DoS via globparts amplification，修复版 11.0.1）：
  - **非本次引入**：`git show HEAD~1:package-lock.json` 已含相同 minimatch ^10.2.x 条目；告警 created_at 2026-11-12T13:37，公告随复扫新发。
  - **范围**：eslint / typescript 等开发工具链传递依赖，不随产品分发；中危 DoS，实际风险可忽略。
  - **处置**：唯一修复版 11.0.1 跨大版本、父级范围锁 ^10.2.x，范围内无修复版（root-dev-dependency-hygiene 既有路径不适用，MUST NOT 以 overrides 钉版）。挂长期账本：待上游工具链采纳 minimatch 11 后随例行升级收敛；若期间需要主动处置另立 change 拍板。

