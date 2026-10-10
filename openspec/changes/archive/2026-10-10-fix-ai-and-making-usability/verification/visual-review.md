# 视觉比对复核（只读，静态截图）——fix-ai-and-making-usability

> 角色：validation owner（文档与只读核对）。日期：2026-10-10。
> 性质：由最终 observer 对已落盘**静态截图**所做的只读视觉比对（观察是否存在明显遮挡/重叠、关键控件是否可见）。
> **明确：这不是用户本人验收。** 8.2 的验收 owner 是用户／主助手，8.2 仍保留未勾（见 `completion-evidence.md`、`tasks.md`）。
> 边界：本文件只归纳既有事实与证据路径；未改产品代码、未改 `openspec/specs/` 真相源、未 archive、未重跑门禁、未发模型请求。

## 1. 被复核的截图与来源

| 图 | 证据路径（相对 `verification/`） | 来源记录 |
|---|------|----------|
| 补读授权卡长理由（670 / 540 滚到底） | `ui-acceptance/evidence-reading-auth/layout-after-670-reason-bottom.png`、`layout-after-540-reason-bottom.png` | `ui-acceptance/reading-card-layout.md` |
| 完整卡原文：确认展开 / 全页详情 | `ui-acceptance/evidence-making/making-draft-rt-02-confirm-expanded.png`、`making-draft-rt-04-full-detail.png` | `ui-acceptance/making-draft-roundtrip.md` |
| 卡删除：取消 / 基线失效 / 失败 | `ui-acceptance/evidence-making/card-delete-cancel.png`、`card-delete-baseline-changed.png`、`card-delete-baseline-missing.png`、`card-delete-failure.png` | `ui-acceptance/card-delete-cancel-failure.md` |
| 在途轮启用 v2 | `ui-acceptance/evidence-binding/binding-02-v2-enabled-inflight.png` | `ui-acceptance/chain-round-binding.md` |

## 2. 观察结论（只读）

- **无明显遮挡或元素重叠**：授权理由区与「允许/本次不允许」、保存确认/全页详情文本、卡删除状态条与卡片、在途状态条与「正在使用·第2版」在上述截图中均可见，未见互相压盖。
- **可见性可接受**：文本可读，决策按钮与状态可见，未见关键控件被裁到视口之外。
- **静态截图不代表行为**：截图为某一时刻的静态画面；它不能证明交互可点击/可键盘操作、滚动后固定、状态流转或后端语义——这些由各记录中的自动断言与真实链路证据分别承担。
- **视口覆盖有限**：真实 WebView 布局只覆盖 1024×670 与 1024×540；**540/670 以外的视口未覆盖**。

## 3. 边界与未覆盖（如实）

- 只复核了第 1 节列出的截图；未列出的其它截图不在本结论范围内。
- 本比对为 observer 的只读视觉判断，**非用户本人验收**，不改变 8.2 的未勾状态。
- 未做逐像素测量或跨图差异分析；`card-delete-baseline-changed.png` 与 `card-delete-baseline-missing.png` 逐字节相同（见 `ui-acceptance/card-delete-cancel-failure.md`），不以截图区分该两子例。
- 本结论不扩大 8.2 的验收范围，也不是新增验收判据。
