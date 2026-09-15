# 设计：CI 恢复绿灯与 Dependabot 治理

## Context

- CI（`.github/workflows/ci.yml`）自 2026-08-15 引入，双平台（ubuntu/windows）门禁：typecheck → lint → 前端测试 → 生产构建 →（Linux 加 fmt/clippy）→ Rust 测试。97 次运行 70 失败，当前已知失败项三个：
  1. 时区依赖测试：`tests/ai-panel-conversation-list.test.ts:110-111` 用 `"2025-06-01T00:00:00+08:00"` 造「更早」分组数据，月份标签按运行环境本地时区格式化；东八区显示 6 月、UTC 显示 5 月，CI（UTC）必挂、本地（UTC+8）必过。
  2. `cargo fmt --check` 不过：队列 3a 修复（`dsh_driver.rs:295` 等）提交前未格式化。
  3. clippy `-D warnings` 不过：**库 9 处 + 测试代码 14 处**。测试代码为 `needless_borrows_for_generic_args` 冗余借用（`story_search.rs:984/988` 等，队列 2 修复引入）；库侧为队列 3a/3b 引入（`dsh_driver.rs` 缺 `Default` 实现与 3 处可用 `?` 运算符的块、`migration.rs` 显式生命周期、`story_search.rs` 双操作数冗余取引用与循环计数器、`generate.rs:267` 8 参数与 `lib.rs:1467` 14 参数超限）。
- 历史失败（2026-08-27）另有 Windows `jetscii` 依赖缓存错误，属 rust-cache 缓存还原问题，非代码问题；近期运行因前端测试先挂而未到达 Rust 步骤，是否复现未知。
- Dependabot 现配置：npm 与 cargo 各 weekly 巡逻、无版本过滤、无分组，已堆 10 张 PR（5 张 Tiptap 2→3、1 张 reqwest 0.12→0.13 大版本）。
- 约束：一次只开一个 change；产品行为零变化；`ci.yml` 门禁步骤保持不动。

## Goals / Non-Goals

**Goals:**

- 推送到 main 后 CI 双平台恢复绿灯。
- 前端测试在任意时区环境下结果一致。
- Dependabot 降频、去大版本噪音、合并递单、限量在途。
- 建立 `ci-pipeline` 规格作为 CI 门禁与环境无关性的真相源。

**Non-Goals:**

- 不升级任何依赖版本（含 10 张 PR 对应的更新；小版本也不在本 change 合并）。
- 不重构 `ci.yml`（步骤、平台、工具链版本均不动）。
- 不处理 Node 20 弃用警告（actions 版本升级留后续）。
- 不改 `conversation-list` 产品分组逻辑（按本地时区显示月份是正确行为）。

## Decisions

1. **时区测试修复采用「月中时刻」测试数据，而非在 CI 或测试里强制设定时区。**
   - 方案：把两组「更早」时间戳改为 `2025-06-15T12:00:00+00:00` / `2025-05-15T12:00:00+00:00`（月中正午 UTC），任何现实时区（±14 小时内）下都不跨月，断言保持「2025 年 6 月 / 2025 年 5 月」不变。
   - 备选一：workflow 设 `TZ=Asia/Shanghai`。否决：掩盖问题而非解决，任何未来测试仍可能隐式依赖时区，且改变整个作业的环境语义。
   - 备选二：测试内 mock `Date`/临时改 `process.env.TZ`。否决：node:test 下跨平台改 TZ 行为不一致（Windows 不支持），复杂度不成比例。
   - 备选三：产品代码把月份格式化固定为某时区。否决：改变用户可见行为，违反「零产品变化」。
