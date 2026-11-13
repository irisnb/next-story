# add-auto-updater 设计

## Context

- **痛点与方向**：手动发包不可持续（用户 ≤5 → 长期 ≤100）。2026-11-13 与用户拍板：GitHub Releases 托管（仓库 `irisnb/next-story` 已公开、免费、匿名可拉取）；minisign 更新签名（私钥用户离线保管）；启动自动检查＋设置页手动检查；全量更新。本设计经 oracle／councillor-alpha／councillor-beta 三方独立只读审查后修订（审查记录要点：启动不得弹模态窗打断写作；验收基线须为带更新器的版本；发版须两阶段可恢复；失败承诺按安装器接管前后划分）。
- **现状事实**：
  - 代码中无任何更新机制；UI 无版本号显示（全 src 无 `getVersion` 引用）。
  - 版本号三处分岔：`tauri.conf.json` 0.1.2（说了算）／`package.json` 0.1.2（`package-lock.json` 滞留 0.1.1）／`Cargo.toml`+`Cargo.lock` 0.1.0。
  - DSH sidecar 由 Rust 宿主经 `std::process` 直管（`src-tauri/src/dsh_driver.rs`）；退出清理走 `RunEvent::Exit → shutdown_best_effort()`（`src-tauri/src/ai_host.rs:156-164`）。`shutdown_best_effort()`（dsh_driver.rs:1192-1197）同步、幂等（take 语义，无当前代时 no-op）。
  - **正常退出不是无条件保存**：`src/main.ts:172-190` 经 CloseCoordinator 守卫，存在脏文档时弹三选一（保存并离开／放弃修改并离开／取消），取消中止退出（`src/leave-dialog.ts`、`src/close-guard.ts`）。安装前准备必须复刻这一守卫而非"静默强存"。
  - 设置页三抽屉在 `index.html:530-604`；帮助分区已有「`p.form-help` 说明＋`btn-secondary` 按钮」模式；DOM 契约 `HelpSectionDom`（`src/dom.ts:240-246`），装配 `setupHelpSection`（`src/help-section.ts:42-50`，调用点 `src/main.ts:164`）。
  - 应用内确认窗 `confirmInApp`（`src/app-confirm.ts`）：模态 `<dialog>`、128×40 按钮、Enter/Esc 语义为**两按钮确认窗**设计（Enter 映射确认钮）；多状态对话框不能照搬。
  - CSP 全禁外部网络、前端除 IPC 外零 HTTP 调用；Tauri 更新器请求走 Rust 侧 reqwest，CSP 无需改动。
  - 权限按「实际使用才授予」纪律管理（`tauri-security-baseline`）。
  - 既有 `release-download` 规格：NSIS 主推＋MSI 备选＋稳定名副本（`NextStory-setup.exe`/`.msi`）、对外入口只用 `releases/latest` 固定链接、发布物必须出自对应 main 提交、官网与 Release 说明含 SmartScreen 指引。
- **官方行为核实结论**（librarian 报告，2026-11-13）：`endpoints` 支持数组顺序容错；v2 更新产物就是 `-setup.exe` 本体＋`.sig`；Windows 上插件以 `std::process::exit(0)` 退出应用、由 NSIS `/R` 参数自动重启，前端 `relaunch()` 不适用；**安装器只杀主程序、不杀子进程**，官方唯一出口是 Rust 侧 `on_before_exit` 钩子；`latest.json` 无官方生成命令；版本比较为严格大于的 SemVer；draft/prerelease 不进 `releases/latest`。

## Goals / Non-Goals

**Goals:**

- 用户端：打开软件即知有新版（入口标记，不打扰写作）；下载与安装时机都由用户确认；失败有重试与手动下载兜底；更新不碰用户数据、数据状态不劣于正常退出重启。
- 发布端：一条命令两阶段发版（准备：检查＋版本＋提交绑定；发布：签名打包＋draft 核验＋正式发布），失败可恢复重试；版本号单一真相源；私钥离线保管、不落盘。
- 安全端：更新包必须验签通过才安装；更新请求仅指向配置端点；不降级。

**Non-Goals:**

- 不购买 Windows 代码签名证书（SmartScreen 警告现状不变，官网与 Release 说明已有指引）。
- 不做增量／差分更新（安装包约百 MB、用户 ≤100，全量替换成本可忽略；sidecar＋Node 运行时永远同版反而是优点）。
- 不做自动回滚（坏版本补救＝用旧代码发更高版本号）。
- 不做后台静默安装（永远用户确认、用户挑时机）。
- 不做更新状态跨重启保留（见 D12，本期明确"不保留"而非留白）。
- 不做下载中途取消（下载便宜，不引入中止复杂度；用户可转后台或等它失败）。
- 不做国内对象存储托管（v1 单 GitHub 端点；`endpoints` 数组能力留作未来"清单在 GitHub、下载指新家"的迁移路径）。

