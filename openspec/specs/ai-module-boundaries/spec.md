# ai-module-boundaries Specification

## Purpose
规定 AI 面板与 AI 编排前端代码的模块结构边界，防止逻辑回退为单文件巨石：状态迁移只经唯一外观进出、面板事件类型只有一份定义、编排聚焦模块不触碰 DOM、停靠区单向接收编排层动作、请求派发只走统一网关、组合根不得内联编排规则。这些边界由巨石拆缝重构（change `extract-ai-logic-seams`）与请求编排中心拆分（change `extract-ai-request-orchestration`，均 2026-09-21 归档）确立，供后续迭代（UI 全量更新等）持续依赖与自动校验。
## Requirements
### Requirement: reducer 迁移逻辑仅经状态外观消费
生产代码 SHALL 仅通过 `AiPanelState` 外观消费 `ai-panel-reducer` 的状态迁移逻辑；除状态外观模块外，任何生产文件 MUST NOT 直接导入 reducer 的迁移函数。类型模块的重导出（re-export）不在此限。

#### Scenario: 生产代码静态边界检查
- **WHEN** 检查 `src/` 下全部生产文件对 `ai-panel-reducer` 的导入
- **THEN** 仅状态外观模块导入迁移函数，其余生产文件零导入，违反时对应边界测试失败

### Requirement: 面板事件类型单一事实源
`AiPanelEvent` 联合类型及其配套请求/进度类型 SHALL 只在独立的事件类型模块定义一份；reducer 与各消费方 SHALL 经该模块（或其重导出）使用同一类型，MUST NOT 出现第二份定义或形状分叉。

#### Scenario: 事件形状调整只改一处
- **WHEN** 需要调整 `AiPanelEvent` 联合的形状（新增或修改一个 case）
- **THEN** 仅事件类型模块需要修改，reducer 与消费方经重导出自动获得更新后的同一类型

### Requirement: AI 编排聚焦模块不触碰 DOM
`ai-feature-*` 编排聚焦模块 MUST NOT 访问 `document` 或 `window` 等 DOM 全局；所需的状态读取与副作用 SHALL 以显式参数（访问器函数、依赖回调）注入。

#### Scenario: 无 DOM 环境完整执行
- **WHEN** 在无 DOM 的测试环境中以注入依赖调用聚焦模块
- **THEN** 模块完整执行其职责，不因缺少 DOM 而抛错或产生行为分叉

### Requirement: 停靠区单向通信
`ai-dock.ts` SHALL 保留为单AI面板的显示接线模块，负责面板开合、全宽/恢复、可调宽度及讨论列表投影；其旧多窗口注册、浮动几何、吸附、并排与恢复布局实现 SHALL 移除。该模块 MUST NOT 导入 `ai-feature.ts` 或其内部编排模块；编排层到面板的全部业务动作 SHALL 经注入的 `AiDockActions` 动作对象传递，依赖方向保持编排层 → 显示接线单向。`ai-window.ts` SHALL 承担当前讨论DOM适配、输入事件、显示结果应用和滚动协调，使用捕获的讨论身份调用动作；不得承载请求调度、会话启动/恢复或第二套讨论状态。显示卸载 SHALL 只清显示订阅与事件，不终止业务路由。状态外观、事件类型唯一来源、无DOM编排、统一请求网关及组合根装配边界保持有效。

#### Scenario: 停靠区不反向依赖编排层
- **WHEN** 检查 `ai-dock.ts` 的导入清单
- **THEN** 不出现对 `ai-feature.ts`（或其内部模块）的导入，全部业务动作来自注入的动作对象

#### Scenario: 单面板模块职责明确
- **WHEN** 迁移单面板显示实现
- **THEN** `ai-dock.ts` 管理单面板布局和列表，`ai-window.ts` 应用当前讨论显示结果与处理交互，`dom.ts` 集中提供显式DOM契约
- **AND** `ai-feature.ts` 仅装配依赖，请求仍经 `ai-feature-request-gateway.ts`，生命周期规则仍归对应编排模块，不因移除浮动路径而内联到显示层

### Requirement: 请求派发经统一网关
AI 请求派发（召唤首轮、追问、直接提问）SHALL 经统一的请求网关模块完成调度准入与协调器调用；网关之外的生产代码 MUST NOT 自行组合 scheduler 准入与 coordinator 请求调用，组合根与停靠区接线层 MUST NOT 内联派发管道实现。

#### Scenario: 派发组合的静态边界检查
- **WHEN** 检查 `src/` 下生产代码中 scheduler 准入与 coordinator 请求方法的组合调用
- **THEN** 该组合仅出现在请求网关模块内，违反时对应边界测试失败

### Requirement: 组合根装配边界
`setupAiFeature` 组合根 SHALL 限于依赖创建、聚焦模块装配与事件接线；请求派发规则、请求生命周期规则与关注文档材料组装规则 SHALL 住在对应聚焦模块，MUST NOT 以内联实现体留在组合根。

#### Scenario: 编排规则不在组合根驻留
- **WHEN** 检查 `src/ai-feature.ts` 的函数体
- **THEN** 不含材料组装、派发管道、停止/重试规则的实现逻辑（由静态边界测试按符号锁定），违反时对应边界测试失败
