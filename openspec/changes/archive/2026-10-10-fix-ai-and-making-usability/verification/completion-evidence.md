# 完成证据矩阵与缺口清单：fix-ai-and-making-usability

> 角色：validation owner（证据矩阵）。日期：2026-10-10。
> 2026-10-10 补：§2 缺口 1–3（卡删除「取消 / 失败 / 基线失效取消重确认」）已补真机证据，
> 见 `ui-acceptance/card-delete-cancel-failure.md` 与 `evidence-making/evidence-card-delete-cancel-failure.json`（26/26）。
> 2026-10-10 再补：AI/observer 只读视觉比对完成（见 §3 与 `visual-review.md`，**非用户本人验收**）；
> §2 缺口按「单测＋fixture＋真实证据组合是否充分」重排为最小列表；8.3 因此可勾，8.2 仍保留未勾。
> 2026-10-10 归档：用户确认「真机验收通过，归档，git push」（原话，见 `user-acceptance.md`）；8.2 以**用户整体真机验收＋分层证据**关闭（残余未单独捕获项见 `user-acceptance.md` §3）；8.4 八个 delta 由官方 `openspec archive fix-ai-and-making-usability --yes` 同步入主 spec（+4 新增 / ~7 修改 / -0 删除），change 已归档至 `openspec/changes/archive/2026-10-10-fix-ai-and-making-usability/`。
> 范围：只读核对既有证据记录与证据文件，产出「8.2 每个子要求 × 证据类型」矩阵、8.3 证据清点、8.4 delta 覆盖评估。
> 边界遵守：未改产品代码，未写 `openspec/specs/` 真相源，未发模型请求，未重跑门禁，未 commit / 未归档。
> 本 session 写入：本文件 + `tasks.md` 的 8.2 / 8.3 注释 + 新增 `visual-review.md`（8.3 按「证据留存＋视觉比对已完成」勾选，明确非用户验收；8.2 不勾）。
> 证据分层口径：**单测/纯计算**（`tests/`、Rust unittests）、**呈现 fixture**（真实 WebView DOM，但显示态为注入）、**真实桌面 CDP**（真实 Tauri dev 实例、真实 Rust 存储/命令，必要时真实模型）。

## 1. 8.2 子要求证据矩阵

