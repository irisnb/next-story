## Why

Next Story 当前的 AI 生成链路走 Rust 直连 HTTP，AI 运行能力受限于现有实现边界。将 DSH 作为 AI 生成的核心运行引擎，可以在保持 Next Story 用户行为和产品宪法不变的前提下，接入 DSH 的插件、Agent 和后续扩展能力，并让核心能够独立升级、回滚和替换。

## What Changes

- 将 AI 首次生成（及时召唤、思维扩展）与临时追问迁移到 DSH headless sidecar，保持 `GenerateAiRequest` / `GenerateAiResult` / `GenerateAiError` 契约和用户可见行为不变。
- 建立 Next Story 与 AI 核心之间的可扩展 Runtime Contract 与能力网关，保留任务事件、能力发现、插件、工具和未来 Agent 能力的扩展空间；本次只接通已验证的 headless 生成与追问。
- 由 Tauri Rust 薄壳负责窗口、sidecar 启动与看守、系统原生安全接缝、外部链接等宿主职责；DSH 承担迁移后的 AI 生成职责。
- 为 DSH 使用应用自有的版本目录、`DSH_HOME` 和 patch/plugin 配置，避免污染用户全局 DSH 状态，并支持版本并存、升级、回滚和替换。
- 保留 DSH 插件市场、插件依赖、profile 和 patch 机制；通过能力网关控制插件能力，不把 DSH 永久压缩成字符串生成器。
- LLM 配置的所有权保留在 Rust（含系统钥匙串中的 API Key）；spawn DSH 时把模型名与 API 地址注入 sidecar，不落明文 key。
- 作品文件事务（创建/打开/保存/校验）保持现有 Rust 实现，不迁移——这是用户文档安全边界，也是铁律 1 的最稳防线。
- 迁移和全量验证完成后，删除旧 Rust 生成 HTTP 直连路径（`llm_config/http.rs`）和临时兼容开关，不保留长期双生成后端。
- **BREAKING**：旧 Rust HTTP 生成实现和过渡期开关将被移除；用户可见的作品数据、写作行为、AI 面板行为和 LLM 配置行为不因此改变。
- 本次不包含作品树、草稿本/正文本废弃、自我进化、Memory、Skill、Policy、Evaluator、Reflection、ACP 长驻协议、新的多 Agent 产品流程，也不迁移作品文件事务。

## Capabilities

### New Capabilities

- `dsh-sidecar-lifecycle`: 管理 DSH sidecar 的打包、启动、看守、超时、退出、清理、版本目录和独立运行状态。

### Modified Capabilities

- `dsh-headless-generation`: 将已验证的 DSH headless 生成转为正式核心能力，补充安全工具边界、凭据、插件/patch、可升级核心和 Runtime 扩展语义。
- `llm-configuration`: 将生成和追问需求从 Rust/HTTP 实现细节改为传输无关的后端生成契约，保持用户可见行为不变。

## Impact

- 影响 `src-tauri` 的 LLM 配置与生成模块、DSH sidecar、插件和运行时配置。
- 影响应用打包资源、Node runtime、DSH 版本锁定、独立 `DSH_HOME` 和 Windows 进程管理。
- 前端 AI 面板和作品编辑行为保持既有契约，但其 AI 生成后端实现从 Rust 直连迁移为 DSH 驱动。
- 作品文件事务与 LLM 配置持久化保持现有 Rust 实现，不迁移。
- 需要补充 sidecar 生命周期、能力网关、插件安全、升级/回滚和端到端生成的测试与诊断。
- 不改变用户文档的事实来源，不允许 AI 直接写入、追加、替换、删除、移动或整理用户文档。
