# repo-license Specification（delta）

## ADDED Requirements

### Requirement: 许可为标准 MIT
主仓库 `LICENSE` SHALL 为标准 MIT 许可证原文（英文通行文本，一字不差），版权行为 `Copyright (c) 2026 irisnb`；`LICENSE` MUST NOT 附加翻译、补充条款或额外限制。

#### Scenario: LICENSE 为标准 MIT 原文
- **WHEN** 查看 `LICENSE` 文件
- **THEN** 内容为标准 MIT 文本，版权行含 irisnb 与 2026 年份，无附加条款或翻译

### Requirement: 对外口径一致
仓库面向访客的许可表述（README「协作与协议」区、`docs/ARCHITECTURE.md`、本 change 归档后新发布的 Release 说明）SHALL 与 MIT 一致：声明本仓库代码与文档按 MIT 开源、可自由使用、修改与再分发（含商业用途）、需保留版权与许可声明；MUST NOT 再出现「未经书面许可不得复用、修改、再分发」「保留所有权利」之类的限制口径；用户创作内容归属声明（用户在软件中写下的所有文字权利完全属于用户）SHALL 在 README 许可表述同区在场。

#### Scenario: README 口径
- **WHEN** 查看 README 协作与协议区
- **THEN** 声明 MIT 口径，无旧限制表述，且用户内容归属声明在场

#### Scenario: 架构文档口径
- **WHEN** 查看 `docs/ARCHITECTURE.md` 许可表述
- **THEN** 为 MIT 口径，无旧限制表述

#### Scenario: 新 Release 口径
- **WHEN** 查看本 change 归档后发布的 Release 说明中的许可表述（如有）
- **THEN** 为 MIT 口径，无旧限制表述

### Requirement: 已发布版本按旧声明
v0.1.0 与 v0.1.1 已分发的副本与 Release 说明 SHALL 继续按原《Next Story 版权与使用声明》表述保留；本 change MUST NOT 对其做追溯性修改。

#### Scenario: 历史版本不动
- **WHEN** 查看 v0.1.0 / v0.1.1 的 Release 页面与分发产物
- **THEN** 保持发布时原样，许可表述未被改写

### Requirement: 第三方许可文本保留
仓库转 MIT 后，随包分发的第三方资源 SHALL 保留其原有许可文本与口径（如 `public/fonts/LICENSE.txt` 的 SIL OFL 声明、Basecoat 的 MIT 声明）；MUST NOT 将第三方资产的许可文本改写或移除。

#### Scenario: 第三方许可文本在场
- **WHEN** 检查随包分发的第三方资源目录
- **THEN** 各自的许可文本原样在场，未因仓库主许可切换而改动
