# 任务：理清提示规则所有权并修复三处界面回归

## 1. 提示属性分离（D1）

- [x] 1.1 `src/ui-v5.ts`：共享提示系统（`prepareTitles`、`showTooltip`、MutationObserver、写作工具装配）全部 `data-tooltip`/`dataset.tooltip` 读写改为 `data-hint`/`dataset.hint`；确认事件委托选择器同步更新
- [x] 1.2 `src/ai-dock.ts`：`maximizeBtn` 及各处先写 `title` 再转提示的路径全部改走 `data-hint`；全仓 grep 复核 `src/` 内 `data-tooltip` 写入清零（vendor 目录除外）
- [x] 1.3 `src/ui-v5.css`：删除全局封锁规则 `[data-tooltip]::before/::after { display:none !important }` 及旧局部封锁注释块；确认无任何新增替代性封锁规则
- [x] 1.4 `tests/ai-panel-geometry-contract.test.ts`：把「封锁规则存在」断言改为「`src/` 无 `data-tooltip` 写入、样式表无封锁规则、共享提示读 `data-hint`」的所有权断言

## 2. 发送纹样改真实 img（D2）

- [x] 2.1 `index.html`：`follow-up-send`、`direct-question-send`、`making-conversation-send` 三按钮内嵌 `<img src="assets/user-mark.png" alt="" aria-hidden="true">`，保留 `aria-label` 功能名
- [x] 2.2 `src/ui-v5.css`：`.ai-send-mark` 删除 `font-size:0` 与 `::after` 系列规则，新增 img 定宽 28px、`aspect-ratio: 988/789`、`filter: invert(1)`、禁用态降不透明度；按钮几何（72×32、黑底、hover/active/focus）不变
- [x] 2.3 `tests/ui-send-mark.test.ts`：改断言三按钮各含 `img[src$="user-mark.png"]`、CSS 宽/比例声明、PNG SHA 不变、禁用/焦点合同保持

## 3. 禁用态提示恢复（D3）

- [x] 3.1 `src/ui-v5.ts` 写作工具 `sync()` 与相关装配：凡因无选区而置 `button.disabled` 的工具栏按钮（含触发按钮；粗体/斜体等基础按钮如同样禁用则一并处理）不再置 `disabled`，改置 `aria-disabled="true"`＋等价视觉类；点击/键盘提交处理器入口守卫拒绝（无选区不动作）
- [x] 3.2 确认禁用视觉与原 `:disabled` 呈现一致（半透明、不可点指针），hover/focus 提示可见
- [x] 3.3 补无选区点击/回车不触发动作、悬停显示功能名的测试
- [x] 3.4 修订（2026-10-30 用户拍板 C「亮着＋点击给提示」）：删除 `ui-v5.css` 中 aria-disabled 工具按钮的变灰/半透明视觉规则与悬停压制，不可用态外观与启用态完全一致（正常悬停反应、正常指针）
- [x] 3.5 撤销/重做历史为空时并入同一模式：改 `aria-disabled="true"`＋守卫＋原因提示（「没有可撤销的内容」/「没有可重做的内容」）；盘点左侧工具栏全部禁用来源（选区/历史/无编辑器过渡态），统一口径并留存清单（无编辑器过渡态可保留原生禁用但须记录理由）
- [x] 3.6 点击/键盘触发不可用工具时经共享提示层短暂显示原因提示（如「先选中文字再用」），MUST NOT 静默无响应；机制避免循环导入（如 CustomEvent 解耦）；补测试（无选区点粗体→提示出现且无格式动作；撤销历史空→提示）
- [x] 3.7 冒烟脚本③扩展：无选区点击粗体断言原因提示出现且无格式动作；悬停撤销（历史空）断言功能名提示可见
- [x] 3.8 补漏（2026-10-30 复验发现）：对齐四枚（`btn-align-left/center/right/justify`）与清除格式两枚（`btn-clear-character-format/btn-clear-paragraph-format`）仍是原生 disabled＋灰视觉（CDP 实测 op=0.4 dis=true）——首版盘点遗漏；并入 setToolUnavailable＋守卫＋「先选中文字再用」
- [x] 3.9 修提示锚点（复验发现「提醒在右上角」，CDP 实测提示框 x:2448,y:8 而按钮在 x:10,y:240）：`ns-toolbar-hint` 事件 detail 携带触发按钮元素，共享提示层按该按钮矩形定位（下优先上回退、钳位），废弃 activeElement 猜测（编辑器工具按钮不抢焦点，点击后 activeElement=BODY）；键盘触发以聚焦按钮为锚
- [x] 3.10 冒烟脚本③补位置断言：原因提示矩形须出现在触发按钮邻近（不得出现在窗口角落）
- [x] 3.11 「讨论」开关展开态去重（2026-10-30 用户拍板：指示太重、应与全软件设计语言一致）：Basecoat ghost 展开态默认 #737373 深灰持续填充（CDP 实测 rgb(115,115,115)，开列表期间常驻，用户读作「卡住」）改为轻表面底 `var(--color-surface-hover)`＋正常文字色——与列表行悬停/选中同族；标签页深底（`--color-primary`）属一次性强选择信号，不适用于持续面板指示；冒烟补断言：展开态计算底色不得为 #737373 系深灰（实测展开 rgb(240,240,240)、收起透明；另修脚本两处既有缺陷：对象快照与字符串比较错配、strong 绝对断言改差值，见脚本注释）

## 4. 收起入口唯一化（D4）

- [x] 4.1 `index.html`：删除讨论窗口模板中 `data-role="close"` 按钮；`src/dom.ts` 移除 `closeBtn`；`src/ai-window.ts` 清理对应装配与接线
- [x] 4.2 确认停靠区头 ✕ 与顶栏入口行为不变（收起后讨论保留、生成不停、排队不移出、重开不重发）
- [x] 4.3 `tests/ai-panel-dom-fixture.ts`、`tests/ai-panel-dom.test.ts`、`tests/dom-contract.test.ts`：移除 close 角色断言，新增「窗口头无收起按钮」断言

## 5. 级联回归断言与验收（D5）

- [x] 5.1 定位既有真机冒烟（CDP）脚本入口，接入四条断言：①三发送按钮 img 实际渲染宽 28px、比例 988/789；②悬停提示按钮仅出现一个提示层；③无选区悬停禁用工具显示功能名提示；④窗口头无收起按钮、停靠区 ✕ 收起后讨论仍在列表且生成不中断
- [x] 5.2 `npm run check` 全绿
- [x] 5.3 真机冒烟全项通过（含四条新断言与既有几何/提示项），留存证据（2026-10-30 CDP 实测：`verification/smoke-tooltip-ownership.json`；①断言指标修正为 content 断粮＋制作页补切「制作对话」子标签，两处脚本修正记录于脚本注释）
- [x] 5.4 交用户过目验收（纹样恢复、双 ✕ 去重后的收起手感、禁用工具提示）后归档（2026-10-30 用户多轮真机复验通过：含 C 修订、补漏六枚、提示锚点、讨论开关浅灰）
