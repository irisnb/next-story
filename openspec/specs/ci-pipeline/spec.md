# ci-pipeline Specification

## Purpose
定义仓库持续集成（CI）的门禁范围、测试环境无关性约束与 Dependabot 依赖更新策略，作为「推送即可验证」的工程基线，防止 CI 长期红灯无声漂移。

## Requirements

### Requirement: CI 双平台门禁

CI SHALL 在 Linux 与 Windows 双平台对 main 分支的每次推送与拉取请求执行门禁，至少包含：前端类型检查、lint、前端测试、前端生产构建、Rust 测试；Linux 作业 SHALL 额外执行 Rust 格式检查（`cargo fmt --check`）与 clippy（`-D warnings`）。门禁步骤集合 MUST NOT 未经新的 change 被删除或放宽。

#### Scenario: 推送到 main 触发门禁

- **WHEN** 任意提交推送到 main 分支
- **THEN** CI 在 Linux 与 Windows 作业上执行类型检查、lint、前端测试、生产构建与 Rust 测试
- **AND** Linux 作业额外执行 Rust 格式检查与 clippy

#### Scenario: 门禁失败即红灯

- **WHEN** 任一门禁步骤失败
- **THEN** 对应 CI 作业标记失败，不得跳过或降级为警告

### Requirement: 测试与门禁不得依赖运行环境本地条件

测试与 CI 门禁 SHALL 在任意合理运行环境（时区、语言区域、操作系统）下产生一致结果；测试数据 MUST NOT 依赖「运行环境处于特定时区」的隐式假设。需要验证月份、日期边界等本地化展示时，测试 SHALL 使用在任何现实时区（UTC−12 至 UTC+14）下都落在同一期望值内的时间数据（如月中时刻）。

#### Scenario: 时区无关的月份分组测试

- **WHEN** 涉及按月分组或月份标签的测试在 UTC 环境与东八区环境分别运行
- **THEN** 测试结果一致，不因运行环境时区不同而失败

#### Scenario: 纯文档提交可通过门禁

- **WHEN** 仅包含文档改动的提交推送到 main
- **THEN** CI 全部门禁通过（不存在与代码内容无关的确定性失败）

### Requirement: Dependabot 更新策略

Dependabot SHALL 以默认周度频率巡逻 npm 与 cargo 依赖，SHALL 递送全部版本层级（含 semver-major 大版本）的更新 PR；机器人 MUST NOT 自动合并任何更新 PR，采纳、关闭或忽略均由用户决定。

#### Scenario: 周度巡逻递单

- **WHEN** Dependabot 周度巡逻发现任意生态存在可用更新（补丁、小版本或大版本）
- **THEN** 对应更新 PR 被创建，不受版本层级过滤

#### Scenario: 大版本更新照常递单

- **WHEN** 某依赖发布新的 major 版本且 Dependabot 巡逻发现
- **THEN** Dependabot 照常创建对应 PR，由用户决定后续处理

#### Scenario: 机器人不自动合并

- **WHEN** 任一 Dependabot 更新 PR 的检查通过
- **THEN** PR 保持打开等待用户处理，Dependabot 不得自行合并
