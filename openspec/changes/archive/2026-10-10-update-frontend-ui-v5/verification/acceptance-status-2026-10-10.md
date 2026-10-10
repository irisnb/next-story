# update-frontend-ui-v5 验收状态审计（2026-10-10）

范围：仅本 change。本文件逐条审计 `tasks.md` 1.3~7.9 是否有**完整实证**可勾；无完整证据者保持未勾。**本审计勾选 1.3、1.4、3.1、3.2、3.6、6.1、6.3**（清单/纯实施/资源核验，无真机/用户门槛）；其余已勾 1.1/1.2/2.1/6.2/7.1/7.7 维持，见 §2。未改源码/规格/方向/AGENTS，未 Git/archive，未运行安装器，未发真实模型，未启用全局链路，未读正文/secret。owned debug `next-story.exe`（PID 28820 等，及更早 25588/32224）均已按 owner 记录核验后优雅关闭；当前无 `next-story` 进程、exe 未锁定。

依据记录（相对 `openspec/changes/update-frontend-ui-v5/`）：
`implementation-record.md`（IR）、`verification/final-check-buildrs-icon-rerun-2026-10-10.md`（FC）、`verification/v5-bounded-final-2026-10-10.md`（VBF）、`verification/v5-bounded-observer-fix-2026-10-10.md`（VBO）、`verification/making-unbound-2026-10-10.md`（MU）、`verification/ui-smoke-report.md`（US），及截图证据目录 `verification/v5-parity-pages-screens/`、`v5-parity-screens/`、`v5-menu-screens/`、`v5-native-graph-screens/`、`v5-reference-screens/`、`ui-screens/`（各含 `evidence.json`），测试 `tests/ai-single-projection.test.ts`、`tests/ai-runtime-independence.test.ts`、`tests/ai-reading-authorization-race.test.ts`、`tests/ui-v5.test.ts`、`tests/editor-toolbar.test.ts`、`tests/file-management.test.ts`、`tests/making-module.test.ts`、`tests/making-conversation.test.ts`、`tests/dom-contract.test.ts`、`tests/editor-layout-style.test.ts`、`tests/llm-config-form.test.ts`、`tests/recent-works.test.ts`、`tests/workspace-project-flow.test.ts`。

## 0. 更正（2026-10-10）

本文件初版误记「原生缩放未驱动 WebView」（见 1.3 / 3.8 / 7.2 行）。依据 `verification/v5-bounded-final-2026-10-10.md`：根因是旧验收脚本取错 HWND——命中单实例通信窗口 `com.nextstory.desktop-sic`（HWND 2102734），而非真实 `Tauri Window`（HWND 3348336，同 PID）。修正脚本枚举真实 Tauri 顶层 root 后，三档原生客户区 1024×670／1280×720／1440×900 与 WRY/页面视口一致，最大化/恢复通过。相应行已更正；`implementation-record.md` §92/§134 已附同源更正（保留原时态）。

## 1. 结论

- 本轮新增勾选：**1 项**——1.4（命名合同已 resolve；22 delta 无重复/矛盾；全规格/迁移自动部分已完成；单投影/职责迁移/摘要已同步，见 §6/§7、`final-name-reconcile-2026-10-10.md`）；连同此前 1.3/3.6/3.1/3.2/6.1/6.3，合计 **13/38**。其余混合真机/用户/真实数据项保持未勾，逐条给出精确缺口，不笼统写「用户缺」。
- 已有勾选维持：1.1、1.2、2.1、6.2、7.1、7.7。
- 全程未把「代码已存在」或「历史旧绿（旧全量 1346/1347/1358 等）」当作完成依据；仅采用最新证据。

## 2. 已勾项与最新证据

