# dsh-sidecar-lifecycle Specification

## Purpose
规定 DSH sidecar 的宿主边界：sidecar 从应用资源打包解析、由宿主拥有并限界——懒启动就绪、请求级超时、意外退出自动重启、应用退出清理、启动闸门只认版本正确的 ready。运行时状态按 DSH 版本隔离，升级先验证、失败回滚，崩溃恢复如实不伪造。
## Requirements
### Requirement: Sidecar is packaged and resolved from application resources
系统 SHALL 将精确锁定的 DSH、所需 Node runtime 和 Next Story adapter/patch 作为应用受控资源打包，并在运行时从 resource directory 解析入口路径，不依赖源码目录或用户当前工作目录。

#### Scenario: Packaged application starts sidecar
- **WHEN** 用户从已安装的桌面应用发起需要 AI 核心的操作
- **THEN** 系统从应用资源目录解析并启动锁定版本的 DSH
- **AND** 系统不依赖 `CARGO_MANIFEST_DIR`、开发机源码路径或当前工作目录

### Requirement: Sidecar lifecycle is owned and bounded by the host

Rust 宿主 SHALL 负责常驻 sidecar 进程的懒启动、就绪确认、stdout/stderr 排空、请求级超时、崩溃自动重启、优雅退出与进程树强制终止，并 MUST 防止 sidecar 进程或管道在失败后残留。宿主 SHALL 为每次进程启动分配单调递增的代际标识，并 SHALL 将 reader、请求等待表与进程句柄绑定到所属代际：事件路由、失败清空、标记死亡与就绪等待 MUST 只对当前代生效；旧代的迟到事件、EOF 与清理 MUST NOT 影响当前代的进程、请求或就绪等待。就绪确认 MUST 只接受协议版本正确的 ready 事件；启动期内收到错误事件、其他事件、EOF 或超时 MUST 判定启动失败并回收该代进程。只有已就绪的当前代意外退出才 SHALL 触发崩溃恢复通知；启动失败 MUST NOT 伪装为已建立驱动的崩溃恢复事件。宿主内部锁在中毒后 SHALL 以恢复策略继续完成生命周期、取消与退出清理，MUST NOT 连锁 panic。

#### Scenario: Sidecar 懒启动并就绪

- **WHEN** 用户首次发起需要 AI 核心的操作且常驻进程不存在
- **THEN** 宿主启动 sidecar 并等待就绪确认后才发送会话消息

#### Scenario: 请求级超时

- **WHEN** 某次生成在配置的超时上限内未完成
- **THEN** 宿主发送取消指令终止该次生成并返回稳定的 timeout 错误
- **AND** 若框架能确认该轮已干净终止，常驻进程与会话继续服务后续请求
- **AND** 若无法确认干净终止，宿主结束当前会话（见 `resident-ai-session` 的会话不可信语义），不静默继续

#### Scenario: Sidecar 意外退出后自动重启

- **WHEN** 已就绪的当前代 sidecar 进程意外退出或输出无法解析
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

#### Scenario: 启动闸门只认版本正确的 ready

- **WHEN** sidecar 启动后未输出 ready 即退出，或首帧输出错误事件、其他事件或错误协议版本
- **THEN** 宿主判定启动失败并回收该代进程
- **AND** 当前不存在被认定为就绪的代，启动失败不触发崩溃恢复通知

#### Scenario: 旧代 EOF 不影响当前代

- **WHEN** 驱动因参数变化重启，且旧代 reader 在新代安装之后结束
- **THEN** 旧代 EOF 只清理旧代自身资源
- **AND** 当前代的进程、请求等待与就绪等待全部保留
- **AND** 不误报驱动丢失，不清空当前代的等待者

#### Scenario: 启动失败不伪造崩溃恢复

- **WHEN** 某代在启动阶段失败（而非已就绪后意外退出）
- **THEN** 宿主不发出面向前端的驱动丢失恢复通知
- **AND** 首次请求收到明确的启动失败错误

#### Scenario: 锁中毒后清理路径存活

- **WHEN** 宿主内部某持锁路径发生 panic 导致锁中毒
- **THEN** 后续的取消、进程回收与应用退出路径以恢复策略继续执行
- **AND** 不发生连锁 panic 或清理遗漏

### Requirement: Runtime state is isolated per DSH version
系统 SHALL 为每个 DSH 版本使用独立安装目录、独立 `DSH_HOME`、profile、patch 和插件状态，并 SHALL 通过受控当前版本指针选择已验证版本。

#### Scenario: New version is validated before activation
- **WHEN** 系统安装新的 DSH 版本
- **THEN** 新版本在独立目录和独立 `DSH_HOME` 中加载配置与插件并运行回归测试
- **AND** 测试通过前当前版本指针保持不变

#### Scenario: Failed upgrade rolls back
- **WHEN** 新 DSH 版本的验证失败
- **THEN** 系统不切换当前版本指针
- **AND** 已验证旧版本仍可启动
- **AND** 用户作品文件不被升级或回滚流程改写

