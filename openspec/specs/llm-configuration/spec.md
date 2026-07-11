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
系统 SHALL 提供测试连接动作，并 MUST 使用用户填写的唯一 LLM 配置发起一次真实 OpenAI-compatible chat-completions 模型调用。

#### Scenario: 测试连接成功
- **WHEN** 用户填写可调用的 API 地址、API Key 和模型名并触发测试连接
- **THEN** 系统向该模型发起一次真实测试请求
- **AND** 系统解析返回的 JSON 并确认至少存在一个合法的非空 `choices` 结果
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

### Requirement: 唯一 LLM 配置支持受限 AI 思考生成
系统 SHALL 在保存了完整唯一 LLM 配置后支持选区触发的真实单次 AI 思考生成，同时 MUST NOT 提供多 provider、多模型槽位或 AI 直接写入草稿本和正文本的能力。

#### Scenario: 保存配置驱动真实生成
- **WHEN** 用户已保存完整唯一 LLM 配置
- **AND** 用户从有效选区明确召唤 AI
- **THEN** 系统使用已保存的 API 地址、API Key 和模型名发起一次真实 OpenAI-compatible `chat/completions` 请求
- **AND** 前端不需要再次传入 API Key

#### Scenario: 生成响应必须包含合法模型结果
- **WHEN** 模型服务返回 2xx
- **THEN** 系统仅在响应包含合法非空 assistant `choices` 内容时返回成功
- **AND** 空正文、无效 JSON、错误对象或无合法回复 MUST 被视为失败

#### Scenario: 生成错误使用稳定安全契约
- **WHEN** 生成因缺少配置、认证、超时、网络、请求过长、服务错误或无效响应而失败
- **THEN** 系统返回稳定错误 `code` 和中文可读 `message`
- **AND** 错误不得包含 API Key、Authorization、请求正文或完整远端响应

#### Scenario: 配置能力保持单一
- **WHEN** AI 思考生成功能可用
- **THEN** 系统仍只使用一份保存的 LLM 配置
- **AND** 系统不展示多个 provider、多个模型槽位或不可调用的模型列表

#### Scenario: 生成不改变草稿本和正文本
- **WHEN** 系统使用唯一 LLM 配置生成 AI 思考材料
- **THEN** 系统不修改草稿本、正文本或作品元数据
- **AND** 系统不存在将 AI 输出插入、替换、改写、移动或删除草稿本或正文本的入口

