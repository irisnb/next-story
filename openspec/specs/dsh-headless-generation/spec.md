# dsh-headless-generation Specification

## Purpose
TBD - created by archiving change spike-dsh-headless-generation. Update Purpose after archive.
## Requirements
### Requirement: DSH headless 生成与现有链等价
系统 SHALL 通过常驻 DSH 会话进程生成 AI 思考响应（本要求标题中的 headless 为历史能力名），其输入（用户问题 + 可选冻结选区重点材料）与输出语义与现有生成链一致：不代写正文、不评价故事、纯文本回答、流式输出。系统 MUST 要求模型区分"从提供材料中可见的内容"与"进一步提出的可能解释、问题或方向"，不把假设冒充作品事实。Runtime Contract MUST 保留任务、事件、结果、错误和能力声明的扩展位。

#### Scenario: 首问生成等价
- **WHEN** 传入一个合法的首问请求（非空问题，可选选区材料）
- **THEN** 常驻会话路径流式返回非空 assistant 文本，内容只基于问题与选区材料，不代写正文、不判断故事好坏

#### Scenario: 追问生成等价
- **WHEN** 在已建立的会话中传入追问
- **THEN** 会话在既有上下文基础上流式返回非空 assistant 文本

#### Scenario: 生成保持陪想姿态
- **WHEN** 系统组装任一轮生成请求
- **THEN** 请求要求模型区分材料可见信息与可能解释，不代写、不润色、不提供可直接替换正文的改写文本，不替用户评价或决定故事方向

### Requirement: DSH 版本锁定
sidecar 使用的 DSH SHALL 锁定为精确版本，Node 运行时 SHALL vendor 到应用内；任何升级 MUST 在独立版本目录和 DSH_HOME 中完成显式回归测试后才能激活，且不得要求前端修改稳定 Runtime Contract。

#### Scenario: 精确锁版
- **WHEN** 应用安装并启动 sidecar
- **THEN** sidecar 运行的 DSH 版本为锁定的精确版本，而非浮动 `latest` 标签

#### Scenario: 升级不改变产品契约
- **WHEN** 已验证的新 DSH 版本被激活
- **THEN** 现有请求、结果和错误契约保持不变
- **AND** 版本特定差异被限制在 adapter、patch 或配置层

### Requirement: 错误契约保持稳定
DSH 路径的错误 MUST 映射到稳定的 `GenerateAiErrorCode` 分类，且 `message` 不含 API Key、Authorization、请求正文或完整远端响应。

#### Scenario: 认证失败映射
- **WHEN** DSH 生成因 API Key 无效而失败
- **THEN** 返回 `code = authentication` 的错误，message 不泄露 Key

#### Scenario: 超时映射
- **WHEN** 生成超过超时上限被壳侧强制终止
- **THEN** 返回 `code = timeout` 的错误

#### Scenario: 请求过长映射
- **WHEN** DSH 生成因上下文窗口超限而失败
- **THEN** 返回 `code = request_too_large` 的错误

### Requirement: API Key 经宿主注入不落磁盘
宿主 SHALL 从系统钥匙串读取 API Key，并以 `DEEPSEEK_API_KEY` 环境变量在 spawn 时注入 DSH（DSH 官方 per-run override，环境变量优先）；API Key MUST NOT 写入 DSH_HOME、settings 或任何磁盘文件。

#### Scenario: 复用已存 Key
- **WHEN** 系统钥匙串中已保存 API Key 且磁盘配置无明文 key
- **THEN** 宿主从钥匙串读出 Key 并注入 DSH 生成，无需用户重输

#### Scenario: 缺少 Key
- **WHEN** 钥匙串中不存在 API Key
- **THEN** 生成返回「缺少 LLM 配置」类错误，不静默假装成功

### Requirement: DSH 能力受 Next Story 安全边界控制
DSH 插件、profile、patch 和工具能力 SHALL 保留可加载和扩展能力，但进入 Next Story 的能力 MUST 经过宿主能力网关；AI 和插件 MUST NOT 写入、追加、替换、删除、移动或整理用户文档，默认也 MUST NOT 执行任意系统命令或任意文件写入。

#### Scenario: Plugin capability is allowed through gateway
- **WHEN** 已安装插件请求一个 Next Story 明确定义且授权的能力
- **THEN** 宿主按能力声明和权限策略转发请求
- **AND** DSH 插件市场和插件运行机制仍然可用

#### Scenario: Plugin attempts document mutation
- **WHEN** DSH、插件或工具尝试修改用户文档
- **THEN** 能力网关拒绝该操作
- **AND** 用户文档内容和保存状态保持不变

### Requirement: DSH 直接提问接受可选选区
DSH 生成接口 SHALL 接受必填的直接提问和可选的选区重点材料；不得要求所有直接提问都提供选区。

#### Scenario: 只有问题时组装任务
- **WHEN** 请求包含非空问题且没有选区
- **THEN** 生成任务包含用户问题，并不因缺少选区而被拒绝

#### Scenario: 问题带选区时区分材料
- **WHEN** 请求同时包含问题和选区
- **THEN** 生成任务明确区分用户问题与重点参考材料

#### Scenario: 空问题被拒绝
- **WHEN** 请求问题为空白
- **THEN** 接口拒绝请求且不调用模型

