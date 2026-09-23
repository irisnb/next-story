# workspace-navigation 变更增量

## ADDED Requirements

### Requirement: 切换文档先静默保存且失败阻止切换

系统 SHALL 在切换当前文档前先静默保存当前文档；静默保存失败时 SHALL 阻止切换，保持当前文档、其未保存状态与失败原因可见，MUST NOT 静默丢弃未保存修改。

#### Scenario: 切换前静默保存
- **WHEN** 用户从文档 A 切换到文档 B 且 A 有未保存修改
- **THEN** 系统先保存 A 再完成切换
- **AND** 切换完成后 A 不再带有未保存标记

#### Scenario: 静默保存失败阻止切换
- **WHEN** 切换前的静默保存失败
- **THEN** 系统保持 A 为当前文档、不执行切换
- **AND** 未保存状态与保存失败原因保持可见
