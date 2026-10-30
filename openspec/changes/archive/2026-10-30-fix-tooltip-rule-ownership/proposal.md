# 提案：理清提示规则所有权并修复三处界面回归

## Why

2026-10-28 归档的 `fix-ui-friction` 用全局规则 `[data-tooltip]::before/::after { display:none !important }` 镇压 Basecoat 伪元素双提示，误伤了同样住在伪元素里的合法视觉：三个 `.ai-send-mark` 发送按钮（AI 追问、直接提问、制作对话）的鸢尾花纹样全部消失；禁用态工具按钮因「原生 disabled 掐断事件＋原生 title 已被剥离＋伪元素提示被封」三路皆断而悬停无任何提示。叠加 v5 单面板迁移残留的双「收起 AI 面板」✕，共三类用户可见回归。根因是两套提示系统（我方 JS 共享提示与 Basecoat CSS 伪元素提示）共用同一属性名 `data-tooltip`，靠全局镇压维持秩序。用户已拍板（2026-10-30）：结构修——理清所有权，而非再叠补丁。

## What Changes

- **提示属性所有权分离**：共享提示改用自家属性（`data-hint`），全部写入点不再写 `data-tooltip`；Basecoat 伪元素提示自然断粮（双提示根除），`ui-v5.css` 的全局封锁规则与旧局部封锁规则**整个删除**，消灭 `!important` 战争。
- **发送纹样改真实元素**：三个发送按钮的纹样从 `::after` 伪元素背景改为按钮内真实 `<img>`（同一 `user-mark.png` 原字节、同几何：黑底 72×32、图案宽 28px 高自动），对任何 CSS 全局伪元素规则免疫。
- **禁用态提示恢复**：需要选区才可用的工具条触发按钮从原生 `disabled` 改为 `aria-disabled="true"`＋点击守卫——事件照常流动，禁用态悬停/聚焦仍显示共享提示与功能名称，外观保持不可点视觉，键盘可达性不降。
- **收起入口唯一化**：删除讨论窗口头部的 ✕（`data-role="close"`），收起 AI 面板唯一入口＝停靠区头部 ✕（用户拍板 2026-10-30：留上面那个）；顶栏既有入口不变。
- **级联回归断言**：真机冒烟新增「验成片不验台本」断言——纹样实际可见（img 呈现且几何正确）、悬停提示单一、禁用按钮悬停有提示、收起入口唯一且有效；防止同类级联误杀再次无声通过全部门禁。

范围外（明确不做，防扩散）：死窄轨 `#ai-dock-rail` 拆除、ai-dock.ts:653 span 原生 title 口径统一——另行处理，不混入本 change。

## Capabilities

### New Capabilities

（无——全部落入既有规格）

### Modified Capabilities

- `frontend-ui-v5`：①「提示和面板头部稳定」修订——提示所有权改为属性分离（我方 `data-hint`，不再写 `data-tooltip`），新增禁用态提示可见要求，AI 头动作组从讨论窗口头动作清单中移除「收起」；②「最大化时讨论窗口头部贴边」修订——删除「Basecoat 伪元素提示 SHALL 全局关闭」的封锁式表述，改为所有权分离式同一结果（单一提示、无封锁规则）；③「发送彩蛋和应用图标各用定案真源」增补场景——纹样以真实 `img` 元素呈现且实际可见（级联级断言）。
- `discussion-windows`：「面板显示动作与请求动作分离」修订——收起面板入口唯一化为停靠区头 ✕ 与顶栏入口，讨论窗口头不再承载收起动作；收起语义（不清讨论、不停生成、不移出排队）不变。

## Impact

- **前端**：`src/ui-v5.ts`（属性名改写、MutationObserver、共享提示选择器、写作工具 sync 的 aria-disabled）、`src/ui-v5.css`（删封锁规则、`.ai-send-mark` 改 img 布局）、`index.html`（三个发送按钮加 `<img>`、删窗口头 ✕）、`src/ai-dock.ts`（maximize/菜单等 tooltip 写入点改属性名、close 接线清理）、`src/dom.ts`（`closeBtn` 移除）、`src/ai-window.ts`（窗口头动作装配）。
- **测试**：`tests/ui-send-mark.test.ts`（改断言 img 呈现）、`tests/ai-panel-geometry-contract.test.ts`（封锁规则断言改写为所有权断言、动作组去「收起」）、`tests/ai-panel-dom-fixture.ts` 与 `tests/ai-panel-dom.test.ts`（close 角色移除）、`tests/dom-contract.test.ts`、`tests/ui-v5.test.ts`（禁用态提示）。
- **vendor**：`public/vendor/basecoat-css/` 不动——它只是不再被喂 `data-tooltip`。
- **真机验收**：CDP 冒烟新增级联断言四条；`npm run check` 全绿为归档门槛。
