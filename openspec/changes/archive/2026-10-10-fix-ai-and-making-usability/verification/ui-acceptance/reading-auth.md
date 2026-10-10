# tasks 4.4 真实补读授权端到端（bounded）—— batch3-real-ai

> change: `fix-ai-and-making-usability`。角色：运行时唯一 owner（真实 Tauri CDP 9225）。日期：2026-10-10。
> 范围：验收 scripts / evidence / tasks。**未改产品代码**、未 commit/归档、未读写正式用户数据、配置或钥匙串。
> 目标：在隔离项目（关注 Doc A）常规提问，明确请补读另一篇 Doc B，触发**真实 `story-request-reading`**
> pending；观察等待授权状态、长正文滚顶/滚底卡固定可见、切换讨论不串卡、回到所属讨论允许并恢复。
> 不 mock 模型、不以 DOM 注入冒充真实链路。

## 0. 隔离与凭据（沿已授权、不再触碰）

- 隔离 identifier `com.nextstory.acceptance`，CDP 9225，配置仅 `api_base_url`/`model`（无 api_key），
  密钥经共享 keyring **只读 get** 复用（本批**未**改配置/钥匙串/调用 save）。
- fixture 两文档（`setup-docs.mjs`，用户式 UI 操作，未 AI 写作品）：
  - **Doc A（关注）= `未命名文档`**：正文「雾岭车站的第七封信：主角把信收进外套，决定明天再拆开。」
  - **Doc B（另一篇）= `钟表铺`**：正文「南旧巷的钟表铺里停着一只蓝色乌鸦，钟摆停在凌晨三点七分。」
    （唯一标记：钟表铺 / 蓝色乌鸦 / 凌晨三点七分）

## 1. 真实请求工具与 pending

- 提问（关注 Doc A）：**「请补读另一篇文档《钟表铺》的完整正文，把里面出现的地点、物件和细节逐条整理给我，并说明你读了哪些文档。」**
- **是否真实请求工具：是。** 模型先经字面检索只拿到片段，随后发出真实补读授权请求：
  - 授权卡 reason（模型原文）：**「您要求我读取《钟表铺》的完整正文并逐条整理地点、物件和细节，但目前我只有检索到的一小段片段（蓝色乌鸦、钟摆停在凌晨三点七分），无法完成完整整理。需要授权我读取该文档全文。」**
- **pending 状态（授权等待）——非「正在思考」**：
  - 窗口头 badge = **`等待授权`**（`ai-window-badge is-waiting`）；状态点 = **`ai-window-status-dot is-waiting`**；
  - `loading` 元素 `loading=false`，其文案为 `等待授权`（**不是**「正在思考…」）；
  - 授权卡 `[data-role="reading-request"]` 可见，`允许`/`本次不允许` 按钮存在。
- 请求预算：**1 次真实请求**（第二个脚本复用同一 pending，未再发请求），符合「最多两次」。

## 2. 长正文滚顶/滚底：卡固定可见（真实 pending 卡）

- `[data-role="reading-request"]` **不在** `[data-role="body"]` 之内（`cardInsideBody=false`）→ 置于正文滚动区之外。
- 注入长正文制造滚动后（正文 fixture 标注）：正文 `scrollTop` 0 → 2506（可滚动）；
  授权卡矩形在滚顶/滚底**完全不变**（x=716,y=263,287×195）且可见 → **固定可见**成立。

## 3. 切换讨论不串卡 + 回到所属讨论

- 打开讨论列表（3 条）→ 点另一条（召唤讨论「信里写着 C:\旧站\第七封…」）：该窗口 `pending=false` → **不串卡**。
- 再切回所属讨论（标题「请补读另一篇文档《钟表铺》…」）：`pending=true`、badge `等待授权`、dot `is-waiting`
  → **状态与卡随讨论身份正确归属**。

## 4. 允许 → 真实恢复链路（选择允许）

- 点「允许」→ 约 **19.8s** 后本轮完成（dot `is-done`，pending 消失，无 error）。
- 回复（同一所属讨论）**真实读取了 Doc B**，并自报读到的文档身份：
  - 「我读取的文档：本次实际完整读取了《钟表铺》（ID：`node-1791637882019718500-1`，版本 `4090ca0df9bbb643`，全文共计 123 字节）」
  - 逐条整理了 南旧巷 / 钟表铺 / 蓝色乌鸦 / 钟摆 / 凌晨三点七分，并说明《未命名文档》片段仅参考未另读。
