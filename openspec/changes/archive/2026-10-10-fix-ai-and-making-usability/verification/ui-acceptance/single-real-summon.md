# 单次真实选区及时召唤（bounded）—— batch3-real-ai

> change: `fix-ai-and-making-usability`。角色：运行时唯一 owner。日期：2026-10-10。
> 范围：验收 scripts / evidence / tasks。**未改产品代码**、未 commit/归档、未读写正式用户项目正文与配置。
> 目标（用户授权 2026-10-10）：**一次**真实 Tauri 选区及时召唤——隔离 fixture 中跨段落且含
> 引号 / 反斜杠 / inline mark 的选区，点击选区旁「AI」，观察真实模型首轮回复或具体报错。

## 0. 隔离与凭据路径（授权边界内）

- 实例：真实 Tauri **dev**，隔离 identifier `com.nextstory.acceptance`，CDP `127.0.0.1:9225`。
  现核实进程：`next-story` PID **10360**；owned wrapper cmd PID **19880**（`owned-dev.json`）。
  `app_local_data_dir` = `C:\Users\Administrator\AppData\Local\com.nextstory.acceptance`（隔离）。未启动/未触碰正式应用。
- 配置（只写非秘密白名单字段，**无 api_key 键**）：
  - 安全脚本 `read-real-llm-config.mjs` 只输出白名单字段：
    - 正式 `Local\com.nextstory.desktop\llm-config.json`：键 `[api_base_url, model]`，无 legacy api_key；
      值 `https://open.bigmodel.cn/api/coding/paas/v4` / `glm-5.3`（地址已脱敏，无 query/userinfo）。
    - 正式 `Roaming\com.nextstory.desktop\llm-config.json`：**含 legacy `api_key` 键** → 仅报告存在，
      **停止该文件路线，未读取值、未触发 migration**。
  - `configure-isolated-from-real.mjs` 把 `api_base_url` + `model`（无 `max_tokens`、无 `api_key`）写入
    隔离实例配置。校验：隔离配置键 = `[api_base_url, model]`，`api_key_present=false`。
  - **未调用** `save_llm_config` / 前端「保存设置」；**未读/未显示/未复制**密钥；未改正式配置或钥匙串。
  - 密钥复用：隔离实例经应用既有路径 `llm_config::load_llm_config`（`mod.rs:634-661`，无 api_key 键时
    只 `keyring get` → 共享 service `com.nextstory.desktop` / account `llm-api-key`）**只读 get** 复用现有凭据
    （源码已核：`load_llm_config_summary` 同款；无 app env 读取路）。
  - 记录内不含密钥、地址敏感 query 或凭据。

## 1. Fixture（隔离项目，用户式编辑，非 AI 写作品）

- 项目：`CDP几何验收-隔离`（隔离临时目录）；编辑器 `#editor-textarea .ProseMirror`（Tiptap contenteditable）。
- 用 CDP `Input.insertText` 用户式输入两段，回车分段：
  - P1：`沈一苇说："信里写着 C:\旧站\第七封。"`（含中文引号与 Windows 反斜杠路径）
  - P2：`她把信折好，放回抽屉，没有回头。`
- inline mark：选中 `第七封` → 点工具栏 `#btn-bold`，DOM 出现 `<strong>`（`boldHasStrong=true`）。
- 未使用任何 AI 写文档路径；未访问正式用户正文。

## 2. 召唤动作与真实结果

- 形成**跨段落**选区：从 P1「信里」到 P2「放回」后，覆盖 **引号** `"`、**反斜杠** `\旧站\`、**行内 mark**（加粗 `第七封`）。
- `#ai-selection-entry` 可见（trigger rect x=341,y=214,44×32），点击 `#ai-selection-entry-trigger`（正文「AI」入口）。

观察（真实链路，非 mock）：

| 时刻(相对点击) | 观察 |
|------|------|
| +2.4s | 面板打开，讨论窗口生成；`loading=true`（「正在思考…」）；窗口正文显示冻结选区 `信里写着 C:\旧站\第七封。" 她把信折好，放回` |
| +12.5s | `loading=false`；`conversation` 渲染**真实模型首轮回复**（正文含对该选区两句话的逐句分析） |
| +18.6s | 回复稳定，无 error、无 config、无 console error |

- 冻结选区标题（窗口头）：`信里写着 C:\旧站\第...`；回复明确写「**本轮仅基于这两句话，未读取作品其他内容**」——
  与「及时召唤只基于冻结选区、不取材」的设计一致。
- 截图：`evidence-summon/summon-selection.png`（选区高亮）、`evidence-summon/summon-result.png`（回复）。
- **结论（PASS）**：点击「AI」后召唤**到达真实后端并通过选区授权**（跨段落 + 引号 + 反斜杠 + 行内 mark
  未被误拒），请求**到达真实模型 `glm-5.3`（coding 端点）并返回首轮回应**；首轮回复在 ~12.5s 内出现。
- 具体错误：无。未出现 `invalid_selection_error`（「AI 请求内容无效」）或任何 error block。

## 3. 如实记录的方法限制

- 采样脚本 `summon-once.mjs` 的自动完成判定只看 `[data-role="response"]`，而本应用完成回复渲染在
  `[data-role="conversation"]`，故 `result.status` 落在 `unknown`、循环跑满 180s 上限；**回复本身在
  ~12.5s 已到**（见 samples 中 t=12514 的 bodyText）。为遵守「一次召唤」，**未重跑**；证据以
  `single-real-summon.json` 的 samples/bodyText 为准（JSON 内含完整首轮回复）。
- 本次为**一个**跨段落 + 引号 + 反斜杠 + inline mark 的选区；D4 的其它形态（部分列表项、跨首尾块裁切、
  嵌套列表缩进）未在本次单独再跑（其纯计算/一致性证据见 `selection-backend-lane.md`）。
- `invalid_selection_error` 覆盖 ≥10 分支的残余未知：见 `selection-backend-lane.md`「残余未知 / 风险」；
  本次真实召唤成功不证明用户现场唯一根因已消除（只证明该形态不再被误拒）。

## 4. 命令

```text
node read-real-llm-config.mjs            # 白名单字段（不含 api_key）
node configure-isolated-from-real.mjs    # 无 api_key 写入隔离配置
node summon-once.mjs 9225                # 单次真实召唤
```

## 5. 实例与清理

- 结束时 owned 实例仍在运行：`next-story` PID **10360**，CDP **9225**，wrapper cmd PID **19880**。
- 清理建议（仅向下杀该实例树，不影响其他进程）：
  `taskkill /PID 19880 /T /F`（若 PID 已变，先 `Get-CimInstance Win32_Process` 核 `next-story.exe` 父链再杀）。

## 6. 本批改动文件

- 新增脚本：`verification/ui-acceptance/{read-real-llm-config,configure-isolated-from-real,probe-editor,summon-once}.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-summon/{single-real-summon.json,summon-selection.png,summon-result.png}`。
- 新增本记录：`verification/ui-acceptance/single-real-summon.md`。
- 更新 `openspec/changes/fix-ai-and-making-usability/tasks.md`：勾选 2.1、2.2（范围见 §3）。
- 未改 `src/`、`src-tauri/`、`tests/`；未 commit/归档；未读写正式用户正文/配置/密钥。
