# 真实桌面 CDP 运行验收（第二批）——同一 change 续跑

> change: `fix-ai-and-making-usability`
> 角色：运行时唯一 owner（真实 Tauri CDP 9225，串行执行）。日期：2026-10-10。
> 范围：验收 scripts / evidence / tasks。**未改动产品源码**、未 commit/归档、未读写用户正文与私有配置。
> 本记录仅证据；未验项一律不勾。

## 0. 环境与隔离

- 真实 Tauri **dev** 实例，隔离 identifier `com.nextstory.acceptance`，CDP 9225，视口 1024×670，DPR 1。
- 应用数据目录：`C:\Users\Administrator\AppData\Local\com.nextstory.acceptance`（隔离）。
- 未触碰用户真实实例（`com.nextstory.desktop` / `com.nextstory.app`）。
- 本 session 未重启实例；沿前序已运行实例，直接 CDP 驱动。前批 scripts（`cdp-client.mjs` 等）已扩展
  `insertText/fillText/insertEnv`（密钥值只插入、不读取不打印）与 `dialogs` 采集。

## 1. 真实 LLM 服务可用性核实与阻塞（关键）

- 隔离实例**无** LLM 配置：`Local\com.nextstory.acceptance\llm-config.json` 与 `Roaming\...` 均不存在（仅存在性检查）。
- 环境变量**存在性**检查（**只检测存在、不输出值**）：`ZHIPU_API_KEY=True`；其余 `ZHIPU_MODEL`/`ZHIPU_API_BASE`/
  `GLM_*`/`NEXT_STORY_LLM_*`/`OPENAI_*`/`ANTHROPIC_*`/`DSH_*` 均不存在。
- 项目已有真实链路验证设施：
  - `src-tauri/tests/real_link_on_demand_reading_test.rs`（`#[ignore]`，读 `ZHIPU_API_KEY` env，默认端点
    `https://open.bigmodel.cn/api/paas/v4` / 模型 `glm-5.3-flash`，用临时目录，不写钥匙串）。
  - 归档 `2026-09-22-app-real-chain-validation/verification/driver.mjs` 的 `insertEnv` 机制（值不进日志）。
- **阻塞（必须报告主助手）**：应用保存 LLM 配置会把密钥写入 **系统钥匙串固定条目**
  `KEYRING_SERVICE="com.nextstory.desktop"` / `KEYRING_ACCOUNT="llm-api-key"`（`src-tauri/src/llm_config/secret_store.rs:11-13`）。
  该条目与**用户真实应用共享**（不随隔离 identifier 变化）。因此：
  - 若在隔离实例保存配置，会**覆盖用户真实应用的密钥条目** → 属「用户私有配置改动」，**禁止**。
  - 生成必须经已保存配置（`load_llm_config` 读钥匙串）；`test_llm_connection` 不落盘但也无法驱动生成。
  - 结论：**在隔离实例上无法在不触碰用户私有凭据的前提下配置真实模型**。故本批**未执行**任何真实 LLM 场景
    （2.1/2.2 选区真实召唤、materials/stop 真实显示态、授权真实端到端、制作对话真实起草、7.3/7.4 在途轮）。
- 未自行拷贝/导入任何密钥或配置；未读取或打印任何密钥值。

## 2. 无凭据可做的真实工作（真实 WebView + 真实 Rust 存储）

### 2.1 制作卡直接删除与真实 Rust 版本库（`making-storage-and-versions.mjs`）

证据：`evidence-making/evidence-making-storage-versions.json` + 截图；**17 项断言全部通过，0 失败，0 console error**。
隔离 fixture：`seed-chains.mjs` 写入 2 张要求卡（长卡 709 字 + 第二张），真实 Rust `chain_library_load` 读取。

确认对话框：沿归档 change 既有做法，经 devtools 通道改写 `globalThis.confirm` 记录**真实确认文案**并接受
（`making-module.ts` 用 `app-dialog.ts` 的原生 `confirm`，无法自动点击；非模型 mock，业务结果仍由真实 Rust 命令产生）。

- **启用经确认才改指针**：点击 `#making-enable-btn` → 确认文案记录 → 磁盘 `active` 由 null 变为
  `{chain_id, version_id=chainver-cdp-long-1}`，状态条/「正在使用」显示已启用。
- **保存（直接删除卡追加新版本）≠ 启用**：在 v1 删除「可删除的第二张卡」→ 确认文案为
  「从「CDP长卡验收链·第1版」删除卡片「可删除的第二张卡」？将保存为新版本，历史版本保持不变，不自动启用；下一轮使用的版本不变。」
  → 磁盘版本 1→2：v1 仍 **2 张卡**（历史保持），v2 **1 张卡**；**查看跟进 v2**（下拉选中「第2版（最新）」）；
  **`active` 不变（仍 v1）**、「正在使用」仍显示第1版。
