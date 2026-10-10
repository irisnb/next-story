# 有界恢复：制作页状态核实（recovery-making）

日期：2026-10-10 约 21:51（新 session，接续两次被取消的验收任务）
范围：只做「端口/进程归属核实 + 打开制作页 + 读取非秘密状态 + 报告下一次单个模型请求所需」。
**未发任何模型请求；未改任何源代码/配置/keyring；未读密钥；未读用户项目正文；未 commit/归档；未改 tasks.md。**

## 1. 端口与进程归属（不盲信旧 PID）

| 端口 | 状态 | 归属 |
|------|------|------|
| `127.0.0.1:9225` | LISTEN（PID 33504） | `msedgewebview2.exe`，`--user-data-dir=...\Local\com.nextstory.acceptance\EBWebView`、`--webview-exe-name=next-story.exe`、`--remote-debugging-port=9225` → **就是本 change 的隔离实例** |
| `[::1]:1420` | LISTEN（PID 30728） | `node ... vite.js`（dev server） |

进程链（活进程核实，非旧记录）：
- `next-story.exe` PID **29040**（21:40:20 启动）← `cargo.exe` 23888/23424 ← `node.exe` 19540 ← `cmd.exe` 26600 ← **`node.exe` PID 33604**（21:38:30）
- `owned-dev.json`（预批准临时目录）记录 `pid=33604, port=9225`；**与本轮活进程链一致**，即 9225 上确为本 change `launch-dev.mjs` 启动的隔离 dev 实例。
- 注意：同目录 `owned.json` 记录的是更早的 `pid=15028`（debug exe，11:00:58）——**已过时**，未采用。
- 本轮**未重新启动**（实例已可连，无需重编译等待）。

## 2. CDP 与页面

- CDP 可连：`/json/list` 返回 `type=page, title="Next Story", url=http://localhost:1420/`。
- 只读 `probe.mjs`：初始为**欢迎页**（`currentProject=""`，最近项目 `CDP几何验收-隔离`）。
- 经 `.recent-work-item` 打开隔离 fixture 项目 → `#editor-page` 可见，`current=CDP几何验收-隔离`；点击 `#tab-making` **制作页已打开**（`#module-making` 可见、`#tab-making` active）。

## 3. 制作页当前非秘密状态（打开后立即读取）

- 链路库：**1 行** `chain-cdp-long-acceptance`（seed fixture，「未启用」），**未被选中**（`#making-inspector-empty` 可见、content 隐藏）。
- 版本选择：`#making-version-select` 存在但 0 选项；卡片 `· 0 张卡`；姿态 `· 0 张卡`。
- 草稿：**无**（无任何 `*draft*` 元素、`#making-conversation-input` 长度 0）。
- 制作会话：未激活（`#making-conversation-active` 不可见），无消息。
- 顶部状态条：显示**未启用**（「当前未启用链路，使用日常陪想」）。
- 无 trial / 完整详情 / 快捷面板打开态。

## 4. 上次任务留下的产物（如实）

1. **有**：`...\Local\com.nextstory.acceptance\making-module\chains.json.cdp-bak`（20:05:24）保存着上一次制作验收（卡删除）的中途状态——多出 **version 2** `chainver-1791633922778093400-3`（`change_note="删除卡片「可删除的第二张卡」`，仅剩 1 张长卡）。这是卡删除验收的磁盘副产品。
2. 当前**生效的** `chains.json`（20:08:16）已被 seed 重写回**单版本 fixture**（`active:null`）；当前应用读到的即此干净状态，**制作页 UI 里没有残留版本/草稿**。
3. 隔离项目目录（`Temp\opencode\acceptance-fix-ai\project-geometry\CDP几何验收-隔离`）留有上次验收产物：`conversations\` 3 个讨论 JSON、`作品文本\documents\` 2 个文档（`setup-docs.mjs` 夹具）。均为隔离夹具，非用户数据。
4. 应用数据目录另有 `dsh\`（21:05:39，来自上次召唤）、`recent-works.json`（21:49:37，本轮打开项目所致）。

结论：**当前链路/草稿在运行实例中没有上次任务遗留的活动产物**；遗留仅存在于磁盘备份文件 `.cdp-bak`（卡删除的第 2 版快照）与隔离项目里的旧讨论/文档夹具。既非用户数据，也不影响当前制作页显示。

## 5. 下一次「单个模型请求」所需（仅报告，本轮不执行）

可用凭据路径已就绪（非秘密核对）：隔离 `llm-config.json` **存在**，键 `[api_base_url, model]`，`api_key_present=false`（走应用既有 keyring 只读复用；keyring 条目本轮**未触发、未读取**）。因此配置层面不构成阻塞。

现有可发单次真实请求的脚本（二选一）：

| 脚本路径 | 用途 | 主要 selectors | 请求数 |
|----------|------|----------------|--------|
| `verification/ui-acceptance/summon-once.mjs` | 选区及时召唤（最近一次 21:08 已跑通） | `.recent-work-item`/`.recent-work-name`、`#tab-writing`、`#editor-textarea .ProseMirror`、`#btn-bold`、`#ai-selection-entry`、`#ai-selection-entry-trigger`、`#ai-dock`、`.ai-window` `[data-role="body"\|"loading"\|"response"\|"error-block"\|"error-message"\|"config-block"\|"conversation"]` | 1 |
| `verification/ui-acceptance/reading-auth.mjs` | 按需补读授权端到端 | 同上 AI 面板选择器 + 授权卡/状态点 | ≤2 |

制作对话若要走真实模型，**目前没有现成脚本**；需要新写有界脚本，相关 selectors 为 `#making-conversation-start-btn`、`#making-conversation-input`、`#making-conversation-send`、`#making-session-messages`。

已知阻塞/限制（沿用既有记录，非本轮新发现）：
1. `summon-once.mjs` 完成判定只认 `[data-role="response"]`，而应用回复渲染进 `[data-role="conversation"]` → 脚本会落 `status=unknown` 并跑满 180s（**回复实际约 12.5s 已到**，证据以 samples/bodyText 为准）。这是报告口径问题，不阻塞真实请求。
2. 运行前需先停止本 change 已启的隔离实例树（若与门禁/真机验收冲突）；单跑本脚本无需停。
3. 本项目其余验收任务（4.x）标记已勾，真实模型相关待办主要落在 8.2/8.3 真机验收；具体「下一个单请求」应由调度方指定（选区召唤 or 补读授权 or 制作对话）。

## 6. 本轮未做

未发模型请求，未改 `src/`、`src-tauri/`、`tests/`、配置或 keyring，未读密钥，未读写用户真实项目正文/配置，未 commit/归档，未勾 tasks。仅：打开隔离 fixture 项目、切换制作标签、只读侦察、写本记录。
