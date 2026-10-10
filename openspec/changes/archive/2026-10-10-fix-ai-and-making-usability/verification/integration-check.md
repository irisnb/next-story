# 集成验证记录：总门禁（tasks 组 8.1 + 任务证据对应）

> change: `fix-ai-and-making-usability`
> 角色：集成验证 owner（总门禁 + 任务证据对应）。不新增产品行为。
> 日期：2026-10-10。工作目录：`D:\Next Story`。
> 本记录仅为证据，不代表 change 达到归档条件；未 commit、未归档，未读写用户项目文档。
> 后端选区 lane 见 `selection-backend-lane.md`；前端 UI lane 见 `ui-lane.md`。本 lane 不重复其专项验证，只做集成后的最终总门禁。

## 1. 总门禁真实退出结果

命令（工作目录已用 `Test-Path` 确认为 `D:\Next Story`）：

```text
npm run check
```

定义：`typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust`

| 步骤 | 命令 | 结果 |
|------|------|------|
| typecheck | `npm run typecheck` | 通过（无 TS 报错） |
| lint | `npm run lint` | 通过（无 lint 报错） |
| test:frontend | `npm run test:frontend` | 通过：1385 tests / 1385 pass / 0 fail |
| test:reliability | `npm run test:reliability` | 通过：121 tests / 121 pass / 0 fail |
| test:driver | `npm run test:driver` | 通过：33 tests / 33 pass / 0 fail |
| test:validation | `npm run test:validation` | 通过：78 tests / 78 pass / 0 fail |
| build | `npm run build` | 通过 |
| fmt:rust | `npm run fmt:rust` | 通过（`cargo fmt --check` 无差异） |
| clippy:rust | `npm run clippy:rust` | 通过（`Finished dev profile`，无 `-D warnings` 报错） |
| test:rust | `npm run test:rust` | 通过：lib 531 passed / 0 failed / 1 ignored；各集成 target 0 failed（21 / 10 / 4 / 33 / 18 / 6 / 2 / 33 / 5 通过，另 1 个 target 3 ignored） |

**最终总门禁退出码：0（通过）。**

## 2. 首次运行发现的失败与修复（仅机械测试契约）

首次 `npm run check` 在 **test:frontend** 停止，1 项失败：

- 失败：`tests/dom-contract.test.ts:99` —— 测试 `making module exposes a fourth tab and a status bar bound to the global active chain`
- 断言：`/\bid="making-deactivate-btn"[^>]*>停用<\/button>/`
- 实际：`index.html` 中停用按钮已随本 change 决策 D8（tasks 7.1）从顶部状态条**移入版本操作区**（`index.html:664`，标签改为 `停用当前链路`，容器 `.making-version-operations`，`aria-label="版本操作区"`）。该 DOM 契约测试未随实现更新，属**陈旧测试契约**。
- 判定：机械问题（测试契约与已实现、已由 `making-module.test.ts:141-143` 覆盖的新结构一致），非视觉方向、非选区安全设计。按 lane 授权修复。

修复（`tests/dom-contract.test.ts`）：
- 从「状态条」测试移除过期的停用按钮断言（状态条现为纯全局只读展示）。
- 在「双标签 / 统一详情挂载位」测试新增版本操作区契约断言：`.making-version-operations` + `aria-label="版本操作区"`、`id="making-deactivate-btn"` 文案 `停用当前链路`、`class="...making-version-using..."`。

验证：`node --test tests/dom-contract.test.ts` → 12 tests / 12 pass / 0 fail；随后完整 `npm run check` 复跑 → 退出码 0（见第 1 节）。

## 3. 任务证据对应（tasks.md 更新）

按「有实际自动化证据」原则勾选，未证实/纯视觉/真机项一律不勾。

### 勾选 [x]（有证据）

