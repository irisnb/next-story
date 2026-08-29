# dsh-sidecar-lifecycle 变更增量

## MODIFIED Requirements

### Requirement: Sidecar lifecycle is owned and bounded by the host
Rust 宿主 SHALL 负责常驻 sidecar 进程的懒启动、就绪确认、stdout/stderr 排空、请求级超时、崩溃自动重启、优雅退出与进程树强制终止，并 MUST 防止 sidecar 进程或管道在失败后残留。

#### Scenario: Sidecar 懒启动并就绪
- **WHEN** 用户首次发起需要 AI 核心的操作且常驻进程不存在
- **THEN** 宿主启动 sidecar 并等待就绪确认后才发送会话消息

#### Scenario: 请求级超时
- **WHEN** 某次生成在配置的超时上限内未完成
- **THEN** 宿主发送取消指令终止该次生成并返回稳定的 timeout 错误
- **AND** 若框架能确认该轮已干净终止，常驻进程与会话继续服务后续请求
- **AND** 若无法确认干净终止，宿主结束当前会话（见 `resident-ai-session` 的会话不可信语义），不静默继续

#### Scenario: Sidecar 意外退出后自动重启
- **WHEN** sidecar 进程意外退出或输出无法解析
- **THEN** 宿主回收进程资源并自动重启进程
- **AND** 通知前端按崩溃恢复流程重放历史（见 `resident-ai-session`）
- **AND** 不把完整 stderr、密钥或用户请求正文直接展示给用户

#### Scenario: 协议读取与异常处理
- **WHEN** sidecar 运行中
- **THEN** 宿主以独立任务持续排空 stdout 与 stderr，不因读取不及时阻塞子进程
- **AND** 协议消息带版本标识，单帧超长、非 JSON 或未知类型消息按定义策略丢弃并记录诊断日志
- **AND** 持续性协议异常触发会话重建，不静默继续

#### Scenario: 应用退出时清理
- **WHEN** 应用退出
- **THEN** 宿主先尝试优雅结束 sidecar
- **AND** 优雅结束超时后强制终止进程树并回收管道
