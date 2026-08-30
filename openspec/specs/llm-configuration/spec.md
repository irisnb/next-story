# llm-configuration Specification

## Purpose
TBD - created by archiving change add-llm-configuration. Update Purpose after archive.
## Requirements
### Requirement: 用户可以编辑唯一 LLM 配置
系统 SHALL 提供一个 LLM 配置界面，让用户手动填写并修改一个模型调用配置。

#### Scenario: 查看空配置
- **WHEN** 用户第一次打开 LLM 配置界面且本地尚未保存配置
- **THEN** 系统显示空的 API 地址、API Key 和模型名输入项
- **AND** 系统提示用户需要填写这些信息后才能测试连接

#### Scenario: 编辑配置字段
- **WHEN** 用户在 LLM 配置界面填写 API 地址、API Key 和模型名
- **THEN** 系统在界面中保留用户当前输入
- **AND** 系统不展示多个 provider、多个模型槽位或不可调用的预设模型列表

#### Scenario: 明确 API 基础地址含义
- **WHEN** 用户查看 API 地址输入项
- **THEN** 系统说明该地址必须是 OpenAI-compatible API 基础地址
- **AND** 系统说明不应包含 `/chat/completions`

### Requirement: API 地址必须安全且可解析
系统 SHALL 使用结构化 URL 解析校验 API 地址，并 MUST 防止将 API Key 通过远程明文 HTTP 发送。

#### Scenario: 接受远程 HTTPS 地址
- **WHEN** 用户填写包含合法主机名的 HTTPS API 基础地址
- **THEN** 系统允许保存并测试该地址

#### Scenario: 接受本机 HTTP 地址
- **WHEN** 用户填写 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP API 基础地址
- **THEN** 系统允许保存并测试该地址

#### Scenario: 拒绝远程 HTTP 地址
- **WHEN** 用户填写非本机回环地址的 HTTP API 基础地址
- **THEN** 系统拒绝保存或测试该配置
- **AND** 系统提示远程地址必须使用 HTTPS

#### Scenario: 拒绝结构不完整或含混的地址
- **WHEN** API 地址缺少主机名，或包含用户信息、查询参数、fragment，或已经包含 `/chat/completions`
- **THEN** 系统拒绝保存或测试该配置
- **AND** 系统提示用户填写合法的 API 基础地址

### Requirement: 用户可以保存并重新加载 LLM 配置
系统 SHALL 在用户触发保存时将唯一的 LLM 配置保存到本地系统区域，并在之后重新打开应用时加载该配置。

#### Scenario: 保存有效配置
- **WHEN** 用户填写非空 API 地址、API Key 和模型名并触发保存
- **THEN** 系统保存该 LLM 配置
- **AND** 系统显示保存成功状态

#### Scenario: 重新加载已保存配置
- **WHEN** 用户已经保存 LLM 配置
- **AND** 用户关闭并重新打开应用
- **THEN** 系统在 LLM 配置界面显示已保存的 API 地址和模型名
- **AND** 系统保留已保存的 API Key 用于后续测试连接

#### Scenario: 拒绝保存不完整配置
- **WHEN** 用户尝试保存缺少 API 地址、API Key 或模型名的配置
- **THEN** 系统拒绝保存该配置
- **AND** 系统提示用户补全缺失项

### Requirement: 用户可以测试已配置模型的连接
系统 SHALL 提供测试连接动作，并 MUST 使用用户填写的唯一 LLM 配置发起一次真实 OpenAI-compatible chat-completions 模型调用。系统 MUST 使用与 AI 思考生成相同的 assistant 文本规范化规则判断响应是否包含合法模型结果。

#### Scenario: 测试连接成功
- **WHEN** 用户填写可调用的 API 地址、API Key 和模型名并触发测试连接
- **THEN** 系统向该模型发起一次真实测试请求
- **AND** 系统解析返回的 JSON 并确认至少存在一个合法的非空 `choices` 结果
- **AND** 如果 assistant `message.content` 是字符串，系统以该字符串去除首尾空白后的非空结果作为合法模型结果
- **AND** 如果 assistant `message.content` 是数组，系统按原顺序收集全部非空 `text` part，并以合并后的非空结果作为合法模型结果
- **AND** 系统显示测试连接成功状态

#### Scenario: 2xx 响应不包含有效模型结果
- **WHEN** 服务返回 2xx，但正文为空、不是 JSON、包含错误对象或没有合法的非空 `choices`
- **THEN** 系统显示测试连接失败状态
- **AND** 系统 MUST NOT 将该响应视为模型真实可调用

#### Scenario: 测试连接失败
- **WHEN** 用户触发测试连接但 API 地址、API Key、模型名或网络调用不可用
- **THEN** 系统显示测试连接失败状态
- **AND** 系统提供可读错误信息，帮助用户判断是配置缺失、认证失败、模型不可用还是网络失败

