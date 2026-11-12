# 验证记录：switch-to-mit-license（2026-11-12）

## 任务 1.x 口径切换

- `LICENSE`：整体替换为标准 MIT 原文，版权行 `Copyright (c) 2026 irisnb`，无翻译、无附款（diff 可查）。
- `README.md`：徽章排 License 徽章改为 `License-MIT`（alt「许可：MIT」）；「协作与协议」区改为 MIT 口径，同区保留用户内容归属声明（「你在软件中写下的所有文字，权利完全属于你，与仓库许可无关」）。
- `docs/ARCHITECTURE.md`：「不是什么（诚实边界）」首条改为 MIT 口径，保留「不是可安装的框架或库」的如实定位。
- 账本：`方向/行动计划-2026-08-27.md` 新增第 25 条（2026-11-12 补记，插于第 24 条之后、按时间正序），含用户原话初心与单向门知情确认。（`方向/` 不在公开仓库，本地生效。）

## 任务 2.2 残留清扫

- 检索 `保留所有权利|未经书面许可|书面许可`：活文档（`README.md`、`docs/`、`AGENTS.md`、`scripts/`、`src/`）命中为零；剩余命中全部位于本 change 工件（描述旧口径，合法）与 `openspec/changes/archive/`（历史归档，按 design D4 不改写）。
- DEVELOPMENT.md 发布流程无许可模板文本；已发布 Release 说明按规格不追溯修改。

## 任务 2.3 第三方许可文本

- `public/fonts/LICENSE.txt`（SIL OFL 1.1）与 `public/vendor/basecoat-css/LICENSE.md`（MIT）原样在场，`git status` 确认本次未改动。

## 任务 3.1 门禁

- 首跑 `npm run check`：前端测试 1413 中 1 挂（`tests/ai-feature-persistence.test.ts` 2.7）。
- **诊断（既有问题，与本 change 无关）**：stash 本 change 全部已跟踪改动后干净树复现同败；根因＝测试夹具 `savedRecord` 的 `updated_at` 写死 `2026-09-24`，2026-11-01 起跨入默认收起的「更早」分组（`src/ai-dock.ts:617` 收起态不渲染行），`assert.ok(row)` 失败。产品行为符合 `conversation-list` 规格（「更早」默认收起），非产品回归。
- **处置（用户拍板「顺手修掉」）**：夹具改为相对时间（当前时间 3 天前，恒落「今天/昨天/本周」渲染分组），单独提交、不并入本 change 的许可改动；修后单文件 29/29 过。
- 复跑 `npm run check`：**exit=0 全绿**（前端 1413、Rust 单元/集成、构建、fmt、clippy 全链）。

## 任务 3.2 GitHub 许可识别

- 当前 `gh repo view --json licenseInfo` → `Other`：远端默认分支仍是旧 LICENSE，**提交并推送后才会翻为 MIT**（GitHub 有识别延迟属预期）。发布前复查。

## 任务 3.3 官网核对

- 抓取 https://irisnb.github.io/next-story-site/ ：页脚两行旧口径——「© 2026 irisnb · 版权所有（保留所有权利；可下载安装使用）」「本软件按现状提供，不附担保」。
- **待办（发布前，在官网仓库 next-story-site 执行，不属本 change 实施范围）**：页脚改为 MIT 口径（与主仓库 README 等价句式，保留按现状提供句）。