## Decisions

### D1 官方插件＋版本钉法

用 `tauri-plugin-updater`（Rust `~2.11.0`）＋ `@tauri-apps/plugin-updater`（npm `2.11.0`）。官方标准件，不发明轮子。钉 2.11.0 因最新 2.14.x 要求 tauri ^2.12，与当前 `~2.11.5` 冲突；与 `single-instance` 锁 2.4.5 同一先例，tauri 升 2.12 后随升并挂长期账本。**注意**：NSIS 安装器"关闭应用"机制随 CLI 版本变化（2.11 按进程名找杀主 exe；2.12+ 改 Restart Manager），升级 CLI 时必须重测真机更新。

### D2 托管与端点

单一端点：`https://github.com/irisnb/next-story/releases/latest/download/latest.json`。仓库已公开，匿名可拉取。国内可达性风险已知（下载本体走 objects.githubusercontent.com 可能抽风），以重试＋打开下载页兜底；兜底页与更新源同属 GitHub，极端情况下退回今天的手动发包方式（维护者经现有联系渠道直发安装包），不会更糟；未来迁移时把清单内下载 URL 指向新家即可。

### D3 前端直用官方 JS API，不包装 Rust 命令

检查／下载／安装由前端调 `@tauri-apps/plugin-updater` JS API（内置进度回调），`capabilities/default.json` 授予 `updater:default`。官方路径、代码量最小、进度事件免造轮子；权限符合"实际使用才授予"基线（与 dialog 权限同型）。

### D4 更新对话框：入口驱动、不抢焦点、键盘语义按状态定义

新增 `src/update-dialog.ts`（概念名：**应用内更新对话框**）。**启动检查发现新版时 MUST NOT 自动打开任何模态窗或移动焦点**——仅在设置页帮助入口显示轻量更新标记（含首启引导在场的情形，标记不覆盖引导）；对话框只经用户点击入口或手动检查打开。多状态对话框不照搬确认窗的两按钮 Enter 全局确认语义：

```
[检查中]（仅手动入口；有限等待）
   ├─ 无新版 ──→ [已是最新]
   ├─ 失败 ────→ [失败]「未能连接更新服务，当前版本仍可使用」
   └─ 有新版 ──→ [发现新版] 版本号＋更新说明＋[立即更新][打开下载页][暂不]
                    ├─ 暂不/Esc → 关闭（入口标记持续显示直到更新）
                    └─ 立即更新 → [下载中] 进度（有总大小时百分比，否则不确定进度）
                        │          允许关闭对话框＝转后台继续（Esc 同义）
                        ├─ 失败 → [失败] [重试][打开下载页]
                        └─ 完成 → [已就绪] [现在重启安装][稍后]
                                     ├─ 稍后/Esc → 对话框收起，入口变「重启安装更新」
                                     └─ 现在重启安装 → 离开守卫（D6）→ 安装 → 自动退出重启
```

键盘与可访问性：Enter 激活**当前聚焦按钮**（MUST NOT 全局映射到"立即更新"）；Esc 按状态映射（发现新版＝暂不、下载中＝转后台、已就绪＝稍后、检查中＝关闭）；Tab 焦点圈闭于对话框；对话框有可访问名称；关闭后焦点归还触发元素。概念边界：更新对话框是多状态任务流程，**不属于** `in-app-confirmation` 的确认点统一覆盖范畴，但视觉语言（居中模态、128×40 按钮）与其一致。

### D5 sidecar 停止：安装前显式停止命令（原「on_before_exit 钩子」方案经实施期实证修正）

实施期源码实证（2026-11-13）：钉定的插件 2.11.0 的插件级 `Builder` 没有 `on_before_exit`（E0599 编译实证；该钩子只存在于 `UpdaterBuilder`，且 JS 命令路径经 `UpdaterExt::updater_builder()` 无条件装入默认钩子 `app_handle.cleanup_before_exit()`，Rust 侧任何注册形式都无法替换）——D3（前端直用 JS API）与钩子方案在 2.11.0 上不可兼得。修正为等效方案：插件以最小形态 `Builder::new().build()` 注册（实证：2.11.0 连 `init()` 都不提供，`Builder::new().build()` 即官方最小注册，setup 内读 tauri.conf.json 配置、不带任何自定义钩子）；前端在离开守卫通过、准备完成后、调用 `update.apply()` 之前，先经新增 Rust 命令 `stop_driver_for_update` 显式执行 `global_driver_manager().shutdown_best_effort()`（优雅 3 秒→强杀，幂等）；sidecar 已停止，安装器换文件无占用。`apply()` 失败时驱动按既有懒启动语义在下次 AI 请求自动重生，无损失。正常退出的 `RunEvent::Exit` 清理不变（两条路径调同一幂等函数，先后触发无害）。备选方案：升级 tauri 2.12+ 换插件 2.14（可能提供插件级钩子）或自定义 Rust 安装命令走 `UpdaterBuilder` 钩子（需二次下载）——均记长期账本，不在本 change。

