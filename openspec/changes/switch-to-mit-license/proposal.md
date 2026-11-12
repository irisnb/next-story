## Why

用户拍板将仓库许可从「保留所有权利＋允许使用」调整为标准 MIT 开源（2026-11-12 方向决策）。初心：大大方方给大家用——他人可以自由拿本项目的代码、框架与模式去做别的事情，包括修改、闭源与商业用途；对「别人改完当自己产品」明确表示可以。现行口径（LICENSE、README、`docs/ARCHITECTURE.md`、Release 说明中的「未经书面许可不得复用、修改、再分发」）与该决策直接冲突，且 LICENSE 第四节已预留「若未来调整为开源协议，将在本仓库另行公示」的口子，本 change 兑现该承诺。

## What Changes

- **BREAKING（许可条款层面）**：`LICENSE` 整体替换为标准 MIT 许可证原文（英文通行文本，版权行 `Copyright (c) 2026 irisnb`），不再保留现行《Next Story 版权与使用声明》。
- README「协作与协议」区改为 MIT 口径，徽章排增加 MIT 徽章；用户创作内容归属声明（用户写的文字权利完全属于用户）继续保留。
- `docs/ARCHITECTURE.md` 许可表述从「保留所有权利……不得复用、修改、再分发」改为 MIT 口径。
- Release 说明口径：本 change 归档后的新 Release 如提及许可，一律 MIT；已发布的 v0.1.0 / v0.1.1 不做追溯修改，其副本按原声明继续授权。
- 账本记录：`方向/行动计划-2026-08-27.md` 账本新增一条许可拍板记录（决策＋理由原话）。
- 规格修订：解除 `repo-architecture-doc` 中「许可维持现状、不得作开放许可表述」的限制，改为与 MIT 口径一致。

不改动：`AGENTS.md`、`openspec/` 历史归档、`方向/` 历史讨论记录（历史文档如实保留，不改写）；应用代码、构建与打包流程零改动；依赖不升级不新增（DSH MIT、Basecoat MIT、字体 SIL OFL 均与 MIT 兼容，各自许可文本原样保留）。

## Capabilities

### New Capabilities
- `repo-license`: 仓库许可为标准 MIT——LICENSE 文件形态、四处对外口径一致（LICENSE / README / 架构文档 / Release 说明）、用户内容归属声明在场、已发布版本按旧声明、第三方依赖许可文本保留。

### Modified Capabilities
- `repo-architecture-doc`: 「架构文档事实边界」要求修订——移除「MUST NOT 作出『开放许可』之类的承诺（许可维持现状）」限制；许可表述改为 SHALL 与仓库 MIT 口径一致；「MUST NOT 作出『可复用框架』夸大宣称」等既有事实边界保持不变。

## Impact

- **文件**：`LICENSE`（全文替换）、`README.md`（协作与协议区＋徽章排）、`docs/ARCHITECTURE.md`（一句许可表述）、`方向/行动计划-2026-08-27.md`（账本追加）、新增本 change 规格。
- **对外效果**：GitHub 仓库页许可识别从「Other」变为「MIT」；访客可依 MIT 自由复用、修改、再分发（含商用），仅需保留版权与许可声明。
- **历史版本**：v0.1.0 / v0.1.1 已分发副本按原《Next Story 版权与使用声明》继续有效，不可也不需追溯变更（单向门已在决策时知情确认）。
- **依赖与合规**：无许可冲突——MIT 依赖可随 MIT 仓库分发；SIL OFL 字体文件随包分发时保留其自身许可文本（`public/fonts/LICENSE.txt`），不因仓库改 MIT 而改变。
- **工程门禁**：纯文档级变更，无代码行为变化；无测试断言 README/LICENSE 内容（已核对 tests/ 零引用）；`npm run check` 作为例行卫生确认。
- **范围外**：官网仓库（独立仓库）如含许可表述，发布前人工核对一次并同步 MIT 口径，不进本 change 实施（本仓库不可见其内容）。