| 任务 | 证据 |
| --- | --- |
| 1.1 批准记录 | `implementation-record.md`（2026-10-09 用户批准原话） |
| 1.2 术语统一（项目/文档管理/制作） | `implementation-record.md`、`AGENTS.md`、`README.md`、`方向/核心方向宪章.md`、`方向/第一版方向共识-2026-07-01.md`（同步项；代码/存储名不改） |
| 2.1 Basecoat 离线+MIT | `FC`、`package-check*.log`；`scripts/check-package-resources.mjs` 校验；`dist/vendor/basecoat-css/` |
| 6.2 图标 8 帧接入 | `FC`：`icon.ico` 8 帧 `16/20/24/32/48/64/128/256`；EXE+NSIS+MSI 逐字节/帧核验 |
| 7.1 `npm run check` | `FC`：前端 1362/1362、可靠性 121、驱动 33、离线 78、Rust 510 通过/1 ignored，fmt/clippy 无告警 |
| 7.7 依赖准备+资源检查+打包 | `FC`：`npm ci --prefix sidecar`、`vendor-node.ps1`、`package:check`、`tauri:build` 依序 exit 0；产物哈希见 FC |
| 3.6 替换旧多窗口测试+回归 | `verification/ai-panel-state-single-panel-2026-10-10.md`：删旧 `set_window_placement`(3)/`reset_layout`(2)/非法 `close_window`(1) 共 6 项，`focus_window`→`select_discussion`、`close_window`→`close`；新增身份投影/运行时独立/授权竞态回归；定向 271/271、`test:frontend` 1356/1356、typecheck/lint/build exit 0 |
| 3.1 单当前投影+清除旧几何+DOM 契约 | `ai-panel-state-single-panel`/`ui-cleanup-final`：state 删除 `windows` 存储与 `focus_window`/`close_window`/`set_window_placement`/`reset_layout`，getter 改名派生 `openDiscussionIds`；`index.html` 删 `i-float/i-grip/i-dock/i-sbs`；`src/` 旧几何 token 零命中；终态全门禁绿 |
| 3.2 隐藏/切换与停止分离+运行期草稿/滚动/关闭收列 | `tests/ai-single-projection.test.ts`：仅当前讨论挂载而后台生成存活、切走再回恢复未发送草稿、最大化保持投影且关闭复位显示、键盘调宽仅改宽度、切换讨论恢复阅读位置；全门禁（1358）绿 |
| 6.1 发送彩蛋字节/比例/禁用/focus/功能名 | `verification/ui-cleanup-final-2026-10-10.md` 6.1 节 + `tests/ui-send-mark.test.ts`：原字节 SHA256 `b8296fa1…`、988×789、alpha 0–255、按钮 72×32、图案 28×22.3594、aspect-ratio 988/789、功能名（`发送`/`提问`）、禁用/启用/focus-visible 2px |
| 1.3 迁移清单+三尺寸基线 | `verification/migration-matrix-final-2026-10-10.md`（11 入口真实 handler+tests）；三尺寸真实基线 `v5-bounded-final-2026-10-10.md`（1024/1280/1440 client==viewport） |
| 6.3 清理+入口真实可达 | `migration-matrix-final-2026-10-10.md`；`src`/`index.html` 演示数据 0、旧几何 token 0、旧 sprite id 0；入口真实 handler 接线（非演示）；`ai-window`/divider 为 live 保留 |
| 1.4 22 delta核对+迁移+摘要+查漏 | `final-name-reconcile-2026-10-10.md`（命名合同 resolve，§6）；22 份 delta `openspec validate --strict` valid 且无重复/矛盾；单投影/职责迁移见 `ai-panel-state-single-panel`、`ui-cleanup-final`；AGENTS/README 摘要已同步 |

## 3. 逐条审计（1.3~7.9）

