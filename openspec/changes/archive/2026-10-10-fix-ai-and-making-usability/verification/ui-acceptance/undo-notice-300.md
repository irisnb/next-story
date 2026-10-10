# 300px 撤销提示局部修复与真实验收

2026-10-10，同 change。针对 batch1-geometry.md 第 115–116 行所记质量缺陷：长标题将撤销按钮压至约 10.5px、文字竖排。

## 改动

- `src/ai-dock.ts`：文案缩为「已删除：标题」；提示文本独立 class、title 保留讨论标题。
- `src/styles.css`：提示文本允许收缩、单行省略；撤销按钮不收缩、单行，最小 48×32px。
- 未修改撤销状态、回调、寿命或删除语义；未改其他产品 scope、tasks.md；未运行全量 check。

## 真实 Tauri CDP

命令：在本目录运行 `node undo-notice-geometry.mjs 9225`。

沿用隔离 dev 实例与 CDP几何验收-隔离项目。实际点击列表删除确认与撤销，不注入布局、业务状态或按钮行为。测试讨论使用长标题；初始旧样本在一次键盘事件缺少 text 的脚本失败后超时删除，最终通过真实 UI 创建新的长问题样本（无 LLM 配置，不触达模型）重验。键盘事件补齐原批次相同的 Enter 文本后通过。

最终结果：**14 个断言全部通过，0 console error**。

| 项目 | 鼠标路径 | 键盘 Enter 路径 |
|---|---|---|
| 实际面板宽 | 300px | 300px |
| notice | 259×45px | 259×45px |
| 撤销按钮 | 48×32px | 48×32px |
| 撤销文字 | 1 行，宽 21px | 1 行，宽 21px |
| 按钮 flex-shrink / white-space | 0 / nowrap | 0 / nowrap |
| 标题 | 180px 文本区，ellipsis 生效 | 同左 |
| 标题与按钮 | 无重叠，间隔 8px | 同左 |
| 列表打开时点击命中 | 按钮中心命中按钮本身 | 同左 |
| 撤销结果 | 讨论行恢复，notice 消失 | 讨论行恢复，notice 消失 |

证据：`evidence-ai/undo-notice-300.json`、`evidence-ai/undo-notice-300-mouse.png`、`evidence-ai/undo-notice-300-keyboard.png`。

截图已生成并尝试读取；当前模型不支持图像输入，读取结果提示 Cannot read image，**未宣称人工视觉观察通过**。真实 WebView 的文字 Range 行数、矩形、样式与命中断言已证明本缺陷中的竖排、挤压和重叠问题得到修正；截图留给主助手直接查看。

## 局部回归

`node --test tests/ai-dock.test.ts tests/ui-v5.test.ts`：4 项通过，0 失败。

`git diff --check -- src/ai-dock.ts src/styles.css`：通过，仅 Git 换行提示。

最终全量门禁由主助手负责。本次未提交、未归档、未修改共享 tasks。
