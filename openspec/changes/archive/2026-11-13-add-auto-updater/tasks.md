# add-auto-updater 任务清单

## 1. 密钥、依赖与配置基线

- [x] 1.1 生成 minisign 更新密钥对（`npm run tauri signer generate`）；公钥写入 `tauri.conf.json`；私钥与密码交用户离线保管，并附一页中文保管说明（丢失＝无法再向老用户推更新，不可找回）——密钥已生成于 `C:\Users\Administrator\.tauri\`，保管说明见 `docs/updater-key-custody.md`；公钥写入随 1.3 完成
- [x] 1.2 添加依赖：`src-tauri/Cargo.toml` 加 `tauri-plugin-updater ~2.11.0`；`package.json` 加 `@tauri-apps/plugin-updater 2.11.0`；在 Cargo.toml 注释钉版原因与随升条件（同 `single-instance` 先例）
- [x] 1.3 `src-tauri/tauri.conf.json`：`bundle.createUpdaterArtifacts: true`；`plugins.updater`（pubkey、endpoints 指向 `releases/latest/download/latest.json`、`windows.installMode` 保持默认 passive）；`bundle.windows.nsis.installMode` 显式钉 `currentUser` 并注释「永不更改」（纪律记录于 design.md D7）
- [x] 1.4 `src-tauri/capabilities/default.json` 授予 `updater:default`（实际使用才授予，符合 `tauri-security-baseline`）
- [x] 1.5 一次性对齐版本号分岔：`package-lock.json`（0.1.1）、`src-tauri/Cargo.toml`＋`Cargo.lock`（0.1.0）对齐至 `tauri.conf.json` 的 0.1.2（六处核对一致）
- [x] 1.6 在 `方向/行动计划-2026-08-27.md` 账本记录方向拍板（三块拼图外新增基建条目、0.2.0→0.2.1 两版验收节奏），apply 前落地——顶部 2026-11-13 更新注记＋路线总览事项 14＋账本第 26 条已落

## 2. Rust 侧：插件注册与 sidecar 停止

- [x] 2.1 `src-tauri/src/lib.rs` 注册更新插件（最小形态 `Builder::new().build()`——实证 2.11.0 无 `init()`；读配置、无钩子）＋新增 `stop_driver_for_update` 命令（async＋spawn_blocking，调 `global_driver_manager().shutdown_best_effort()`，幂等、不触发崩溃恢复通知）并在 invoke_handler 注册；前端经 project-api 包装 `stopDriverForUpdate`，安装序列 `prepare → stopDriver → install` 顺序测试钉死。（原「on_before_exit 钩子」方案经实施期实证在插件 2.11.0 不可用，机制等效替换见 design.md D5 修正）
- [x] 2.2 Rust 单测：钩子清理幂等（无存活代时 no-op 不 panic；双调用无害）——`shutdown_best_effort_without_live_generation_is_noop`＋`shutdown_best_effort_double_invocation_is_harmless`（dsh_driver.rs 测试模块新增，全量 Rust 套件零回归）

## 3. 前端：更新对话框模块

- [x] 3.1 新建 `src/update-dialog.ts`：状态机（检查中／已是最新／失败／发现新版／下载中／已就绪），仅经入口点击或手动检查打开，MUST NOT 自动弹出
- [x] 3.2 接入 `@tauri-apps/plugin-updater` JS API：check、download（进度回调：有总大小显示百分比、否则不确定进度）、install；模块内存单例持有 Update 对象（仅本次运行期间有效，随进程销毁）
- [x] 3.3 下载转后台（关闭对话框继续下载、完成不抢焦点）与「稍后」再入：帮助分区入口状态联动（下载中／已就绪「重启安装更新」／有更新标记），「稍后」提示「本次打开软件期间可随时安装；关闭软件后需重新下载」
- [x] 3.4 键盘与可访问性：Enter 激活当前聚焦按钮（非全局确认）、Esc 按状态映射（暂不／转后台／稍后／关闭）、Tab 焦点圈闭、可访问名称、关闭后焦点归还
- [x] 3.5 安装前离开守卫：「现在重启安装」后复用既有 CloseCoordinator 离开守卫路径（close-guard.ts 抽取 `runLeaveGuard`，行为逐字等价；脏文档三选一；取消＝中止安装不退出）；准备期间锁定（`inert`＋排空保存＋重复触发忽略）；准备失败中止并恢复正常、保留就绪状态
- [x] 3.6 `src/ui-v5.css` 增补更新对话框样式（沿用 `.app-confirm` 视觉语言：居中模态、128×40 按钮；更新说明限高滚动不截断）
- [x] 3.7 前端单测（tests/update-dialog.test.ts，23 用例）：状态机全部转换、Enter 聚焦语义、Esc 状态映射、守卫取消中止、准备失败恢复、状态不跨重启语义、下载失败重试、转后台完成不弹窗

## 4. 前端：帮助分区入口与版本号

- [x] 4.1 `index.html` 帮助分区新增「检查更新」按钮（`p.form-help`＋`btn-secondary` 既有模式）、当前版本号显示行与更新标记（`#help-update-badge` summary 层小标）；抽屉摘要文案更新为包含「查看版本、检查更新」
- [x] 4.2 `src/dom.ts` 扩展 `HelpSectionDom` 契约（checkUpdateBtn/updateStatus/versionText/updateBadge）并绑定新元素（沿用 `requireElement` 显式契约）
- [x] 4.3 `src/help-section.ts` 接线检查更新回调与状态文本（`setupHelpUpdateEntry` 受控视图：renderVersion/setUpdateView）；`src/main.ts` 装配
- [x] 4.4 前端单测（tests/help-update-entry.test.ts，8 用例）：入口回调、版本号渲染、更新标记呈现、状态文本联动

