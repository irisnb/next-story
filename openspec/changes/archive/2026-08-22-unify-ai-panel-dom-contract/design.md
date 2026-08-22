## Context

AI 面板当前由 `AppDom` 提供根节点和少数公共节点，但 `setupAiPanel` 又通过全局 `document.getElementById` 获取大量内部节点，并通过根节点查询 `.ai-panel-body`。这种混合方式让 DOM 依赖分散在两个边界，测试必须依赖全局文档，且节点归属不够明确。

本 change 只收敛依赖组织，不改变 HTML 结构、CSS、面板状态机、AI 请求、临时对话或作品文档写入边界。

## Goals / Non-Goals

**Goals:**

- 定义一个集中、严格类型化的 AI 面板 DOM 依赖契约。
- 让应用 DOM 组装边界负责解析和校验所需节点。
- 让 `setupAiPanel` 只接收契约并负责事件绑定、输入读取和显示结果应用。
- 保持既有 ID、class、文案、交互和滚动行为不变。
- 增加契约缺失和既有行为回归测试。

**Non-Goals:**

- 不重做 AI 面板布局或视觉设计。
- 不改变 `AiPanelState`、请求编排、追问模型或错误处理语义。
- 不增加常驻 Agent、自动上下文、多会话或任何未来能力。
- 不提供任何向作品文档写入 AI 输出的接口。

## Decisions

### 1. 使用集中式 `AiPanelDom` 类型契约

在 `src/dom.ts` 中定义 AI 面板所需节点的专用类型，并由 `getAppDom()` 通过统一的 `requireElement` 完成解析。`AppDom` 保留 `aiPanel`、`aiResponse`、`btnToggleAi` 等公共字段，同时增加一个集中面板依赖字段，或采用等价的明确适配器；具体实现以不破坏现有调用方为准。

选择集中契约而不是让 `setupAiPanel` 自己继续查找，是为了让节点缺失在应用启动接线处尽早失败，并让测试可以直接构造面板依赖。

### 2. `setupAiPanel` 不再使用全局节点查询

`setupAiPanel` 接收完整的 `AiPanelDom`，所有内部节点从该对象读取；`.ai-panel-body` 也由契约提供，而不是在面板模块内部再次查询。这样模块只依赖显式输入，不依赖全局文档状态。

备选方案是只把一个根节点传入、继续在根节点内部查询。该方案改动较小，但仍把必需节点契约隐藏在实现内部，测试和错误定位较弱，因此不采用。

### 3. 保持 DOM 标识和渲染路径兼容

HTML 中现有 ID/class 不变，渲染函数继续向相同节点写入 `textContent`、class 状态和 disabled 状态。测试先锁定契约组装与已有事件行为，再迁移 fixture，避免把结构重构误认为行为变更。

## Risks / Trade-offs

- [Risk] 类型契约字段较多，初始化代码会显得冗长 → [Mitigation] 仅在 `dom.ts` 集中解析，测试使用共享 fixture，业务模块不再重复查找。
- [Risk] 节点类型声明与 HTML 实际元素类型不一致 → [Mitigation] 保留现有启动时必需节点校验，并增加关键节点类型/行为回归测试。
- [Risk] 迁移时漏接事件节点导致交互回归 → [Mitigation] 运行现有 AI 面板和编辑器前端测试，并覆盖 retry、config、collapse、follow-up、thinking expansion。

## Migration Plan

1. 先补充失败的 DOM 契约测试和 fixture。
2. 在 `dom.ts` 增加集中面板契约并接入 `getAppDom()`。
3. 迁移 `ai-panel.ts` 和 bootstrap 调用方，删除其内部全局查询。
4. 运行定向测试、类型检查、完整前端测试、lint、build 和 OpenSpec 严格验证。

无需数据迁移。若出现问题，回滚本 change 的源码和测试变更即可，HTML 和持久化格式不受影响。

## Open Questions

- `AppDom` 是直接增加 `aiPanelDom` 嵌套字段，还是将面板节点字段平铺后由 `AiPanelDom` 类型投影得到？实现时选择对现有调用方改动最小且契约最清晰的方案。
