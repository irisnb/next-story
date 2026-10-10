# 完整卡原文保存全文往返（task 6.1）

> change: `fix-ai-and-making-usability`。角色：validation owner（真实存储与 DOM 逐字证据）。
> 日期：2026-10-10。范围：验收脚本 + evidence 记录。**未改产品代码、未改配置、未提交/归档、未勾其他 tasks**。
> **未发任何新模型请求**；未重建模型草稿。目标：沿用刚生成的真实草稿（399 字），只完成 task 6.1
> 「保存全文往返」——真实 UI 点保存 → 展开完整原文核对 → 用户式确认保存 → 存储/查看版本/全页 DOM 逐字对照。

## 0. 隔离与凭据边界（未触碰密钥）

- 实例：真实 Tauri dev，隔离 identifier `com.nextstory.acceptance`，CDP `127.0.0.1:9225`
  （浏览器标题 `Next Story`，url `http://localhost:1420/`，target id `241FEF4D17F06C48A01AA5B58E65EEF8`）。
- 全程**只读复用**既有隔离制作页与既有草稿；未调用 `save_llm_config`、未点「保存设置」、未读写密钥、
  未触碰 keyring；未读写正式用户项目正文；未改 `src/`、`src-tauri/`、`tests/`、配置。
- 唯一写入发生在**隔离 fixture** 的链路库：真实 Rust 命令 `chain_save_version` 追加第 2 版
  （`C:/Users/Administrator/AppData/Local/com.nextstory.acceptance/making-module/chains.json`）。
- 未 commit/归档；未改 `openspec/specs/`。

## 1. 原始草稿来源（逐字）

来自既有 `evidence-making/making-draft-request.json` 的 `draftFull[0]`（该文件由前一步「单次真实制作请求」
产出，是**真实模型**一次输出经前端标记块协议解析后的草稿，未重跑、未重建）：

| 字段 | 值 |
|---|---|
| 类型 | `回应要求`（`slot_type=requirement`） |
| 卡名 | `回应要求卡`（7 字） |
| 何时用 | 59 字 |
| 何时不用 | 41 字 |
| 正文 | **399 字**（首/中/尾结构：`分四步走`→第一步…第四步→`底线：…`） |

正文首/中/尾取样（用于 DOM 对照，非仅长度或 startswith）：

- 首 20 字：`这张卡管你每次开口之后我怎么接话，分四步`
- 中 20 字：`用你的词句去追问，不问「你的主题是什么」`
- 尾 20 字：`不往你的文档里写任何内容，稿子一字不动。`

## 2. 保存前基线（真实 UI 只读确认）

- 制作页可见；左链路库唯一链路 `chain-cdp-long-acceptance`（`CDP长卡验收链`，显示 `未启用`）。
- 保存前磁盘：1 个版本（第 1 版，2 张卡：`长卡首中尾验收卡`＋`可删除的第二张卡`），`active=null`。
- 制作对话转写第 3 轮（`data-draft-turn-index="3"`）草稿面板：
  - 徽标 `回应要求`，`卡名：回应要求卡`；
  - `.making-draft-body` 文本 = 原始草稿正文**逐字**（399 字，`draftBody === BODY`）；
  - `保存这版草稿` 按钮存在且 **enabled**（`开始试问` enabled）。
- 快照：`making-draft-rt-00-pre-save.png`。

## 3. 用户式动作与逐字结果

### 3.1 真实 UI 点「保存这版草稿」→ 确认对话框

- 经 CDP 真实鼠标事件点击（`Input.dispatchMouseEvent`，非 JS `.click()`）。
- 出现原生 `<dialog class="making-save-confirm" open>`；标题 `确认保存卡草稿`；操作按钮 `取消` / `确认保存`。
- 摘要预览（`.making-save-summary`，280 字）：正文按 60 字**截断并明示** `正文摘要（已截断；可展开完整原文核对）`，
  末尾含「保存后会作为新版本进入链路库，不会自动启用；启用需要在结构检视里显式操作。」——摘要存在且明确标注截断。
