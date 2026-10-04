# ci-pipeline Specification

## Purpose
定义仓库持续集成（CI）的门禁范围、测试环境无关性约束与 Dependabot 依赖更新策略，作为「推送即可验证」的工程基线，防止 CI 长期红灯无声漂移。
## Requirements
### Requirement: CI 双平台门禁

CI SHALL 在 Linux 与 Windows 双平台对 main 分支的每次推送与拉取请求执行同一套完整门禁，且该套门禁的科目集合 SHALL 与仓库标准检查命令 `npm run check` 完全一致：前端类型检查、lint、前端测试、可靠性工具测试、驱动测试、离线协议验证、前端生产构建、Rust 格式检查（`cargo fmt --check`）、Rust clippy（`-D warnings`）与 Rust 测试。任一平台 MUST NOT 缺少该集合中的任何科目；门禁步骤集合 MUST NOT 未经新的 change 被删除或放宽。

#### Scenario: 推送到 main 触发门禁

- **WHEN** 任意提交推送到 main 分支
- **THEN** CI 在 Linux 与 Windows 作业上执行与 `npm run check` 完全一致的完整门禁科目
- **AND** 两个平台不因操作系统不同而缺少任何科目（含格式检查与 clippy）

#### Scenario: 门禁失败即红灯

- **WHEN** 任一门禁步骤失败
- **THEN** 对应 CI 作业标记失败，不得跳过或降级为警告

#### Scenario: 本地命令与 CI 同一集合

- **WHEN** 维护者运行 `npm run check` 并与 CI 执行集合对照
- **THEN** 两者科目完全一致，不存在仅本地执行或仅 CI 执行的科目

### Requirement: 测试与门禁不得依赖运行环境本地条件

测试与 CI 门禁 SHALL 在任意合理运行环境（时区、语言区域、操作系统）下产生一致结果；测试数据 MUST NOT 依赖「运行环境处于特定时区」的隐式假设。需要验证月份、日期边界等本地化展示时，测试 SHALL 使用在任何现实时区（UTC−12 至 UTC+14）下都落在同一期望值内的时间数据（如月中时刻）。

#### Scenario: 时区无关的月份分组测试

- **WHEN** 涉及按月分组或月份标签的测试在 UTC 环境与东八区环境分别运行
- **THEN** 测试结果一致，不因运行环境时区不同而失败

#### Scenario: 纯文档提交可通过门禁

- **WHEN** 仅包含文档改动的提交推送到 main
- **THEN** CI 全部门禁通过（不存在与代码内容无关的确定性失败）

### Requirement: Dependabot 更新策略

Dependabot SHALL 以默认周度频率巡逻仓库全部三个依赖树——根目录 npm（`/`）、sidecar npm（`/sidecar`）与 Rust cargo（`/src-tauri`）——并 SHALL 递送全部版本层级（含 semver-major 大版本）的更新 PR；机器人 MUST NOT 自动合并任何更新 PR，采纳、关闭或忽略均由用户决定。

#### Scenario: 周度巡逻递单

- **WHEN** Dependabot 周度巡逻发现任意依赖树存在可用更新（补丁、小版本或大版本）
- **THEN** 对应更新 PR 被创建，不受版本层级过滤

#### Scenario: sidecar 依赖树纳管

- **WHEN** `sidecar/package.json` 的依赖发布可用更新
- **THEN** Dependabot 在 `/sidecar` 目录创建 npm 更新 PR
- **AND** sidecar 依赖更新与根 npm、cargo 更新互不替代

#### Scenario: 大版本更新照常递单

- **WHEN** 某依赖发布新的 major 版本且 Dependabot 巡逻发现
- **THEN** Dependabot 照常创建对应 PR，由用户决定后续处理

#### Scenario: 机器人不自动合并

- **WHEN** 任一 Dependabot 更新 PR 的检查通过
- **THEN** PR 保持打开等待用户处理，Dependabot 不得自行合并

### Requirement: 跨平台编译覆盖

main 分支的双平台 CI SHALL 覆盖非 Windows 目标代码的编译完整性：`cargo clippy --all-targets -- -D warnings` 在 Linux 任务中 MUST 通过，使 `#[cfg(not(windows))]` 等平台特有分支的编译错误不会因"本地 Windows 不编译该分支"而长期潜伏。

#### Scenario: Linux 任务编译非 Windows 分支

- **WHEN** CI 在 Linux 运行 `npm run check`
- **THEN** Rust 编译与 clippy 全目标通过，不因非 Windows 平台分支的编译错误失败

#### Scenario: 平台分支编译错误按平台暴露

- **WHEN** 任一平台专属分支存在编译错误
- **THEN** 对应平台的 CI 任务失败，错误在合并前可见（不得只存在于无人编译的分支）

### Requirement: 夹具字节稳定性（LF 规范）

被内容哈希校验的文本夹具 SHALL 以 LF 规范检出并在读取入口归一，使同一内容的哈希在 Windows 与 Linux 上一致；`npm run test:reliability` 的磁盘夹具校验 MUST 在两平台均通过。

#### Scenario: Windows 检出后磁盘夹具校验通过

- **WHEN** Windows 检出发生换行转换（autocrlf）后运行 `npm run test:reliability`
- **THEN** 手写档材料哈希与存档一致，磁盘夹具校验全部通过

#### Scenario: CRLF 输入经归一后哈希不漂移

- **WHEN** 以 CRLF 变体读取手写档文本
- **THEN** 归一后的材料哈希与 LF 基准存档一致（由回归用例钉住）

