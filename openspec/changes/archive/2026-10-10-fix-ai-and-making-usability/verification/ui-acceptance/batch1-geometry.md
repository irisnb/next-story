# 真实桌面 CDP 几何验收（第一批）

> change: `fix-ai-and-making-usability`
> 角色：validation owner（真实 WebView 几何与可重复验收脚本）。不新增产品行为、不改源码。
> 日期：2026-10-10。工作目录：`D:\Next Story`。
> 本记录仅为证据；未 commit、未归档；未改动任何用户真实项目、配置或作品正文。

## 0. 环境与隔离

- 运行实例：真实 Tauri **dev** 构建，隔离 identifier `com.nextstory.acceptance`（`tauri.override.json`），
  CDP 端口 9225（`WEBVIEW2_ADDITIONAL_BROWSER_DEBUGGING` 参数由 `launch-dev.mjs` 注入）。
- 应用数据目录（隔离）：`C:\Users\Administrator\AppData\Local\com.nextstory.acceptance`；
  未触碰用户真实实例目录（`com.nextstory.desktop`、`com.nextstory.app`）。
- 视口：1024 × 670，DPR = 1；`http://127.0.0.1:9225/json/list` 返回真实 WebView page（`Next Story`）。
- `browser_*` 插件不可用；全部经**直接 CDP websocket（Node 24 内建 WebSocket）**驱动，未做任何 DOM 注入式“造假行为”。
- 隔离测试项目：`C:\Users\Administrator\AppData\Local\Temp\opencode\acceptance-fix-ai\project-geometry\CDP几何验收-隔离`（新建的空项目；无用户正文）。
- 隔离实例**无** LLM 配置（未写 `llm-config.json`）；因此状态停在 `configuration_required`，**不触达真实模型**、无长阻塞。
  本批**不含**真实 LLM 召唤/授权，留后续批次（与任务边界一致）。

## 1. 可重复脚本

| 脚本 | 作用 |
|------|------|
| `verification/ui-acceptance/cdp-client.mjs` | 复用型 CDP 客户端（连接/求值/点击/悬停/键盘/截图） |
| `verification/ui-acceptance/launch-dev.mjs` | 以隔离 identifier 启动/重启 dev 实例（已在运行） |
| `verification/ui-acceptance/bootstrap.mjs` | 在隔离实例中经 UI 新建并打开隔离测试项目、展开 AI 面板 |
| `verification/ui-acceptance/probe.mjs` | 只读侦察当前页面/项目/面板/讨论状态 |
| `verification/ui-acceptance/seed-chains.mjs` | 向隔离实例应用数据目录写入一条长卡 fixture 链路（`making-module/chains.json`），仅 `com.nextstory.acceptance` |
| `verification/ui-acceptance/ai-panel-geometry.mjs` | AI 面板头动作组几何 + 列表顶边 + 删除确认/撤销 |
| `verification/ui-acceptance/making-card-geometry.mjs` | 制作页版本操作区集中 + 长卡全文首/中/尾 |

最短复现命令（实例已运行于 9225）：

```text
node probe.mjs 9225
node seed-chains.mjs
node ai-panel-geometry.mjs 9225
node making-card-geometry.mjs 9225
```

两个几何脚本在失败或出现 fatal 时以退出码 1 结束，可作为自检。

## 2. AI 面板几何结果（`ai-panel-geometry.mjs`）

证据 JSON：`evidence-ai/evidence-ai.json`；截图：`evidence-ai/*.png`。
**24 项断言全部通过（0 失败，0 fatal，0 console error）**（统计含三种模式与列表/删除）。

讨论来源：经真实 UI（面板 →「讨论」列表 →「新建对话」）创建空讨论，再提交一个**长问题**（隔离实例无模型配置 →
`configuration_required`，不触达模型），得到 41 字长标题（超过 CSS 170px 截断宽度）。

### 2.1 `.ai-window-head` 动作组几何（tasks 3.5）

三种模式下，`.ai-window-actions` 的子元素两两**零重叠**、**同排单行**（中心 y 偏差 0px）、
整组完全包含在头部矩形内、标题与动作组**零重叠**、动作组 `flex-wrap:nowrap` + `white-space:nowrap`。

| 模式 | 面板宽 | 头部宽 | 动作组矩形(x,w) | 可见动作子项 | 结论 |
|------|--------|--------|------------------|--------------|------|
| 默认 | 330 | 311 | x=891 w=116 | focus-switch / badge(失败) / more / close | 通过 |
| 最窄 | 300 | 465→实际 300 档 | x=803 w=116 | focus-switch / badge / more / close | 通过 |
| 最大化 | 全宽（头 `min(100%,760)`=760） | 760 | x=385.5 w=116 | focus-switch / badge / more / close | 通过 |

- 最窄档（`aria-valuenow=300`）标题 `clientWidth=170 / scrollWidth=501` → **截断生效**，与动作组零重叠。
- 头部文本随模式变化，动作组始终同排不出界。