- 结论：**授权端到端真实通过**（pending → 允许 → 真实 `story-read` → 回复引用被授权文档，归属正确）。

## 5. 证据与命令

```text
node setup-docs.mjs 9225          # 隔离两文档 fixture
node reading-auth.mjs 9225        # 发起 1 次真实请求（发现 pending）
node check-pending.mjs 9225       # 只读确认 pending 状态
node reading-auth-pending.mjs 9225# pending 观察 + 切换 + 允许 + 恢复
```

证据：`verification/ui-acceptance/evidence-reading-auth/`
- `reading-auth.json`、`reading-auth-pending.json`
- 截图：`pending-card.png`、`pending-scroll-bottom.png`、`switch-away.png`、`switch-back.png`、`after-allow.png`、`after-allow-reply.png`

## 6. 发现（产品问题 / 需主助手判定，未私改）

**后续修复说明（2026-10-10）：下述问题已确认为缺陷并局部修复。** 旧真实链路记录证明授权恢复与讨论归属，但其程序化点击不能证明按钮始终可见可操作。新增失败回归及修复后证据见 `reading-card-layout.md`；未覆盖或改写旧截图。后续真实 WebView 长 reason 测试明确为呈现 fixture，不冒充新的真实 pending 请求。

**授权卡在 reason/边界说明较长时，卡内「允许/本次不允许」按钮被卡自身滚动区裁到视口外。**
- 复现：产生 pending（reason 较长）→ 卡 `[data-role="reading-request"]` 使用 `.ai-reading-request { max-height:42%; overflow-y:auto }`
  （`src/ui-v5.css:108`），实测卡高 195px < 内容高度 → 卡内出现滚动条，`允许`/`本次不允许` 落在卡可见区之下。
- 证据：`pending-card.png` / `pending-scroll-bottom.png` 卡底部只露出部分文案，按钮不可见；
  卡矩形中心点 `document.elementFromPoint(允许按钮中心)` **不命中按钮**（`allowHit=false`）。
- 影响：reason 较长时用户需在卡内再滚动才能点「允许/拒绝」——与 4.2「可见可操作」的直观预期有落差。
  程序化 `.click()` 仍可用，故本批恢复链路不受阻；但真人使用需额外滚动。是否为缺陷由主助手/designer 判定。
- 说明：本卡为**真实模型 reason**，非 fixture 注入；正文长填充仅用于验证「消息正文滚动时卡固定」，不影响卡的内部裁切结论。

## 7. 附带（materials/stop 显示几何，仅本页顺带，未扩展制作/版本）

- pending 时窗口头动作组（真实、非 fixture）：`badge 等待授权` + `停止` + `更多` + `×` 同排、无换行（见 `pending-card.png`）；
  `停止` 在等待授权期间仍可见（与「停止入口保留」一致）。未做严格的逐矩形几何断言（本批目标为授权，未扩展）。

## 8. 局限（如实）

- 请求 → pending 的精确耗时未仪器化：首个脚本因 `settled` 判定缺陷提前退出（已改为读真实 `conversation` +
  状态点，并在后续脚本修正）；pending 在后续探针时已就绪。**允许 → 恢复约 19.8s** 为精确值。
- 仅测「允许」路径；「本次不允许」未单独跑（任务要求「允许/拒绝至少一条」）。
- 未测授权卡的**拒绝**、跨重启授权保留、讨论关闭授权开关（超出本 bounded 目标）。
- 本批**未新增单测**（属 tests lane）；4.4 行为面由本真实机器证据确认。

## 9. 本批改动文件

- 新增脚本：`verification/ui-acceptance/{setup-docs,reading-auth,check-pending,reading-auth-pending}.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-reading-auth/`。
- 新增本记录：`verification/ui-acceptance/reading-auth.md`。
- 更新 `openspec/changes/fix-ai-and-making-usability/tasks.md`：勾选 4.4（依据：真实机器端到端 + 既有
  `agent-on-demand-reading.test.ts` 已覆盖 等待状态/切换归属 呈现用例；「补单测」条目不属本 lane）。
- 未改 `src/`、`src-tauri/`、`tests/`；未 commit/归档；未读写正式用户数据/配置/钥匙串。
