# 长补读理由卡布局修复与局部验收

2026-10-10，fix-ai-and-making-usability。布局与真实 WebView 点击几何 owner：UI lane；最终门禁和人工视觉复核：主助手。

## 缺陷与失败回归

`reading-auth.md` 原真实模型请求证明了授权端到端，但卡本身滚动导致按钮不可见，程序化 click 不足以证明可操作。

修产品代码之前执行 `node reading-card-layout.mjs before`：300px 面板，在 1024×670 与 1024×540 两种视口下，消息滚顶/滚底时两按钮中心均无法 elementFromPoint 命中，消息区仅 24px。16 个初始断言失败、无控制台错误。保留 `evidence-reading-auth/layout-before.json` 和四张 before 截图。脚本后来增加标题、输入区与理由滚底断言，before JSON 保留最初失败结果。

## 产品改动

- `index.html`：理由和边界说明移入独立、可键盘聚焦的区域，保留原 data-role、标题和两个决策按钮。
- `src/styles.css`：内容区独立滚动、长词可换行、键盘焦点可见；标题和按钮不收缩，按钮不换行。
- `src/ui-v5.css`：卡整体不滚动，有限高度并允许收缩；消息区至少 60px。等待授权期间输入区紧凑排列，标签保留在无障碍树中，以免低窗口下输入区被挤出面板。
- 未修改 `src/ai-window.ts`、reducer、loading、并发、授权接口。

## 修复后真实 WebView 呈现 fixture

命令：`node reading-card-layout.mjs after`，现有隔离 Tauri CDP 9225。

**明确是呈现 fixture**：暂时替换隐藏卡为其克隆，填入显式标注的长理由/边界说明与长消息；使用实际产品标题。捕获按钮点击回执，不调用授权接口。结束后恢复原节点及原监听，删除消息填充，清除视口模拟。检查没有真实 pending 后才执行。不读取或修改 keyring/配置，不新增模型请求。

**28 个断言全部通过，无控制台错误**：

- 面板宽 300px，视口为 1024×670 和 1024×540；标题完整保留，消息区至少 60px，输入区位于窗口内部。
- 消息滚顶/滚底时，两按钮中心 elementFromPoint 均命中按钮本身。
- 理由与边界说明独立滚动；通过 CDP 鼠标滚轮到内容底部后，两按钮仍命中。
- 两种视口均用 Input.dispatchMouseEvent 鼠标移动/按下/释放触发两个按钮的 fixture 点击回执，未用 DOM .click()。
- 卡整体 overflow hidden，按钮分别约 55×35px 与 93×35px，单行。

证据：`evidence-reading-auth/layout-after.json`；截图为 `layout-after-{670,540}-{top,bottom,reason-bottom}.png`。前后证据均保留，不覆盖原真实模型 pending 截图。

## 局部测试与交接

`node --test --test-reporter=dot tests/agent-on-demand-reading.test.ts tests/ai-panel-scroll.test.ts tests/ui-v5.test.ts`：28 项通过。

本次没有新增镜像 CSS 的单测；先失败的真实 WebView 回归直接覆盖布局缺陷。

更新 tasks 4.4 的发现与修复证据说明；原勾选不再仅依赖旧程序化点击。未运行全量 check，未 commit/archive。

剩余限制：此次用户式点击证明呈现 fixture 的真实命中和 DOM 点击到达，授权后端恢复仍由旧真实链路成功记录证明；没有新发真实请求重复恢复。最小验收高度为 540px，更低视口未覆盖。人工视觉复核留给主助手，不能用几何断言替代视觉确认。
