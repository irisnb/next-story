# ai-module-boundaries 增量规格

## ADDED Requirements

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
`ai-dock.ts` MUST NOT 导入 `ai-feature.ts`；编排层到停靠区的全部动作 SHALL 经注入的 `AiDockActions` 动作对象传递，依赖方向保持编排层 → 停靠区单向。

#### Scenario: 停靠区不反向依赖编排层
- **WHEN** 检查 `ai-dock.ts` 的导入清单
- **THEN** 不出现对 `ai-feature.ts`（或其内部模块）的导入，全部动作来自注入的动作对象
