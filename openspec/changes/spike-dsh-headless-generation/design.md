## Context

现有 AI 生成链在 Rust（`src-tauri/src/llm_config/generate.rs` + `http.rs`）：组装固定 system prompt + 用户消息，用 reqwest POST 到 `chat/completions`，抽取 assistant 文本，错误映射到 `GenerateAiErrorCode`。追问是**无状态**的——前端持历史，每次重发完整消息列表（`GenerateAiRequest::FollowUp { messages }`），后端不存会话。

目标是把这条链迁到 headless DeepSeek Harness（DSH）sidecar，作为「一次性迁移到 DSH」前的地基验证。DSH 当前 `0.1.0-rc.7`，developer preview，官方声明「会有破坏性变更」。

约束：铁律 6（UI 可选的模型后端必须真可调用）、铁律 1（AI 永不写用户文档）、错误契约稳定（前端只认 `code`）、追问仍锚定首次冻结选区。

## Goals / Non-Goals

**Goals:**
- 证明 headless DSH 能跑通完整生成链（首问 + 追问）。
- DSH 精确锁版 + vendor Node 运行时。
- `dsh-credentials-keyring` 挂进凭据接缝，验证 API Key 复用。
- 建立 Tauri 壳「启动 / 看守 / 关停」sidecar 通路。
- 保留 Rust 生成链作为对照，DSH 路径可开关。

**Non-Goals:**
- 不迁移作品生命周期（create/open/save）与 LLM 配置（save/load/test）。
- 不做内容树、流式输出、持久化会话、多会话、自我进化引擎。
- 不删除 Rust 生成链（本 spike 只加并行实验路径）。

## Decisions

**D1. 嵌入模式：先用 one-shot headless，ACP 后置。**
- 选 `dsh --profile headless "task"`（版本对齐 0.1.0-rc.7，退出码=成败，stdout=最终答案）。
- ACP（长驻多轮）卡在旧版本线 0.0.1-rc.1、与主线错位，peer 冲突风险高，本 spike 不碰。
- `boot()` 程序化 API 需要宿主自己实现 `appExit` hook，成本高，留作备选。
- 关键验证点：追问（无状态全量历史）能否被序列化进单次 task 而不丢语义——这是 spike 的头号未知数。

**D2. 等价迁移（已定：先 A 后 B）。**
- **A（本 spike）**：迁移第一步保持现有行为——复用 `FIXED_SYSTEM_PROMPT` + 消息构造，无工具、无 agent 副作用。优先用配置实现（设 system prompt + 禁用工具）；不够等价再写最小插件直连模型适配器。
- **B（后续方向）**：DSH 的 agent 能力（思考、工具、自我进化）逐步受控打开，每个能力单独走 OpenSpec，且必须先限制工具（禁写文件、禁命令），守住铁律 1。

**D3. 版本锁定：精确 `0.1.0-rc.7` + vendor Node 22.19+。**
- 不用 `^`；`dsh-headless` 的 `latest` 标签停在过时 0.0.1-rc.1，必须显式 `@next` 或精确版本。
- 升级必须走显式测试，不自动跟新版。

**D4. 凭据：`dsh-credentials-keyring` 挂进 `ctx.credentials`。**
- `service=com.nextstory.desktop`。原「零交接」假设被证伪：DSH 凭据引用名必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`（POSIX 标识符），而 Rust 的 account「llm-api-key」含连字符不合法，DSH 无法直接 resolve。
- 改用**一次性交接**：把 key 从 `llm-api-key` 复制到 `DEEPSEEK_API_KEY`（同 service），迁移瞬间做一次，旧 key 保留。
- 真机已验：`@napi-rs/keyring`（插件底层）与 Rust `keyring` crate 槽位同源兼容，能读回 Rust 写入的 key。

**D5. sidecar 启动/看守：Tauri 壳 spawn `dsh` CLI，传数据目录。**
- Rust 壳负责启动、传 `DEEPSEEK_API_KEY` 之外的环境（配置目录、模型名、API 地址）、监控退出码、异常重启。
- 生成超时由壳侧强制（现有 60s 语义不变）。

**D6. 并行对照：默认仍走 Rust，DSH 路径用开关切。**
- spike 阶段两者并存，便于对比等价性；验证通过后再由后续 change 决定替换。

## Risks / Trade-offs

- [Risk] one-shot headless「只接受一个任务、无交互」承载不了追问语义 → [Mitigation] 追问本就是无状态重发；若序列化丢语义，退到 `boot()` / 自定义插件路线（D1 已列为备选）。
- [Risk] DSH 升级断链 → [Mitigation] 精确锁版 + vendor，升级走显式测试（D3）。
- [Risk] ACP 版本错位，未来「正规多轮」暂时走不通 → [Mitigation] 本 spike 不依赖 ACP；确认 one-shot/插件路线可行即可。
- [Risk] 第三方凭据 provider 挂载无官方逐步教程 → [Mitigation] 插件已实现 `CredentialProvider` 四方法，按 Cordis 插件行挂载，真机验证。
- [Risk] 头less 启动缺 `appExit` host hook → [Mitigation] 直接用 `dsh` 启动器（它自带 `appExit`），不走裸 boot。

## 验证结论（spike 结果，2026-08-17）

**结论：DSH 可行，可作为 Next Story 的后端引擎，「一次性迁移」的地基成立。**

真机已验证：
- DSH `0.1.0-rc.7` 能装、能跑：`dsh --profile headless "task"` 一次性任务，退出码=成败、stdout=最终答案。
- 真生成质量对得上「陪想」：区分文字事实/解释、提问题、给方向、不代写不评价。
- `dsh-credentials-keyring` 挂进 `ctx.credentials` 后，从钥匙串读 key（无环境变量、无明文）。
- 追问（整段对话序列化进一个 task）成立，仍锚定原选区。
- 「A」等价迁移安全：禁用全部工具后生成照常，且要求写文件被明确拒绝、文件未创建（铁律 1 落地）。

关键发现（已更新上方对应决策）：
1. 「零交接」不成立：DSH 凭据引用名必须 POSIX 标识符（`^[A-Za-z_][A-Za-z0-9_]*$`），Rust account `llm-api-key` 含连字符 → 改一次性交接（复制到 `DEEPSEEK_API_KEY`）。
2. DSH dev preview、7 天 7 版、官方声明破坏性变更 → 必须精确锁版 + vendor。
3. ACP 卡旧版本线（`0.0.1-rc.1`，与主线 peer 冲突）→ 用 one-shot headless，ACP 后置。
4. DSH 默认 agent 带工具 → 「A」禁工具；「B」agent 能力（思考/工具/自我进化）后续受控打开。

遗留（归入迁移 phase，本 spike 不展开）：
- vendor Node 运行时打包（1.2）。
- A/B 开关接线到 `generate_ai_thinking`（3.4，默认仍走 Rust）。

补充发现（spike 后期新增，细节见 `docs/dsh-migration-spike.md`）：
5. keyring 插件挂载语法：patch 对 `id` 覆盖要求 `name` 匹配、否则「name mismatch … skipping」跳过；正确做法是 `- id: credentials, disabled: true` + `- insert: [{ id: credentials-keyring, name: dsh-credentials-keyring, config: { service: ... } }]`。
6. Rust spawn 管道死锁：DSH 流式写输出，「退出后再读 stdout/stderr」会写满管道缓冲区（~64KB）而阻塞；必须并发排空（读线程 + `try_wait` 轮询）。
7. 超时需放宽：DSH agent（含思考模式）比原单次 HTTP 慢，60s 不够（真机 25~180s），迁移时要与「关闭思考模式」一起调优。
