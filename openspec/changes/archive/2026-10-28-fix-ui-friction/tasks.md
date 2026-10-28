## 1. 删除等待计时功能（前端）

- [x] 1.1 删除 `src/ai-timing.ts`；移除 `src/main.ts` 的 `window.__waitTiming` 暴露与相关导入
- [x] 1.2 移除 `src/ai-feature-request-gateway.ts`、`src/ai-feature-request-lifecycle.ts`、`src/ai-feature.ts` 中全部 waitTiming 接线与动作（`hasWaitTimingData`/`exportWaitTiming`/`clearWaitTiming`、`exportWaitTimingJson` 依赖注入与调用）
- [x] 1.3 `src/ai-dock.ts` 移除「⋯」菜单（`openDockMenu`）、计时提示条（`TimingNotice` 及导出/清空流程）与 `#ai-dock-more` 绑定；`index.html` 删除 `#ai-dock-more` 按钮（连带窄轨 `#ai-rail-more`，其唯一功能即打开该菜单）；`src/dom.ts` 同步移除 `moreBtn`/`railMoreBtn` 引用
- [x] 1.4 `src/project-api.ts` 移除 `exportWaitTimingJson`、`waitTimingFileName`、`ExportWaitTimingResult` 与命令绑定（保留导出功能在用的 `SaveDialogFn`）

## 2. 删除等待计时功能（后端与测试）

- [x] 2.1 Rust 侧移除 `export_wait_timing_json` 命令、注册与 capability 授权（capabilities 经查无该命令 ACL），`cargo` 编译与 clippy 由总门禁覆盖
- [x] 2.2 删除 `tests/ai-timing.test.ts`、`tests/ai-wait-timing-export.test.ts`；更新 `tests/ai-feature-orchestration.test.ts`（移除 waitTiming 四点接线断言）、`tests/ai-single-projection.test.ts`（假动作签名）、`tests/ai-module-boundaries.test.ts`（接线字符串守卫）、`tests/ai-panel-dom-fixture.ts`（`ai-dock-more` 假元素）及 `tests/ai-panel-dom-contract.test.ts` 残留引用

## 3. 讨论窗口头部贴边

- [x] 3.1 `src/ui-v5.css` 最大化限宽选择器仅保留 `.ai-panel-maximized .ai-window-body` 与 `.ai-window-input`，移除 `.ai-window-head`；**补充修复（冒烟发现）**：`src/styles.css` 旧规则 `.ai-window-title` 的 `max-width: 170px` 钳制使 v5 的 `flex: 1 1 0` 失效、动作组左挤（v5 遗留缺陷，用户原始报告「按钮漂中间」的第二个病根）——已移除该钳制，长标题由 ellipsis 截断让位；诊断与证据见 `verification/diag-head-geometry.mjs`、`verification/evidence/`
- [x] 3.2 新增 `tests/ai-panel-geometry-contract.test.ts` 几何断言：正文/输入 760px 限宽居中、头部不被限宽覆盖、限宽规则均以最大化类为前提、动作组不收缩不换行

## 4. 统一应用内确认组件

- [x] 4.1 新建 `src/app-confirm.ts`（`confirmInApp(options): Promise<boolean>`）：`<dialog>` 实现、常规/危险变体、取消与确认按钮 128×40px 同几何仅颜色不同、Enter 确认 Esc 取消、打开聚焦确认按钮、关闭返回触发元素、失败返回 false
- [x] 4.2 新建 `tests/app-confirm.test.ts`：11 条测试覆盖两变体呈现、几何一致、键盘行为、取消/关闭/异常不当作已确认、焦点返回与并发独立

## 5. 制作页操作区 B 定稿与确认替换

