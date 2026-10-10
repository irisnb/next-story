## MODIFIED Requirements

### Requirement: 停靠区单向通信
`ai-dock.ts` SHALL 保留为单AI面板的显示接线模块，负责面板开合、全宽/恢复、可调宽度及讨论列表投影；其旧多窗口注册、浮动几何、吸附、并排与恢复布局实现 SHALL 移除。该模块 MUST NOT 导入 `ai-feature.ts` 或其内部编排模块；编排层到面板的全部业务动作 SHALL 经注入的 `AiDockActions` 动作对象传递，依赖方向保持编排层 → 显示接线单向。`ai-window.ts` SHALL 承担当前讨论DOM适配、输入事件、显示结果应用和滚动协调，使用捕获的讨论身份调用动作；不得承载请求调度、会话启动/恢复或第二套讨论状态。显示卸载 SHALL 只清显示订阅与事件，不终止业务路由。状态外观、事件类型唯一来源、无DOM编排、统一请求网关及组合根装配边界保持有效。

#### Scenario: 停靠区不反向依赖编排层
- **WHEN** 检查 `ai-dock.ts` 的导入清单
- **THEN** 不出现对 `ai-feature.ts`（或其内部模块）的导入，全部业务动作来自注入的动作对象

#### Scenario: 单面板模块职责明确
- **WHEN** 迁移单面板显示实现
- **THEN** `ai-dock.ts` 管理单面板布局和列表，`ai-window.ts` 应用当前讨论显示结果与处理交互，`dom.ts` 集中提供显式DOM契约
- **AND** `ai-feature.ts` 仅装配依赖，请求仍经 `ai-feature-request-gateway.ts`，生命周期规则仍归对应编排模块，不因移除浮动路径而内联到显示层