2. **clippy 修复分两档**：机械类（冗余借用、冗余取引用、生命周期省略、`?` 运算符重写、`Default` 实现、循环计数器）逐处人工确认改写，不改语义；**参数超限（`generate.rs:267` 8 个、`lib.rs:1467` 14 个）采用定点 `#[allow(clippy::too_many_arguments)]` 加注释**，不在本 change 重构函数签名——结构性拆分已由审计 P2-1/P2-2（`lib.rs` 巨石模块、热点拆缝）排队，此处提前重构会扩大本 change 的产品代码风险面。
3. **Dependabot 策略**：`interval: monthly`；`ignore: update-types: ["version-update:semver-major"]`（npm 与 cargo 都配）；`groups` 按生态分组（development/npm 一组、cargo 一组）；`open-pull-requests-limit: 2`。理由：单人开发、版本已钉死，机器人只承担「小修补提醒」职责；大版本换代必须由用户主导，不自动递单。
4. **旧 PR 一律关闭而非合并**：其中大版本单关闭后不会再递（新策略忽略 major）；小版本单关闭后 Dependabot 会在下个巡逻周期按新分组规则重新递出，无需手动保留。
5. **jetscii 缓存问题按「再犯再治」处理**：推送观察；若 Windows 的 cargo 步骤再现 `jetscii` 源错误，删除该仓库 Actions 中 rust-cache 相关缓存（GitHub API/网页操作）后重跑。不预先清缓存（避免无谓丢弃有效编译缓存拖慢 CI）。
6. **Tauri 资源占位（首次推送后发现的第三层失败）**：`tauri.conf.json` 把 `../sidecar/node-runtime`（vendor 的 Node 运行时，87 MB，有意按 `.gitignore` 不入库，由 Windows-only 的 `scripts/vendor-node.ps1` 按需下载）声明为打包资源；Tauri 构建脚本在任何 cargo 编译时都校验该路径存在，CI 全新检出里没有该目录导致两平台构建脚本失败。修法：两平台 CI 各加一步**创建带说明文件的占位目录** `sidecar/node-runtime/`——CI 只跑测试与检查、从不打包安装包，资源占位即可满足校验；真运行时仅在实际打包时由开发机 vendor 提供。不选「CI 跑 vendor 脚本」：脚本仅支持 Windows，且 87 MB 下载只为满足存在性校验，浪费。

## Risks / Trade-offs

- [风险] fmt/clippy 修复后仍可能暴露下一层失败（例如 Windows Rust 测试中环境依赖用例）。→ 缓解：本 change 收尾前以实际推送的 CI 结果为准，不宣称绿灯；发现新失败项按根因小步追修，仍属本 change 范围（目标就是 CI 绿）。
- [风险] 月中时刻法依赖「所有 CI 与开发环境时区偏移 ≤ ±14h」的假设。→ 缓解：该假设对 GitHub 托管 runner（UTC）与现实时区集合恒成立；在 `ci-pipeline` 规格中写明「测试不得依赖运行环境时区」的一般要求，未来评审可依此拦截。
- [风险] 关闭 10 张 PR 后 Dependabot 下月重新递单，可能再次产生邮件。→ 缓解：新策略下大版本（当前噪音主体）不再递单、总量限制 2 张且按组合并，邮件量从每周数封降为每月约一两封；用户已知情并选择保留管家。
- [权衡] `open-pull-requests-limit: 2` 会延迟部分小版本提醒。可接受：单人项目无安全告警场景（出现安全告警时 Dependabot 走独立安全通知，不受此限制）。

## Migration Plan

1. 实现并本地验证（前端测试、`cargo fmt --check`、`cargo clippy -D warnings`、Rust 测试全绿）。
2. 提交推送 → 观察 CI 双平台结果。
3. 全绿后关闭 10 张旧 Dependabot PR。
4. 若 Windows 再现 jetscii：清缓存重跑；仍失败则升级为设计修订。
5. 归档 change，同步审计报告第八节（新增「CI 修复」条目记录）。

回滚：全部改动为测试数据、格式化与配置，任何一步 `git revert` 即可，无数据迁移。

## Open Questions

（无——范围与策略已与用户确认。）