**本批未覆盖**：`materials-toggle` 与 `stop` 在 `configuration_required` 状态下不渲染（`hasMaterials=false`、`hasStop=false`），
故四按钮中的这两个**未单独测量**。动作组**容器**（nowrap/不拆行/不重叠/标题让位）已在真实 DOM 上证实；
`materials/stop` 可见态随真实生成/材料态，留后续批次补。

### 2.2 讨论列表顶边不压面板头（tasks 3.1）

`list-open`：面板头高 56px；列表 `top` 相对停靠区顶 = 56px（与头部等高），
`list.top - header.bottom = 0px`（不重叠、不压边），`z-index` 列表 30。断言 `list.notPressingHeader` 通过。

### 2.3 删除确认与撤销（tasks 3.2 / 3.3）

- 悬停行 → 行尾 `.ai-cl-actions` 显示（`display:flex`）；点删除 → 行进入 `confirming`，
  行尾操作组从 DOM 移除/不显示，`.ai-cl-confirm` 显示，**确认区与操作组重叠面积 = 0**。
- 取消 → 确认消失、操作组回到 DOM（`actionsPresent=true`）。
- 键盘路径：焦点进入确认区的「删除」按钮时，**动作组仍隐藏**、确认可见；`Enter` 键激活删除成功（行数 1→0）。
- 删除后 `#ai-dock-notice` 可见（`.ok`），「撤销」按钮 `disabled=false`，
  在撤销按钮中心做 `document.elementFromPoint` 命中**就是撤销按钮本身**（未被列表 z-index 30 遮挡；notice z-index 31）；
  键盘 `Enter` 激活撤销 → 提示隐藏、行恢复（行数 ≥1）。

## 3. 制作页结果（`making-card-geometry.mjs`）

证据 JSON：`evidence-making/evidence-making.json`；截图：`evidence-making/*.png`。
**11 项断言全部通过（0 失败，0 fatal，0 console error）**。

数据来源：`seed-chains.mjs` 写入一条隔离 fixture 链路（`slot_type=requirement`，正文 709 字、触发描述 156 字），
经**真实后端读取**（切换制作页触发 `making.refresh()` → `chain_library_load`）后渲染，非 DOM 注入内容。

### 3.1 启用/回退/停用集中固定操作区（tasks 7.1 / 7.2，几何复核）

`.making-version-operations` 区域矩形 (x=182,w=803)；其中 `#making-version-select`、`#making-enable-btn`、
`#making-deactivate-btn`、`.making-version-using`、`#making-delete-chain-btn` **全部落在该区域内**（`allInside` 全 true）。
「正在使用：未启用链路，使用日常陪想」同区显示；版本下拉列出「第1版（最新）」。
（7.1/7.2 已在 tasks.md 据既有测试勾选，本批为其真实 WebView 几何复核。）

### 3.2 完整卡原文不摘要（tasks 6.1，真实存储读取路径）

全页详情 `#making-card-panel` 各分段（`身份/何时用/怎么做/本版变化/试问记录`）：
「怎么做」正文分段长度 **709**（与 fixture 正文全等），逐字包含 `【正文开头】`、`【正文中段】`、`【正文结尾】`；
「何时用」分段长度 **156**（与触发描述全等），逐字包含 `【触发开头】`、`【触发结尾】`。
证明经真实存储读取后全页详情**逐字呈现全文**，未摘要/截断。
**本批未覆盖**：制作对话「起草→保存确认→保存后查看」链路（经真实模型）未在本批执行；原报告样本端到端对照留后续。

## 4. 未证 / 阻塞（不在本批勾选）

- `materials-toggle` / `stop` 的可见态几何（需真实生成或材料态）——后续 LLM/材料批次。
- 任务 3.4 的完整四按钮（materials/stop/more/close）稳定：容器行为已证，materials/stop 未出现。
- 任务 4.2 / 4.4（授权卡贴底/上翻/切换可见）——需授权请求态，未执行。
- 任务 6.1 的「起草→保存确认→保存后查看」真实模型链路、原报告样本对照。
- 任务 7.3 / 7.4（在途轮/次轮生效集成证明）。
- 组 2（选区真实召唤到达真实链路）、8.2/8.3（真实模型召唤与全量真机）、8.4（规格同步）——不在本批。
- 观察（交主助手/designer 视觉复核，非失败）：最窄面板下删除撤销提示中的「撤销」按钮被挤到约 10.5px 宽、
  文字竖排换行（仍可见可点，`hitIsUndo=true`）；提示文案显示完整 40 字标题致提示偏高。

## 5. 本批改动文件

- 新增：`verification/ui-acceptance/{cdp-client,bootstrap,probe,seed-chains,ai-panel-geometry,making-card-geometry}.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-ai/`、`verification/ui-acceptance/evidence-making/`。
- 新增本记录：`verification/ui-acceptance/batch1-geometry.md`。
- 更新：`openspec/changes/fix-ai-and-making-usability/tasks.md`（仅按本批证据勾选 3.1 / 3.2 / 3.3 / 3.5）。
- 未改动任何 `src/`、`src-tauri/` 产品源码；未 commit、未归档。
