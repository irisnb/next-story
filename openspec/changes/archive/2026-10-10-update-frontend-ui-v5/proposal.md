## Why

用户已认可整套 UI v5、黑底个人 PNG 发送彩蛋与独立应用图标04「开口」，现有界面及多窗口规格仍与新设计冲突。需要用唯一 change 明确视觉迁移和单面板行为，保留真实写作、制作、权限与保存能力后再实施。

## What Changes

- 按唯一完整规范 `方向/前端UI全量更新-设计与实施方案-2026-10-09.md` 更新首页、公共组件与写作/文档管理/制作/设置四页，使用本地Basecoat与统一灰白近黑令牌。
- **BREAKING** 取消应用内浮动讨论窗口、多窗口并排与浮窗几何操作；保留可拖动及键盘调宽的边栏分隔条和选区旁AI按钮。一个AI面板显示当前讨论，多个讨论仍并存并发，切换/隐藏/×不停止生成或排队，显式停止独立处理。
- **BREAKING** 替换旧新粗野主义视觉规则；统一用户已决定的界面「项目」用语，实施前同步方向与宪法，代码/存储名不迁移。
- 工具栏按可用高度收纳，显示偏好归设置；文档管理提供直接AI可见性开关；制作页接真实链路与会话并增加只读组装/回应说明。
- 在同一change接入已定发送PNG与04Windows图标；不使用未采用候选，不引入新AI能力。
- 本提案需确认的行为收口：切换编辑器文档保留按讨论草稿、清除未发送实时选区与待附带提示；此项替换旧清输入合同，随整体范围批准，不视为既有拍板。

## Capabilities

### New Capabilities

- `frontend-ui-v5`: 完整视觉参考、全页迁移、命名、发送彩蛋与Windows图标、响应式及真实应用验收合同。

### Modified Capabilities

- `design-tokens`: 替换旧视觉方向及选中/焦点规则。
- `workspace-navigation`: 四页居中导航及命名。
- `discussion-windows`: 替换为单面板多讨论，移除浮动布局，改变关闭语义。
- `ai-thinking-panel`: 移除多窗口显示要求，采用单面板。
- `persistent-ai-panel-entry`: 统一当前讨论投影、后台状态与材料保留。
- `ai-panel-dom-contract`: 单视图显式契约，切换身份防串接。
- `conversation-list`: 状态归讨论，列表仅覆盖当前面板。
- `ai-request-scheduling`: 隐藏不取消排队，显式停止继续独立取消。
- `stable-writing-width`: 去掉浮动/竖条专属行为，保留稿纸三档及降级。
- `file-management-ui`: 文档管理直接开关与同源菜单。
- `making-module-page`: 制作导航与上下说明图、真实制作承接。
- `ai-panel-state-structure`: 移除停靠/浮动/聚焦窗口状态，按讨论保留完整轮次、草稿及所有在途业务，保持作品级生命周期边界。
- `resident-ai-session`: 显示隐藏/×/切换不使启动或重放失效，保留显式停止/删除/离开/退出失效保护，流式路由及恢复覆盖所有在途讨论。
- `project-mission-governance`: 实施时同步AGENTS能力摘要，替换强制多窗/浮动/关闭停止描述，保留使命、真实能力及永久边界。
- `project-readme`: 实施时同步README单面板与请求生命周期描述，保留其他已实现能力、未来方向及永久边界合同。
- `clear-current-ai-conversation`: 新建独立讨论改为选择单面板投影，保留旧讨论档案、在途请求及结果隔离。

- `selection-ai-summon`: 新召唤选择单面板投影，保留选区浮动按钮、冻结身份、权限及快车道。
- `ai-panel-rendering-boundaries`: 更新单投影与v5 DOM/视觉合同，保留纯派生、唯一状态、安全与action边界。
- `conversation-persistence`: 读档按身份归入有效讨论，隐藏/切换不失效，删除/离开项目/退出仍丢弃迟到结果。
- `ai-module-boundaries`: 明确ai-dock/ai-window单面板职责与注入动作，保留单向依赖和统一请求网关。

- `conversation-management`: 重开有效后台讨论只选择现有运行态，历史读档不覆盖运行态；明确显示切换与业务失效的隔离边界。

本change共21项Modified Capabilities、1项New Capability，对应22份delta/spec文件；文档齐备不表示实施完成。

## Impact

前端入口、样式、DOM契约、AI显示管理/接线、工具栏、文件管理、设置及制作显示层；Tauri图标资源与打包配置。原型mock不能进入产品。后端数据格式、只读工具、模型调用、并发上限4和制作协议不变；保留保存/输入保护、讨论隔离、授权与崩溃恢复。旧多窗口相关测试需替换，其他质量合同继续通过。

本轮仅propose；用户批准范围后apply，真实Windows应用CDP＋用户点击＋视觉比较及总门禁通过后才能归档。
