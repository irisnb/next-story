## Context

`verify-import-fidelity-ui`（2026-10-03 归档）的质量门槛复跑留下两条红色门槛：`cargo fmt --check` 共 11 文件 150 处差异（当前范围 5 文件 91 处、既有范围外 2 文件 30 处、待分诊 4 文件 29 处）；`cargo clippy --all-targets -- -D warnings` 唯一错误位于 `examples/docx_read_spike.rs:59`（`manual_is_ascii_check`）。标准门禁 `npm run check` 因此无法全绿（fmt 步骤先失败；修复后 clippy 步骤仍会在该处失败），CI 双平台执行同一门禁随之受阻。执行中发现第三条本地阻塞：`eslint .` 不读 `.gitignore`，把本地证据目录 `本地测试文档/`（16 个 `.mjs`，363 个错误）扫入 lint，使 `npm run check` 在本机无法全绿（该目录 git 零跟踪，CI 干净检出不受影响）。本项为事项 11 第 ⑥ 项，用户拍板先单列先行；完成后仓库门禁归零，后续导入保真修复的 diff 不再被格式噪音污染。

## Goals / Non-Goals

**Goals:**

- 全仓 rustfmt 归零（11 文件 150 处全部处理，含既有范围外与待分诊文件）。
- `cargo clippy --all-targets -- -D warnings` 归零。
- `npm run check` 全绿；Rust 544／前端 1181 测试基线零回退；全部改动行为零变化。

**Non-Goals:**

- 不重构、不改产品行为、不动依赖与接口。
- 不处理导入保真缺陷①–⑤（后续 change 承接）。
- 不以「如实分账」作为最终状态（仅作失败兜底记录）。

## Decisions

- **D1：一次处理全部 150 处，而不是只修当前范围 91 处。** 目标是让门禁退出码真正为 0；纯格式改动行为零影响；范围外与待分诊文件改动单独分账记录，保持审计透明。替代方案「只修当前范围、其余如实分账」被否——门禁仍红，修格式的意义落空。
- **D2：clippy 按 lint 建议做等价改写**（`matches!(c, '0'..='9')` → `c.is_ascii_digit()`），而不是 `#[allow]` 压制——消除告警本身。
- **D3：不新增 `rustfmt.toml`。** 仓库既有代码即默认 rustfmt 输出风格，不引入新的格式化配置面，避免全仓二次重排。
- **D4：验证在关闭开发应用的前提下执行**（或设独立 `CARGO_TARGET_DIR`）——否则链接期替换 `next-story.exe` 会以 os error 5 失败（2026-10-03 已实证）；证据落 `verification/validation.md`。
- **D5：diff 审查准则**：除 `examples/docx_read_spike.rs:59` 一处等价改写外，其余 diff MUST 仅为换行／缩进／导入排序类格式差异；逐文件核对。
- **D6：lint 忽略本地工作目录（收尾补项，2026-10-04 用户拍板）。** `本地测试文档/**` 与 `.omo/**` 均为 gitignored 的本地文件（证据／草稿，git 零跟踪、CI 不涉及），加入 `eslint.config.js` 忽略名单——延续 `tmp/**` 既有惯例，仅缩小扫描范围、不改规则。替代方案「按本地限制如实收尾、另立 change」被否：本 change 的目标就是门禁可用，一行配置即可闭合，实测复跑整链退出码 0。

## Risks / Trade-offs

- [格式 churn 可能掩盖意外语义改动] → 提交前逐文件 diff 审查＋全量门禁（含全部测试）零回退。
- [改动范围外文件引起「越界」疑虑] → 三类文件（当前范围／既有范围外／待分诊）独立分账记录，并明示纯格式性质。
- [本地与 CI rustfmt/clippy 版本差异导致残余差异] → 以本地实测与 CI 结果为准分别记录；残余如实入档，不宣称通过。
