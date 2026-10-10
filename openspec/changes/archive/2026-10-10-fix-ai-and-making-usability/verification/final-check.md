# 最终总门禁复核：fix-ai-and-making-usability

> 角色：最终集成验证 owner（隔离实例清理 + `npm run check` + `openspec validate --strict`）。
> 日期：2026-10-10（终验 session）。工作目录已 `Test-Path` 确认为 `D:\Next Story`。
> 前置状态：designer 后续修改 `index.html`、`src/styles.css`、`src/ui-v5.css`（真实长授权理由按钮遮挡）已在工作树。
> 本记录仅为证据；未改产品代码、未 commit、未归档、未读写用户项目文档/配置/密钥。

## 1. 隔离验收进程树核实与停止（仅本 change launch-dev）

停止前核实（本 session 实况，非沿用旧记录）：

- `owned-dev.json`（本目录 launch-dev.mjs 产物）：root `cmd.exe` PID **19880**，port 9225，override = 本 change 的 `tauri.override.json`，started 2026-10-10T12:31:47Z。
- 以 PID 19880 为根、按 `Win32_Process` 父子关系完整枚举**后代 20 个进程**，加根共 **21 个**，全部属本实例：
  - wrapper：`cmd 19880` → `node npm 33520` → `conhost 25036` → `cmd 23764`（`tauri dev --config .../tauri.override.json --no-watch`）→ `node tauri.js 20788`；
  - dev server：`cmd npm run dev 29484` → `node npm 11848` → `cmd vite 20232` → `node vite 20424`（端口 1420 LISTEN）→ `esbuild 32344`；
  - 构建/应用：`cargo 12576` → `cargo 27948` → `next-story.exe 10360`（`target\debug\next-story.exe`，PID 与 `recovery-status.md` 一致）；
  - 应用子进程：`sidecar driver.mjs 31372`（`--api-base ...coding/paas/v4 --model glm-5.3`）+ `conhost 23340`；
  - WebView2：`msedgewebview2 25020`（`--remote-debugging-port=9225`，`--user-data-dir=...\com.nextstory.acceptance\EBWebView`）→ 25036/12592/20904/27068/30928 等 5 个子进程。
- 隔离标识：`identifier=com.nextstory.acceptance`、数据目录 `...\Local\com.nextstory.acceptance`；命令行为本仓库该 override 或该隔离 user-data-dir。
- **未包含任何其他用户进程**：另有 2026-10-9 启动的 `msedgewebview2`（PID 14892 子树）不在该父子树内，未触碰。

停止动作：`taskkill /PID 19880 /T /F`，退出码 **0**，21 个进程全部终止。

停止后复核（全部通过）：owned 树 21 个 PID 无一存活；无 `next-story.exe`、无 `cargo.exe`；端口 9225、1420 均已释放；无 `com.nextstory.acceptance` 残留 webview2；无关的 10-9 `msedgewebview2 14892` 仍在（未被误杀）。

## 2. `openspec validate --strict`

```text
npx openspec validate fix-ai-and-making-usability --strict
```

结果：`Change 'fix-ai-and-making-usability' is valid`，退出码 **0（通过）**。

## 3. `npm run check` —— 一次连续运行

命令（工作目录 `D:\Next Story`，实例树已停止、exe 未被占用）：

```text
npm run check
```

定义：`typecheck → lint → test:frontend → test:reliability → test:driver → test:validation → build → fmt:rust → clippy:rust → test:rust`

| 步骤 | 结果 |
|------|------|
| typecheck | 通过（`tsc --noEmit` 无报错） |
| lint | 通过（`eslint .` 无报错） |
| test:frontend | 通过：**1385 tests / 1385 pass / 0 fail / 0 skipped / 0 todo** |
| test:reliability | 通过：**121 tests / 121 pass / 0 fail / 0 skipped** |
| test:driver | 通过：**33 tests / 33 pass / 0 fail / 0 skipped** |
| test:validation | 通过：**78 tests / 78 pass / 0 fail / 0 skipped** |
| build | 通过（`vite v6.4.3`，135 modules transformed，built in **3.13s**） |
| fmt:rust | 通过（`cargo fmt --check` 无差异） |
| clippy:rust | 通过（`Finished \`dev\` profile ... in 9.04s`，`-D warnings` 无告警） |
| test:rust | 通过：**663 passed / 0 failed / 4 ignored**（明细见第 4 节） |

