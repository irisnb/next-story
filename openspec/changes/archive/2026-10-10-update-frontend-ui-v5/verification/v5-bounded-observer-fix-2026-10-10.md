# Observer 最后 bounded UI 修正

只改 `index.html` 制作展示节点、`src/ui-v5.css`、`src/making/making-view-model.ts` 的输出副文案和相关语义断言／native验收脚本。未改 controller、Rust、API、icons、协议、启用状态；未提交、归档或补勾任务。

链路库保留158px紧凑左栏；标题独占一行，“新建制作”按钮另行占满可用宽度，二者均 nowrap。组装恢复 #252525 白字并添加「汇合三路内容」；提示词副文案统一「发给 AI 的说明」。`tests/editor.test.ts` 的存储恢复语义断言更新为「宽 · 860」，仍验证真实 wide 档位。

命名明确冲突：当前已批准 change `specs/making-module-page/spec.md` 第62、82、125行仍 SHALL 用户可见「固定底座」「每轮动态」，同时要求详情只读。遵循调度指令中的冲突处理，保留这两个展示名称和现有说明，没有擅改成「固定规则／本轮动态」。backend概念与协议未改。这一项需由父调度方处理规格对齐，不能声称已完成。

定向 `editor/editor-toolbar/making-module/dom-contract/ui-v5` 共125项通过，命令退出0；typecheck、lint各退出0。未跑全门禁，交父finalcheck。

最新 `v5-native-graph.mjs` 禁止 override fallback，先 clear override，真实 Tauri root HWND 正常缩放，断言 native client==innerWidth/innerHeight==目标尺寸。三档纯导图截图前关闭快捷详情，详情截图只在显式 `--details` 模式生成，本次未重复已有quick/full截图。三档无横向溢出、errors为空；展示几何与computed颜色另入 evidence。截图仍由observer视觉复验。

截图：`v5-native-graph-screens/graph-1024x670.png`、`graph-1280x720.png`、`graph-1440x900.png`。完整窗口与展示证据：同目录 `evidence.json`。

进程于本轮只读重新核验：PID32224，parent33240，exe `D:\Next Story\src-tauri\target\debug\next-story.exe`，创建时间2026-10-10 02:14:23，与 `v5-launch-owner.json` 及session handoff一致。未停止或启动新进程；ownership记录仍是handoff追记，不冒充原始spawn日志。fix2如stop-owned-only，必须当场重新核对PID、路径、创建时间，保持这一证据限制。

现有global chain仅查看；未启用／修改、未读取正文或secret、无模型请求。完成本次范围后停止润色。

> **更正（2026-10-10）**：上文第 7 段记录的规格命名冲突（change delta 第 62、82、125 行的「固定底座」「每轮动态」）**已由用户批准完整词后 resolve**。delta 第 62、82 行早已采用批准来源名；第 125 行内层句与「命名统一」场景已按批准内层名（「红线／基本立场／工具／材料规则」「你的问题／参考材料／提问方式」）更新，显示层合同不再使用「固定底座/每轮动态」。原时态保留为历史。详见 `final-name-reconcile-2026-10-10.md`。未改 backend 概念、协议与业务。