- 快照：`making-draft-rt-01-confirm-summary.png`。

### 3.2 展开「展开完整原文核对」→ trigger/body 完整且逐字

- 真实鼠标点击 `<details><summary>展开完整原文核对</summary>`；展开后 1 个 `<pre>`（`detailsOpen=true`）。
- `pre.textContent` 长度 **523**，逐字等于源码口径：

  ```text
  卡名：回应要求卡
  何时用：<whenToUse 59字>
  何时不用：<whenNotToUse 41字>
  正文：
  <body 399字>
  ```

- 断言 `expanded.preFullEqualsExpected`：`preText === `卡名：${title}\n何时用：${whenToUse}\n何时不用：${whenNotToUse}\n正文：\n${body}`` **完全相等**；
  且 `结束于 body`、`包含首/中/尾取样`、`包含完整 whenToUse / whenNotToUse`。
- 快照：`making-draft-rt-02-confirm-expanded.png`。

### 3.3 用户式确认保存

- 真实鼠标点击 `确认保存`。对话框关闭；提示位显示：

  > 已保存为「CDP长卡验收链·第2版」草稿；尚未启用，启用请在结构检视里显式操作。

- 快照：`making-draft-rt-03-post-save.png`。

### 3.4 自动查看新版本、active 不自动改

- 版本下拉：`第2版（最新）`、`第1版`（**最新在前**）；选中项 = 第 2 版（`viewedIndex=0` 指向 `第2版（最新）`）。
  → 保存后**查看对象自动跟进新版本**。
- `正在使用：未启用链路，使用日常陪想`（未启用）；磁盘 `active` 仍为 `null`。
  → **保存 ≠ 启用，active 不自动改**。
- 第 1 版仍保留 2 张卡（历史保持）。

## 4. 隔离存储往返（真实 Rust 落盘逐字）

读回 `chains.json` 第 2 版（`chainver-1791640932954121800-1`，index 2）单卡：

| 存储字段 | 结果 |
|---|---|
| `title` | `回应要求卡`（逐字） |
| `trigger_desc` | `适用：<whenToUse 59字>\n不适用：<whenNotToUse 41字>`（逐字＝`EXPECT_TRIGGER`，108 字） |
| `body` | **逐字等于原始草稿正文（399 字）** |
| `slot_type` | `requirement` |

- 触发描述与正文**原样保存**（来自源码 `draftToCardInput`：正文原样、触发＝适用/不适用两行包装；
  Rust `save_version_in_dir` 原样落盘、卡 id 后端生成）。第 1 版未被修改（2 张卡）。

## 5. 全页完整详情 DOM（新版本卡，首/中/尾 + 整体）

切到「导图」标签（`#making-view-map-btn`），点新版本卡打开「打开完整详情」，全页详情 `#making-card-panel`：

- 五项标题：`身份` / `何时用` / `怎么做` / `本版变化` / `试问记录`。
- `何时用`（`whenToUse`）逐字等于存储 `trigger_desc`（108 字，含 `适用：`/`不适用：`）。
- `怎么做`（`howTo`）**逐字等于原始草稿正文**（`howTo === BODY`，399 字）；
  且首 20 / 中 20 / 尾 20 取样均命中（**非仅长度、非仅 startswith**）。
- 全页详情整体 `innerText` 同时包含完整 `body` 与完整 `trigger_desc`。
- 快照：`making-draft-rt-04-full-detail.png`。

## 6. 真实长内容首/中/尾对照（只读，v1 长卡）

为满足 task 6.1「含真实长内容首/中/尾对照」，只读切到第 1 版、打开既有长卡 `长卡首中尾验收卡`：

- `怎么做` 逐字等于其 709 字正文（`howTo === body`）；
- `何时用` 逐字等于其 156 字触发描述；
- 正文首/中/尾标记 `【正文开头】` / `【正文中段】` / `【正文结尾】` **三者均出现**。
- 快照：`making-draft-rt-05-long-card-detail.png`。