**`npm run check` 单次连续退出码：0（通过）。** 无步骤失败、无中途停止。

## 4. `test:rust` 明细（单次连续运行内）

| target | 结果 |
|--------|------|
| lib（next_story_lib unittests） | 531 passed / 0 failed / 1 ignored（15.90s） |
| main.rs unittests | 0 passed |
| export_test | 21 passed / 0 failed |
| fdx_import_test | 10 passed / 0 failed |
| import_fidelity_test | 4 passed / 0 failed |
| llm_config_test | 33 passed / 0 failed |
| markdown_export_test | 18 passed / 0 failed |
| markdown_import_test | 6 passed / 0 failed |
| on_demand_reading_negative_test | 2 passed / 0 failed |
| project_test | 33 passed / 0 failed |
| real_link_on_demand_reading_test | 0 passed / 0 failed / 3 ignored（需真实链路，手动 `--ignored`） |
| word_import_test | 5 passed / 0 failed |
| doc-tests | 0 passed |
| **合计** | **663 passed / 0 failed / 4 ignored** |

## 5. 任务勾选与未完成项（如实）

- **本次未新增勾选任何任务**：此前已由各 lane 证据勾选的任务保持 [x]；仍为 [ ] 的任务其真实场景未完成，按「未完成真实场景不得勾」一律不勾。
- **更新仅限 8.1 文字**：由「组合门禁（非一次连续）」更正为「一次连续 `npm run check` 退出码 0」（见 `tasks.md`）。
- 最终门禁支持已勾选的实现/测试任务（typecheck/lint/frontend/reliability/driver/validation/build/fmt/clippy/test:rust 全绿）。

留 [ ] 的未完成真实场景：

1. **2.2 残余形态**：真实召唤仅覆盖「跨段落 + 引号 + 反斜杠 + inline mark」一种形态；D4 的其它形态（部分列表项、跨首尾块裁切、嵌套列表缩进）仅有纯计算/一致性证据，未在真实桌面单独召唤。
2. **授权「拒绝」分支**：真实补读只跑「允许」路径；「本次不允许」、跨重启授权保留、讨论关闭授权开关未真机验证。
3. **6.1 真实起草链路**：制作对话「起草（`parseCardDrafts`/草稿面板）→ 保存 → 查看 → 全页 DOM」的真实模型端到端、以及原报告样本首/中/尾对照未完成（batch1 仅证「真实 Rust 存储读取 → 全页 DOM 全文」）。
4. **7.4 在途/下一轮**：真实「在途轮沿用发起版本、下一轮采用新启用版本」的集成证明未完成（batch2 仅证指针机械语义）。
5. **8.4 必要同步**：归档前主规格必要同步未执行。

另：8.2（真实 Windows 桌面全量验收）与 8.3（截图/视觉比对证据，mock 全绿不作归档依据）仍未完成。

## 6. 本 session 改动文件

- `openspec/changes/fix-ai-and-making-usability/verification/final-check.md`：本记录。
- `openspec/changes/fix-ai-and-making-usability/tasks.md`：仅更新 8.1 文字（勾选状态未变）。

未改写任何产品代码；未 commit / 未归档；未读写用户项目正文、配置或密钥。

---

## 附：历史记录（前一 session，非连续门禁，已被第 3 节取代）

更早一次 session 的 `npm run check` 首轮在 `test:rust` 因**验收 dev 实例占用 `target\debug\next-story.exe`**（拒绝访问 os error 5，退出码 101）而失败；前 9 步全绿，停止该实例后 `test:rust` 单独复跑退出码 0（663 passed / 0 failed / 4 ignored）。该次为**组合门禁**，不是一次连续 check 退出 0。本次（第 3 节）已在停止隔离实例树后取得**一次连续**退出码 0，历史结论以本次为准。
