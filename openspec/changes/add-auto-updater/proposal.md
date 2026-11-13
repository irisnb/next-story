# add-auto-updater 提案

## Why

每次发版都要手动给用户发包或提醒下载（当前用户 ≤5 人，长期预期 ≤100 人），用户需要手动下载、手动安装，容易装出旧版本；发错版本只能逐个通知回滚。需要一个标准化的自动更新通道，把发版成本降为一条命令，把用户升级成本降为几次确认。

方向决议（2026-11-13 与用户讨论拍板，经三方独立审查修订）：托管先用 GitHub Releases（仓库 `irisnb/next-story` 已公开，发布免费）；minisign 更新签名（私钥由用户离线保管）；启动自动检查＋设置页手动检查；全量更新。本变更属用户明确决定的基建事项，在三块拼图之外单独排队，apply 前在行动计划账本记一笔。

## What Changes

- 引入 Tauri 官方更新插件（Rust `tauri-plugin-updater ~2.11.0` + npm `@tauri-apps/plugin-updater 2.11.0`），更新端点指向 GitHub Release 的 `latest.json`。
- 启动自动静默检查：失败静默、无更新静默；**发现新版不弹窗、不抢焦点**，仅在设置页「帮助」入口显示轻量更新标记，用户点击入口才打开更新对话框（写作中不打扰的产品底线）。
- 设置页「帮助」分区新增「检查更新」入口、当前版本号显示与更新状态标记；手动检查设有限等待，失败明确提示「未能连接更新服务，当前版本仍可使用」，MUST NOT 谎报「已是最新」。
- 更新对话框（新概念，视觉语言沿用应用内确认窗）：发现新版（版本号＋更新说明＋立即更新／打开下载页／暂不）→ 下载（进度、可转后台）→ 已就绪（现在重启安装／稍后）。下载与安装分两次用户确认，**绝不后台静默安装，下载完成绝不自动重启**。
- 键盘语义按多状态对话框定义：Enter 激活当前聚焦按钮（非全局确认），Esc 按状态映射（暂不／转后台／稍后）；焦点圈闭与归还。
- 安装前执行与正常退出一致的离开守卫（存在未保存修改时呈现保存／放弃／取消三选，**取消即中止安装、不退出应用**）；守卫通过与准备完成后、安装前，经显式 Rust 停止命令优雅停止 DSH sidecar（复用幂等的 `shutdown_best_effort`；原「更新器 on_before_exit 钩子」方案经实施期实证在插件 2.11.0 不可用，机制等效替换、行为不变）。
- 失败承诺按安装器接管前后划分：检查／下载／验签失败旧安装必然完好（硬保证）；安装阶段失败的恢复路径为稳定名副本手动覆盖安装，须经真机故障验证后如实记录，不作无证据的完好承诺。
- 更新状态（下载中／已就绪）仅本次运行期间保留：退出即释放，下次启动重新检查、重新下载前仍需确认。
- 更新安全：minisign 验签（公钥内置、私钥用户离线保管），验签失败拒绝安装；版本只升不降；更新请求仅指向配置的 GitHub 端点；用户项目数据在项目文件夹，更新 MUST NOT 触碰。
- 版本号单一真相源：`tauri.conf.json` 为唯一手改处；发版脚本发布时同步 `package.json`／`package-lock.json`／`src-tauri/Cargo.toml`／`Cargo.lock`（修复现状 0.1.2／0.1.1／0.1.0 三处分岔），并强制新版本号严格大于上一正式 Release。
- 发版一条命令（两阶段）：准备阶段（gh 前置检查、总门禁、版本严格递增检查、版本同步、绑定明确的 main 提交与标签）＋发布阶段（签名打包 → draft 上传全套 → 逐项核验 → 转正式发布；任一阶段失败给出失败阶段与安全重试指引，正式发布前上一正式 Release 保持 latest）。

**不做（Non-Goals，见 design.md）**：不购买 Windows 代码签名证书（SmartScreen 现状与说明不变）；不做增量／差分更新；不做自动回滚；不做后台静默安装；不做更新状态跨重启保留（本期明确留白为"不保留"，见 design.md）；不做国内对象存储托管（多端点能力留作未来迁移路径，本期单端点）。

**冷启动与验收节奏**：自动更新只对已装"带更新器版本"的用户生效；验收采用两版节奏——0.2.0（首个带更新器、正式发布质量）→ 0.2.1（真实小改），以 0.2.0 为更新验收基线；现有 ≤5 名用户在 0.2.0 验收通过后，由维护者经现有联系渠道通知最后一次手动升级（附版本号与固定下载链接）。

## Capabilities

### New Capabilities

- `auto-update`: 应用内自动更新全流程——启动静默检查与不打扰呈现、手动检查入口、更新提示与双重确认、下载与安装时序、安装前离开守卫与 sidecar 排空、失败兜底（按安装器接管前后划分承诺）、更新安全（验签／固定端点／不降级）、用户数据不受更新影响。

### Modified Capabilities

- `settings-help-section`: 「帮助」分区构成新增「检查更新」入口、当前版本号显示与更新状态标记；相应 DOM 契约与装配行为扩展。
- `dsh-sidecar-lifecycle`: 更新安装触发的进程退出（不经 `RunEvent::Exit`）SHALL 经更新器退出前钩子执行与正常退出同等的 sidecar 清理义务。
- `release-download`: Release 发布物在既有 NSIS／MSI 及稳定名副本基础上，新增更新发布物（`latest.json` 与 `*.sig`）与 draft→核验→正式发布流程；新增发版两阶段一条命令流程与版本号单一真相源要求。

## Impact

- **Rust 后端**：`src-tauri/Cargo.toml`（新增插件依赖）；`src-tauri/src/lib.rs`（注册更新插件＋新增 `stop_driver_for_update` 命令接全局驱动管理器 `shutdown_best_effort`）；`src-tauri/src/dsh_driver.rs` 仅新增幂等测试。
- **前端**：`index.html` 帮助分区（新入口、版本号行、更新标记）与摘要文案；`src/dom.ts`（`HelpSectionDom` 契约扩展）；`src/help-section.ts`（入口、状态文本与标记）；`src/main.ts`（启动静默检查装配、安装前离开守卫接线）；新增更新对话框模块 `src/update-dialog.ts`；`src/ui-v5.css`。
- **配置**：`src-tauri/tauri.conf.json`（`bundle.createUpdaterArtifacts`、`plugins.updater`、NSIS `installMode` 显式钉 `currentUser`）；`src-tauri/capabilities/default.json`（授予 `updater:default`）。CSP 不变（更新请求在 Rust 侧，不经 webview）。
- **工具链**：新增 `scripts/release.mjs`（准备／发布两模式）；一次性对齐三处版本号分岔；`docs/DEVELOPMENT.md` 增补发版流程、私钥保管与用户通知责任。
- **依赖**：`+tauri-plugin-updater ~2.11.0`（Rust）、`+@tauri-apps/plugin-updater 2.11.0`（npm）。钉版原因：最新 2.14.x 要求 tauri ^2.12，与当前 ~2.11.5 冲突；tauri 升 2.12 后随升（同 `single-instance` 锁 2.4.5 先例，挂长期账本）。
- **运维与用户义务**：生成并离线保管 minisign 私钥（密码管理器＋离线备份，丢失即无法再向老用户推更新）；GitHub 账号开启两步验证。
- **归档门槛**：涉及外部网络与安装器行为，apply 后必须真机冒烟（0.2.0 基线 → 0.2.1 真实端到端更新，含失败场景与安装器接管后故障恢复验证），mock 与单测全绿不算完成。
