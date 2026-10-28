## Context

四项界面摩擦的现场（均已代码核对）：

1. **开发工具在用户界面**：讨论列表头部「⋯」按钮（`index.html` `#ai-dock-more`）只承载两项开发功能——`src/ai-dock.ts` `openDockMenu` 的「导出等待计时数据（开发者用）／清空等待计时数据」，源头是 2026-09-22 等待基线验证（`app-real-chain-validation`）的测量工具；记录器在 `src/ai-timing.ts`，接线遍布 `ai-feature-request-gateway.ts`（10+ 处）、`ai-feature-request-lifecycle.ts`、`ai-feature.ts`，导出经 `project-api.ts` 走后端 `export_wait_timing_json` 命令；规格落在 `ai-request-scheduling`「等待分段记录」。
2. **头部按钮悬空**：`src/ui-v5.css` 90–92 行把 `.ai-panel-maximized .ai-window-head` 与正文、输入区一并限宽 760px 居中——稿纸宽度美学误用于操作部件，最大化时动作组悬在 760px 列右缘而非面板右缘。
3. **启用按钮不显眼**：制作页版本操作区（`index.html` 678–688）单行混排标题、状态、版本下拉、启用、停用、删除与「正在使用」标注，`styles.css` `.making-inspector-head` 允许换行堆叠；2026-10-10 已收拢过一次（解决分散），未解决主次。设计定稿见 `C:\Users\Administrator\AppData\Local\Temp\opencode\making-enable-redesign\mockups.html`（B 定稿）。
4. **确认语言分裂**：`src/app-dialog.ts` 把 `window.confirm` 接到 Tauri 原生对话框；业务调用点共 8 处（制作页启用/回退、停用、删卡、删链路、删制作会话；写作页删有未保存修改文档、文件管理删除）。应用内自绘确认窗（`making-save-confirm`）与列表内嵌确认条已存在，两套语言并存。

用户拍板（2026-10-28）：计时工具彻底删除；启用确认保留但全软件统一为应用内样式；操作区采 B 定稿且启用/停用合并为同一状态化主按钮；确认窗按钮尺寸必须一致（128×40px）。

## Goals / Non-Goals

**Goals:**

- 用户版本里不再出现任何开发工具入口（连按钮一起删）。
- 最大化时头部动作钉在面板边缘；正文/输入保留 760px 稿纸宽度。
- 版本操作区上下两行：上行双状态标注、下行版本选择＋删除＋单一状态化主按钮（启用/回退/停用三态合一）；700px 内不换行错乱。
- 八处确认全部换成统一应用内确认窗（常规/危险变体、按钮 128×40 一致、键盘可达）。

**Non-Goals:**

- 不改任何业务语义：全局启用只有一条、下一轮生效、在途不变、版本不可变、保存不等于启用、确认必须存在。
- 不改「保存卡草稿」确认窗的内容结构（它带预览与明细，属富确认；仅视觉语言与之同源，不合并为简单确认）。
- 不动稿纸宽度偏好、讨论列表其余行为、按需补读授权卡等其他 UI。
- 不删除 `app-dialog.ts` 的原生对话框运行期安装（`tauri-security-baseline` 要求的基础设施，保留）。

## Decisions

- **D1 计时工具整链删除，不做开关**。备选「仅开发版显示」被用户否决。删除面：`ai-timing.ts`、网关/生命周期/编排层接线与动作（`hasWaitTimingData`/`exportWaitTiming`/`clearWaitTiming`）、`ai-dock.ts` 的「⋯」按钮/菜单/计时提示条、`main.ts` `__waitTiming` 暴露、`project-api.ts` 导出绑定与文件名函数、Rust `export_wait_timing_json` 命令及其 capability 授权（如有）、`tests/ai-timing.test.ts` 与 `tests/ai-wait-timing-export.test.ts` 整删、编排/单投影/模块边界测试中的 waitTiming 断言同步移除。规格侧整条移除「等待分段记录」。
- **D2 头部贴边＝选择器瘦身**。`ui-v5.css` 90–92 行仅保留 `.ai-window-body` 与 `.ai-window-input`；`frontend-ui-v5` 增补贴边几何要求与断言，防止回归。
- **D3 操作区重排以视图模型派生按钮身份**。`making-view-model.ts` 把启用/回退/停用收成单一主按钮决策（label、confirm 文案、动作命令），`making-module.ts` 单一按钮渲染与分发；HTML 结构改两行（identity／action-line），沿用既有 sticky 操作区。停用入口收敛为「查看启用版本时主按钮显示停用」——备选「保留独立停用按钮」被用户否决（学习成本）；取舍见 Risks。
- **D4 统一确认组件，注入式可测**。新增共享模块（形状 `confirmInApp(options): Promise<boolean>`，基于 `<dialog>` 与 `making-save-confirm` 视觉语言）：常规/危险变体、按钮 128×40 且仅颜色不同、Enter 确认 Esc 取消、打开聚焦确认按钮、关闭返回触发元素；失败与取消一律返回 false（沿用 `confirmDialog` 的 D1/D3 语义）。八处调用点替换；测试经注入替身（`making-session-controller` 已有 `services.confirm` 注入点，其余调用方照此模式），测试不驱动真实 dialog。`window.confirm` 不再有业务调用方，但安装保留（见 Non-Goals）。
- **D5 视觉以定稿稿为准**。实现对照 `mockups.html` 定稿（合并按钮三态、两行结构、128×40 按钮）；文案沿用现有真实文案（启用/回退确认含替换对象与全局生效范围、停用文案、删除文案），不发明新措辞。

## Risks / Trade-offs

- [停用需先切到启用版本查看] → 主按钮三态与「正在使用」标注同区呈现，文案自解释；停用是低频操作，用户已接受该取舍；真机冒烟含「找到停用」场景。
- [删计时工具后未来验证需重建] → 用户拍板接受；规格同步整条移除，不留半套死代码。
- [确认替换牵动既有测试桩] → 全部经注入替身替换，任务清单逐文件列出，`npm run check` 全绿为门禁。
- [操作区两行增高占导图纵向空间] → sticky 区高度增加有限；700px 窄幅不换行已在定稿稿验证；真机视觉比对把关。
- [合并按钮身份随版本切换变化] → 位置与样式恒定、文案随查看对象变化；冒烟含三态切换（草稿→启用、启用版→停用、旧版→回退）场景。

## Migration Plan

单仓库一次完成，无存储格式与数据迁移；用户机器上已导出的计时 JSON 文件不受影响（只删功能，不碰用户文件）。回滚策略：git revert 整个 change 即可恢复原状。

## Open Questions

无——四个决策点（计时工具去向、启用确认方式、统一范围、操作区方案）均已由用户拍板。