| # | 8.2 子要求 | 单测 / 纯计算 / Rust | 呈现 fixture | 真实桌面 CDP | 判定 |
|---|-----------|----------------------|--------------|--------------|------|
| A | 边栏最窄/默认/最大化长标题下头部动作位置稳定 | — | `batch2-runtime.md` §2.2（四按钮，`presentation-fixtures.mjs`，24/24） | `batch1-geometry.md` §2.1（`ai-panel-geometry.mjs`，三种模式零重叠/同排/nowrap；**仅 focus-switch/badge/more/close，materials/stop 未出现**） | 真机已证容器与可见动作；materials/stop 仅 fixture；注：8.2 措辞「三按钮」若指停靠区头部三按钮（讨论/最大化/关闭），本 change 未在真机单独测量（属 `update-frontend-ui-v5` 归档合同） |
| B | 讨论删除 hover＋键盘确认、撤销可见 | `tests/ai-dock.test.ts`、`tests/ui-v5.test.ts`（局部 4 项） | — | `batch1-geometry.md` §2.3 + `undo-notice-300.md`（14/14，含 300px 撤销命中） | **真机已证** |
| C | 长对话授权贴底/上翻/切换且状态与输入准确（底层挂起/取消/并发不变） | `tests/agent-on-demand-reading.test.ts`：`waiting authorization replaces thinking presentation without changing loading`、`authorization presentation stays with its discussion across switching` | `reading-card-layout.md`（28/28，300px / 540-670px 真实 WebView 命中与鼠标点击）＋`presentation-fixtures.mjs` 4.2 | `reading-auth.md`（真实 pending 状态、滚顶/滚底卡固定、切讨论不串卡、允许→真实恢复） | 呈现层与「允许」路径真机已证；**「底层挂起/取消/并发名额不变」与「拒绝」路径无真机证据（仅单测/未测）** |
| D | 选区纯计算＋Rust 正例与安全负例＋真实桌面召唤到达真实链路 | `tests/selection-serialization.test.ts`（30，含 16 共享夹具）＋`selection_projection.rs`（18）＋`ai_orchestration`（20，正/负例） | — | `single-real-summon.md`（1 形态：跨段落＋引号＋反斜杠＋inline mark，到达真实 `glm-5.3` 返回首轮） | 真机 1 形态（最难形态）到达真实链路；其余形态（部分列表项 / 跨首尾块裁切 / 嵌套列表缩进）为纯计算＋跨语言共享夹具＋Rust 正/负例，**组合充分，不列为缺口（见 §2）** |
| E | 卡删除取消/失败/最后卡/active 与历史保护、基线失效取消重确认 | `tests/making-module.test.ts`：`card deletion saves a new viewed version and protects active history`（含 confirm=false 取消）、`last card deletion is disabled...`、`card deletion confirmation baseline: changed/missing/appended/failure` | — | `batch2-runtime.md` §2.1 / `evidence-making-storage-versions.json`（17/17：最后卡禁删✓、active 不变✓、历史保持✓、删除追加新版本✓）＋`card-delete-cancel-failure.md`（26/26：真实 UI 取消→版本/active 不变；确认期间隔离 fixture 注入 changed/missing 基线失效→取消并要求重新确认、不误删；只读隔离存储受控 I/O 故障→真实 Rust 报错「拒绝访问 (os error 5)」、不误删） | **全部真机已证**：最后卡 / active / 历史保护（storage-versions 17/17）；取消 / 失败 / 基线失效取消重确认（card-delete-cancel-failure 26/26）。基线失效＝明确标注的隔离 fixture 注入，失败＝明确标注的受控只读 I/O（真实 Rust 写路径，非 mock）。changed/missing 两截图逐字节相同（取消后可视一致，差异在 JSON 注入/断言）；AI 只读视觉比对已做（`visual-review.md`：无明显遮挡重叠、可见性可接受），非用户验收 |
| F | 完整卡原文首中尾与保存/查看版本对照 | `tests/making-conversation.test.ts`（`save confirmation expands full original...`、`view.versionId`）＋`tests/making-module.test.ts`（`full card view preserves long trigger and body...`） | — | `making-draft-roundtrip.md`（48/48，真实保存往返逐字）＋`batch1-geometry.md` §3.2＋`batch2-runtime.md` §2.3 | **真机已证** |
| G | 启停同区与次轮/在途 | `tests/making-module.test.ts`（`version controls share one region...`） | — | `chain-round-binding.md`（20/20：启停同区、不经确认不改指针、在途绑 v1、次轮绑 v2、首轮保持、停用清指针） | **真机已证** |

## 2. 剩余缺口（最小列表，2026-10-10 重排）

> 重排口径：只保留「尚无充分证据组合」的项。已有「单测＋fixture＋真实证据」组合充分的，不再重复列为缺口。
> 这些剩余项按「提案硬验收」列出，不扩大本 change 范围。

1. **用户本人（或主助手出场）真人验收**：8.2 的验收 owner 是用户／主助手；本轮只做了 observer 的只读视觉比对（见 §3 与 `visual-review.md`），**不能替代用户本人验收**。
2. **授权底层语义与拒绝路径真机**：「等待授权时底层 `loading`／轮次挂起／取消／并发名额不变」与「拒绝 / 跨重启保留 / 讨论关闭授权开关」路径仍仅单测或未测（`reading-auth.md` §8 自述只跑「允许」）；呈现层 fixture 不覆盖底层语义。
3. **materials/stop 真实显示态几何**：几何仅来自呈现 fixture（`batch2-runtime.md` §2.2）；真实 pending 截图仅证「停止」可见同排（`reading-auth.md` §7），无真实生成/材料态下的逐矩形几何。

