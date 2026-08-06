## Why

`src/selection-entry.ts` 已经有可独立测试的纯决策函数，但 `setupSelectionEntry()` 仍同时维护按钮规则、创建和更新 DOM、绑定事件、冻结选区、处理定位以及管理生命周期。按钮组合因此存在两份事实源，后续修改入口行为时容易只改一处，造成界面与决策不一致。现在在进入 D-03 面板拆解前收窄这条边界，可以降低选区入口继续演进时的回归风险。

## What Changes

- 让选区入口的 DOM 控制层使用现有纯按钮决策结果，不再独立硬编码按钮组合。
- 将 `setupSelectionEntry()` 内部职责整理为清晰的 DOM 渲染、事件/生命周期、选区冻结和几何适配边界；保持现有外部入口 API 不变。
- 为新的边界补充或调整直接测试，确保现有入口显示、按钮组合、冻结选区、请求中阻止重复操作、定位和重置行为保持不变。
- 保留现有纯决策函数及其测试，不重做已经完成的 D-02 工作。
- 不抽取共享 fake DOM 测试工具；该工作属于 D-04。

## Capabilities

### New Capabilities

- `selection-entry-boundaries`: 规定选区入口内部控制层的单一按钮决策来源、稳定外部适配边界和行为保持要求；这是内部架构能力，不新增用户可见功能。

### Modified Capabilities

无。现有选区入口的产品需求保持不变；本 change 不修改 `selection-ai-invocation` 的行为要求。

## Impact

- 主要影响 `src/selection-entry.ts` 及其 `tests/selection-entry.test.ts` 测试。
- 可能新增同一目录下的内部纯函数或控制器辅助模块，但不改变 `setupSelectionEntry()` 的外部参数、返回值和 `src/ai-feature.ts` 的接入方式。
- 不增加依赖，不改变 Tauri、项目文本、AI 请求协议或面板状态协议。
- 验收以现有前端测试、补充的入口边界测试和 `npm run typecheck` 为准。
