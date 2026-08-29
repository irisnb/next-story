# summon-ai-follow-up 变更增量

## REMOVED Requirements

### Requirement: 首次回应成功后才能继续追问
**Reason**: 旧选区工具（`AI 及时召唤`、`思维扩展`）随常驻会话改造退场，本要求所述"召唤文字输入"入口不复存在。
**Migration**: 统一临时对话的追问输入开放时机由 `ai-thinking-panel`（面板显式呈现请求与轮次状态）承接。

### Requirement: 追问请求不显示发送确认弹窗
**Reason**: 旧选区工具退场，其追问载荷规则不复存在；统一对话追问沿用面板既有发送行为。
**Migration**: 见 `persistent-ai-panel-entry` 统一临时对话要求。

### Requirement: 临时对话始终锚定原冻结选区
**Reason**: "每轮重发锚点"是"每轮全量重发"进程模型的配套要求；常驻会话在进程内维护历史，首轮材料随首条消息进入会话，无需每轮重发锚点。面板显示层的冻结材料语义由 `ai-thinking-panel` 与 `persistent-ai-panel-entry` 保留。
**Migration**: 增量发送与会话历史维护见 `resident-ai-session`。

### Requirement: 追问形成单条线性临时对话
**Reason**: 旧选区工具退场；统一临时对话的轮次显示与替换规则已由 `ai-thinking-panel`（面板使用可替换的当前临时对话策略）覆盖。
**Migration**: 见 `ai-thinking-panel`、`persistent-ai-panel-entry`。

### Requirement: 追问失败保留问题并允许受控恢复
**Reason**: 旧选区工具退场；统一对话的失败保留与重试语义已由 `ai-thinking-panel`（重试必须使用原冻结快照与对应失败上下文）覆盖。
**Migration**: 见 `ai-thinking-panel`。

### Requirement: 迟到结果不得污染已替换的临时对话
**Reason**: 旧选区工具退场；迟到结果隔离已由 `ai-thinking-panel`（迟到请求不得污染其他作品或临时对话）与 `resident-ai-session`（会话身份隔离迟到结果）覆盖。
**Migration**: 见 `ai-thinking-panel`、`resident-ai-session`。
