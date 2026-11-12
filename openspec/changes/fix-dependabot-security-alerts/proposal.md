## Why

GitHub Dependabot 当前 8 条在册安全告警（1 critical / 5 high / 2 medium），实际只涉及两个包（2026-11-12 查明）：

- **zip（Rust，5 条：1 严重 3 高 1 中）**：生产依赖，`src-tauri/Cargo.lock` 锁 zip 8.6.0（Word 导入预扫描＋docx-rs 传递引入）。五条 CVE（Zip Cloaking 任意文件覆盖/RCE、软链接逃逸写、内存耗尽、ZIP64 解压炸弹 DoS、AES 校验绕过）修复版全部在 9.x，8.x 无修复版且**全系已被 crates.io 官方下架**。真实暴露面：用户打开恶意 `.docx` 时经 Word 导入管线解析（内存读取、已有逐条目/总量预扫描限额，DoS 面已部分收敛；不落盘解压，RCE 标题门槛高于实际），但解析级漏洞真实存在，且官方下架等于盖章「这版别用了」。
- **happy-dom（npm，3 条：2 高 1 中）**：纯开发测试工具（前端测试的假浏览器），不进产品分发。SSRF / cookie 伪造 / 代码执行对最终用户实际风险≈零，修复属告警清零与工程卫生。

修复难点：docx-rs 0.4.22（最新发布，2026-07-21）硬性要求 `zip ^8.6.0`，单方面升级自身 zip 会导致树内双版本并存、告警一条不清。上游 bokuweb/docx-rs 主线已于 2026-10-17 合并 zip 9.0.4 升级（主线 HEAD `ad7fede6a7` 即该提交），9.0.5 临界修复 PR（#947）未合并；官方尚未发布新版本。

用户 2026-11-12 拍板：查清、说明、立 change 修复。

## What Changes

- **docx-rs 从 crates.io 精确锁版改为钉上游主线 git 提交**：`=0.4.22` → `bokuweb/docx-rs @ ad7fede6a7`（即 zip 9.0.4 升级提交，相对 0.4.22 的行为增量最小），Cargo.toml 注释记录钉版理由与切回条件；长期账本挂账「官方发布含 zip ≥9.0.5 的版本后切回 crates.io」。
- **zip 自身下限 8.6 → 9.0.5**：`zip = { version = "9.0.5", ... }`（deflate-only 不变），与 docx-rs 主线的 zip 9 要求统一解析为单一 9.x（≥9.0.5）版本，Cargo.lock 全树只存在一个 zip，5 条告警全部满足关闭条件。
- **happy-dom `^20.14.5` → `^21.0.4`**：修复版跨大版本、超出既有语义范围，走 `package.json` 显式提升（非 lock-only 定向更新）；全量前端测试验证行为兼容。
- **上游行为变化如实跟进**（如发生）：docx-rs 主线自 0.4.22 起的读入保真改进（脚注引用、cantSplit 等不再丢弃）与 zip 9 文件名失败语义变化，可能引起导入金样本/测试差异——逐条甄别（改进 vs 回归），不静默重录。
- **规格**：修订 `root-dev-dependency-hygiene`（补充「修复版跨大版本、超出既有语义范围」的处理路径）；新增 `rust-dependency-security-hygiene`（Rust 生产依赖安全警报修复纪律与上游钉版规则）。

不改动：sidecar（DSH）、导出格式行为目标、UI、任何用户可见功能语义；不引入 `overrides`/批量 `npm audit fix`；不为守旧版本范围降级处理告警。

## Capabilities

### New Capabilities
- `rust-dependency-security-hygiene`: Rust 生产依赖树的安全警报修复纪律——范围内定向最小更新；被上游版本范围锁死时钉上游已含修复的 git 提交＋提高自身下限使全树统一到修复版；钉版须记录提交号、理由与切回条件；完成判据与远端告警如实报告。

### Modified Capabilities
- `root-dev-dependency-hygiene`: 新增「修复版超出受影响包既有语义范围（跨大版本）且无范围内修复版」时的处理要求——显式提升 `package.json` 版本要求并全量验证，MUST NOT 用 `overrides` 或忽视告警来守住旧范围。

## Impact

- **文件**：`src-tauri/Cargo.toml`（docx-rs、zip 两条目）、`src-tauri/Cargo.lock`（docx-rs 转 git 源、zip 8.6.0 → 9.x、docx-rs 依赖树随主线更新）、`package.json` + `package-lock.json`（happy-dom）；如 zip 9 / docx-rs 主线 API 有破坏性变化，涉及 `src-tauri/src/project/docx_import.rs` 及其测试夹具的小幅适配；如导入金样本因上游保真改进而变化，涉及对应 fixtures 与测试的甄别更新。
- **CI/打包**：git 依赖照常参与双平台构建与 Windows 打包，无流程变化。
- **对外行为**：预期零用户可见变化；Word 导入对个别构造文档的读入结果可能更保真（上游修复所致），以既有导入保真测试全绿为准。
- **告警关闭**：本地门禁全绿＋提交推送后 GitHub 复扫，8 条告警预期全部自动关闭；远端状态如实报告，不提前宣称。
