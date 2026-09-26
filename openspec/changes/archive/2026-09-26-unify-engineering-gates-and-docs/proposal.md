## Why

开发前工程复核（2026-09-23）第 10 节排定的最后一项 change，覆盖 F10–F14：标准检查命令与 CI 科目不一致且缺离线验证/格式/静态检查；sidecar 依赖树不在 Dependabot 巡逻范围；打包链缺内置 Node 的下载核验与构建前资源校验；入口文档与代码注释停留在旧状态（README 自相矛盾、规格仍禁止把已实现的按需补读写成事实）；源码含真实 NUL 字节影响搜索与审查。统一不变量：**一条 check 命令＝CI 科目＝文档现实**。

## What Changes

- **统一门禁（F10）**：`npm run check` 确立为唯一标准门禁集合——补入离线协议验证、`cargo fmt --check` 与 clippy；CI 两个平台（Linux 与 Windows）执行同一套门禁，Windows 补齐格式检查与 clippy；`ci-pipeline` 规格升级为「双平台同一完整集合」。
- **依赖巡逻补全（F11）**：Dependabot 增加 `/sidecar` npm 依赖树的周度巡逻；规格明确仓库三个依赖树（根 npm、sidecar npm、cargo）全部纳管。
- **打包链完整性（F12）**：内置 Node 准备脚本增加官方 SHA-256 清单核验与版本断言；新增打包资源校验脚本并接入 Tauri 构建前置（缺资源时中文报错中止，不产出缺件安装包）；README 补全首次安装（sidecar 依赖、内置 Node 准备、明确 Node 版本）与打包步骤。
- **文档现实校正（F13）**：README 修正阶段状态矛盾（按需补读已实现）、数据保存表补充「切换文档前先保存、失败不切换」语义、检查命令说明对齐；`runtime_contract.rs` 把流式/取消/工具调用从「未来」改为已实现并授权的现状；`dsh_sidecar.rs` 头注改述常驻驱动主路径（`bin.js` 为旧一次性路径）；同步解除 `project-readme` 规格中过时的「不得把按需补读写成已实现」禁令。
- **源码卫生（F14）**：`conversation-archive.ts` 的真实 NUL 字节改为可见转义 `\u0000`（运行语义不变）；新增源码 NUL 扫描回归测试防止复发。
- 行为保持：不改产品行为、不改档案格式、不动 F01–F09 已归档修复；本项不含外网验证动作（哈希核验在打包机执行）。

## Capabilities

### New Capabilities

无。本变更修正工程门禁、打包准备与文档事实，不新增产品能力名称。

### Modified Capabilities

- `ci-pipeline`：双平台门禁升级为与 `npm run check` 完全一致的完整集合；Dependabot 明确覆盖根 npm、sidecar npm 与 cargo 三个依赖树。
- `project-readme`：解除过时的按需补读禁令并纳入已实现能力；安装步骤补充 sidecar 依赖与内置 Node 运行时准备；数据流补充切换文档先保存语义；标准检查命令说明与 CI 对齐。
- `dsh-sidecar-lifecycle`：内置 Node 运行时按锁定版本与官方校验和准备；打包构建前资源校验齐备方可继续；发布产物不依赖用户 PATH。

## Impact

- 配置与脚本：`package.json`、`.github/workflows/ci.yml`、`.github/dependabot.yml`、`src-tauri/tauri.conf.json`、`scripts/vendor-node.ps1`、新增 `scripts/check-package-resources.mjs`。
- 文档与注释：`README.md`、`src-tauri/src/runtime_contract.rs`（注释）、`src-tauri/src/dsh_sidecar.rs`（头注与回退说明注释）。
- 源码与测试：`src/conversation-archive.ts`（空字节转义）、新增源码卫生回归测试。
- 兼容性：全部为门禁/脚本/文档/注释与等价转义，不改变产品行为；CI 时长增加（Windows 补 fmt/clippy），CI 仍不产出安装包。
- 不涉及：产品功能与界面；F12 的「干净 Windows 安装包验收」在 Change 5 结束后的统一真机测试轮执行；AGENTS.md 与方向文档不在本项范围。
