# resident-ai-session Delta

## ADDED Requirements

### Requirement: 同一会话命令按序执行且身份唯一

系统 SHALL 让同一会话的 start、replay、send、end 命令按宿主接收顺序执行：驱动侧按会话串行处理命令，宿主侧对同一会话至多保留一个控制确认等待。replay 建立 Agent 期间到达的 send MUST NOT 重复创建 Agent。宿主 MUST 拒绝重复的消息身份注册——重复注册以明确冲突失败，MUST NOT 覆盖既有等待者。start / replay_done / end 的确认 MUST 与事件类型严格匹配，非预期确认 MUST 使对应等待失败关闭，MUST NOT 当作成功。

#### Scenario: replay 期间 send 排队等待

- **WHEN** replay_done 尚未完成时同一会话的 send_message 到达
- **THEN** send 在 replay 完成确认后才启动
- **AND** 只创建一次会话 Agent

#### Scenario: 不同会话命令并行不受影响

- **WHEN** 多个会话同时执行命令
- **THEN** 各会话的串行约束互不阻塞，跨会话并行保持

#### Scenario: 重复消息身份注册被拒绝

- **WHEN** 同一代内同一消息身份的等待注册发生第二次
- **THEN** 第二次注册立即返回明确冲突失败
- **AND** 第一次注册的等待者仍能收到自己的终态

#### Scenario: 控制确认严格匹配

- **WHEN** start_session 的确认等待期间收到其他事件类型
- **THEN** 该等待失败关闭
- **AND** 不把非预期事件当作启动成功
