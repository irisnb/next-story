# conversation-management Specification Delta

## MODIFIED Requirements

### Requirement: 重开讨论不自动重发未完成请求

系统 SHALL 允许从列表重新打开已有讨论并查看已保存内容。重开 SHALL 通过按需读取该讨论的完整档案获得内容，不再依赖列表携带全文。重开 MUST NOT 自动重发未完成的请求，也 MUST NOT 重复生成已完成的内容。

#### Scenario: 重开显示已保存内容

- **WHEN** 用户从列表重开一个已有讨论
- **THEN** 系统按讨论身份读取其完整档案并显示已保存的轮次与终态
- **AND** 未完成轮显示为中断终态，系统不自动重发