### Requirement: LLM 配置与用户笔记本保持分离
系统 MUST 将 LLM 配置视为系统配置，并 MUST NOT 将其写入草稿本、正文本或作品元信息正文内容。

#### Scenario: 保存 LLM 配置不改变用户笔记本
- **WHEN** 用户保存或测试 LLM 配置
- **THEN** 系统不修改 `作品文本/草稿本.txt`
- **AND** 系统不修改 `作品文本/正文本.txt`
- **AND** 系统不把 API Key 写入草稿本、正文本或用户可见作品正文内容

### Requirement: LLM 配置页必须告知模型服务会收到哪些数据
系统 SHALL 在 LLM 配置界面用用户可见文案说明测试连接与 AI 生成发送给已配置模型服务的数据范围。系统 MUST 区分测试连接只发送固定测试语句与身份凭据，AI 生成会发送创作相关内容。告知内容 MUST NOT 暗示只有 API Key 会离开本机。

#### Scenario: 用户查看配置页隐私告知
- **WHEN** 用户打开 LLM 配置界面
- **THEN** 系统说明 API Key 会作为身份凭据发送给已填写的 API 服务
- **AND** 系统说明测试连接只发送固定测试语句，不发送用户剧本文字或临时对话
- **AND** 系统用一行可见说明告知 AI 请求会把问题原文、可选选区原文以及当前对话此前的问答上下文发送给已配置的模型服务
- **AND** 系统说明第三方服务如何处理这些数据取决于用户与该服务的协议或设置

#### Scenario: 配置页隐私告知保持作品边界
- **WHEN** 系统展示 LLM 配置隐私告知
- **THEN** 告知说明 AI 回复仍是两个本子之外的临时材料
- **AND** 告知不得提供或暗示 AI 可以直接写入、插入、替换、改写、删除、移动或整理草稿本和正文本

### Requirement: 配置界面不得破坏写作现场
系统 MUST 在用户从编辑器进入 LLM 配置界面时保留当前作品、当前本子和未保存文本状态。

#### Scenario: 从欢迎页进入并返回配置
- **WHEN** 用户从欢迎页进入 LLM 配置界面并触发返回
- **THEN** 系统返回欢迎页

#### Scenario: 从编辑器进入并返回配置
- **WHEN** 用户从编辑器进入 LLM 配置界面并触发返回
- **THEN** 系统返回进入前的编辑器
- **AND** 当前作品、当前本子和未保存文本保持不变

### Requirement: 配置异步操作不得互相覆盖
系统 SHALL 将表单有效状态与异步忙碌状态分开管理，并 SHALL 忽略过期的配置加载结果。

#### Scenario: 保存或测试期间修改输入
- **WHEN** 保存或测试连接尚未完成且用户修改输入
- **THEN** 系统保持保存和测试按钮不可再次触发
- **AND** 系统不会并发发起第二个保存或测试动作

#### Scenario: 过期加载结果返回
- **WHEN** 较早的配置加载请求晚于较新的加载请求返回
- **THEN** 系统忽略较早请求的结果
- **AND** 系统不覆盖用户在此期间输入的内容

### Requirement: LLM 配置页未保存修改必须保护离开
系统 SHALL 在 LLM 配置页存在未保存配置修改时保护离开流程，并 MUST 让用户明确选择保存并离开、放弃修改并离开，或取消离开。

#### Scenario: 修改配置后返回前要求确认
- **WHEN** 用户在 LLM 配置页修改 API 地址、API Key 或模型名
- **AND** 用户未成功保存当前配置
- **AND** 用户触发返回
- **THEN** 系统显示离开确认
- **AND** 系统不直接切换到欢迎页或编辑器

#### Scenario: 保存并离开成功
- **WHEN** LLM 配置页存在未保存配置修改
- **AND** 用户触发返回并选择保存并离开
- **AND** 当前配置保存成功
- **THEN** 系统更新配置保存基线
- **AND** 系统清除配置未保存状态
- **AND** 系统离开 LLM 配置页

#### Scenario: 保存并离开失败
- **WHEN** LLM 配置页存在未保存配置修改
- **AND** 用户触发返回并选择保存并离开
- **AND** 当前配置保存失败
- **THEN** 系统停留在 LLM 配置页
- **AND** 系统保留当前输入
- **AND** 系统保持配置未保存状态

#### Scenario: 放弃修改并离开
- **WHEN** LLM 配置页存在未保存配置修改
- **AND** 用户触发返回并选择放弃修改并离开
- **THEN** 系统离开 LLM 配置页
- **AND** 系统不保存当前配置修改
- **AND** 系统清除当前配置页的未保存状态

