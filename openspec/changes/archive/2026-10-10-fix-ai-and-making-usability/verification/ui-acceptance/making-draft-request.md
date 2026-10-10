# 单次真实制作请求——确认是否出现可保存草稿

> change: `fix-ai-and-making-usability`。角色：validation owner（单次真实请求与结果证据）。
> 日期：2026-10-10。范围：验收脚本 / evidence 记录。**未改产品代码、未改配置、未提交/归档、未勾 tasks**。
> 目标：通过真实 UI 发**一次**制作请求（一张回应要求卡），分段观察最多 90s，确认是否出现可保存草稿，
> 并给出草稿 save / 全文展开的实际 selectors 供下一小步。

## 0. 隔离与凭据边界（未触碰密钥）

- 实例：真实 Tauri dev，隔离 identifier `com.nextstory.acceptance`，CDP `127.0.0.1:9225`（保留浏览器标题
  `Next Story`，url `http://localhost:1420/`，target id `241FEF4D17F06C48A01AA5B58E65EEF8`）。
- 配置：**只读复用**（隔离实例经应用既有 `llm_config::load_llm_config` 走 keyring 只读 get）。本次**未**
  调用 `save_llm_config`、未点「保存设置」、**未读取/显示/复制密钥**，未改正式或隔离配置、未触碰 keyring。
- 未读写任何**正式用户项目正文**；未改 `src/`、`src-tauri/`、`tests/`；未做保存/版本切换/全量验收。

## 1. 请求前的只读状态确认

- 制作页可见（`#making-page` 未 hidden）；内容区标签当前为「导图」。
- 链路库 1 条：`chain-cdp-long-acceptance`（显示「未启用」），无选中、无版本操作。
- 会话区空态：`#making-conversation-empty` 可见，`#making-conversation-input/#making-conversation-send` disabled。
- 切到「制作对话」标签（`#making-view-chat-btn`）后：`#making-conversation-pane` display=flex，
  `#making-conversation-start-btn` 可见可用（rect 175,354,83×32），符合预期。

## 2. 用户式动作序列（真实 UI，非命令直调）

| 步 | 选择器 | 动作 |
|---|---|---|
| 1 | `#making-view-chat-btn` | 切到「制作对话」标签 |
| 2 | `#making-chain-list .making-chain-row` | 查看既有链路（只查看，不改制作对象/全局启用） |
| 3 | `#making-conversation-start-btn` | 点「开始新制作」→ 会话建立（自动发「链路现状」附言） |
| 4 | `#making-conversation-input` | 输入**一次**卡片请求（CDP `Input.insertText`，用户式） |
| 5 | `#making-conversation-send` | 发送（本次**唯一**一次用户发送） |

> 说明：「开始新制作」按设计自动发首条「链路现状」附言（`buildChainStatusMessage`），这是会话建立动作，
> 非用户请求；用户请求只发送一次。附言在 +7.7s 到终态（输入恢复可用），随后才输入并发送请求。

### 请求文本（`making-draft-once.mjs` 常量，逐字）

```text
请帮我起草一张「回应要求卡」，用在日常陪想里。
这张卡要求：我每次说完一句，你先分清我是在问事实、问感受，还是只想把思路摊开；如果我只给了片段，你先把片段里能确定的事实和不确定的猜测分开摆出来，再问我缺哪一块。
回答时你只给有依据的观察、问题和可能走向，不替我判断这个故事好不好，也不要替我把内容写进文档。
【首】先把我的原话里能确定的事实与拿不准的猜测分开摆出来，标出你依据的是哪几个词。
【中】再围绕我给的这段材料递两三个具体问题，问题要贴着我用过的词句，不要泛泛而谈；如果看到几种可能的方向，就并列写清各自依据，不要只挑一个替我决定。
【尾】最后收一句我接下来可以自己动手做的小事，把结论留给我。
整段用大白话，不用术语。
触发描述写成两行各约四十字：什么时候用这张卡，什么时候不要用。
先一句话告诉我你对这张卡的理解，再给出标记块草稿。
```

## 3. 真实结果（无 mock）

- 发送后 **~8.3s** 出现草稿面板（`drafts=1`，`inputDisabled=false`），观察在 **8.3s** 内达终态。
  时间线（相对发送）：+0.2s 追加 2 轮（user 请求 + assistant pending）；+8.3s 草稿面板出现、助手轮完成；
  采样脚本在 +8.3s 命中终态并停止。
- **结论（目标达成）**：出现**可保存草稿**——`保存这版草稿` 按钮存在且 **enabled**（`开始试问` 亦 enabled，
  因会话已绑定链路）。无 console error、无失败提示、未超 90s、未强制停止会话。

### 草稿内容（只读提取，未保存）

| 字段 | 值 |
|---|---|
| 类型徽标 | 回应要求（`slot_type=requirement`） |
| 卡名 | 回应要求卡 |
| 何时用 | 59 字 |
| 何时不用 | 41 字 |
| 触发描述合计 | **100 字**（请求要求「两行各约四十字」，实际略高于约数） |
| 正文长度 | **399 字**（请求要求约 300–500 中文字符 → 落在区间内） |

- 正文结构：`分四步走` + `第一步 … 第二步 … 第三步 … 第四步 …` + `底线：…`，可辨识首/中/尾。
- **如实记录的一处偏差**：请求里嵌入的**字面标记** `【首】【中】【尾】` **未逐字保留**——制作助手把标记
  改写成了「第一步／第三步／第四步／底线」的序数散文（`body.includes('【首】')` 等均为 false）。
  正文仍具备可辨识的首/中/尾结构与底线收束，且长度在区间内；这是真实模型行为，**未重试**（遵守「只发一次」）。