### D6 安装前离开守卫：复刻三选一，取消即中止

「现在重启安装」确认后，前端 SHALL 走与正常退出**相同的离开守卫流程**（复用 CloseCoordinator 路径而非另造）：存在脏文档时呈现同样的保存／放弃／取消三选；**用户取消 SHALL 中止安装且不退出应用**，编辑内容与更新就绪状态保留。守卫通过、准备开始后：阻止产生新的未保存修改与重复触发安装（防双击、防状态漂移）；准备失败（如保存出错）SHALL 中止安装、恢复正常操作并保留就绪状态。顺序固定：**离开守卫（含保存）→ 前端准备完成 → 触发安装 → 插件拉起安装器前 `on_before_exit` 停 sidecar → `std::process::exit(0)` → NSIS 安装并以 `/R` 自动重启**。原则：更新重启后的数据状态不劣于正常退出重启（有未保存修改且用户选放弃时，与用户主动放弃离开等价，不算劣化）。

### D7 NSIS installMode 显式钉 `currentUser` 并永不更改

当前默认即 `currentUser`（装 `%LOCALAPPDATA%`、HKCU）。显式写入配置并作为纪律：中途切换会改变安装目录与注册表位置，造成双份安装／更新错位（机制推断，无切换需求）。

### D8 全量更新、不增量、不自动回滚

见 Non-Goals。坏版本补救＝用旧代码发更高版本号（更新器只认严格更大）。

### D9 版本号单一真相源

`tauri.conf.json` 的 `version` 为唯一手改处（Tauri 运行时 `package_info` 的版本即来源于配置；它已是应用对外版本现行来源）。发版脚本在准备阶段同步其余四处（`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`）并校验一致；一次性任务先对齐现状分岔（→ 统一 0.1.2，发版时统一升版）。全项目统一用语「版本号单一真相源」。

### D10 发版两阶段一条命令：`scripts/release.mjs`

**准备阶段（`--prepare`）**：
① 前置断言（工作区干净、当前分支为 main、gh 已安装且已登录且对目标仓库有发布权限）→ ② 识别上一正式 Release：不存在＝**首次发布**分支（合法）；网络／认证／API 失败 MUST 与「不存在」区分，中文报错并说明修复方法，MUST NOT 把失败当作没有上一版 → ③ 跑 `npm run check` 总门禁 → ④ 读 `tauri.conf.json` 版本号比对上一正式 Release tag，**必须严格更大否则中文报错中止** → ⑤ 同步四处版本号 → ⑥ 完整打包准备检查（vendor-node、sidecar 安装等既有步骤齐备）→ ⑦ **打印应提交的文件清单，由维护者提交至 main 并打标签**（发布物与源码一致性由既有 `release-download` 规格约束；脚本不代替维护者做 git 提交，小白看得见每一步）。

**发布阶段（`--publish`）**：
⑧ 校验工作区干净、当前提交即准备阶段绑定的提交、标签存在 → ⑨ 交互输入中文更新说明（建议 1–5 条、每条一句话说用户可感知的变化，附示例与预览确认）与私钥密码（仅环境变量／标准输入传递，不落盘、不回显）→ ⑩ `tauri build`（已配 `createUpdaterArtifacts`，产出 `-setup.exe`＋`.sig`）→ ⑪ 从 `.sig` 生成 `latest.json`（`platforms."windows-x86_64"`、`signature`＝`.sig` 内容原文、`url`＝带 tag 的版本化产物直链、`pub_date` RFC 3339）→ ⑫ **创建 draft Release 并上传全套发布物**（版本化 NSIS＋`.sig`＋`latest.json`＋稳定名副本 NSIS/MSI；Release 正文＝更新说明＋既有 SmartScreen 指引）→ ⑬ 逐项核验（附件齐、清单版本与 tag 一致、签名与安装包对应、`latest.json` 可下载可解析）→ ⑭ **核验全过后由 draft 转正式发布**。正式发布前，上一正式 Release 始终是 `latest`，部分上传失败不污染更新渠道。
**任一阶段失败**：打印失败阶段、已完成步骤与安全重试指引；发布阶段失败保留 draft 供恢复重试；MUST NOT 以重试替换已公开发布版本的产物内容。