已从缺口列表**移除**（组合充分，非缺口）：

- **选区多形态真机**：纯计算（前端 30 / Rust 18 单测）＋跨语言共享夹具（16 例）＋Rust 正/负例＋**1 次真实桌面召唤到达真实链路**（`single-real-summon.md`，覆盖最难形态：跨段＋引号＋反斜杠＋inline mark）＝「单测＋fixture＋真实证据」组合充分；且 8.2 该条措辞为「真实桌面召唤到达真实链路」（单次即可）。不再列为缺口。
- **卡删除取消 / 失败 / 基线失效重确认**：单测＋真实机器证据均已具备（`card-delete-cancel-failure.md` 26/26、`evidence-making-storage-versions.json` 17/17），非缺口。

> 已补（2026-10-10）：原缺口（卡删除「取消 / 失败 / 基线失效取消重确认」）已补真机，见 `ui-acceptance/card-delete-cancel-failure.md` 与 `evidence-making/evidence-card-delete-cancel-failure.json`（26/26）；基线失效＝明确标注的隔离 fixture 注入、失败＝明确标注的受控只读 I/O（真实 Rust 写路径，非 mock）。

## 3. 8.3 证据清点（命令 / 截图 / 样本 / 自动 vs 人工）

- **命令与样本：齐。** 各记录均附可复现命令与样本来源（`batch1-geometry.md` §1、`batch2-runtime.md` §3、`chain-round-binding.md` §8、`making-draft-roundtrip.md` §9、`single-real-summon.md` §4、`reading-auth.md` §5）。
- **截图：齐。** `evidence-ai/`（head-default/narrow/maximized、list-open、delete-confirm-*、delete-undo-notice、undo-notice-300-*）、`evidence-making/`（含 draft-rt-*、versions-after-*、last-card-disabled、`card-delete-cancel`/`card-delete-baseline-changed`/`card-delete-baseline-missing`/`card-delete-failure`）、`evidence-binding/`（binding-00..04）、`evidence-presentation/`、`evidence-reading-auth/`（layout-after-670/540-*、pending-*、switch-*、after-allow-*）、`evidence-summon/`（summon-selection/result）均落盘。
- **自动断言与人工视觉的区分：记录已区分**（每份记录均标注「自动断言」数字并把人工视觉留给主助手）。
- **人工视觉比对（AI/observer）：已完成（部分）。** 最终 observer 对 `visual-review.md` §1 列出的截图（`layout-after-670/540-reason-bottom`、`making-draft-rt-02/04`、`card-delete-cancel/baseline-changed/baseline-missing/failure`、`binding-02`）做了只读视觉比对：无明显遮挡/重叠、可见性可接受；并明确静态截图不代表行为、540/670 以外视口未覆盖。**这不是用户本人验收**（8.2 的真人验收仍缺）。
- **8.3 因此可勾**（「命令/截图/样本留存」齐＋「视觉比对（AI，已明确非用户验收）」完成）；**8.2 仍保留 [ ]**（验收 owner 是用户／主助手，且 §2 第 1–3 项未完成）。

## 4. 8.4 delta 覆盖评估（不写真相源，留待归档同步）

- **不得在归档前改 `openspec/specs/`**：真相源只能由 change 归档驱动。本文件不写主 spec。
- **change delta 已覆盖本 change 对用户可见行为/规格的改动方向**，共 8 个 spec delta：
  - `conversation-list`（列表顶边对齐、删除确认一致不重叠、撤销可见）
  - `frontend-ui-v5`（讨论窗口头动作组不拆散，且要求由 `ai-window-head` 自身断言保证）
  - `agent-on-demand-reading`（等待授权固定可见、呈现层状态如实、讨论隔离、底层语义不变）
  - `controlled-story-read-visibility`（选区由结构化材料同源派生、保留全部校验、防伪造）
  - `selection-ai-summon`（召唤冻结选区同源派生、合法复杂选区不误拒）
  - `making-module-page`（直接删除、完整原文不摘要、版本操作区集中且标注查看/使用）
  - `chain-library`（卡删除出新版本、基线失效取消重确认、最后一张卡禁止）
  - `making-conversation`（草稿原文不静默截断、保存后查看跟进新版本）