- **最后一张卡禁删 + 说明**：v2 打开唯一卡详情 → 「删除卡片」`disabled=true` + 说明「每个版本至少保留一张卡，不能删除最后一张卡。」。
- **停用经确认改指针**：`#making-deactivate-btn` → 确认文案记录 → 磁盘 `active=null`、「正在使用：未启用链路」。
- **不经确认不改指针（取消）**：confirm 改写为拒绝 → 点启用 → 磁盘 `active` 前后一致（无变化）。

覆盖：tasks 5.2/5.3/5.4 的真实机器证据；7.3 的「不经确认不改指针 / 保存不等于启用 / 全局一条」机械部分。

### 2.2 呈现层几何 fixture（`presentation-fixtures.mjs`）

证据：`evidence-presentation/evidence-presentation.json` + 截图；**24 项断言全部通过，0 失败，0 console error**。
**明确标注为呈现层 DOM 显隐 fixture**：CSS 与布局真实；`materials/stop` 与授权卡的真实显示态需真实生成/授权（本批无模型），
故仅对隐藏类做显隐，**不代表真实生成/授权端到端**。

- **3.4 动作组几何（materials-toggle + stop 显示时）**：真实 WebView 上显示四个动作按钮后，
  默认 330 / 最窄 300 / 最大化 760 三档下：动作组子项**两两零重叠**、**同排单行**（中心 y 偏差 ≤3px）、
  整组在头内、标题与动作组零重叠、`flex-wrap:nowrap` + `white-space:nowrap`；长标题截断。
- **4.2 授权卡呈现**：`[data-role="reading-request"]` **不是** `[data-role="body"]` 的后代（在滚动区之外）；
  在注入长正文使正文可滚动后，正文滚到**顶部**与**底部**时授权卡矩形**不变（±1px）**、可见；
  「允许」「本次不允许」按钮均可见，且 `elementFromPoint` 命中允许按钮（可见可点）。
- 未覆盖：4.4 的「切换讨论时卡可见/不串卡」（fixture 无法证明真实按讨论身份路由；路由由 4.3 与既有单测覆盖）与
  4.4 要求的单元测试（属 tests lane，避免代码冲突未动）。

### 2.3 回归：前批几何仍绿

同 session 复跑（体验最新 HMR 前端，含最后 `styles/ai-dock` notice 修复）：
`ai-panel-geometry.mjs` 退出 0（29 断言 0 失败，含删除撤销提示可见可点）；
`making-card-geometry.mjs` 退出 0（11 断言 0 失败，含真实存储长卡全文首/中/尾）。

## 3. 命令与真实结果

```text
node probe.mjs 9225                          # 侦察
node seed-chains.mjs                         # 隔离 fixture（2 卡）
node making-storage-and-versions.mjs 9225    # exit 0；17/17
node presentation-fixtures.mjs 9225          # exit 0；24/24
node ai-panel-geometry.mjs 9225              # exit 0；29/29（回归）
node making-card-geometry.mjs 9225           # exit 0；11/11（回归）
```

合计 81 断言，0 失败，0 console error。

## 4. 未证 / 阻塞（不勾选）

- **真实 LLM 场景整体受阻**（见 §1，钥匙串共享条目不可改）：
  - tasks 2.1/2.2 选区实时召唤到达真实链路并返回回应。
  - tasks 3.4 的 materials/stop **真实显示态**（本批仅 fixture 几何）。
  - tasks 4.2/4.4 授权卡**真实授权端到端**（本批仅呈现 fixture；4.4 单测与切换未做）。
  - tasks 6.1 制作对话**真实起草**（`parseCardDrafts`）→ 保存；本批仅证「真实 Rust 存储写入 → 查看版本 → 全页 DOM 全文」。
  - tasks 7.3/7.4「下一轮生效、在途轮不变」（本批仅证指针机械语义）。
- tasks 8.2/8.3 全量真机视觉与真实模型召唤；8.4 归档规格同步——不在本批。

## 5. 本批改动文件

- 新增脚本：`verification/ui-acceptance/{making-storage-and-versions,presentation-fixtures}.mjs`；更新
  `cdp-client.mjs`（`insertText/fillText/insertEnv`、JS 对话框采集）、`seed-chains.mjs`（2 卡 fixture）。
- 新增证据：`verification/ui-acceptance/evidence-making/evidence-making-storage-versions.json`（+ 截图）、
  `verification/ui-acceptance/evidence-presentation/`（JSON + 截图）。
- 新增本记录：`verification/ui-acceptance/batch2-runtime.md`。
- 更新 `openspec/changes/fix-ai-and-making-usability/tasks.md`（仅按证据勾选 3.4 / 4.2）。
- 未改动 `src/`、`src-tauri/`、`tests/` 产品与测试源码；未 commit/归档；未读取/打印密钥；未读写用户正文与私有配置。
