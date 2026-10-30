# 设计：理清提示规则所有权并修复三处界面回归

## Context

2026-10-10 `update-frontend-ui-v5` 落地共享提示系统（JS 单例 `#ui-tooltip`）与发送彩蛋（`.ai-send-mark::after` 伪元素背景）；同套代码把按钮原生 `title` 剥离转写为 `data-tooltip`，与 vendor Basecoat CSS 的伪元素提示共用同一属性名。2026-10-28 `fix-ui-friction` 为修双提示引入全局封锁 `[data-tooltip]::before/::after { display:none !important }`，产生三处回归（纹样 ×3 消失、禁用按钮提示三路皆断、双 ✕ 重复系 v5 迁移残留）。约束：不改 vendor 文件；不破坏既有几何合同与归档规格语义；彩蛋 PNG 原字节不可动。

## Goals / Non-Goals

**Goals**：双提示根除且无任何全局封锁规则；纹样对伪元素类全局规则免疫；禁用态功能可发现；收起入口唯一；级联级回归可被自动断言抓住。
**Non-Goals**：不动 `#ai-dock-rail` 死窄轨与 ai-dock.ts:653 span title 口径（另行处理）；不改 vendor Basecoat；不改收起/讨论保留/排队等既有业务语义；不做提示系统视觉改版。

## Decisions

### D1 属性分离替代全局封锁
共享提示全部读写改用 `data-hint`；`data-tooltip` 全线停写。Basecoat 伪元素提示因断粮永不出现，`ui-v5.css` 的全局封锁与旧局部封锁规则整段删除。
- 备选一（拒绝）：保留 `data-tooltip`＋给 `.ai-send-mark::after` 加 `display:block !important` 豁免——以 `!important` 治 `!important`，同一病灶换个位置埋。
- 备选二（拒绝）：改 vendor CSS 去掉其 `[data-tooltip]` 规则——侵入第三方文件，升级即失。
- 安全特性：若将来有写入点漏改仍写 `data-tooltip`，症状是「看得见的双提示」而非无声杀人，一次冒烟即暴露。

### D2 发送纹样改为按钮内真实 `<img>`
三个按钮（`follow-up-send`、`direct-question-send`、`making-conversation-send`）内嵌 `<img src="assets/user-mark.png" alt="" aria-hidden="true">`；CSS 定宽 28px、`aspect-ratio: 988/789`、`filter: invert(1)`、禁用态降不透明度。可访问名称继续由 `aria-label` 承担，`font-size:0` 随伪元素方案一并移除。PNG 原字节与 SHA 不动，几何合同数值不变。
- 备选（拒绝）：保留 `::after` 实现——D1 删封锁后它能复活，但仍住在伪元素里，未来任何同类全局规则可再杀一次；真实元素物理免疫。

### D3 不可用工具：亮着＋点击给原因提示（2026-10-30 用户拍板 C，修订原「复刻灰色」方案）
工具栏按钮的不可用态 SHALL 以 `aria-disabled="true"` 表达，外观与启用态完全一致（图标亮起、正常悬停反应），MUST NOT 变灰/半透明；点击/键盘触发不可用工具在处理器入口守卫拒绝动作并显示简短原因提示（选区依赖：「先选中文字再用」；撤销/重做历史空：「没有可撤销的内容」/「没有可重做的内容」），提示经共享提示层短暂呈现，MUST NOT 静默无响应。事件照常流动→悬停/聚焦功能名提示可见、Tab 可达。撤销/重做（历史空）并入同一模式（首版验收发现：原生 disabled 使这两枚悬停无提示，即用户所见「有的有、有的没有」）。
- 备选一（拒绝）：外包裹 span 接事件——DOM 噪音、几何合同受扰。
- 备选二（拒绝）：`pointer-events:none`——连 hover 一起掐死，与目标相反。
- 备选三（拒绝，2026-10-30 验收否决）：复刻原 `:disabled` 灰色视觉——违背用户原话「本身是亮着的，只是没有适用对象」；灰色被视为整条工具栏「像坏了」。

### D4 收起入口唯一化
删除讨论窗口模板中 `data-role="close"` 按钮及其 DOM 装配（`dom.ts closeBtn`、`ai-window.ts` 接线）；reducer `close` 动作与停靠区头 ✕、顶栏入口不变。用户拍板（2026-10-30）：留停靠区头 ✕。

### D5 级联回归断言
- 单元/静态层：`ui-send-mark.test.ts` 改为断言三按钮各含 `img[src$=user-mark.png]` 且 CSS 定宽/比例声明存在；`ai-panel-geometry-contract.test.ts` 把「封锁规则存在」断言改为「`data-tooltip` 零写入、封锁规则零存在、`data-hint` 由共享提示接管」。
- 真机层：既有 CDP 冒烟清单接入四条计算样式/行为断言（实施首任务定位冒烟脚本入口）：①三发送按钮 img 实际渲染且宽 28px；②任一提示按钮悬停仅一个提示层；③无选区时悬停禁用工具显示功能名提示；④窗口头无收起按钮、停靠区 ✕ 收起面板后讨论仍在列表。
- 原则：断言「浏览器算出来的结果」，不断言「CSS 文本里写了什么」。

## Risks / Trade-offs

- [属性漏改，某写入点仍写 `data-tooltip`] → 症状为可见双提示而非静默；以全仓 grep 清单核对＋断言④兜底。
- [`aria-disabled` 守卫遗漏，无选区误触发动作] → 处理器入口统一守卫；补无选区点击不动作的测试。
- [禁用按钮进入 Tab 序改变键盘节奏] → 有意换取可发现性；Enter/Space 由守卫拒绝，不会误操作。
- [img 加载失败显示破图标] → 与背景图失败同为静默风险；断言①在真机核对实际渲染。
- [几何合同测试大改] → 动作组少一枚按钮，合同语义（不拆散、1px 稳定）不变，改断言不改合同。

## Migration Plan

单一 change 内完成，无数据迁移、无存储格式变化；回滚＝git revert 单提交序列。实施顺序：D1 属性改写与规则删除 → D2 纹样 → D3 aria-disabled → D4 ✕ 去重 → D5 断言与测试翻新 → `npm run check` → 真机冒烟 → 归档。

## Open Questions

无——收起按钮去留与结构修方向均经用户拍板（2026-10-30）；`data-hint` 命名为实现细节，可在实施中保持一致性即可。
