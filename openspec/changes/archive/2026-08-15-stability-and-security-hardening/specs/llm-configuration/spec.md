## ADDED Requirements

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
