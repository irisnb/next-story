# 真实在途/下一轮链路版本绑定验收（tasks 7.3 / 7.4）

> change: `fix-ai-and-making-usability`。角色：validation owner（真实绑定身份/轮次证明）。
> 日期：2026-10-10。范围：验收脚本 + evidence 记录。**未改产品源码/配置/keyring/正式用户数据；未 commit/归档。**
> 目标（用户授权 bounded）：仅做 tasks 7.3/7.4 的真实「在途不换、下一轮生效」集成证明，
> **不重做草稿**；用真实请求发送链路版本身份（后端按发起时冻结值落档的 `chain_rounds`）证明绑定，
> 而非根据模型回复措辞猜测。

## 0. 隔离与凭据边界（未触碰密钥）

- 实例：真实 Tauri dev，隔离 identifier `com.nextstory.acceptance`，CDP `127.0.0.1:9225`
  （浏览器标题 `Next Story`，url `http://localhost:1420/`，target id `241FEF4D17F06C48A01AA5B58E65EEF8`）。
  owned 实例根：`cmd.exe /c npm run tauri -- dev …` **PID 33604**（`owned-dev.json`）；应用进程
  `next-story.exe` **PID 29040**；驱动进程 `node sidecar` **PID 24104**（均属该受控实例树，未启动/未触碰正式应用）。
- 配置：隔离实例 `llm-config.json` 无 `api_key` 键；密钥由应用既有路径经 keyring **只读 get** 复用。
  本次**未**调用 `save_llm_config`、未点「保存设置」、未读写/显示密钥、未改正式或隔离配置、未触碰 keyring。
- 数据：仅读写隔离 fixture——项目 `C:\Users\Administrator\AppData\Local\Temp\opencode\acceptance-fix-ai\project-geometry\CDP几何验收-隔离`
  与隔离链路库 `…\com.nextstory.acceptance\making-module\chains.json`。未读写正式用户项目正文。
  结束时经真实 UI **停用**，隔离 fixture 指针恢复为 `active=null`。

## 1. 被测语义（源码口径，事实）

- 轮次发起时冻结启用链路（`src-tauri/src/ai_orchestration.rs` `freeze_chain_round_blocking`）：
  读一次 `active` 快照，产出 `cards_text`（要求卡注入文本）与 `{chain_id, chain_name, version_index}`；
  冻结后不再读指针（在途轮不受打扰）。
- 冻结产物与档案**同源**：成功轮把同一冻结值经 `record_chain_round`/`upsert_chain_round` 落档为
  讨论档案的记录级 `chain_rounds`（窄更新，与前端整档保存互斥、合并保护）；失败/取消轮不落档。
- 因此「某轮真实请求绑定了哪一版」的可核实证据 = 该轮 `chain_rounds` 条目的 `version_index`
  （由真实请求发起时冻结值派生，非模型回复措辞）。
- 本项只改操作区呈现与接线，语义不变（design Non-Goals：不改「全局启用一条、下一轮生效、在途不变、保存不等于启用、版本不可变」）。

## 2. 用户式动作序列（真实 UI，非命令直调）

| 步 | 动作 | 结果 |
|---|---|---|
| 1 | 制作页选中链路 `chain-cdp-long-acceptance` | 版本操作区显示「正在查看·第1版」「未启用」 |
| 2 | **不经确认**点「启用第1版」（确认框取消） | 文案记录到；磁盘 `active` **仍为 null**（不经确认不改指针） |
| 3 | **经确认**点「启用第1版」 | `active={chain, chainver-cdp-long-1}`（调用既有 `chain_set_active`） |
| 4 | 写作页 → AI 面板 → 新建对话 → 输入常规首轮问题 → 发送 | 对话流出现「正在思考…」（首轮在途） |
| 5 | **在途时**切制作页 → 选「第2版」→ 经确认点「启用第2版」 | `active=chainver-1791640932954121800-1`；此刻新讨论档案**尚无已完成首轮**（请求在途） |
| 6 | 切回写作页 | 对话流**仍在途**（状态消息仍在） |
| 7 | 首轮完成 | 档案 `chain_rounds[0].version_index = 1` |
| 8 | 同讨论追问 → 发送 → 完成 | 档案 `chain_rounds[1].version_index = 2` |
| 9 | 经确认点「停用当前链路」 | `active=null`（下一轮起回日常陪想） |

## 3. 关键时间线（相对脚本 T0，毫秒）

| 事件 | t | 证据 |
|---|---|---|
| 启用 v1 完成 | 3258 | `p2.disk.active.version_id=chainver-cdp-long-1` |
| 首轮问题已输入、发送键可用 | 5525 | `first-question-typed` |
| 首轮在途（「正在思考…」状态可见） | 5726 | `inflight.inflightSample={statusText:'正在思考…',directDisabled:true}` |
| **在途时启用 v2 完成** | 8053 | `p5.tV2=8053`；`p5.firstRoundDoneAtV2=false` |
| 首轮完成（档案 assistant 已 done） | 16670 | `first.roundCompleted` |
| 追问在途 → 完成 | 17798 → … | `followup-sent.followInflight.inFlight=true` |

- **在途绑定 v1**：v2 于 t=8053 启用，而首轮完成检测于 t=16670（晚 8.6s）；启用 v2 时读档案，
  首轮 assistant 仍为 pending（`firstRoundDoneAtV2=false`）；切回写作页时请求仍在途
  （`afterV2Return.stillInFlightAtReturn=true`）。完成后该轮 `chain_rounds[0].version_index=1`。