| 任务 | 状态 | 已实现/已验证 | 剩余精确缺口（保持未勾原因） |
| --- | --- | --- | --- |
| 1.3 迁移清单+三尺寸基线 | **已勾** | `verification/migration-matrix-final-2026-10-10.md`：11 入口逐项真实 handler+tests；格式工具/高级参数/制作试问/权限/保存保护均有测试；三尺寸真实基线 `v5-bounded-final`（1024/1280/1440 client==viewport） | — |
| 1.4 22 delta 核对+实施+摘要+查漏 | **已勾** | 22 份 delta/spec 无重复 requirement/矛盾合同（`validate --strict` valid）；单投影/选区召唤/按身份读档/有效运行态重开与 `ai-dock`/`ai-window` 职责迁移完成（`ai-panel-state-single-panel`、`ui-cleanup-final`）；AGENTS/README 摘要已同步；全规格/迁移自动部分完成；命名合同 §6 resolve | — |
| 2.2 v5 令牌/组件状态 | 未勾 | `src/ui-v5.css`、`tests/ui-v5.test.ts`、同位截图 | 未提供完整「默认/hover/active/focus-visible/disabled/busy/error + 减少动态」状态矩阵；视觉未验收 |
| 2.3 单中文提示+生命周期+长名 title | 未勾 | `src/ui-v5.ts`；`tests/ui-v5.test.ts` | 原生 hover/focus 单提示与长名 title 的真机视觉未验收（US、VBO） |
| 2.4 首页真实入口+空/错误 | 未勾 | IR §34（最近三项、返回/文件夹图标）；`tests/recent-works.test.ts` | 真实创建/文件框/路径检查/缺失失败流程未真机验收（仅表单位置替代） |
| 2.5 三列顶栏+四页顺序+长名+保存状态+离开保护 | 未勾 | `v5-parity-pages-screens/`（四页×三尺寸）、`tests/dom-contract.test.ts` | 长名不碰撞、保存状态真实性、离页保护的真机/视觉未验收 |
| 3.1 单当前投影+DOM 契约+移除浮动入口 | **已勾** | state 删 `windows` 存储与旧几何事件；getter 改名派生 `openDiscussionIds`；`index.html` 删旧 sprite；`src/` 旧几何 token 0 命中；`tests/ai-single-projection`/`ai-panel-dom-contract` 绿 | — |
| 3.2 隐藏/切换与停止分离+运行期草稿/滚动 | **已勾** | `tests/ai-single-projection.test.ts` 直接覆盖：仅当前挂载而后台生成存活、切走再回恢复未发送草稿、最大化保持投影且关闭复位显示、键盘调宽仅改宽度、切换恢复阅读位置；全门禁绿 | — |
| 3.3 讨论列表覆盖/当前标记 | 未勾 | `tests/ai-panel-dom.test.ts` 等 | 分组/过滤/置顶/重命名/删除确认撤销的真实交互未验收 |
| 3.4 接回直接提问/召唤/追问/重试/授权入口 | 未勾 | 代码与定向测试 | 真实链路与用户操作未验收（依赖 7.4/7.3） |
| 3.5 4 上限/FIFO/同讨论单轮/隐藏排队/迟到隔离/崩溃恢复 | 未勾 | 调度/隔离定向测试 | 真实模型链路缺失（依赖 7.4）；隐藏排队与恢复的真实行为未验 |
| 3.6 替换旧多窗口测试+身份/草稿/隐藏生成/授权挂起回归 | **已勾** | `verification/ai-panel-state-single-panel-2026-10-10.md`：删旧 `set_window_placement`(3)/`reset_layout`(2)/非法 `close_window`(1) 共 6 项，`focus_window`→`select_discussion`、`close_window`→`close`；新增身份投影/运行时独立/授权竞态回归；定向 271/271、`test:frontend` 1356/1356、typecheck/lint/build exit 0 | — |
| 3.7 启动/重放隐藏切换不失效+迟到失效+message_sent | 未勾 | 传输/生命周期定向测试 | 真实链路与崩溃恢复未验；`message_sent` 仅离线契约，未实弹 |
| 3.8 拖宽/箭头调宽+330/370 边界+切文档草稿/清选区 | 未勾 | `ui-native-resize.ps1`、`v5-parity-resize.ps1`；CDP 断言；**原生缩放已解决**（VBF：真实 `Tauri Window`，三档 client==viewport，max/restore 通过） | 300/50vw 客户区适配与真机拖宽/用户手动未验 |
| 4.1 文档栏/稿纸/工具列+粘贴规则 | 未勾 | `tests/editor-toolbar.test.ts`、IR §56 | 非空选区的格式/链接真机动作未验收；粘贴规则真机未验 |
| 4.2 工具收纳/回流+菜单 | 未勾 | 定向测试+菜单截图 | 真实高度回流与数值菜单真机未验 |
| 4.3 640/720/860+降级+偏好入设置 | 未勾 | `tests/editor-layout-style.test.ts`；IR §35 | 空间不足降级真机/视觉未验 |
| 4.4 设置分组+连接测试+未保存保护 | 未勾 | `tests/llm-config-form.test.ts` | 真实连接测试（需密钥）与掩码真机未验 |
| 5.1 混排树+顶部动作+同源行菜单 | 未勾 | `v5-menu-screens/evidence.json`、`tests/file-management.test.ts` | 行菜单/右键真实动作与排序/落点真机未验 |
| 5.2 文档 AI 可见性开关+双击不跳页+失败回原 | 未勾 | `tests/file-management.test.ts` | 影响确认/旧讨论只读/脱敏、失败回原的真机未验 |
| 5.3 回收站独立页+真实 DOCX/MD/FDX 导入与 Word/PDF/MD 导出 | 未勾 | 既有后端能力；IR §82 明确未做真实进出线 | 真实三格式进出线与恢复未验（用户要求） |
| 5.4 制作库/双标签/三态/保存确认/启停/试问 | 未勾 | `tests/making-module.test.ts`、`v5-native-graph-screens/`；命名轮 `making-naming-final-screens/`（真实 native 三档，只读查看现有链路） | 正向「正在制作/已启用」状态安全证据仍缺（VBF §31）；保存确认/启停/试问真实动作未验 |
| 5.5 上下说明图+五步+折叠+两类卡+只读底座动态 | 未勾 | `tests/making-module.test.ts`；空库口述见 MU；命名轮 `making-naming-final-screens/` 真机三档（新名可见） | 有内容导图/长卡/空库的视觉与真实数据未验；正向启用状态见 §4B |
| 6.1 发送彩蛋字节/比例/禁用/focus/名称 | **已勾** | `ui-cleanup-final-2026-10-10.md` 6.1 节 + `tests/ui-send-mark.test.ts`：原字节 SHA256 `b8296fa1…`、988×789、alpha 0–255、按钮 72×32、图案 28×22.3594、aspect-ratio 988/789、功能名（`发送`/`提问`）、禁用/启用/focus-visible 2px | — |
| 6.3 清演示/旧窗口/重复事件/陈旧入口+迁移清单可达 | **已勾** | `migration-matrix-final`；`src`/`index.html` 演示数据 0、旧几何 token 0、旧 sprite id 0；入口真实 handler 接线（非演示）；`ai-window`/divider live 保留 | — |
| 7.2 三尺寸 CDP+常用 DPI+无溢出/菜单/深树/收纳/详情/焦点 | 未勾 | 三尺寸截图与几何（`v5-parity-*`）；**原生三档已通过**（VBF：真实 `Tauri Window`，client==viewport，max/restore）；命名轮复拍 `making-naming-final-screens/`（1024/1280/1440 原生，client==viewport，errors []） | **常用其它 DPI 缺**（用户确认）；用户手动拖拽/视觉未做 |
| 7.3 头按钮几何≤1px+单提示+关重开保留+**用户点击/视觉** | 未勾 | CDP 几何与草稿保留断言（IR §96） | **用户真实点击与视觉验收缺**（用户确认） |
| 7.4 真实模型链路全项 | 未勾 | 离线契约测试 | **真实模型链路缺**（用户确认；不发真实模型） |
| 7.5 保存/中文输入/导入导出/制作三态与失败路径 | 未勾 | 定向测试 | **真实导入导出与真机保存/中文输入缺**（用户确认） |
| 7.6 实际 Windows 安装包/任务栏/快捷方式/壁纸/小图标 | 未勾 | `FC`/任务栏只读截图 | **安装后壳层未验**（用户确认；不运行安装器） |
| 7.8 汇总+受影响规格 Purpose/旧窗口文案同步+归档 | 未勾 | — | **归档未做**；主规格 Purpose 与纯旧窗口文案同步未执行 |
| 7.9 重开仅选身份/不读档覆盖/不标中断/不自动重发+切文档批准核对 | 未勾 | `verification/restart-isolation-2026-10-10.md`：新增 fixture **3/3**（真实 Node 磁盘存储 + fake 传输、两新鲜控制器实例）＋支撑 **110/110**；零读盘选身份、挂起轮保留、磁盘重启标中断不自动重发、切文档清实时选区保留草稿 | 层级**仅**「两控制器共享磁盘」模拟，**非 Windows 进程重启**；真实模型链路与真机重启截图未做；「切文档批准」最终核对未闭环 |

