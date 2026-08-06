## Context

`src/selection-entry.ts` 目前同时包含纯决策函数和 DOM 控制流程。纯函数已经覆盖入口可见性、按钮组合、选区身份和浮层定位；DOM 流程仍在 `setupSelectionEntry()` 中重复表达按钮规则，并同时处理节点创建、事件绑定、选区冻结、定位更新、菜单状态和清理。

本 change 只整理现有选区入口的内部边界。`setupSelectionEntry(options)` 的调用方式、`SelectionEntryController` 的外部行为、选区快照格式和 AI 入口产品规则都必须保持不变。D-01 的 AI 总编排拆分已完成，D-04 的 fake DOM helper 抽取不属于本 change。

## Goals / Non-Goals

**Goals:**

- 建立单一的按钮动作决策来源，让 DOM 层根据 `decideSelectionEntryActions()` 的结果创建、显示和隐藏按钮。
- 将入口控制流程按职责分成可单独理解和测试的内部边界：DOM 渲染、事件与生命周期、选区冻结、几何更新。
- 保持同一渲染帧合并更新、焦点端定位、菜单展开锚点稳定、请求中阻止重复动作和 reset 清理等现有行为。
- 用测试锁定边界和行为，并通过前端测试与类型检查。

**Non-Goals:**

- 不增加从光标位置召唤、历史对话、多对话或新的入口动作。
- 不改变“必须先选中文字”和“点击时冻结选区”。
- 不改变 AI 请求、面板状态、prompt、项目文本或 `src/ai-feature.ts`。
- 不抽取共享 fake DOM 测试基础设施，不做视觉重设计或 CSS 重构。

## Decisions

1. **以纯按钮决策结果作为唯一事实源。** DOM 控制层在更新入口时调用已有的 `decideSelectionEntryActions()`，按照返回结果决定是否创建/显示“及时召唤”和“思维扩展”按钮；不再根据请求状态或选区状态自行复制同一组合判断。相比继续保留两套判断，这能让规则修改只需要改一个地方；相比把 DOM 节点传进纯函数，保留纯函数的输入输出边界，测试更直接。

2. **保留 `setupSelectionEntry()` 作为稳定外部适配器。** 内部可以提取小型控制器或闭包，但公开的 options、controller 和 `src/ai-feature.ts` 接线保持不变。相比修改外部 API，这种做法把迁移风险限制在入口模块内；相比完全拆成多个公开模块，避免为当前规模暴露不必要的长期接口。

3. **按事件流而非按 DOM 节点拆分内部职责。** 选区冻结继续发生在用户点击开启动作的回调中；几何更新继续由合并后的调度入口触发；生命周期清理继续由 controller 的 reset 负责。节点渲染只消费决策和布局结果，不读取编辑器全文或直接发起 AI 请求。这样既保留当前时序，又减少控制器中的业务耦合。

4. **先补行为锁定测试，再移动实现。** 先为按钮决策与 DOM 消费关系、冻结快照和 reset 行为补测试，再进行最小重构。相比先移动代码再凭现有测试兜底，这能捕获现有测试未覆盖的两份事实源问题。

## Risks / Trade-offs

- [Risk] 内部拆分可能改变事件注册或清理顺序 → [Mitigation] 保留 controller 外部 API，补充重复 setup/reset 和菜单动作测试，并运行完整前端测试。
- [Risk] DOM 层直接消费决策结果时可能遗漏 loading 状态下的按钮禁用规则 → [Mitigation] 将请求中状态作为纯决策输入，测试入口隐藏、动作组合和请求中行为。
- [Risk] 提取过多小模块会增加跳转成本 → [Mitigation] 只提取有独立输入/输出或生命周期边界的职责，优先留在 `selection-entry.ts` 内部或同域小文件。

## Migration Plan

1. 在现有前端测试中锁定当前行为和新的单一决策来源。
2. 重构 `selection-entry.ts` 内部控制流程，保持公开 API 不变。
3. 运行 `tests/selection-entry.test.ts`、相关 AI 入口测试、完整前端测试和 `npm run typecheck`。
4. 若验证失败，回滚本 change 的内部实现；不涉及数据迁移、持久化格式或外部 API。

## Open Questions

无。具体内部函数命名和是否需要一个同域辅助文件由实现时依据现有代码规模决定，但不得改变本设计的职责边界。
