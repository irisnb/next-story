# dsh-headless-generation Specification

## Purpose
TBD - created by archiving change spike-dsh-headless-generation. Update Purpose after archive.
## Requirements
### Requirement: DSH headless 生成与现有链等价
系统 SHALL 通过 headless DSH sidecar 生成 AI 思考响应，其输入（冻结选区原文 + 可选方向 + 追问轮次）与输出语义与现有 Rust 生成链一致：不代写正文、不评价故事、纯文本回答、追问仍锚定首次冻结选区。

#### Scenario: 首问生成等价
- **WHEN** 传入一个合法的首问请求（非空选区原文，可选方向）
- **THEN** DSH 路径返回一个非空 assistant 文本，内容只基于选区原文与可选方向，不代写正文、不判断故事好坏

#### Scenario: 追问生成等价
- **WHEN** 传入一个合法的追问请求（原冻结选区 + 完整消息轮次列表，末轮为 user）
- **THEN** DSH 路径返回一个非空 assistant 文本，且回应仍锚定首次冻结选区

### Requirement: DSH 版本锁定
sidecar 使用的 DSH SHALL 锁定为精确版本（当前 `0.1.0-rc.7`），Node 运行时 vendor 到应用内，升级 MUST 经过显式测试。

#### Scenario: 精确锁版
- **WHEN** 应用安装并启动 sidecar
- **THEN** sidecar 运行的 DSH 版本为锁定的精确版本，而非浮动 `latest` 标签

### Requirement: API Key 经钥匙串凭据接缝解析
sidecar SHALL 通过 `dsh-credentials-keyring` 挂载的凭据接缝解析 API Key，读取钥匙串槽位（`service=com.nextstory.desktop`、`account=DEEPSEEK_API_KEY`），不在磁盘落明文。

#### Scenario: 复用已存 Key
- **WHEN** 系统钥匙串中已保存 API Key 且磁盘配置无明文 key
- **THEN** sidecar 从凭据接缝解析到该 Key，无需用户重输

#### Scenario: 缺少 Key
- **WHEN** 钥匙串中不存在 API Key
- **THEN** sidecar 返回「缺少 LLM 配置」类错误，不静默假装成功

### Requirement: 错误契约保持稳定
DSH 路径的错误 MUST 映射到与现有链相同的 `GenerateAiErrorCode` 分类（配置缺失、认证失败、超时、网络、请求过长、服务错误、响应无效），且 `message` 不含 API Key、Authorization、请求正文或完整远端响应。

#### Scenario: 认证失败映射
- **WHEN** DSH 生成因 API Key 无效而失败（退出码非 0 或服务返回 401/403）
- **THEN** 返回 `code = authentication` 的错误，message 不泄露 Key

#### Scenario: 超时映射
- **WHEN** 生成超过超时上限（当前 180 秒）被壳侧强制终止
- **THEN** 返回 `code = timeout` 的错误
