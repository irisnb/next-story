## Why

`src/ai-panel.ts` 目前同时解释面板状态、决定显示内容、直接操作大量 DOM 节点并绑定交互。现有功能继续迭代前，先建立可直接测试的显示决策边界，可以减少同一状态在多处被重复解释以及局部修改引发面板回归的风险。

## What Changes

- 为现有 AI 面板状态建立纯显示决策（view model）边界，统一说明当前状态应显示的内容、操作和可用性。
- 让 `src/ai-panel.ts` 主要负责 DOM 创建、事件绑定，以及把显示决策应用到既有节点。
- 保持 `AiPanelState` 为面板状态与临时对话的唯一事实源，保持 `setupAiPanel()` 及 `src/ai-feature.ts` 的现有接入稳定。
- 为显示决策增加脱离 fake DOM 的直接测试，并保留现有 DOM、状态、临时对话与滚动回归测试。
- 不改变 UI 视觉、显示文案、请求语义、临时对话、追问、重试、编辑重发、配置缺失处理或滚动行为。
- 不新增 AI 功能，不抽取共享 fake DOM helper，也不涉及作品后端拆分。

## Capabilities

### New Capabilities

- `ai-panel-rendering-boundaries`: 规定 AI 面板显示决策、状态事实源与 DOM 渲染层之间的内部责任边界，以及重构时必须保持的现有行为。

### Modified Capabilities

无。现有 `ai-thinking-panel`、`ai-panel-state-structure`、`summon-ai-follow-up` 等产品行为要求保持不变。

## Impact

- 主要影响 `src/ai-panel.ts`，并可能新增一个聚焦的 AI 面板显示决策模块及对应测试。
- `src/ai-panel-state.ts`、`src/ai-panel-request-state.ts`、`src/ai-panel-conversation.ts`、`src/ai-panel-scroll.ts` 继续提供现有状态和滚动边界，不改变对外语义。
- `tests/ai-panel-dom.test.ts` 继续锁定 DOM 行为；新增直接测试锁定显示决策。
- 不改变后端、项目文件格式、依赖、公开 API 或草稿本/正文本写入边界。
