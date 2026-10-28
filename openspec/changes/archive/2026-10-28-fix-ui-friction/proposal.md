## Why

用户在真实使用中报告四项界面摩擦：讨论列表头部的「⋯」菜单整个是开发验证工具（导出/清空等待计时数据），出现在给用户的版本里；AI 面板最大化时新讨论头部按钮不贴边、悬在半中间；制作页「启用」按钮夹在一行杂项控件中不显眼、不易找到；启用/停用/删除等操作反复弹出 Windows 系统级确认框，与应用自绘确认窗并存、体验割裂。四项都落在已归档能力的行为缝隙里，属维护类修复，不改产品方向。

## What Changes

- **彻底删除等待计时功能**：前端记录器（`ai-timing.ts`）、请求网关/生命周期里的接线、讨论列表头部「⋯」按钮与其菜单（导出/清空等待计时数据）、`window.__waitTiming` 开发控制台暴露、导出命令的前端绑定与后端 `export_wait_timing_json` 命令、相关测试一并删除；`ai-request-scheduling` 的「等待分段记录」要求整条移除。该功能为 2026-09-22 等待基线验证的测量工具，验证已归档，用户拍板彻底删除（未来如需类似验证重新建设）。
- **讨论窗口头部贴边**：`ui-v5.css` 的 760px 限宽居中选择器不再覆盖 `.ai-window-head`；最大化状态下头部操作组（更多、收起等）钉在面板右缘，正文与输入框保留 760px 稿纸宽度不变。
- **制作页版本操作区重排（B 定稿）**：操作区拆为上下两行——上行是「正在查看：名称·第N版」＋版本状态标注＋「正在使用：名称·第N版」；下行左侧为版本下拉＋「删除链路」，右侧为**单一状态化主按钮**：查看非启用版本时显示「启用「名称·第N版」」（更早版本显示「回退到…」），查看的正是启用版本时同一按钮显示「停用当前链路」，未启用链路时恒为「启用…」。不再同时出现独立的「启用」与「停用」两个按钮（用户拍板：降低学习成本）。启用/回退/停用仍集中同一固定操作区、仍经确认后执行、双状态标注保真、全局启用只有一条、下一轮生效等红线全部不变。停用入口收敛为「查看启用版本时主按钮」，不再在查看任意版本时随时可用。
- **全软件确认统一为应用内确认窗**：制作页启用/回退/停用（同一状态化主按钮）、删卡、删链路、删制作会话，以及写作页删除有未保存修改的文档、关闭文档 AI 可见性（受影响讨论永久只读），全部既有确认改为应用内自绘确认窗（以既有 `making-save-confirm` 的语言为基础统一），不再弹出 Windows 系统级对话框。确认本身保留（含全局替换范围、不可恢复等真实信息量）；确认窗取消/确认按钮尺寸完全一致（定稿：128×40px，仅颜色角色不同）；危险操作确认按钮用危险色；键盘可达（Enter 确认、Esc 取消）；确认调用失败不得当作已确认。原生对话框运行期安装（`tauri-security-baseline`）保留不动，仅调用点更换。**勘误（实施期代码核对）**：原方案所列「文件管理删除文档/文件夹确认」不存在——删除直接进回收站（可恢复）且本无确认步骤；本变更不为其新增确认（用户诉求即减少无谓确认）。

## Capabilities

### New Capabilities

- `in-app-confirmation`: 应用内统一确认窗——所有需用户确认的操作以应用内自绘确认窗呈现（不使用系统级确认对话框），按钮几何统一、常规/危险两变体、键盘可达、失败与取消不得当作已确认。

### Modified Capabilities

- `ai-request-scheduling`: 移除「等待分段记录」整条要求（记录、历史保留与开发者导出入口不再存在）。
- `making-module-page`: 版本操作区要求更新——同一固定操作区内启用/回退/停用合并为单一状态化主按钮（启用/回退在查看非启用版本时、停用在查看启用版本时），停用不再于查看任意版本时独立可用；双状态标注与「经确认后执行」保留。
- `frontend-ui-v5`: 增补最大化状态几何要求——讨论窗口头部操作组钉在面板边缘（头部不参与 760px 限宽居中），正文与输入框保留限宽；动作组不拆散的既有几何合同不变。

## Impact

- **前端**：删除 `src/ai-timing.ts`；修改 `src/ai-feature.ts`、`src/ai-feature-request-gateway.ts`、`src/ai-feature-request-lifecycle.ts`、`src/ai-dock.ts`（「⋯」按钮与菜单、计时提示条）、`src/main.ts`、`src/project-api.ts`（导出绑定）；`index.html`（移除 `#ai-dock-more`、制作页操作区结构重排）；`src/making/making-module.ts`、`src/making/making-view-model.ts`、`src/making/making-session-controller.ts`（合并按钮、确认更换）；`src/editor.ts`、`src/file-management.ts`（确认更换）；`src/ui-v5.css`、`src/styles.css`；新增统一应用内确认组件（供上述各处复用）。
- **后端（Rust）**：移除 `export_wait_timing_json` 命令及其 capability 授权（如有）。
- **测试**：删除 `tests/ai-timing.test.ts`、`tests/ai-wait-timing-export.test.ts`；更新 `tests/ai-feature-orchestration.test.ts`（waitTiming 断言）、`tests/ai-single-projection.test.ts`（假动作签名）、`tests/ai-module-boundaries.test.ts`（接线字符串守卫）、制作页与写作页确认相关测试改走应用内确认。
- **设计定稿参照**：`C:\Users\Administrator\AppData\Local\Temp\opencode\making-enable-redesign\mockups.html`（B 定稿：合并按钮三态、128×40 统一按钮；apply 时按此实现，验收视觉比对）。
- **不动**：确认语义与业务命令不变（启用全局一条、下一轮生效、在途不变、版本不可变、保存不等于启用）；`tauri-security-baseline` 的原生对话框安装要求保留；讨论列表其余行为、稿纸宽度偏好、写作区不受影响。
- **验收**：`npm run check` 总门禁；因涉及窗口视觉与交互，归档前按硬性门槛执行真机冒烟（CDP 端到端＋用户真实点击＋视觉比对），mock 全绿不替代。
