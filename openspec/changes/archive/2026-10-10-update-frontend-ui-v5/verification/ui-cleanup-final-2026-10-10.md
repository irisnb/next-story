# 最后有界显示清理

取消后先核对 partial：旧sprite、模板头标记、getter和PNG比例改动已存在；沿用精确改动，没有覆盖工作区其他lane的diff。一次AST替换工具报告已应用但文件仍保留旧getter引用，typecheck因此失败；随后使用精确patch补齐19处真实测试调用，最终通过。没有删除业务断言。

## 实际改动

- `index.html` 删除确认无引用的 i-float/i-grip/i-dock/i-sbs；模板头标记 drag-handle改为discussion-header，关闭按钮title统一收起AI面板。`src/dom.ts`与`tests/ai-panel-dom-fixture.ts`仅同步查找标记。
- `src/styles.css` 删除只有定义无消费的window-min-w/window-shadow-float/window-grip-color/window-resize-color，以及无消费的ai-window-dragging规则。仍消费的 ai-window 结构、active/inactive、头部／正文／输入与单面板最大化、调宽separator保留。原ai-window-docked的flex占满能力仍有消费者，机械改名ai-discussion-projection并同步`src/ai-dock.ts`，保留全部声明；未当死代码删掉。
- `src/ai-panel-state.ts`仅将派生ReadonlySet getter windows改名openDiscussionIds，仍由discussions.keys()新建Set；`src/ai-dock.ts`与四文件测试调用同步。focusedConversationId、reducer/events、业务及生命周期未改。
- `src/ui-v5.css`发送图案width28、height:auto、aspect-ratio988/789，补focus-visible明确边框。提示词副文案11px nowrap，避免1024档说／明拆字。
- 新`tests/ui-send-mark.test.ts`验证批准PNG hash、固有尺寸，以及两个日常提交按钮的功能名／初始禁用／比例／焦点显示合同。

getter调用测试文件：ai-feature-delete-undo、ai-feature-persistence、ai-panel-dom、ai-panel-state。没有改制作显示TS／协议、Rust、API、build、icons、spec命名或implementation-record；未提交、归档或补勾任务。

## PNG专项6.1

原文件`src/assets/user-mark.png`未改。System.Drawing实际解码：SHA256 b8296fa14dc2f9c3e889e9dcd9d8677be1fc9ada57b1f46edfea2ed7dd8a9d96；988×789；Format32bppArgb；alpha最小0、最大255、完全透明像素556823。

真实native1024×670及1440×900：按钮72×32，图案28×22.3594，computed aspectRatio988/789。功能名「提问」；空输入真实disabled，浅灰rgb(228,228,228)、图案filter none/opacity0.45；输入临时草稿后enabled，深色rgb(32,32,32)、invert(1)/opacity1；实际Tab进入按钮，focus-visible为true且solid2px。没有提交或模型请求。两个尺寸projection均为1。

`ui-cleanup-native.mjs`先clearDeviceMetricsOverride，操作真实root Tauri Window HWND922916；client和innerWidth/innerHeight均等于目标尺寸，无override fallback。证据及四张状态截图在`ui-cleanup-screens/`：disabled-1024x670、enabled-focus-1024x670、disabled-1440x900、enabled-focus-1440x900；完整evidence.json。

提示词单行改动后刷新三档纯导图：`v5-native-graph-screens/graph-{1024x670,1280x720,1440x900}.png`，真实client==viewport、无横向溢出、无快捷详情遮挡、errors空；细节视觉及不裁字交observer复验，未将CSS声明当成视觉结论。

## 检查与进程交接

定向9文件共169项通过、退出0：ui-send-mark/ai-panel-state/ai-panel-dom/ai-panel-dom-contract/ai-single-projection/ai-feature-delete-undo/ai-feature-persistence/dom-contract/ui-v5。typecheck和lint退出0。保留单DOM与键盘separator的既有测试。最后投影class机械同步后另跑single-projection及DOM契约与typecheck/lint。全check/build交父lane，不重复全套。

原PID32224已退出。本lane按已授权已有ui-launch.mjs启动PID25588，launcher原始输出ownedPid25588；temp `ui-v5-app-owned.json`记录started UTC2026-10-09T20:46:27.572Z。CIM核验exe D:\Next Story\src-tauri\target\debug\next-story.exe，parent34616，创建本地2026-10-10 04:46:27。native证据同时记录PID及HWND。原始owned记录优于旧handoff追记；fix2 stop-owned-only仍需当场核对PID／路径／创建时间。当前应用仍运行，最终clear override，未停止。

验收使用新建UI-v5-cleanup空临时项目，未打开recent用户项目；全局链路仅授权只读查看，未启用／修改；未读取用户正文／secret，无模型调用。剩余仅observer截图复验及父最终门禁，结束本scope。
