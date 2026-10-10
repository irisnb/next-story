# 单面板状态合同：移除停靠/浮动/聚焦窗口/多窗口几何（有界机械清理）

日期：2026-10-10。范围：change `update-frontend-ui-v5`，`ai-panel-state-structure` 迁移（MUST NOT 保存停靠/浮动、聚焦窗口或多窗口几何）。变更文件限 `src/ai-panel-events.ts`、`src/ai-panel-reducer.ts`、`src/ai-panel-state.ts`、`src/ai-feature.ts` 及对应 tests；未改 UI/CSS/index/制作/Rust/icons。**未归档、未提交、未勾任务。**

## 清理前状态（真实消费者核查）

- `windows` 是**存储字段** `Map<string, WindowPlacement>`（"docked"|"floating"），承载停靠/浮动几何；并非仅命名误报。
- 真实消费者：`src/ai-dock.ts:766` 只用 `state.windows.keys()` 做讨论计数（与 `state.conversations` 求并集）；`src/ai-feature.ts:450` 用 `windows.has` + `focusWindow` 重开已加载讨论；其余为 tests。
- 结论：`windows` 同时含「几何 placement」（不合规，删除）与「运行期讨论 id 集合」（被显示层计数消费，保留为派生集合）。讨论业务状态（`discussions`、请求、草稿、授权、排队）与当前投影 `focusedConversationId` 均在，不因移除 windows 丢失。

## 改动

- `src/ai-panel-events.ts`：删除 `WindowPlacement` 类型、`focus_window`、`close_window`、`set_window_placement`、`reset_layout` 事件；模块注释声明单面板无停靠/浮动/聚焦窗口/多窗口几何；保留 `select_discussion`。
- `src/ai-panel-reducer.ts`：`AiPanelCoreState` 删除 `windows` 字段；所有 `windows: new Map(...).set(id,"docked")` 分支移除；`open_discussion` 的「已打开则聚焦」判据由 `windows.has` 改 `discussions.has`；`delete_discussion` 生效判据由 `windows.has` 改 `opening.has`（读档中讨论仍可删，修一处回归）；删除 `focus_window`/`close_window`/`set_window_placement`/`reset_layout` case；`select_discussion` 去掉 windows 依赖。
- `src/ai-panel-state.ts`：删除 `focusWindow`/`closeWindow`/`setWindowPlacement`/`resetLayout`；`windows` getter 改为**派生** `ReadonlySet<string>`（`discussions` 的 id 集合，兼容 `ai-dock` 计数；非窗口/几何状态）；`focusedConversationId` 文档改为「当前显示的讨论身份（单面板当前投影）」。
- `src/ai-feature.ts`：重开已加载讨论改用 `state.selectDiscussion(id)`（去掉 `windows.has` + `focusWindow`）。

## 旧合同消除证据（全文检索）

`rg` 检索 `src/` 与 `tests/` 的 `WindowPlacement|setWindowPlacement|resetLayout|set_window_placement|reset_layout|focusWindow|focus_window|close_window|\.closeWindow\(`：

- `src/`：**零命中**（`ai-feature-request-lifecycle.ts` 的 `closeWindow` 是「面板隐藏」动作函数，非被移除的逐窗口几何事件；命名沿用显示层 onClose 接线）。
- `tests/`：仅 `ai-runtime-independence.test.ts` 的 `lifecycle(h).closeWindow("1")`（生命周期面板隐藏动作，非 state 几何 API）。无 `WindowPlacement`/placement/reset_layout/focus_window 残留。
- `src/ai-panel-reducer.ts` 不再有 `windows` 字段；`src/ai-panel-state.ts` 的 `windows` 为派生只读集合（无存储几何）。

## 测试（有意义的无几何 single-projection / runtime）

- 改写/删除陈旧几何断言：`ai-panel-reducer.test.ts` 删除 `set_window_placement`（3）与 `reset_layout`（2）与 `close_window` 非法迁移（1）共 6 项；`focus_window` 两项改为 `select_discussion`；`close_window` 改为 `close`（面板隐藏保留讨论与当前投影）；`windows.get("…")==="docked"` 改为 `windows.has` 或移除。
- `ai-panel-state.test.ts`：窗口结构测试更名/改写为单面板讨论状态；`focusWindow`→`selectDiscussion`；`closeWindow`→`close`（隐藏保留讨论与当前投影、`selectDiscussion` 重开）。
- `ai-panel-dom.test.ts`：`closeWindow` 测试改为 `close` 隐藏保留讨论。
- `ai-feature-persistence.test.ts`：`closeWindow` 改为 `close`（重开复用运行期）。
- `ai-feature-orchestration.test.ts`：`focusWindow`→`selectDiscussion`。
- `ai-runtime-independence.test.ts`：「无窗口恢复」改为「独立于当前投影恢复」；`closeWindow` 移除，用 `selectDiscussion` 切换投影。
- 保留并覆盖：草稿/滚动/在途/排队/授权/迟到/会话恢复/FIFO/调宽分隔条（`ai-single-projection`、`ai-runtime-independence`、`ai-panel-state/-reducer` 等未改动的业务断言）。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test tests/ai-panel-reducer.test.ts tests/ai-panel-state.test.ts tests/ai-panel-dom.test.ts tests/ai-runtime-independence.test.ts tests/ai-feature-persistence.test.ts tests/ai-feature-orchestration.test.ts tests/ai-feature-delete-undo.test.ts tests/ai-single-projection.test.ts` | 271/271 |
| `npm run test:frontend` | 1356/1356、0 失败、0 跳过 |
| `npm run typecheck` / `npm run lint` / `npm run build` | 均 exit 0 |
| `cargo test --lib` | 510 通过 / 1 ignored（本轮无 Rust 改动，回归确认） |
| `npm run fmt:rust` | exit 0 |

## 限度 / 交接

- `ai-dock.ts` 仍调用兼容 getter `state.windows.keys()`（派生讨论 id 集合，计数语义不变）；显示层若需更贴合命名（如 `openDiscussionIds`）由 designer/显示清理车道处理，本轮不改 UI。
- `npm run test:rust` 未跑（`target/debug/next-story.exe` 非本 lane 启动、占用构建产物）；由父 final check 协调停止明确 owned 的验收应用后统跑。
- 未改已验证行为：first-save 冲突需用户再次保存、global active 不改、仅绑定后可试问、旧字符串档案兼容、未保存不可试问。
