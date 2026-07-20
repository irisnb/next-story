## Why

`src/ai-panel-state.ts` 现在同时承担面板可见性、首次召唤请求状态、临时对话、追问轮次、失败重试、只读视图快照和订阅通知等职责。继续在一个类里叠加后续 AI 能力，会让状态边界变得难判断，尤其容易误伤“冻结选区锚点”“单条线性临时追问”“零写回”这些已实现边界。

这次 change 只做内部结构拆分：先把现有 AI 面板状态机拆成职责清楚的小模块，并用测试证明用户可见行为完全不变。它是后续 AI 工作的地基，不是新功能。

## What Changes

- 将 `AiPanelState` 当前混在一起的职责拆成更小的内部模块，至少分开：
  - 面板开关/可见性状态；
  - 首次召唤请求状态；
  - 当前临时对话身份、冻结选区锚点和首轮回应；
  - 追问 pending / success / error 轮次；
  - 状态只读快照与订阅通知。
- 保留现有外部使用方式，优先让 `src/ai-feature.ts`、`src/ai-panel.ts`、`src/ai-panel-scroll.ts` 不需要理解拆分后的内部结构。
- 保持所有现有行为不变：召唤时无输入、首次成功后单条线性临时追问、新召唤替换旧对话、切换作品清空、面板收起不清空、失败可重试或编辑后重发、过期结果不得污染新对话。
- 补强或调整测试，让拆分后的模块分别锁定状态转换，同时保留现有集成测试保护外部行为。
- 不新增依赖、不新增持久化数据、不修改 Rust 后端生成语义。
- 不改 AI Prompt、模型请求结构、模型列表、配置规则或任何草稿本/正文本写入能力。

## Capabilities

### New Capabilities

- `ai-panel-state-structure`: Internal implementation contract for keeping AI panel state responsibilities separated while preserving the current user-visible AI panel behavior.

### Modified Capabilities

（无。该 change 不改变现有用户可见能力的需求语义。）

## Impact

- **代码**：主要影响 `src/ai-panel-state.ts`，并可能新增 `src/ai-panel-*.ts` 或 `src/ai-state/*.ts` 等内部模块；调用方重点检查 `src/ai-feature.ts`、`src/ai-panel.ts`、`src/ai-panel-scroll.ts`。
- **测试**：重点影响 `tests/ai-panel-state.test.ts`，并需要确认 `tests/ai-panel-dom.test.ts`、`tests/ai-feature-routing.test.ts`、`tests/ai-panel-scroll.test.ts` 仍按现有行为通过。
- **规格**：新增内部结构规格 `ai-panel-state-structure`，用于约束拆分后的状态职责边界；不修改现有用户可见能力规格。
- **用户行为 / 数据 / API**：无变化；不新增持久化、不改 Tauri IPC、不改 LLM 配置、不改模型请求含义。
- **产品边界**：继续遵守 AI 输出只在面板中作为临时材料，AI 永远不直接改草稿本和正文本。