### D11 不买代码签名证书

SmartScreen 警告与今天手动发包时完全一致，不是更新功能引入的新债；官网与 Release 说明已按既有规格提供指引。将来用户量级或投诉变化时再单独决策（挂账本，不在本 change）。

### D12 更新状态不跨重启保留

下载中／已就绪状态仅在本次运行期间有效：应用退出即结束下载并释放待安装内容（内存中的 Update 对象随进程销毁）；下次启动重新检查，重新下载前仍需用户确认。「稍后」时对话框与帮助入口 SHALL 明示「本次打开软件期间可随时安装；关闭软件后需重新下载」。本期不做跨重启缓存（若未来要做，需另行定义缓存位置、校验与清理规则，另开 change）。

## Risks / Trade-offs

- [GitHub 国内下载抽风（objects.githubusercontent.com 不稳；下载页兜底与之同源）] → 重试按钮＋打开下载页；极端情况回退手动发包（维护者直发安装包），不会更糟；未来可经 `endpoints`／清单内 URL 无感迁移。
- [私钥丢失＝永远无法向已装用户推更新；泄露＋GitHub 账号同时失守＝可推恶意更新] → 用户离线双备份（密码管理器＋离线介质）；GitHub 开两步验证；私钥密码不落盘。
- [发出版本起不来（无自动回滚）] → 发布前总门禁＋真机冒烟为硬门槛；补救＝旧代码发更高版本号。
- [`std::process::exit(0)` 绕过正常退出路径] → D6 离开守卫复刻＋准备期锁定；真机验收断言更新重启后讨论与文档状态不劣于正常退出重启。
- [安装器接管后（安装阶段）失败无官方恢复保证] → 承诺拆分：接管前失败旧安装必然完好；接管后恢复路径＝稳定名副本手动覆盖安装，**经真机故障注入验证后如实记录恢复方式**，不作未经验证的完好承诺。
- [sidecar 未停导致文件占用、安装失败] → D5 钩子＋幂等双保险；真机验收断言 sidecar 退出无残留。
- [`gh release create` 非原子，部分上传产生窗口期] → D10 draft→逐项核验→转正式；正式发布前上一正式版保持 latest。
- [发版中途失败的中间态] → 两阶段设计＋失败阶段报告＋安全重试指引；版本同步产物在准备阶段提交入库，发布阶段从干净工作区构建。
- [忘升版本号导致用户收不到更新] → 脚本严格递增检查（D10 ④）。
- [draft/prerelease 不进 `releases/latest`] → 发版流程以 draft 为发布准备、核验后转正式；更新渠道只认正式版。
- [CLI 升级改变安装器关进程机制] → D1 版本钉法＋升级时重测（挂长期账本）。
- [冷启动] → 现有 ≤5 用户在 0.2.0 验收通过后手动安装一次（维护者经现有渠道通知：版本号＋固定下载链接＋GitHub 不可达时直接发安装包）。
- [更新打断写作] → 设计红线：启动只标记不弹窗；下载与安装分两次确认；可转后台、可稍后；绝不静默装、绝不自动重启。

## Migration Plan

1. 实施首日生成 minisign 密钥对（`tauri signer generate`），公钥入 `tauri.conf.json`，私钥交用户离线保管（附保管与"丢失不可找回"后果的一页中文说明）。
2. 一次性对齐版本号分岔至 0.1.2（仅仓库内记账文件，不影响用户）。
3. **两版验收节奏**：发布 0.2.0（首个带更新器、正式发布质量）作为验收基线；再做一处真实小改发布 0.2.1；真机以 0.2.0 → 0.2.1 完成真实端到端更新验收。两版都必须满足正式交付质量，不为测试占用 `latest`。
4. 现有用户通知：验收通过后由维护者经现有联系渠道发送最后一次手动升级说明（版本号、`releases/latest/download/NextStory-setup.exe` 固定链接、SmartScreen 提示、GitHub 不可达时的替代方式）。
5. 回滚策略：无数据迁移、无配置迁移；用户侧任何时候可通过手动下载稳定名副本覆盖安装。

## Open Questions

（无阻塞项。实施期小决策，不改变本设计：下载进度是否显示速度与剩余时间——默认只显示百分比；更新说明显示区域限高滚动，不截断内容。）