#### Scenario: 取消离开继续编辑
- **WHEN** LLM 配置页存在未保存配置修改
- **AND** 用户触发返回并选择取消
- **THEN** 系统停留在 LLM 配置页
- **AND** 系统保留当前输入
- **AND** 系统保持配置未保存状态

#### Scenario: 离开确认不得泄露 API Key
- **WHEN** LLM 配置页存在未保存 API Key 修改
- **AND** 系统显示离开确认
- **THEN** 离开确认不显示 API Key 明文

### Requirement: LLM 配置未保存修改必须保护窗口关闭
系统 SHALL 在原生窗口关闭前检查 LLM 配置页未保存修改，并 MUST 仅在相关离开保护全部通过后关闭窗口。

#### Scenario: 仅配置未保存时关闭窗口要求确认
- **WHEN** 编辑器文本没有未保存修改
- **AND** LLM 配置页存在未保存配置修改
- **AND** 用户触发窗口关闭
- **THEN** 系统显示离开确认
- **AND** 用户取消或保存失败时窗口保持打开

#### Scenario: 配置保存后允许关闭窗口
- **WHEN** LLM 配置页存在未保存配置修改
- **AND** 用户触发窗口关闭并选择保存并离开
- **AND** 当前配置保存成功
- **THEN** 系统关闭窗口

#### Scenario: 编辑器与配置都未保存时全部通过才关闭
- **WHEN** 编辑器文本存在未保存修改
- **AND** LLM 配置页存在未保存配置修改
- **AND** 用户触发窗口关闭
- **THEN** 系统分别保护需要保存或放弃的未保存内容
- **AND** 只有全部离开保护通过后系统才关闭窗口
- **AND** 任一保护取消或保存失败时窗口保持打开

#### Scenario: 配置关闭保护不修改用户笔记本
- **WHEN** 系统因 LLM 配置未保存修改保护窗口关闭
- **THEN** 系统不修改草稿本、正文本或作品元数据

### Requirement: 唯一 LLM 配置支持受限 AI 思考生成
系统 SHALL 在保存了完整唯一 LLM 配置后支持直接提问或及时召唤触发的真实流式 AI 思考生成与当前临时对话的继续追问，同时 MUST NOT 提供多 provider、多模型槽位、磁盘会话存储或 AI 直接写入用户文档的能力。

#### Scenario: 保存配置驱动真实首次生成
- **WHEN** 用户已保存完整唯一 LLM 配置
- **AND** 用户提交直接提问（可选附带选区）
- **THEN** 系统通过常驻会话生成链发起一次真实流式生成
- **AND** 首次请求只包含后端组装的行为任务、用户问题和可选冻结选区原文
- **AND** 前端不需要再次传入 API Key

#### Scenario: 保存配置驱动召唤首轮生成
- **WHEN** 用户已保存完整唯一 LLM 配置
- **AND** 用户通过及时召唤以选区发起首轮
- **THEN** 系统通过常驻会话生成链发起一次真实流式生成
- **AND** 首轮请求只包含后端按召唤语义组装的任务与冻结选区原文，不包含用户输入的问题文本
- **AND** 前端不需要再次传入 API Key

#### Scenario: 保存配置驱动真实追问生成
- **WHEN** 当前临时对话已有首次成功回应
- **AND** 用户提交有效追问
- **THEN** 系统通过常驻会话生成链发起一次真实流式生成
- **AND** 请求只携带本次追问内容，此前问答上下文由常驻会话在进程内维护
- **AND** 本次追问在模型消息中只出现一次

#### Scenario: 后端运行期会话不落盘
- **WHEN** 系统完成首次或追问生成请求
- **THEN** 后端在应用运行期通过常驻会话维护对话上下文
- **AND** 会话上下文不写入磁盘，应用退出后随进程结束而消失
- **AND** 后续追问不要求前端重新提交此前轮次

#### Scenario: 会话消息必须合法
- **WHEN** 前端提交会话消息
- **THEN** 系统只接受合法的会话、消息身份标识
- **AND** 系统拒绝前端提供 system 消息
- **AND** 直接提问首轮与追问请求拒绝空白问题文本
- **AND** 召唤首轮允许空问题文本，但 MUST 要求非空的冻结选区材料
- **AND** 同一消息身份的重复提交被幂等处理，不产生重复轮次

#### Scenario: 不隐式添加上下文
- **WHEN** 系统组装首次或追问模型请求
- **THEN** 系统不添加选区附近文本、本子全文、摘要、作品元数据、用户确认的作品信息或 AI 内容库
- **AND** 上下文超限由框架压缩能力显式承接（见 `resident-ai-session`），前端与宿主不手搓截断