## 7. 格式包装差异（说明，非缺陷）

原始草稿与各呈现层之间的**包装**差异如下（内容本身逐字不变）：

| 层 | 包装 |
|---|---|
| 草稿面板 `.making-draft-body` | **裸正文**（无包装） |
| 确认对话框 `<pre>` | `卡名：…\n何时用：…\n何时不用：…\n正文：\n` + 裸正文 |
| 存储 `trigger_desc` | `适用：<whenToUse>\n不适用：<whenNotToUse>`（正文仍裸存） |
| 全页详情 `何时用` | ＝存储 `trigger_desc`（带 `适用：`/`不适用：` 前缀） |
| 全页详情 `怎么做` | ＝裸正文（逐字） |

两处 `whenToUse`（草稿面板/确认）是裸触发描述；「何时不用」在存储时并入 `trigger_desc` 的 `不适用：` 行；
这是既有的卡模型约定，不是截断或篡改。任一层的**正文**均与原始草稿逐字一致。

## 8. 结论与断言汇总

- 断言总数 **48 / 48 通过**（含保存前基线、确认摘要截断、确认展开全文逐字、保存回执、查看跟进、
  active 不变、存储逐字、全页 DOM 逐字首中尾、长卡首中尾）。
- `making-draft-roundtrip.json`：合并记录（阶段 1 保存 + 阶段 2 保存后复核）。
- 判定：**task 6.1 保存全文往返确证成立**——草稿（parseCardDrafts/草稿面板）→ 存储（`save_version_in_dir`）
  → 查看版本（`buildCardPanelView`）→ 全页 DOM，各段原文完整、`howTo`/`whenToUse` 全文原样、无省略。

### 8.1 两处过程纠正（如实记录）

1. **版本顺序断言**：阶段 1 原断言假设版本下拉升序（新版本在 selectedIndex=1），实际下拉为「最新在前」
   （第 0 项＝第 2 版最新）。行为本身正确（保存后查看对象=第 2 版）；断言口径已修正并由阶段 2 独立复验通过。
2. **阶段 1 一处失败（`.making-quick-open` 不可见）**：阶段 1 保存后仍停留在「制作对话」标签，`#making-inspector`
   为 `display:none`，卡片详情挂载位尺寸为 0，鼠标点击失败。阶段 2 先切「导图」标签再打开全页详情，全部通过；
   不影响已落盘的第 2 版。

## 9. 命令

```text
node openspec/changes/fix-ai-and-making-usability/verification/ui-acceptance/making-draft-roundtrip.mjs 9225      # 阶段1：保存前基线 + 真实点保存 + 确认展开核对 + 确认保存
node openspec/changes/fix-ai-and-making-usability/verification/ui-acceptance/making-draft-roundtrip-post.mjs 9225  # 阶段2：保存后只读复核（查看/存储/全页DOM/长卡）
```

> 注：阶段 1 与阶段 2 拆分为两个脚本，是因为阶段 1 首次运行时保存已成功落盘；为避免重复追加同名版本，
> 保存后复核不重跑保存。可复现的首跑顺序为先 1 后 2。

## 10. 本批改动文件

- 新增脚本：`verification/ui-acceptance/making-draft-roundtrip.mjs`、`making-draft-roundtrip-post.mjs`。
- 新增证据：`verification/ui-acceptance/evidence-making/making-draft-roundtrip.json`（合并，48/48）、
  `making-draft-roundtrip-post.json`（阶段 2）、
  `making-draft-rt-00-pre-save.png`、`making-draft-rt-01-confirm-summary.png`、
  `making-draft-rt-02-confirm-expanded.png`、`making-draft-rt-03-post-save.png`、
  `making-draft-rt-04-full-detail.png`、`making-draft-rt-05-long-card-detail.png`。
- 新增本记录：`verification/ui-acceptance/making-draft-roundtrip.md`。
- 未改 `src/`、`src-tauri/`、`tests/`、`openspec/specs/`；未 commit/归档；未触碰正式用户正文/配置/keyring；未发模型请求。
