# project-reliability-boundaries Specification

## Purpose
TBD - created by archiving change harden-project-reliability-boundaries. Update Purpose after archive.
## Requirements
### Requirement: Global editor shortcuts respect text input focus
编辑器全局快捷键处理器 SHALL 在非编辑器文本输入控件获得焦点时交还事件，不得执行编辑器保存、撤销、格式化、查找或链接命令。

#### Scenario: AI panel input receives undo
- **WHEN** 用户在 AI 面板文本输入框中按下 Ctrl/Cmd+Z
- **THEN** 编辑器全局快捷键处理器不阻止默认事件
- **AND** 编辑器不执行撤销命令

#### Scenario: Editor surface receives save shortcut
- **WHEN** 用户在编辑器写作区按下 Ctrl/Cmd+S
- **THEN** 编辑器执行保存命令

### Requirement: Unsaved current document deletion is explicit
系统 SHALL 在当前文档存在未保存修改且该文档将从内容树移除时提示用户确认丢失范围；用户取消时 SHALL 保留当前编辑器和未保存内容。

#### Scenario: User cancels deletion aftermath
- **WHEN** 当前文档有未保存修改且内容树更新将移除该文档
- **AND** 用户取消确认
- **THEN** 当前编辑器继续显示原文档和未保存修改

#### Scenario: User confirms deletion aftermath
- **WHEN** 当前文档有未保存修改且用户确认删除
- **THEN** 系统才切换到内容树中的其它文档或空状态

### Requirement: Document load failures preserve valid editor state
文档读取、解析或校验失败时，系统 SHALL 显示中文可读错误；只有成功读取且请求未过期时才替换编辑器内容，不得把失败结果当作空白文档成功加载。

#### Scenario: Switching to unreadable document
- **WHEN** 用户切换到的文档读取失败
- **THEN** 当前有效编辑器内容保持不变
- **AND** 用户看到中文错误提示

#### Scenario: Stale failed load
- **WHEN** 一个已经过期的文档读取请求失败
- **THEN** 该错误不得覆盖更新请求的状态或提示

### Requirement: Content tree traversal is bounded
内容树校验和子树操作 SHALL 使用显式遍历状态并遵守统一最大深度；超过上限时 SHALL 返回结构错误，不得因深层输入触发进程栈溢出或截断结构。

#### Scenario: Over-depth tree is rejected
- **WHEN** 内容树深度超过支持上限
- **THEN** 操作返回中文可读结构错误
- **AND** 原作品文件不被修改

### Requirement: Incomplete transaction recovery is conservative
事务恢复 SHALL 区分未提交暂存事务与提交阶段事务。只有可证明未提交的暂存目录才可自动清理；提交阶段 manifest 缺失、损坏或映射不完整时 SHALL 保留事务文件并拒绝打开，返回人工恢复路径。

#### Scenario: Uncommitted staging directory has no manifest
- **WHEN** 事务尚未进入提交阶段且 manifest 不存在
- **THEN** 系统清理暂存目录并继续读取原有可见世代

#### Scenario: Committing transaction has invalid manifest
- **WHEN** 事务已进入提交阶段且 manifest 缺失或不完整
- **THEN** 系统拒绝打开作品
- **AND** 系统不覆盖或静默删除原文件
- **AND** 错误包含人工恢复所需路径

### Requirement: 作品重开恢复编辑器交互模块
编辑器控制器 SHALL 在作品卸载时释放作品期交互模块，并 SHALL 在同一应用实例重新打开作品时重建查找、工具栏、链接弹层、右键菜单与快捷键模块。重建后每个用户操作 MUST 只由一套当前模块处理。

#### Scenario: 卸载后重开使用保存快捷键
- **WHEN** 用户打开作品、返回欢迎页并再次打开作品后在写作区按下 Ctrl/Cmd+S
- **THEN** 系统执行一次当前文档保存

#### Scenario: 卸载后重开使用右键菜单
- **WHEN** 用户打开作品、返回欢迎页并再次打开作品后在写作区打开右键菜单
- **THEN** 系统显示当前编辑器上下文对应的菜单
- **AND** 菜单命令只作用于当前编辑器

#### Scenario: 未卸载时重复建立作品视图
- **WHEN** 同一编辑器控制器再次建立作品视图
- **THEN** 旧交互模块先被释放
- **AND** 一次快捷键或右键命令只执行一次

### Requirement: 应用级前端控制器统一销毁
持有 DOM 监听、状态订阅或 Tauri 事件监听的应用级前端控制器 SHALL 提供幂等销毁入口。应用窗口真正关闭前，系统 SHALL 销毁这些控制器并释放其监听；若用户取消关闭，系统 MUST 保留控制器和监听继续工作。控制器销毁后，迟到事件或异步结果 MUST NOT 再改变界面状态。

#### Scenario: 窗口确认关闭后释放监听
- **WHEN** 窗口关闭无需拦截或用户确认允许关闭
- **THEN** 系统在销毁窗口前销毁应用级前端控制器
- **AND** 控制器释放其 DOM 监听、状态订阅与 Tauri 事件监听

#### Scenario: 用户取消关闭
- **WHEN** 窗口因未保存内容请求确认且用户取消关闭
- **THEN** 系统不销毁应用级前端控制器
- **AND** 现有编辑器与 AI 交互继续可用

#### Scenario: 重复销毁控制器
- **WHEN** 同一应用级前端控制器被多次请求销毁
- **THEN** 监听释放与会话结束不重复产生有害副作用

#### Scenario: 销毁后的迟到事件
- **WHEN** 控制器销毁后收到旧监听事件或旧异步操作结果
- **THEN** 该事件或结果不再改变界面状态