#### Scenario: 生成错误使用稳定安全契约
- **WHEN** 首次或追问生成因缺少配置、消息无效、认证、超时、网络、请求过长、服务错误或无效响应而失败
- **THEN** 系统返回稳定错误 `code` 和中文可读 `message`
- **AND** 错误不得包含 API Key、Authorization、请求正文、临时对话全文或完整远端响应

#### Scenario: 生成不改变用户文档
- **WHEN** 系统使用唯一 LLM 配置生成首次或追问 AI 思考材料
- **THEN** 系统不修改用户文档或作品元数据
- **AND** 系统不存在将 AI 输出直接写回用户文档的入口

### Requirement: LLM 配置文件读取有大小上限
系统 MUST 在读取 `llm-config.json` 前检查其大小，超过上限（64 KiB）时 MUST 返回读取失败，而不是把文件无界读入内存。

#### Scenario: 超大配置文件被拒绝
- **WHEN** 本地 LLM 配置文件超过大小上限
- **THEN** 系统返回中文可读的读取失败
- **AND** 系统不把该文件无界读入内存

### Requirement: API Key 存入操作系统凭据存储
系统 MUST 将 LLM 配置中的 API Key 保存到操作系统凭据存储（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service），并 MUST NOT 把 API Key 以明文写入 `llm-config.json`。`llm-config.json` MUST 只保存非敏感字段（API 地址、模型名）。

#### Scenario: 保存配置不落盘明文 Key
- **WHEN** 用户保存 LLM 配置
- **THEN** API Key 写入操作系统凭据存储
- **AND** `llm-config.json` 不包含 api_key 字段
- **AND** 系统仍能加载完整配置用于测试连接和 AI 生成

#### Scenario: 旧明文配置自动迁移
- **WHEN** 磁盘上存在旧格式的含明文 api_key 的 `llm-config.json`
- **THEN** 系统加载时把 api_key 迁入凭据存储
- **AND** 把 `llm-config.json` 改写为不含 api_key 的新格式

#### Scenario: 凭据存储不可用时明确报错
- **WHEN** 配置文件存在但系统凭据存储无法读取 api_key
- **THEN** 系统返回中文可读错误
- **AND** 系统不以空 key 静默继续

### Requirement: 配置保存是原子的
系统 MUST 将 API Key 写入凭据存储与 `llm-config.json` 写入视为一个原子保存流程，并 MUST NOT 出现「凭据存储里的 Key 与磁盘配置里的服务地址来自两次不同保存」的分裂状态。保存失败时系统 MUST 恢复到与磁盘配置一致的旧状态。并发保存 MUST 被串行化。

#### Scenario: 磁盘写入失败不留下密钥分裂
- **WHEN** 用户把配置从服务 A + Key A 改为服务 B + Key B
- **AND** 磁盘配置文件写入失败
- **THEN** 系统恢复到旧配置（服务 A + Key A）
- **AND** 系统不留下「服务 A 地址 + Key B」的分裂状态
- **AND** 系统返回中文可读的保存失败错误

#### Scenario: 并发保存被串行化
- **WHEN** 两个配置保存请求同时到达
- **THEN** 系统串行执行两个保存
- **AND** 最终凭据存储与磁盘配置来自同一次保存

### Requirement: 加载配置不返回明文密钥
系统 MUST 在加载已保存 LLM 配置时向前端返回非敏感字段与一个 `has_api_key` 布尔值，并 MUST NOT 返回明文 API Key。前端 MUST 显示固定掩码而非真实密钥。用户未输入新密钥时，测试连接与 AI 生成 MUST 由后端复用凭据存储中的现有密钥。

#### Scenario: 重新加载配置不返回明文 Key
- **WHEN** 用户已保存 LLM 配置并重新加载
- **THEN** 系统返回 API 地址、模型名与 `has_api_key: true`
- **AND** 系统不返回 `api_key` 字段
- **AND** 前端以掩码显示「已保存」状态，而不回填真实密钥

#### Scenario: 无新密钥时测试连接复用后端密钥
- **WHEN** 用户已保存 LLM 配置且未输入新密钥
- **AND** 用户触发测试连接或 AI 生成
- **THEN** 后端复用凭据存储中的现有密钥
- **AND** 前端不需要再次传入 API Key

### Requirement: 生成请求拒绝未知字段
系统 MUST 在解析 AI 生成请求时拒绝未知字段，并 MUST NOT 静默忽略 `draft_content`、`main_content`、`project_path` 或其它未在请求契约中声明的字段。拒绝时系统 MUST 返回中文可读错误且 MUST NOT 修改草稿本、正文本或作品元数据。

#### Scenario: 注入未知字段被拒绝
- **WHEN** 生成请求载荷包含未声明的字段（如 `draft_content`、`main_content`、`project_path`）
- **THEN** 系统拒绝该请求并返回中文可读错误
- **AND** 草稿本、正文本与作品元数据保持不变

