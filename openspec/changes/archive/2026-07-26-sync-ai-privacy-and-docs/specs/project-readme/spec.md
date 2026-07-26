## MODIFIED Requirements

### Requirement: README distinguishes implemented truth, future direction, and permanent boundaries
项目 README MUST 只将正式规格确认的产品能力描述为已实现，MUST 将未来方向标记为未实现，并 MUST 将永久 AI 边界与普通未实现项目分开说明。

#### Scenario: README lists implemented capabilities
- **WHEN** README 声明当前已实现的产品能力
- **THEN** 每项声明都有当前正式规格中的要求作为依据
- **AND** README 可以将“AI 及时召唤从选区快速开始，召唤时无文字输入”写为已实现
- **AND** README 可以将“思维扩展从选区开始并可带用户填写的可选方向”写为已实现
- **AND** README 可以将“首次回应成功后围绕原冻结选区进行线性临时追问”写为已实现
- **AND** README 说明临时对话只在当前应用打开周期存在，新召唤会替换旧对话
- **AND** README 不得把附近文本、整本摘要、AI 内容库、作品信息、多个对话、历史、持久化、分支、自动摘要、流式输出、停止生成、多 provider 或多模型支持写成已实现
- **AND** README MUST NOT 把已归档实现的思维扩展、可选方向输入或临时追问写成未来未实现

#### Scenario: README refers to future direction
- **WHEN** README 提及尚未归档进正式规格的产品方向
- **THEN** README 将该内容明确标记为未来方向或当前未实现
- **AND** README 不把方向文档当作已实现事实来源

#### Scenario: README states the permanent AI notebook boundary
- **WHEN** README 说明 AI 与草稿本、正文本的关系
- **THEN** README 明确说明首次回应、用户追问和后续 AI 回应都只属于两个本子之外的临时材料
- **AND** README 明确说明 AI 永远不能插入、追加、替换、改写、删除、移动或整理草稿本和正文本内容
- **AND** README 说明内容只有经过用户亲手复制、粘贴、编辑并保存后才进入作品事实

### Requirement: README explains the one-way architecture and current data flows
项目 README SHALL 用初学者可理解的语言说明“前端 → bridge → Tauri commands → Rust domain”的单向责任传递，并 SHALL 说明作品生命周期、LLM 配置和测试、AI 生成与临时追问三条当前数据流。

#### Scenario: Reader follows the architecture chain
- **WHEN** 读者查看架构说明
- **THEN** README 将前端定位到 `src/`
- **AND** README 将 bridge 定位到 `src/project-api.ts`
- **AND** README 将 Tauri commands 定位到 `src-tauri/src/lib.rs`
- **AND** README 将 Rust domain 定位到 `src-tauri/src/project/` 与 `src-tauri/src/llm_config/`
- **AND** README 说明结果和错误会沿调用链返回前端

#### Scenario: Reader follows project lifecycle data
- **WHEN** 读者查看新建、打开或手动保存作品的流程
- **THEN** README 说明前端动作经 bridge 和对应 Tauri command 进入 Rust project domain
- **AND** README 说明 project domain 负责校验并读写作品目录
- **AND** README 说明处理结果返回界面

#### Scenario: Reader follows LLM configuration and test data
- **WHEN** 读者查看 LLM 配置加载、保存或连接测试流程
- **THEN** README 说明配置表单经 bridge 和对应 Tauri command 进入 Rust llm_config domain
- **AND** README 说明该 domain 负责校验和应用本地配置读写，或使用当前唯一配置发出真实 OpenAI-compatible 测试请求
- **AND** README 说明测试连接只发送固定测试语句和身份凭据，不发送用户剧本文字或临时对话
- **AND** README 说明成功状态或可读错误返回界面

#### Scenario: Reader follows AI generation and follow-up data
- **WHEN** 读者查看 AI 生成或临时追问流程
- **THEN** README 说明 AI 及时召唤发送冻结选区原文
- **AND** README 说明思维扩展发送冻结选区原文和用户填写的可选方向
- **AND** README 说明继续追问会发送原冻结选区和当前临时对话中的成功轮次
- **AND** README 说明这些创作内容会发送给用户配置的 API 服务，后端不持久保存临时对话
- **AND** README 说明 AI 返回内容只显示在 AI 面板中，不能写回草稿本或正文本
