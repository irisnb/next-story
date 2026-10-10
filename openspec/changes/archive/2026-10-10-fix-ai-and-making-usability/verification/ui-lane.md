# 前端 UI lane 验证与交接

日期：2026-10-10。范围：tasks 第 3–7 组前端实现。共享 tasks.md 未修改；未提交、未归档。测试使用隔离 fixture，未读写用户正文。

## 已实现

- AI 讨论列表顶边与面板头共用高度变量；更多菜单删除转入列表行内确认；确认时隐藏行尾操作；列表打开时撤销提示置于列表上方。
- 讨论头部动作收进不换行组，标题与文档名可收缩截断。
- 授权等待由呈现层派生「等待授权」，保留底层 loading；停止入口保留；授权卡移至消息滚动区之外。按讨论身份派生列表与窗口状态。等待结束清除等待徽标样式。
- 卡删除直接确认后追加新版本：锁定 chainId/versionId/cardId 和完整 cards 基线，确认后重读并核对；基线改变/缺失取消，同链路其他版本追加允许。最后一张卡禁删并说明。成功查看新版本，历史和 active 不变。
- 保存确认可展开核对完整原文，截断摘要明示；快捷详情标摘要，全页保留完整触发描述与正文。追加保存与首次建链成功后跟进新版本；首次绑定保留当前会话防迟到检查。
- 启用/回退/停用集中在版本操作区，顶部状态只读；显示正在使用与正在查看，停用仅在存在 active 时可用。

## 自动验证

以下专项联合运行共 192 项，全部通过，0 失败、0 跳过：

```text
node --test tests/agent-on-demand-reading.test.ts tests/making-conversation.test.ts tests/making-module.test.ts tests/ai-panel-view-model.test.ts tests/ai-panel-scroll.test.ts tests/ai-dock.test.ts tests/making-trial.test.ts tests/ai-panel-conversation-list.test.ts tests/ui-v5.test.ts
```

徽标样式清理新增断言后，用同一文件集合加 `--test-reporter=dot` 重跑，退出成功（192 项）。为准确模拟浏览器，FakeClassList.remove 改为支持多个参数。

`npm run typecheck` 最终通过。`git diff --check` 通过，仅有 Git 换行转换提示。未运行全量 test:frontend 或 npm run check：留给集成 owner，避免重复全量门禁。

新增/加强的断言包括：授权等待不改变 loading、切换讨论隔离、等待徽标样式清理；删除取消/成功/失败/最后卡/基线变化与缺失/其他版本追加/active 历史保护；长触发与正文全文；实际保存确认展开全文、取消与成功保存后查看新版本；版本控制同区。

## 未捕获与交接

- 浏览器连接失败：本地 opencode-browser broker 管道不存在（ENOENT）。未完成真实 Windows 桌面截图、几何测量和人工视觉比对。当前 mock/DOM/source 测试不能替代该验收。
- 3.5：尚缺针对实际 `.ai-window-head` 动作组的浏览器几何断言。请覆盖最窄/默认/最大化、长标题、停止按钮显示时不重叠或换行。
- 3.1–3.4、4.2/4.4：列表顶边、确认 hover/键盘、撤销可点击、长对话贴底/上翻时授权卡位置需真机检查；当前断言只证明派生状态和交互逻辑，未证明像素位置。
- 6.1：隔离前端夹具已对长内容首/中/尾和完整字符串做核对，保存确认与保存后查看链路已通过。尚未以真实 Rust 存储往返和原报告样本做端到端对照；原报告的全文截断根因未证实。
- 7.3/7.4：既有确认与命令调用测试通过；真实在途轮沿用发起版本、下一轮采用新启用版本的集成证明由主助手完成。
- 8.1–8.4：总门禁、真实模型召唤、Windows 验收、必要规格同步与归档由主助手/验收 owner 处理。后端与选区 lane 结果见其独立记录，不将其状态算入本 UI lane。

本记录仅说明已实现与实际验证结果，不代表 change 已达到归档条件。
