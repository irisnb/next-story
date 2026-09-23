# find-replace 变更增量

> 归档备忘：主规格 Purpose（第 4 行）「在当前本子可见文字上字面匹配」应随归档同步为「当前文档」——delta 格式只支持 Requirement 级操作，Purpose 修正并入归档步骤，此处仅登记。

## REMOVED Requirements

### Requirement: 查找在当前本子可见文字上字面匹配并高亮
**Reason**: 标题含旧世界「本子」措辞，随本 change 对账重构。
**Migration**: 由下方 ADDED 承载，语义连续。

## ADDED Requirements

### Requirement: 查找在当前文档可见文字上字面匹配并高亮
系统 SHALL 在当前文档的可见文字上进行字面查找，支持区分大小写开关，并 MUST 高亮全部命中、显示命中总数与当前序号，提供上一个与下一个的导航。查找高亮是装饰，MUST NOT 改变文档内容、结构或保存结果。查找范围 MUST 只包含当前文档，不跨到其它文档。

#### Scenario: 查找并高亮命中
- **WHEN** 用户输入要查找的文字
- **THEN** 当前文档中所有命中处被高亮
- **AND** 系统显示命中总数

#### Scenario: 上一个与下一个导航
- **WHEN** 存在多个命中且用户点击下一个
- **THEN** 光标移动到下一命中处
- **AND** 当前序号随之更新

#### Scenario: 区分大小写开关
- **WHEN** 用户开启区分大小写并查找某词
- **THEN** 只匹配大小写完全一致的命中
- **AND** 关闭后匹配不区分大小写

#### Scenario: 查找不改变文档
- **WHEN** 用户执行查找后立即保存
- **THEN** 保存结果与查找前一致
- **AND** 高亮不进入文档结构
