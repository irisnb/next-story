## ADDED Requirements

### Requirement: 整套界面遵循唯一批准参考
系统 SHALL 按 `方向/前端UI全量更新-设计与实施方案-2026-10-09.md` 及已认可原型v5更新首页、四页、公共组件和边界状态；SHALL 将真实保存、导入导出、制作、连接配置与AI动作接回现有服务，MUST NOT 将演示数据/成功提示作为真实结果。用户已决定的「项目」术语 SHALL 在实施时先同步方向与宪法再统一界面；代码project与存储格式不因此迁移。AI新名未定时 SHALL 保留「AI陪想」。

#### Scenario: 正式操作来自真实状态
- **WHEN** 用户保存、测试连接、制作试问或导入导出
- **THEN** 系统调用真实服务并呈现其成功/失败/取消状态，保留既有未保存保护

#### Scenario: 统一名称
- **WHEN** 用户浏览新界面
- **THEN** 项目容器统一称「项目」，导航为写作、文档管理、制作、设置，无第二套容器名称

### Requirement: 响应布局和工具收纳保持可用
系统 SHALL 在真实Windows1024×670最小外窗、1280×720、1440×900及常用DPI下提供可用布局，MUST NOT 整页等比缩放或出现页面横向滚动。写作最小窗默认正文/AI并排；工具 SHALL 按可用高度收纳至省略菜单并在高窗回流，保留全部既有编辑能力与选区。显示偏好 SHALL 位于设置，留白、三档宽度与存储回退不变；高级连接参数 SHALL 仍可达。

#### Scenario: 矮窗格式能力可达
- **WHEN** 工具栏高度不足
- **THEN** 溢出工具进入省略菜单，原有格式、链接、编号能力可用且不丢编辑器选区
- **AND** 保留既有受控粘贴规则：图片不进入文档，也不产生占位；图文混合仅保留可可靠提取的文字，纯图片不改变文档，均显示相应中文提示；本次更新不新增图片插入功能

#### Scenario: 客户区受DPI影响
- **WHEN** 用户在最小外窗使用高DPI
- **THEN** 布局按实际客户区适应，发送/停止/菜单/正文仍可操作，无整页缩放

### Requirement: 提示和面板头部稳定
图标按钮 SHALL 有中文可访问名称及hover/focus提示；同一触发路径 MUST NOT 并存原生title与自定义提示，长名称完整名title SHALL 保留。AI头动作 SHALL 为讨论、最大化/恢复、关闭，最大化按钮108px，切换边栏/全宽后三个按钮几何边界变化 SHALL 不超过1 CSS px。

#### Scenario: 切换最大化
- **WHEN** 面板在边栏与全宽之间切换
- **THEN** 标签更新且头部动作顺序不变，按钮x/y/宽/高差均不超过1px

#### Scenario: 单一中文提示
- **WHEN** 用户悬停或键盘聚焦按钮
- **THEN** 仅显示一个中文提示，隐藏元素/切页/关闭浮层后提示清除

### Requirement: 发送彩蛋和应用图标各用定案真源
发送按钮 SHALL 使用指定user-mark.png，保持SHA256 `B8296FA14DC2F9C3E889E9DCD9D8677BE1FC9ADA57B1F46EDFEA2ED7DD8A9D96`、alpha与几何，黑底72×32px、图案宽28px高自动，仅按钮内浅显示；MUST NOT 描摹裁切拉伸。应用图标 SHALL 仅由v3的04-aperture标准/小稿及256PNG生成所需WindowsICO/PNG并接入Tauri及安装包，两者 MUST NOT 互替。

#### Scenario: 发送禁用与读屏
- **WHEN** 发送不可用
- **THEN** 按钮不可操作且仍可辨认完整图案，功能名称为发送；不以个人标志名称代替

#### Scenario: Windows壳层图标
- **WHEN** 用户安装并启动正式Windows包
- **THEN** 窗口、任务栏、快捷方式显示04图标，多尺寸及浅深背景可读，无旧候选混入

### Requirement: 归档前完成真实桌面验收
系统迁移 SHALL 通过npm run check、显式npm run package:check及npm run tauri:build，并完成真实Tauri CDP端到端、用户点击、视觉比较，覆盖三尺寸、DPI、并发4、隐藏/切换、授权、保存与制作隔离、两套图案和安装包。Basecoat必需运行文件及MIT许可 SHALL 纳入scripts/check-package-resources.mjs或明确的等价自动检查，留存实际包资源证据；npm run check不包含资源检查，MUST NOT 将其通过当作资源检查通过。证据 SHALL 区分自动断言、人工视觉、原型历史及未完成项；MUST NOT 将原型或mock通过称为产品验收。

#### Scenario: 交付验收报告
- **WHEN** 本change准备归档
- **THEN** 总门禁与真实桌面验收证据完整，任何未过项阻止归档
