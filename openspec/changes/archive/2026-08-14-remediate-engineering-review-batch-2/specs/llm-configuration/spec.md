## ADDED Requirements

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
