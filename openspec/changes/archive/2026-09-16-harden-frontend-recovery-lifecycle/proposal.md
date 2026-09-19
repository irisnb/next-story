## Why

前端仍有三处生命周期缺口：AI 崩溃恢复把命令返回的业务失败当成成功，作品卸载后重开不会恢复快捷键与右键菜单，应用级控制器与 Tauri 事件路由也没有统一销毁入口。这会让界面显示“已恢复”但实际会话不可用，或让同一应用实例在重开、销毁后遗留失效交互与监听。

## What Changes

- AI 会话恢复逐步检查 `start`、`replay history`、`replay done` 的业务结果；任一步失败都向编排层返回失败，不注册该会话，并尽力结束已启动的半成品会话。
- 作品卸载后重新打开时，重新建立编辑器快捷键和右键菜单模块，保证与首次打开时的交互一致。
- 为 AI 会话事件路由和 AI 功能控制器补齐幂等销毁入口，退订 Tauri 事件、状态订阅和控制器持有的前端监听，并在应用窗口销毁前统一调用。
- 增加针对恢复业务失败、作品重开交互、重复安装与销毁退订的回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `resident-ai-session`: 明确崩溃恢复三步命令的失败关闭语义，以及会话事件路由的安装、销毁和重新安装边界。
- `project-reliability-boundaries`: 明确作品卸载后重开必须恢复编辑器交互模块，并要求应用级前端控制器在销毁时释放所持监听。

## Impact

- 受影响代码：`src/ai-session-transport.ts`、`src/ai-feature.ts`、`src/ai-dock.ts`、`src/editor.ts`、`src/main.ts` 及相应测试。
- `AiSessionTransport` 与 `AiFeatureController` 增加生命周期方法；内部调用方与测试桩需要同步。
- 不改变作品正文格式、讨论档案格式、后端命令协议或 AI 对作品的只读边界；不增加依赖。
