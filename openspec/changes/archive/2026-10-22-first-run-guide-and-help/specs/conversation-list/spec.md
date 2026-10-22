## MODIFIED Requirements

### Requirement: 列表入口常驻
面板打开时 SHALL 常驻讨论列表、新建讨论与关闭入口，不因0/1/多讨论突然出现或消失；0条 SHALL 显示引导空态。面板隐藏时 SHALL 通过顶栏AI入口重开边栏后访问列表，不保留旧竖条或浮动入口。

#### Scenario: 数量变化
- **WHEN** 讨论数从0变1或多条
- **THEN** 面板入口保持可达，空列表有引导

#### Scenario: 隐藏后重开
- **WHEN** 面板隐藏且用户点击顶栏AI
- **THEN** 打开右边栏，讨论入口可用，无旧竖条残留
