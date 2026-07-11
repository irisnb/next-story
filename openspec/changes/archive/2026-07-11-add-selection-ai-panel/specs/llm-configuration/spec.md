## RENAMED Requirements

- FROM: `### Requirement: 本 change 不提供 AI 写作交互`
- TO: `### Requirement: 唯一 LLM 配置支持受限 AI 思考生成`

## MODIFIED Requirements

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