## 4. 简短可操作验收清单

**A. 可自动后续（无需用户，后续 lane 可直接做）**
1. 7.8 规格残留复核与主规格 Purpose/纯旧窗口文案同步（ai-feature-orchestration 排队显示、automatic-story-context 多讨论材料隔离、agent-on-demand-reading 授权重开、main-window-size-bounds 停靠并排）；Purpose 只待 archive 时同步、**归档前不改主 spec**；随后才谈 archive。
2. （1.4 已完成，见 §2；命名合同 §6/§7 resolve。）
3. 7.9 真实 Windows 进程重启（需安全 app 持久化/launch）；当前已用两控制器共享磁盘覆盖自动层，见 `restart-isolation-2026-10-10.md`。
（1.3、1.4、3.6、3.1、3.2、6.1、6.3 已完成，见 §2。）

**B. 必须用户点击 / 明确外部操作**
1. 7.2 常用 DPI（125/150/200%）真机检查；用户手动拖拽/视觉（原生缩放已解决，见 §0/§3）。
2. 7.3 用户真实点击与视觉验收（头按钮 ≤1px、hover/focus 单提示、关重开保留）。
3. 7.4 真实模型链路（需用户提供 `ZHIPU_API_KEY`＋网络；不擅自发起）。
4. 7.5 真实保存/中文输入/导入导出（Word/PDF/Markdown/DOCX/FDX）与制作三态。
5. 7.6 实际 Windows 安装包安装后的窗口/任务栏/快捷方式/浅深壁纸/小尺寸图标（需用户安装）。
6. 5.3 真实三格式进出线（依赖用户/真机）。
7. 5.4/5.5 有内容制作导图与正向「已启用」状态（需隔离的真实库数据，避免动生产链路）。

