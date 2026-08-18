## ADDED Requirements

### Requirement: Sidecar is packaged and resolved from application resources
系统 SHALL 将精确锁定的 DSH、所需 Node runtime 和 Next Story adapter/patch 作为应用受控资源打包，并在运行时从 resource directory 解析入口路径，不依赖源码目录或用户当前工作目录。

#### Scenario: Packaged application starts sidecar
- **WHEN** 用户从已安装的桌面应用发起需要 AI 核心的操作
- **THEN** 系统从应用资源目录解析并启动锁定版本的 DSH
- **AND** 系统不依赖 `CARGO_MANIFEST_DIR`、开发机源码路径或当前工作目录

### Requirement: Sidecar lifecycle is owned and bounded by the host
Rust 宿主 SHALL 负责 sidecar 的启动、stdout/stderr 排空、退出状态处理、超时终止和进程清理，并 MUST 防止 sidecar 进程或管道在失败后残留。

#### Scenario: Sidecar exits successfully
- **WHEN** DSH 完成一次合法任务并退出
- **THEN** 宿主读取完整结果后回收进程和管道
- **AND** 向上层返回成功结果

#### Scenario: Sidecar times out
- **WHEN** DSH 在配置的超时上限内未完成任务
- **THEN** 宿主强制终止 sidecar 及其子进程
- **AND** 回收 stdout/stderr
- **AND** 返回稳定的 timeout 错误

#### Scenario: Sidecar exits unexpectedly
- **WHEN** sidecar 以非零退出码退出或输出无法解析
- **THEN** 宿主回收进程资源
- **AND** 返回脱敏的稳定错误
- **AND** 不把完整 stderr、密钥或用户请求正文直接展示给用户

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
