# ai-panel-dom-contract Specification

## Purpose
TBD - created by archiving change unify-ai-panel-dom-contract. Update Purpose after archive.
## Requirements
### Requirement: AI 面板必须通过显式 DOM 契约接线

系统 SHALL 为 AI 面板提供一个集中且严格类型化的 DOM 依赖契约，契约包含面板渲染、折叠、思维扩展、错误恢复和临时追问所需的全部节点。AI 面板初始化 MUST 使用该契约，不得依赖散落的全局节点查询。

#### Scenario: 完整页面组装 AI 面板契约

- **WHEN** 应用从包含现有 AI 面板节点的页面组装 `AppDom`
- **THEN** 系统返回包含全部必需面板节点的有效契约
- **AND** `setupAiPanel` 可以仅通过显式契约完成初始化

#### Scenario: 缺少必需节点时明确失败

- **WHEN** 页面缺少 AI 面板契约中的必需节点
- **THEN** DOM 组装在初始化阶段抛出包含缺失节点标识的明确错误
- **AND** 系统不创建部分接线的 AI 面板

### Requirement: DOM 契约重构必须保持 AI 面板行为

系统 MUST 保持既有 AI 面板的显示、事件和滚动语义，包括开合、重试、前往配置、思维扩展、追问、追问重试、编辑重发和加载/错误状态。面板输出 MUST 继续只存在于 AI 面板之外的临时显示区域，不得提供作品文档写回能力。

#### Scenario: 现有交互继续调用原有 action

- **WHEN** 用户点击 AI 面板中的重试、配置、思维扩展或追问相关控件
- **THEN** 系统通过现有 `AiPanelActions` 调用对应操作
- **AND** DOM 契约迁移不改变参数、按钮可用状态或用户可见文案

#### Scenario: AI 输出不写入作品文档

- **WHEN** AI 面板显示首次回应或追问回应
- **THEN** 回应只更新面板临时显示节点
- **AND** 面板契约不包含作品文档写入、插入、替换或删除接口

