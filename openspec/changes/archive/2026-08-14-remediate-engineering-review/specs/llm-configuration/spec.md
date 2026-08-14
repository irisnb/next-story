## ADDED Requirements

### Requirement: LLM 配置文件读取有大小上限
系统 MUST 在读取 `llm-config.json` 前检查其大小，超过上限（64 KiB）时 MUST 返回读取失败，而不是把文件无界读入内存。

#### Scenario: 超大配置文件被拒绝
- **WHEN** 本地 LLM 配置文件超过大小上限
- **THEN** 系统返回中文可读的读取失败
- **AND** 系统不把该文件无界读入内存