- **结论**：delta 方向与本 change 的八项改动一一对应，未见用户可见行为改动未被 delta 覆盖的情形。**无需在本文件内改写 specs**；归档时按 delta 落主 spec 即完成 8.4。8.4 保留 [ ]，注明「归档前同步，非本验证 lane 动作」。
- 待归档同步的最小核对点：制作页停用入口位置（`making-module-page` 状态条 MODIFIED ＋ 版本操作区 ADDED）、卡删除方式与基线失效（`chain-library` / `making-module-page`）、等待授权呈现（`agent-on-demand-reading`）。均已包含在上述 delta 内。

## 5. 已确证（有真机或充分自动证据，支持任务已勾选）

- 组 1（选区后端 1.1-1.6）：纯计算＋Rust 正/负例＋跨语言共享夹具，见 `selection-backend-lane.md`。
- 组 3（3.1-3.5）：真机几何 + 删除/撤销，见 `batch1`/`undo-notice-300`；动作组容器见 `batch2` §2.2。
- 组 4（4.1-4.4）：呈现层单测 + 真实授权（允许路径）＋真实 WebView 长理由布局回归。
- 组 5（5.1-5.5）：基本删除/最后卡/active/历史真机（`evidence-making-storage-versions.json` 17/17）；取消/失败/基线失效取消重确认真机（`ui-acceptance/card-delete-cancel-failure.md` 26/26；基线失效＝隔离 fixture 注入、失败＝受控只读 I/O 故障注入，均明确标注）。
- 组 6（6.1-6.4）：真实保存往返 48/48。
- 组 7（7.1-7.4）：真机在途/次轮绑定 20/20。
- 组 2（2.1/2.2）：1 形态真实召唤到达真实链路（最难形态）；其余选区形态以纯计算＋跨语言共享夹具＋Rust 正/负例覆盖，组合充分（见 §2）。

## 6. 本文件边界

- 未改 `src/`、`src-tauri/`、`tests/`、`openspec/specs/`、配置、keyring；未发模型请求；未重跑门禁；未 commit / 未归档。
- 未新增或改动任何产品行为；矩阵基于既有证据记录与证据 JSON 只读核对（含 `evidence-making-storage-versions.json` 中 `enable-cancel` 与卡删除场景的实际断言名逐条比对）。
- 2026-10-10 补证动作：新增 `ui-acceptance/card-delete-cancel-failure.mjs` 与记录 `.md`，只驱动**隔离** `com.nextstory.acceptance` 实例与 fixture；未改 `src/`/`src-tauri/`/`tests/`/配置；未发模型请求；未 commit/归档。基线失效为明确标注的隔离 fixture 注入、失败为明确标注的受控只读 I/O 故障注入。
- 2026-10-10 收尾动作（本 session）：新增 `visual-review.md`（AI/observer 只读视觉比对，非用户验收）；`tasks.md` 8.3 据「证据留存＋视觉比对完成」勾选、8.2 仍不勾。核实 `owned-dev.json`（root `cmd.exe` PID 33604、port 9225、override 本 change）后，仅以 `taskkill /PID 33604 /T /F` 关闭本 change 隔离实例树（21 进程，退出码 0）；核实端口 9225/1420 已释放、无 `next-story.exe`/`cargo.exe`、无 `com.nextstory.acceptance` webview 残留，无关的 10-9 webview（PID 14892）未触碰；隔离 fixture `com.nextstory.acceptance/making-module/chains.json` 已复位（非只读、2 卡 v1、`active=null`）。未发模型请求；未改产品代码/配置/keyring；未 commit/归档。
