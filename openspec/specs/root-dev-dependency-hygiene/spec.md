# root-dev-dependency-hygiene Specification

## Purpose

定义根目录 npm 树（不随产品分发的开发工具链依赖）在册安全警报的修复纪律：官方修复版落在受影响包既有语义范围内时，以定向最小更新 `package-lock.json` 的方式修复，`package.json` 不动、不引入 `overrides`、不批量 `npm audit fix`；以 root `npm audit` 告警消除（对照官方警报修复版本）与 `npm run check` 全门禁通过为完成判据；GitHub 远端告警状态如实报告，不提前宣称关闭。首次落地实例：fix-brace-expansion-security（brace-expansion 5.0.9 → 5.0.12，2026-10-05 归档）。

## Requirements

### Requirement: root 开发依赖安全警报须定向最小修复

根目录 npm 树（不随产品分发的开发工具链依赖）出现在册安全警报且官方修复版落在受影响包的既有语义范围内时，SHALL 以定向更新 `package-lock.json` 的方式把该包升到修复版：`package.json` MUST NOT 因此改动，MUST NOT 引入 `overrides` 钉版或执行批量 `npm audit fix`。修复完成后 root `npm audit` 对应条目须消除，且 `npm run check` 全门禁通过后才可归档。

#### Scenario: 范围内的修复版定向更新锁文件

- **WHEN** root npm 树出现在册安全警报，且修复版满足受影响包的既有语义范围（如 `^5.0.8` 内的 5.0.12）
- **THEN** 仅 `package-lock.json` 中该包相关条目被更新到修复版，`package.json` 保持不变，不新增 `overrides`

#### Scenario: 更新面超出目标包即停止

- **WHEN** 定向更新后 `git diff` 显示目标包之外的锁条目发生变动
- **THEN** 停止并检查，还原后重新评估路径，不得默认接受扩大的变更面

#### Scenario: 修复验证留痕且远端状态如实报告

- **WHEN** 锁文件更新完成并进入验证
- **THEN** 以 root `npm audit`（对照官方警报修复版本）与 `npm run check` 全门禁通过作为完成判据，验证记录如实注明：GitHub 远端告警关闭须待另行授权的提交推送并复扫后确认，MUST NOT 提前宣称