**C. 命名裁决（已 resolve，见 §6/§7）**
- 用户已批准并落实新名（公用基础提示词/自定义提示词/本次问题与材料/完整提示词；内层 基本立场/参考材料/提问方式 等）；「固定底座/每轮动态」与原型「固定规则/本轮动态」只作历史（原时态保留），不再待裁决。

## 5. 终态说明

- 本轮以 validation/package lane 执行最终门禁与打包（详见 §7）：`npm run check` → `package:check` → `tauri:build` 依序 exit 0（前端 1358/1358、可靠性 121、驱动 33、离线 78、Rust 510/1）；产物见 §7 与 `final-cleanup-check-2026-10-10.md`。
- owned 实例均按 owner 记录核验后优雅关闭：25588/31884（8:50）；**本轮 28820/29464**（temp `ui-v5-app-owned.json`/`ui-v5-vite-owned.json` 与 CIM path/creation/parent 一致，13:33:01）。当前无 `next-story` 进程、debug/release exe 未锁定。
- 本 change **未归档**；本轮勾选 1.4（连同此前 1.3/3.6/3.1/3.2/6.1/6.3）合计 **13/38**，未提交。归档规格 Purpose 只待 archive 时同步，未提前改主 spec，未新增 change。

## 6. 更新（2026-10-10 内层命名与合同 resolve）

本条追加，前文（含 §4C 的「需用户裁决」）保留原时态不动：

- 用户同日批准内层只读项名称：公用基础提示词内「红线」「基本立场」「工具」「材料规则」，本次问题与材料内「你的问题」「参考材料」「提问方式」；并确认显示层合同不再使用旧名「固定底座/每轮动态」（原型「固定规则/本轮动态」只作历史）。§4C 的裁决项与 §3 第 1.4 行的「命名合同未 resolve」原因**至此解除**。
- 已同步的规范/记录：change delta `specs/making-module-page/spec.md`（第 125 行命名要求内层句、第 129 行「命名统一」场景）、`design.md`、`implementation-record.md`；源码显示层 `index.html`、`src/making/making-view-model.ts` 与断言 `tests/dom-contract.test.ts`/`tests/making-module.test.ts` 早已一致。溯源见 `verification/final-name-reconcile-2026-10-10.md`。
- 该更新**不改**任务复选框：1.4 仍含单投影/职责迁移/全规格查漏等其它 gate，是否可勾由父代理按完整证据裁定。未改 schema/真实提示词/业务/CSS，未提交、未归档。
- 边界：本次为文本核对，未跑 native 截图、未重打包；源码/测试注释残留的旧内部区名不影响用户可见文案，是否清理留待父代理。

## 7. 最终命名核对 + native + 全门禁（2026-10-10）

- `verification/final-name-reconcile-2026-10-10.md`：113 项定向 + typecheck/lint/build + `validate --strict` 均 exit 0；命名合同 resolve（见 §6）；旧名内层文案与原型名仅作历史（原时态保留）。
- native：复用 `making-naming-native.mjs`（由 native graph capture 派生，输出 `making-naming-final-screens/`），对 owned 隔离临时项目 `UI-v5-naming-…` 的真实 `Tauri Window` 三档 1024/1280/1440，client==viewport、`errors:[]`；图区呈现新名（输出块「完整提示词／发给 AI 的说明」），只读查看现有全局链路、未启用/改链路。
- 全门禁/打包：`npm run check`（前端 **1358/1358**、可靠性 121、驱动 33、离线 78、Rust 510/1）→ `package:check` → `tauri:build` 依序 exit 0；EXE/NSIS/MSI 内嵌应用 exe 均 **8 帧**逐帧匹配；Basecoat 离线、CSP `default-src 'self'`。产物（本轮唯一有效）：
  - `next-story.exe` 34759680 B `4869EE0D9BDBABB6CDBD7DBD88B51F31E653939B149EF9B0502C72327D9884CD`
  - `Next Story_0.1.0_x64_en-US.msi` 121905248 B `601DAF574ED02D6A309AD6DB0EDA925580A335A36407781E8078AF01E3AC9DF4`
  - `Next Story_0.1.0_x64-setup.exe` 70801551 B `FDE31A684CC266AE849EC4515F5DA790503B7BD531A6DF3F53D7EAC7AA9BACB0`
- 本轮勾选 1.4（合计 **13/38**）；7.2/7.3/7.4/7.5/7.6/7.8 门槛保持未勾。未归档、未提交、未安装器、未发模型、未写全局链路、未读正文/secret。
