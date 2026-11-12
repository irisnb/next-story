# Tasks: fix-dependabot-security-alerts

## 1. Rust 侧（zip 五条：1 严重 3 高 1 中）

- [x] 1.1 `src-tauri/Cargo.toml`：docx-rs 改钉 `bokuweb/docx-rs @ ad7fede6a7`（注释记录提交号、理由、切回条件）；zip 改 `{ version = "9.0.5", default-features = false, features = ["deflate"] }`；`cargo update` 后 `cargo tree -i zip` 确认全树仅一个 zip 且 ≥9.0.5——实测全树单一 zip v9.5.1（docx-rs git 源与直接依赖共用）
- [x] 1.2 编译适配 zip 9 / docx-rs 主线的 API 变化；`npm run fmt:rust` 与 `npm run clippy:rust` 通过——适配两处 `name()` 返回 Result（zip 9 解码 API 变化；源码核查见 1.5：Err 路径对真实字节输入不可达，失败关死为纵深防御；双头一致性防线实际由 docx-rs 主线 `validate_ascii_part_names` 承担）：docx_import.rs 预扫描、export_test.rs 名单收集；ZipWriter/SimpleFileOptions 用法未受影响；fmt＋clippy（--all-targets -D warnings）通过
- [x] 1.3 `npm run test:rust` 全绿；导入金样本/哈希冻结测试若有差异，逐条归因（上游保真改进 vs 回归）并记录甄别结论；改进类如实更新预期，回归类修代码——exit=0（单元 537＋集成全过）；**现有全部测试未观察到行为差异**（审查指正：上游存在读侧保真改进、脚注解析、导出压缩方式等实现变化，现有断言未覆盖这些差异面，不宣称「零行为漂移」），金样本无一调整
- [x] 1.4 长期账本挂账：docx-rs 官方发布要求 zip ≥9.0.5 的 crates.io 版本后切回并移除 git 钉版——已记入「四、长期账本」表
- [x] 1.5 独立审查加固（oracle 审查 2026-11-12，P1×2 已修、P2×2 已采纳）：①**声明大小设卡**——预扫描原先只限真实解压量，拦不住「声明超大、实际极小」的分配炸弹（docx-rs 按声明值 `Vec::with_capacity` 预留内存）；新增逐条目声明大小上限＋恶意夹具测试 `declared_size_bomb_rejected_before_allocation`（手工改写 ZIP 头声明大小字段，实测拒绝）。②**CVE 归因纠正**——`name()` 返回 Result 是解码 API 变化而非双头校验；zip 9.5.1 源码核查（types.rs:137＋cp437.rs:17-31）Err 路径不可达，注释与验证记录如实改写。③**目录短路后移**——文件名校验移到 `is_dir` 短路之前，每个条目名字必经校验。④`name()` 不可达 Err 路径的可构造测试经实证撤销（CP437 全表回退，怪名字安全放行且匹配不到任何部件名）

## 2. npm 侧（happy-dom 三条：2 高 1 中）

- [x] 2.1 `package.json` happy-dom `^20.14.5` → `^21.0.4`，`npm install` 更新 lock；确认无 `overrides`、无目标包外条目变动（`git diff package-lock.json` 核对）——diff 仅 happy-dom 20.14.5→21.0.4 的版本/地址/摘要条目（审查核对 HEAD~2：嵌套 entities 无变化，原文误记已纠正），另含锁内 version 字段 0.1.0→0.1.1 的 npm 自动归一（对齐 package.json，无害元数据同步）
- [x] 2.2 `npm run test:frontend` 全量；happy-dom 行为怪癖变化导致的夹具失效逐条甄别修正——1413/1413 全过，行为怪癖零变化，夹具无一调整

## 3. 收口验证

- [x] 3.1 `npm run check` 全链全绿（typecheck → lint → 前端 → 可靠性 → 驱动 → 验证 → 构建 → fmt → clippy → Rust）——exit=0
- [x] 3.2 提交推送后 `gh api repos/irisnb/next-story/dependabot/alerts` 复扫，8 条告警关闭状态如实记录（GitHub 复扫有延迟属预期，不提前宣称）；结果记入本 change 验证记录——推送 `f502226` 后复扫：**原 8 条全部自动关闭**（zip 五条＋happy-dom 三条）；复扫同时新出现 #35 minimatch medium（公告 2026-11-12T13:37 新发，dev 工具链传递依赖、非本次引入——HEAD~1 锁文件已含同版本；范围内无修复版，挂账另议，见验证记录）
