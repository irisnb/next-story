## Context

常驻 AI 面板当前只维护一个内存中的线性临时对话。收起面板只改变可见性，作品或文档生命周期的 `reset` 才会清空请求、对话和草稿；同一作品内没有用户主动结束当前对话的入口。实现必须继续遵守 AI 输出不写入作品文档、没有多会话和不持久化历史的边界。

## Goals / Non-Goals

**Goals:**

- 增加一个面向用户的“新建对话”操作，明确结束当前临时对话。
- 清空当前请求显示、对话、追问草稿和直接提问草稿，并让打开的面板回到空白直接提问状态。
- 通过显式 reducer 事件完成迁移，并使清空后的旧异步结果无法污染新状态。
- 保持现有收起恢复、作品边界 reset、单线性临时对话和只读输出行为。

**Non-Goals:**

- 不保存旧对话，不增加多会话或会话列表。
- 不增加后端 API、上下文检索、持久化历史或作品文档写入。
- 不改变首轮入口、追问请求格式或 LLM 配置流程。

## Decisions

### Use an explicit new-conversation transition

在 `AiPanelState` facade 和 `reduceAiPanelState` 中增加明确的开始新对话操作，而不是从 DOM 直接调用作品生命周期 `reset()`。这样用户意图与作品切换清理保持分离，状态迁移仍集中在纯 reducer 中。

Alternative considered: 复用 `reset()`。不采用，因为现有 reset 会关闭面板，语义是作品卸载/替换，不符合用户点击后留在面板中继续提问的行为。

### Invalidate pending work by advancing conversation identity

新对话操作保留单调递增的对话 ID 计数器，清空当前上下文并分配下一次首轮请求可使用的新身份；所有已有请求回调继续通过现有快照/对话身份校验，迟到结果被忽略。

Alternative considered: 增加单独的取消网络请求机制。不采用，因为本 change 只需要保证旧结果不改变当前 UI，不引入新的请求取消协议。

### Show the control only when there is something to end

“新建对话”控件在当前有临时对话或首轮请求进行中时显示，在空白直接提问状态隐藏。控件放在面板标题栏，与收起操作并列，并通过现有显式 DOM 契约接线。

Alternative considered: 始终显示按钮。对空状态没有有效动作，容易让用户误以为存在可切换的历史会话，因此不采用。

## Risks / Trade-offs

- [Risk] 用户点击后无法找回刚清除的临时内容 → [Mitigation] 控件文案明确为“新建对话”，规格明确不保留旧会话；不提供误导性的历史恢复入口。
- [Risk] 首轮或追问完成回调晚于清空操作 → [Mitigation] 使用现有请求身份和 reducer 守卫测试，验证迟到结果不会创建或修改当前对话。
- [Risk] 清空后遗留输入框 DOM 草稿 → [Mitigation] 将清空后的草稿置空纳入状态视图与 DOM 测试。

## Migration Plan

这是纯前端内存状态和 DOM 契约变更，无持久化数据迁移。实现后运行面板状态、DOM 和相关类型检查/测试；回滚时移除新增控件与状态事件即可，不影响作品数据。

## Open Questions

无。用户已确认采用“清空当前临时对话并回到空白提问状态”的范围。