- [x] 5.1 `src/making/making-view-model.ts`：启用/回退/停用收成单一状态化主按钮决策（`MakingPrimaryAction` 三态；停用仅查看启用版本时）
- [x] 5.2 `index.html`＋`src/styles.css`＋`src/ui-v5.css`：操作区改两行结构（上行双状态标注；下行版本选择＋删除链路＋主按钮 `#making-primary-btn`），移除独立停用按钮，sticky 保留（定稿稿临时文件已被系统清理，实现按 proposal/design/spec 文字版定稿完成，真机冒烟做视觉比对）
- [x] 5.3 `src/making/making-module.ts`：单一主按钮渲染与分发；启用/回退/停用、删卡、删链路确认改走 `confirmInApp`（删链路 danger；确认 body 文案逐字保留）
- [x] 5.4 `src/making/making-session-controller.ts`：删制作会话确认改走 `confirmInApp`（danger）；`services.confirm` 注入形状保持
- [x] 5.5 制作页测试更新：主按钮三态、停用入口收敛（查看非启用版本时全页无停用入口）、确认替身注入、既有断言不放宽（63/63 通过）

## 6. 写作页确认替换

- [x] 6.1 `src/editor.ts`：删除有未保存修改文档的确认改走 `confirmInApp`（danger；新增 `confirm` 依赖注入点）
- [x] 6.2 `src/file-management.ts`：现存确认实为「关闭 AI 可见性」（永久只读，danger 变体，文案逐字保留）——已改走 `confirmInApp`；**勘误**：文件删除现行直接进回收站（可恢复）、本无确认，本变更不为其新增确认（方案与规格文字已同步修正）
- [x] 6.3 相关测试更新（editor／file-management／agent-on-demand-reading／workspace-project-flow 四个文件的确认桩全部迁移为依赖注入替身，取消不执行断言保持）

## 7. 总门禁与真机验收

- [x] 7.1 `npm run check` 全绿（typecheck→lint→前端/可靠性/驱动/验证测试→build→fmt/clippy/Rust 测试；顺序链完整跑到末尾，Rust 537 项测试通过；170px 钳制修复后对最终代码复跑亦全绿——首次复跑曾被运行中的开发版应用锁住 exe，关闭应用后通过）
- [x] 7.2 真机冒烟（归档前硬门槛）：CDP 端到端＋用户真实点击＋视觉比对——讨论列表头部无「⋯」（含窄轨）；最大化状态头部按钮贴边且正文保留稿纸宽度；制作页主按钮三态切换（草稿启用／启用版停用／旧版回退）与 700px 窄幅；全部确认点（制作页五处＋写作页两处）为应用内确认窗且按钮同尺寸、键盘可用；确认取消不执行操作。**进度（2026-10-28）**：自动化部分全过（75/75→**82/82**、零失败、零控制台错误，证据 `verification/evidence/`，含窄轨步骤按 v5「不保留旧竖条」规格修正、170px 钳制补充修复）。**用户人工验收发现三缺陷已修复并复验**：①确认窗贴左上角（全局 `*` 重置清零浏览器默认居中——`.app-confirm` 与 `.making-save-confirm` 补 `margin:auto`，规格补居中要求，冒烟补居中断言）；②文档管理顶部「导出」被历史遗留 `margin-left:auto` 从四入口并列组中拆散（违反 file-management-ui「并列」既有规格——已移除，冒烟补成组断言）；③最大化/恢复按钮悬停双黑提示（Basecoat 伪元素提示与共享 `#ui-tooltip` 并存——`ui-v5.css` 全局关闭 Basecoat 伪元素提示（`display:none !important`，共享提示独占），几何合同测试与冒烟补防回归断言）。**用户确认全部人工项通过（2026-10-28「ok归档」），最终门禁复跑全绿**
- [x] 7.3 归档：规格合流进 `openspec/specs/`（新增 `in-app-confirmation`；修订 `ai-request-scheduling`／`making-module-page`／`frontend-ui-v5`），更新 `方向/行动计划-2026-08-27.md` 账本（2026-10-28 更新记）与 `AGENTS.md`（当前实现补界面摩擦修复条目、规格清单补 `in-app-confirmation`）；归档目录 `openspec/changes/archive/2026-10-28-fix-ui-friction/`