## 5. 前端：启动静默检查

- [x] 5.1 `src/main.ts` 启动后静默检查：失败静默、无更新静默、发现新版仅设置帮助入口更新标记（不弹窗、不移动焦点、不覆盖首启引导）
- [x] 5.2 前端单测：三种启动检查结果路径、发现新版只标记不弹窗、首启引导在场不冲突（并入 tests/update-dialog.test.ts）

## 6. 发版脚本与文档

- [x] 6.1 新建 `scripts/release.mjs` 两模式（998 行，全可注入）：准备模式（前置断言含 gh 登录与权限、上一正式 Release 识别含首次发布分支、总门禁、版本严格递增检查、六处版本同步、打包准备检查、打印提交指引，零 git 写操作）与发布模式（标签绑定校验、交互更新说明 1–5 条带预览、私钥密码仅环境变量传递、构建签名、`latest.json` 生成、稳定名副本、draft 上传全套、逐项核验、转正式发布、失败保留 draft 可安全重试）；package.json 加 `release` 脚本
- [x] 6.2 脚本测试（tests/release-script.test.ts，34 用例全绿、零真实副作用）：两模式流程、`latest.json` fixture、semver 严格大于、gh 四分类、版本同步补丁、draft 附件核验、首次发布、私钥不落盘
- [x] 6.3 `docs/DEVELOPMENT.md` 增补：两阶段发版流程（含维护者提交步骤与 9 行失败恢复表）、私钥保管引用、≤5 用户最后一次手动升级通知模板、安装阶段故障恢复占位（7.3 后回填）

## 7. 门禁、真机验收与归档

- [x] 7.1 `npm run check` 总门禁全绿（typecheck→lint→前端/可靠性/驱动/校验测试→build→fmt→clippy→Rust 全量测试，链式全过；doc-tests 单独复验通过）
- [x] 7.2 真机冒烟 A（归档硬门槛，0.2.0 基线 → 0.2.1 两版节奏）：**通过**——启动仅标记不弹窗不抢焦点（CDP 断言）；用户全程真实操作（对话框/下载转后台/三选一取消/保存离开/安装/自动重启/数据完好，检查点自报全过）；终态机器断言（注册表＋exe＝0.2.1、安装器自动重启、安装目录无 sidecar 残留）。详见 `verification/验收记录-2026-11-13.md`
- [x] 7.3 真机冒烟 B：**通过（一项如实记录为尝试未命中）**——断网启动零提示/断网检查文案与按钮逐字合规/网络恢复重试直达发现新版/下载就绪文案合规/安装自动重启（全部 CDP 驱动断言）；故障注入未命中（安装器随机临时名＋NVMe 秒级完成，按名猎杀 30 秒无目标）；恢复路径经三次真实覆盖安装证明；`docs/DEVELOPMENT.md` 已回填
- [x] 7.4 回归：**通过**——①稳定名覆盖安装（用户手动实证＋基线复原两次）；②无更新启动零提示（CDP 断言：标记 hidden、零弹窗、版本如实）；③状态不跨重启（下载中退出实测：0.2.0 完好、零进程零安装器残留）
- [ ] 7.5 归档（openspec archive）；长期账本挂账：tauri 升 2.12 时 updater 随升与 NSIS 关进程机制（Restart Manager）重测；插件级 on_before_exit 钩子可用性复查（design.md D5 备选方案）
