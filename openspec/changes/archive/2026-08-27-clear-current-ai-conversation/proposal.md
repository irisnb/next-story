## Why

当前常驻 AI 面板在一次临时对话完成后只能继续追问或收起，用户无法在同一篇作品中主动回到空白提问状态。用户只能借助其他首轮入口间接替换旧对话，操作意图不清晰；现在需要补上明确的用户控制。

## What Changes

- 在已有临时对话的面板中提供“新建对话”操作。
- 点击后清除当前临时对话、首轮请求显示和追问草稿，面板保持展开并回到直接提问空状态。
- 让清空操作安全处理正在进行的首轮请求或追问：旧请求的迟到结果不得重新写回已清空的面板。
- 不保留被清除的对话，不增加多会话、会话列表或持久化历史。
- 不改变切换作品/文档时清空，以及收起后保留当前临时对话的既有行为。

## Capabilities

### New Capabilities

- `clear-current-ai-conversation`: 用户在当前作品中主动结束唯一的临时 AI 对话并回到空白提问状态。

### Modified Capabilities

- `persistent-ai-panel-entry`: 补充常驻面板内主动开始下一次临时对话的入口及其生命周期行为。
- `ai-panel-state-structure`: 补充清空当前对话的显式状态迁移，并保持异步结果隔离。
- `ai-panel-dom-contract`: 补充面板“新建对话”控件及其 DOM 交互契约。

## Impact

- 影响 `src/ai-panel-reducer.ts`、`src/ai-panel-state.ts`、`src/ai-panel-view-model.ts` 和 `src/ai-panel.ts` 的状态、显示决策与事件接线。
- 影响 `AiPanelDom` 契约、面板 HTML 和相关样式。
- 增加状态机、DOM 交互和迟到请求隔离测试；不新增后端接口、网络依赖或作品文档写入能力。