- **下一轮绑定 v2**：追问帧 `chain_rounds[1].version_index=2`，且首轮记录保持 1 不被改写。
- **实时只读行**（应用「本次参考了什么」的链路行）：首轮完成后为
  `本轮链路：CDP长卡验收链·第1版`；追问后为
  `["本轮链路：CDP长卡验收链·第1版","本轮链路：CDP长卡验收链·第2版"]`。

## 4. 复查的隔离档案（真实 Rust 落盘）

讨论 `mv2h95se-1b8e39209eee4030b3834b2dccf009e3`（隔离项目 `next-story-system/conversations/`）：

```json
"chain_rounds": [
  { "turn_index": 0, "chain_id": "chain-cdp-long-acceptance", "chain_name": "CDP长卡验收链", "version_index": 1 },
  { "turn_index": 1, "chain_id": "chain-cdp-long-acceptance", "chain_name": "CDP长卡验收链", "version_index": 2 }
]
```

- `turns` 角色/状态：`assistant(done)`（首轮回应）→ `user(done)`（追问）→ `assistant(done)`（追问回应）。
- 隔离链路库 `chains.json` 结束时 `active=null`（停用生效）。

## 5. 操作区同区（7.4「启停同区」）

- 断言 `sameArea.enableAndDeactivateInVersionOperations`：`#making-enable-btn` 与 `#making-deactivate-btn`
  同处 `#making-inspector-content .making-version-operations`（`aria-label="版本操作区"`）。

## 6. 断言汇总

- **20 / 20 通过**：同区、初始未启用、取消不改指针、v1 启用、在途状态可见、v2 在途启用、
  在途请求未完成即启用、成功后按 v1 落档、完成晚于 v2 启用、追问次轮按 v2 落档、首轮保持 v1、停用清指针。
- `consoleErrors` 为空；无失败提示；未超观察上限（每轮远早于 90s 终态）。
- 证据文件：`evidence-binding/chain-round-binding-acceptance.json`；
  截图 `binding-00-v1-enabled.png`、`binding-01-inflight-v1.png`、`binding-02-v2-enabled-inflight.png`、
  `binding-03-first-round-done.png`、`binding-04-followup-done.png`。
  `binding-02` 可见制作页状态条「从下一轮开始使用；正在生成的回复沿用发起时的版本」与
  「正在使用：CDP长卡验收链·第2版」；`binding-01` 可见对话流「正在思考…」与直问键禁用。

## 7. 如实记录的一次方法纠错（首跑未捕获在途窗口）

- 首跑（14:13:30Z）在途判据误用了 `[data-role="loading"]`。源码事实：直接提问首轮的状态由
  `DirectQuestionView`/对话流承载，`[data-role="loading"]` 对直接提问**不显示**（`ai-panel-view-model.ts`
  `requestFacts` 的 `direct_question` 分支返回空）；故首跑在途检测空转 15s，叠加 1s 等待，切到制作页时
  首轮已接近完成，`firstRoundDoneAtV2` 落在真值边界，**在途窗口不可判定**。
- 纠正：在途判据改为对话流状态消息 `.ai-message-status`（文案「正在思考…」，直接提问首轮与追问**共用**，
  完成后该消息消失）。用一次纠正运行复验，全部关键断言通过（见 §3）。首跑与纠正运行均如实留存
  （首跑 JSON 已被纠正运行覆盖，经过记录于本节，不伪造）。
- 未发现「模型完成过快」导致不可捕获之情形：纠正运行在途窗口约 11s（t=5.7s～16.7s），
  在途内完成 v2 启用且余量充足。

## 8. 命令

```text
node openspec/changes/fix-ai-and-making-usability/verification/ui-acceptance/chain-round-binding-acceptance.mjs 9225
```

## 9. 实例与清理

- 结束时 owned 隔离实例仍在运行：根 `cmd.exe` PID **33604**（`owned-dev.json`），
  `next-story.exe` PID **29040**，CDP 9225。
- 清理建议（仅向下杀该受控实例树，不影响其他进程）：`taskkill /PID 33604 /T /F`
  （若 PID 已变，先核 `next-story.exe` 父链再杀）。

## 10. 本批改动文件

- 新增脚本：`verification/ui-acceptance/chain-round-binding-acceptance.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-binding/chain-round-binding-acceptance.json` 与 5 张截图。
- 新增本记录：`verification/ui-acceptance/chain-round-binding.md`。
- 更新 `openspec/changes/fix-ai-and-making-usability/tasks.md`：勾选 7.3、7.4（依据见上）。
- 未改 `src/`、`src-tauri/`、`tests/`、`openspec/specs/`、产品配置、keyring；未 commit/归档。

## 11. 覆盖边界与剩余任务（不夸大）

- 本记录只覆盖 tasks 7.3（不经确认不改指针 / 确认后调用既有命令 / 全局一条 / 下一轮生效 / 在途不变 / 保存≠启用）
  与 7.4（启停同区、次轮生效、在途轮不变）在**同一链路 v1→v2** 上的一次真实桌面证明。
- 未覆盖（仍属 change 剩余验收）：task 8.2/8.3 中其它条目的真机总览（边栏三按钮几何、讨论删除、等待授权卡、
  选区召唤、卡删除基线、完整卡原文等各有独立证据文件）、8.4 规格同步。本记录不勾 8.x。
- 真实模型为隔离配置中配置的模型（未读取/未改动其身份，仅经既有 config 复用）；未输出密钥或系统隐私，
  未复制模型回复全文进证据。