| 任务 | 证据来源 |
|------|----------|
| 1.1 | `selection-backend-lane.md` 可行性结论 + `selection_projection.rs` 18 单测 + 共享夹具 |
| 1.2 | `selection-backend-lane.md` 实现说明 + `ai_orchestration` 20 单测 |
| 1.3 | `selection-backend-lane.md` 安全边界 + 既有校验/防伪造测试保留 |
| 1.4 | `structured_derivation_accepts_complex_legal_selections`、`selection_authorization_fails_closed_...` 等正/负例 |
| 1.5 | `tests/fixtures/selection-projection-samples.json` 前后端共享夹具双端断言 |
| 1.6 | `tests/selection-serialization.test.ts`（含 16 条共享样例，本 change +36 行） |
| 4.1 | `tests/agent-on-demand-reading.test.ts`：`waiting authorization replaces thinking presentation without changing loading`（+39 行） |
| 4.3 | 同文件：`authorization presentation stays with its discussion across switching` |
| 5.1 | `tests/making-module.test.ts`：`card deletion saves a new viewed version and protects active history` |
| 5.2 | 同上 |
| 5.3 | `last card deletion is disabled with a visible explanation` |
| 5.4 | `card deletion confirmation baseline: ${scenario}`（取消/失败/基线变化/其他版本追加） |
| 5.5 | 上述卡删除全部用例 |
| 6.2 | `tests/making-conversation.test.ts`：`save confirmation expands full original and save follows the exact new version` |
| 6.3 | 同上（断言 `view.versionId === saved.id`） |
| 6.4 | `tests/making-module.test.ts`：`full card view preserves long trigger and body from beginning through end` + 保存后查看新版本用例 |
| 7.1 | `tests/making-module.test.ts`：`version controls share one region outside the read-only status bar` |
| 7.2 | 同上（同区 + 查看/使用标注） |
| 8.1 | 本记录第 1 节：`npm run check` 退出码 0 |

### 未勾 [ ]（未证实 / 真机 / 纯视觉 / 未完成）

- 组 2（2.1、2.2）：真实桌面 CDP 端到端与真机证据未执行。
- 3.1、3.2、3.3、3.4（布局/几何/层级视觉，需真机像素级验收）、3.5（显式缺少 `.ai-window-head` 动作组几何断言，`ui-lane.md` 交接）。
- 4.2（授权卡固定可见，像素位置需真机）、4.4（长对话贴底/上翻/切换可见性用例未见新增于 `ai-panel-scroll.test.ts`，`ui-lane.md` 列为需真机）。
- 6.1：隔离前端夹具做了首/中/尾核对，但未以真实 Rust 存储往返与原报告样本端到端对照，`ui-lane.md` 明示未证。
- 7.3、7.4：命令调用既有测试通过，但真实「在途轮沿用发起版本、下一轮采用新启用版本」的集成证明未完成（`ui-lane.md` 交主助手）。
- 8.2（真实 Windows 桌面验收）、8.3（截图/视觉比对证据；`:mock 全绿不作为归档依据`）。
- 8.4：规格必要同步属归档前动作，本 lane 未执行。

## 4. 未完成 / 需后续验收项（交接）

1. 组 2 真机：写作区选中跨段落/行内标记/引号/反斜杠文字 → 点「AI」→ 确认真实链路召唤到达并返回回应。
2. 组 3/4 视觉几何：边栏最窄/默认/最大化长标题下头部动作组不换行不重叠；列表顶边不压边；删除确认 hover/键盘与撤销可见可点；长对话授权卡贴底/上翻可见。
3. 6.1 端到端：真实长内容经 `save_version_in_dir` / `buildCardPanelView` 往返后首/中/尾全文对照。
4. 7.3/7.4 集成：真实在途轮沿用发起版本、下一轮采用新启用版本。
5. 总门禁已绿不等于真机验收（AGENTS 归档前硬门槛）；归档前须补真实桌面 CDP + 用户点击 + 视觉比对。
6. 8.4 归档时的主规格必要同步。

## 5. 本 lane 改动文件

- `tests/dom-contract.test.ts`：更新陈旧停用按钮 DOM 契约（机械修复）。
- `openspec/changes/fix-ai-and-making-usability/tasks.md`：仅按证据勾选实现任务。
- `openspec/changes/fix-ai-and-making-usability/verification/integration-check.md`：本记录。

说明：未改写后端选区 lane 与前端 UI lane 的实现文件；除上述三处外未触碰其他文件；未 commit / 未归档；未读写任何用户项目文档。
