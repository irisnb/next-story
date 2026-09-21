# ai-module-boundaries 增量规格（Modified：新增两条要求，既有四条不变）

## ADDED Requirements

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