- 边界符合：卡正文含「不替你判断故事好不好、对不对，也不往你的文档里写任何内容，稿子一字不动」，
  与陪想边界（只给有依据的观察/问题/可能、不裁决、不写文档）一致。

### 助手完整回复（含标记块，证明草稿被前端标记块协议解析）

```text
我的理解：这张卡管的是你说话之后我「怎么接」，核心是先分清你那句话的性质，把事实和猜测拆开，再用贴词的具体问题回应，结尾留一个小动作，判断权和写文档的权力都留在你手里。

【卡草稿开始】
类型：要求卡
卡名：回应要求卡
何时用：日常陪想里，每次用户说完一句话要回应时使用：先分清这句是问事实、问感受，还是只想把思路摊开，再按首中尾的固定顺序接话。
何时不用：用户明确要求换一种回应方式、或只是闲聊无关剧本内容时不套用这套流程，照常对话即可。
正文：这张卡管你每次开口之后我怎么接话，分四步走。

第一步，分清你这句话的性质：你是在问一个事实、问我的感受，还是只想把思路摊开给我看。你只给了片段、没说全的时候，我不硬猜，先把你原话里能确定的事实和拿不准的猜测分开摆出来，并标明我依据的是你用过的哪几个词，让你一眼看到哪些是你说的、哪些是我猜的。

第二步，围绕你给的这段材料，递两三个具体问题。问题必须贴着你的原话问，比如直接引用你的词句去追问，不问「你的主题是什么」这种泛泛的空话。

第三步，如果我看出几种可能的方向，就并列写清楚每种方向的依据各是什么，摆在一起给你看，不只挑一个替你决定，也不暗示哪个更对。

第四步，收尾时给一句你接下来可以自己动手做的小事，比如「回去看看某段里某个词出现了几次」，把结论留给你自己下。

底线：我只给有依据的观察、问题和可能走向，不替你判断这个故事好不好、对不对，也不往你的文档里写任何内容，稿子一字不动。
【卡草稿结束】
```

## 4. 供下一小步的实际 selectors

### 草稿save（已实测存在于 DOM，且 enabled）

- 草稿面板：`.making-draft-panel`
- 本次面板（按轮次索引）：`.making-draft-panel[data-draft-turn-index="3"]`
- 卡片容器：`.making-draft-panel .making-draft-card`
- 正文节点（**已是全文**，`<pre>`，无截断）：`.making-draft-panel .making-draft-card .making-draft-body`
- 保存按钮：`.making-draft-panel .making-draft-actions .making-mini-btn.primary`（文本「保存这版草稿」，disabled=false）
- 试问按钮：`.making-draft-panel .making-draft-actions .making-mini-btn:not(.primary)`（文本「开始试问」，disabled=false）

### 全文展开（保存确认对话框内；**未触发**，来自源码 `confirmDraftSave`，供下一步）

点击 `保存这版草稿` 后才出现原生 `<dialog class="making-save-confirm">`：

- 对话框：`.making-save-confirm`（`dialog`，`showModal()`）
- 摘要预览（正文在此处按 60 字截断）：`.making-save-confirm .making-save-summary`
- **全文展开**：`.making-save-confirm details > summary`（文本「展开完整原文核对」）→ 展开后每卡一个
  `.making-save-confirm details > pre`（文本含 `卡名：/何时用：/何时不用：/正文：`）
- 操作按钮：`.making-save-confirm footer button.making-action-btn`（依次「取消」「确认保存」）

> 注：草稿面板自身的 `.making-draft-body` 已是完整正文（本次 399 字），截断仅发生在「保存确认」摘要预览；
> 「全文展开」指确认对话框里的 `<details>`。

## 5. 方法限制（如实）

- 本次观察窗口 90s 未用满：草稿在 ~8.3s 到终态即停采样；不认「不存在的 response 元素」——制作页完成态
  以「输入恢复可用 + 助手轮非 pending + 草稿面板出现」判定，未依赖日常面板的 `[data-role="response"]`。
- 只发**一次**用户请求，未重跑、未重试；字面标记未保留的结果如实记录，不因不理想而重试。
- 未点保存/试问，未开「全文展开」对话框（避免触发链路写入），其 selectors 为源码推导。
- 结束后隔离实例仍在运行；未清理进程（保留供下一小步）。清理时仅向下杀该实例树。

## 6. 命令

```text
node making-draft-once.mjs 9225   # 单次真实制作请求（切标签→查看链路→开始新制作→附加言→输入→发送→观察≤90s）
node making-draft-shot.mjs 9225   # 只读：滚动草稿卡片到可见并截图
```

## 7. 本批改动文件

- 新增脚本：`verification/ui-acceptance/making-draft-once.mjs`、`making-draft-shot.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-making/making-draft-request.json`、
  `making-draft-00-chat-view.png`、`making-draft-01-session-start.png`、`making-draft-02-request-typed.png`、
  `making-draft-03-request-result.png`、`making-draft-04-card-visible.png`。
- 新增本记录：`verification/ui-acceptance/making-draft-request.md`。
- 未改 `src/`、`src-tauri/`、`tests/`、`openspec/specs/`、tasks.md；未 commit/归档；未触碰正式用户正文/配置/keyring。
