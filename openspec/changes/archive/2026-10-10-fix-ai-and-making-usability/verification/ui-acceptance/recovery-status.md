# 有界恢复状态（配置完成 + 桌面可连）

日期：2026-10-10（新 session，替换已取消的真实 AI 验收 session）
范围：仅确认「隔离配置是否完成 + 桌面是否可连」。已发模型请求＝否；未跑其他验收；未改产品/任务勾选；未 commit。

## 结论

- **隔离配置：已完成。**
- **桌面（隔离实例）：可连。**

## 脚本安全审核（仅审核、未打印密钥）

- `read-real-llm-config.mjs`：只读，白名单输出 `api_base_url`/`model`/`max_tokens`，URL 脱敏，绝不输出 `api_key` 值，只报告该键是否存在；不写文件。→ **安全，已执行**。
- `configure-isolated-from-real.mjs`：只把白名单三字段写入 `com.nextstory.acceptance`，**不写 `api_key` 键**，不调用 `save_llm_config`，不改正式配置/钥匙串；源含 legacy `api_key` 键即中止。源路径固定为 Local 正式目录。→ **安全；本轮未重复执行**（产物已存在且一致，重跑只会重写相同值并生成 `.cdp-bak`，无必要）。

## 配置事实

- 隔离配置 `C:\Users\Administrator\AppData\Local\com.nextstory.acceptance\llm-config.json`
  - keys：`api_base_url`, `model`（**无 `api_key` 键**）
  - `api_base_url=https://open.bigmodel.cn/api/coding/paas/v4`，`model=glm-5.3`，写入时间 20:31:40
  - `api_key` 由隔离实例经既有 keyring 只读复用（未读取/打印密钥值）。
- 正式源（Local）`...\com.nextstory.desktop\llm-config.json`：keys 同为 `api_base_url`,`model`，**无 legacy `api_key`** → 迁移路线安全。
- 正式源（Roaming）`...\com.nextstory.desktop\llm-config.json`：**含 legacy `api_key` 键**；但 `configure` 脚本只读 Local 路径，该 Roaming 文件不在路线内，未触碰、未迁移。

## 桌面/端口事实

- `127.0.0.1:9225` LISTENING，PID 25020（`msedgewebview2.exe`，`--webview-exe-name=next-story.exe`）。
- 进程链：25020(webview) ← 10360 `target\debug\next-story.exe`（20:33:52 启动）← 27948/12576 `cargo run`（20:31:53）← launch-dev 记录的 `cmd.exe` PID 19880（owned-dev.json，20:31:47）。即 **9225 上就是本次 launch-dev 启动的隔离 dev 实例**。
- `[::1]:1420` LISTENING，PID 20424（node vite dev server），并有 ESTABLISHED 连接。
- `probe.mjs 9225`（只读，未打印密钥）：
  - `href=http://localhost:1420/`，`viewport=1024x670`，页面 `welcome-page` 可见（**页面 ready**）。
  - `currentProject=""`（当前在欢迎页，未打开项目）；最近项目显示 `CDP几何验收-隔离`。
  - `#ai-dock` 存在但不可见（欢迎页无项目时不显示，符合预期）；`#tab-writing` 等存在但不可见。
- `dev-out.log` / `dev-error.log` 均为 0 字节；无错误输出。

## 记录状态

- 已有 `batch1-geometry.md`、`batch2-runtime.md`；**无 batch3 记录**（与任务描述一致）。
- 脚本中不存在 `has_config` 探针（未找到该字段实现），本轮以配置键集直接核对替代。
- `batch2-runtime.md` 记载：真实 LLM 场景此前受阻于「钥匙串共享条目不可改」，正是本恢复路线（隔离实例 + keyring 只读复用）的由来。

## 下一具体操作（本轮不执行）

配置完成 + 桌面可连两个目标已达成，本轮到此为止。若继续真实 AI 验收（超出本任务范围，需另行授权）：
1. 在 9225 上的隔离实例中先**打开/新建一个项目**（当前在欢迎页，无当前项目）；
2. 再经 AI 面板发起真实首轮，验证 has_config/真实链路。

本轮未发起模型请求，未扩范围。
