# Design: fix-dependabot-security-alerts

## Context

8 条 Dependabot 告警＝两个包：zip 8.6.0（Rust，5 条，含 critical CVE-2026-115905，8.x 全系下架）与 happy-dom 20.14.5（npm dev，3 条）。zip 无法单方面升级：docx-rs 0.4.22 要求 `zip ^8.6.0`，且 `[patch]` 无法跨越语义版本边界强制替换（docx-rs 的版本要求不被 zip 9 满足时 cargo 直接拒绝补丁）。上游 docx-rs 主线已合并 zip 9 升级（HEAD `ad7fede6a7`＝该提交），临界修复 9.0.5 靠我们自己提下限即可覆盖（主线 zip 要求接受 9.x 区间）。

## Goals / Non-Goals

**Goals**
- Cargo.lock 全树只存在一个 zip 且 ≥9.0.5（五条 zip 告警的关闭条件）。
- happy-dom ≥21.0.4（三条 npm 告警的关闭条件）。
- `npm run check` 全链全绿；导入保真测试如实甄别上游行为变化。
- 钉版决策留痕：为什么钉 git、钉哪个提交、什么条件切回。

**Non-Goals**
- 不换掉 docx-rs（换库是独立大决策）。
- 不自建 docx-rs fork 或 vendor 副本（上游主线已含所需修复）。
- 不动 sidecar、不动导出行为语义、不做依赖大扫除（其余依赖不搭车升级）。
- 不处理 zip/happy-dom 之外的既有已忽略告警（如有新告警另行处置）。

## Decisions

### D1: docx-rs 钉上游主线 `ad7fede6a7`，而不是等发布或用贡献者分支

**备选与取舍**：
- 等 docx-rs 官方发布含 zip ≥9.0.5 的版本（作者 2026-11-09 已开 #948 在做）——时间不可控，期间 5 条告警（含 1 critical）持续挂账，且我们锁的 8.6.0 已被官方下架。否决为「等待兜底」，不作本 change 路径。
- 用贡献者 PR #947 分支（bnmchone/docx-rs@316e704d29，只提 9.0.5 下限、零代码变化）——依赖未合并的第三方 fork，供应链信任面更差。否决。
- 钉主线 HEAD `ad7fede6a7`——作者本人仓库、该提交就是 zip 9.0.4 升级＋破坏性适配本身，相对 0.4.22 增量最小（其后的读入修复 PR 均未合入主线）。**采纳**。

### D2: 自身 zip 下限直接提到 9.0.5（不是 9.0.0）

docx-rs 主线 zip 要求为 9.x 区间（≥9.0.4 语义），自身 `zip = "9.0.5"`（^9.0.5）与之相交，解析器统一选单一 9.x ≥9.0.5（当前解析为 9.5.1）。五条告警的最高修复门槛（critical＝9.0.5）一次覆盖，无需依赖未合并的 #947。deflate-only feature 配置不变（9.x 已核实存在 `deflate` feature）。

### D3: 切回 crates.io 的条件与挂账

docx-rs 官方发布「要求 zip ≥9.0.5」的 crates.io 版本后，择机另立小 change 切回并移除 git 钉版；本条件写入长期账本。钉版期间升级 docx-rs git 提交＝版本变更，须走同一审慎流程，不静默漂移。

### D4: happy-dom 跨大版本走 package.json 显式提升

三条告警修复版：21.0.4（两条）与 20.14.6（一条中危）；取 ≥21.0.4 一次覆盖。`^20.14.5` 范围内无全覆盖修复版，故必须改 `package.json`（既有 root-dev-dependency-hygiene 的 lock-only 路径不适用，本 change 顺带把该路径写进规格）。风险：测试夹具对 happy-dom 行为怪癖有依赖注释（Esc 不合成 cancel、零值矩形等）；21.x 若改变这些行为，逐条甄别修夹具，不为兼容而锁死旧版。

### D5: 上游行为差异的甄别纪律

docx-rs 主线相对 0.4.22 含读入保真改进（脚注引用、cantSplit、isLgl 等，均为「不再丢弃既有信息」方向）与 zip 9 的文件名失败语义（恶意构造文件名现在报错而非被接受）。若导入金样本/哈希冻结测试出现差异：先归因（上游改进 vs 我们回归），改进类差异如实更新预期并记录，回归类差异修我们的代码；禁止无解释重录。zip 9 写侧 API 变化只影响 docx_import.rs 内测试夹具的 ZipWriter 用法（生产导出走 docx-rs），编译器逐处暴露，就地适配。

## Risks / Trade-offs

- **[Risk] docx-rs git 主线无 semver 承诺，后续漂移** → 钉死 rev（Cargo.lock 记录），升级＝显式决策；切回条件挂长期账本。
- **[Risk] zip 9 / docx-rs 主线 API 破坏性变化超出预期** → 我们生产代码对 zip 只用读侧（ZipArchive 元数据/读流），写侧只在测试夹具；编译＋clippy 全暴露；若适配面失控则暂停并回报用户重议（fallback：vendor 或等发布）。
- **[Risk] 导入保真金样本大面积变化** → 逐条归因纪律（D5）；预期仅限上游「不再丢弃」类改进；若出现真实回归即修代码。
- **[Risk] happy-dom 21 行为怪癖变化引发测试断裂** → 全量前端测试暴露，逐条甄别修夹具；不引入 overrides。
- **[Risk] GitHub 告警未按预期自动关闭**（复扫延迟或清单口径）→ 推送后用 API 复核实数，如实报告，不提前宣称关闭。

## Migration Plan

依赖与代码适配，无数据迁移、无用户数据影响；回滚＝git revert 整个 change。发布节奏不受影响（下次发布自然携带）。

## Open Questions

无——核心取舍（钉主线 vs 等发布 vs 用贡献者分支）已在 2026-11-12 调查中定案，理由如上。
