# Design: resident-ai-session（常驻 AI 会话进程）

## Context

现状（探底实验 + 代码侦察已确认）：

- Rust 宿主每次生成调用 `Command::spawn` 启动一个 DSH headless 进程（`src-tauri/src/dsh_sidecar.rs:156-281`），task 以命令行参数传入（Windows 实测上限约 3.2 万字符），回复从 stdout 一次性整段取回，进程用完即焚。
- 前端 `src/ai-panel-conversation.ts` 在内存中维护全部对话历史，每轮追问把完整问答轮次重发给后端，后端 `build_task_string`（`src-tauri/src/llm_config/generate.rs:117-187`）把全部历史拼成一个大字符串。
- DSH（`@deepseek-ai/dsh@0.1.0-rc.7`，vendored 在 `sidecar/`）自带会话基建：会话管理（`dsh-session`）、JSONL 持久化插件（`dsh-session-persistence-jsonl`）、自动压缩插件（`dsh-compaction` 系列）、可编程启动（`dsh-app-boot` 导出 `boot`/`composeEntries`）。
- 安全边界现状：`capability_gateway.rs` 定义 17 项禁用工具，每次 spawn 经 `--patch` 注入 `disabled: true`；能力网关只放行文本生成；API Key 经环境变量注入不落盘。

关键事实：模型 API 本身永远无状态——常驻省的是进程开销与手工历史管理，不是"模型记忆"。

## Goals / Non-Goals

**Goals:**

- DSH 会话进程在对话期间常驻：懒启动、增量收发、流式回复、崩溃自动恢复。
- 会话生命周期与产品临时对话同寿命（召唤时就绪；新建对话/切换作品结束会话；退出应用结束进程）。
- 上下文超限由 DSH compaction 插件承接，去掉手搓截断；兜底为报错提示新建对话。
- 安全边界在常驻模式下原样维持（禁工具、能力网关、Key 不落盘、无写入能力）。
- 旧选区工具（及时召唤/思维扩展/浮动入口）退场，代码保留。

**Non-Goals:**

- 不做聊天记录持久化、会话列表、快捷跳转（行动计划事项 4，独立 change）。
- 不做"让 AI 看见作品"（事项 2，等本 change 落地后重新立项；本 change 只保证运输层不再阻碍它）。
- 不升级 DSH 版本（保持锁定 rc.7）。
- 不引入任何 AI 参考优先级/分级模型。
- 不做后台预加载、摘要、记忆、Agent 循环。

## Decisions

### D1. 形态选型：常驻 node 进程驱动 DSH JS API（方案 C）

三个候选（2026-08-28 探索拍板）：

| | A. web profile 常驻 server | B. 自定义 Cordis profile | C. 常驻 node 驱动 JS API |
|---|---|---|---|
| 通信 | HTTP/WebSocket（占本地端口） | 看 CLI 约定 | stdin/stdout 管道（无端口） |
| 碎了修在哪 | Rust 编译代码（WS 协议变更时） | YAML 配置（可能静默失效） | 一个几十行胶水脚本 |
| 安全面 | 网络端口暴露 | 中 | 无网络面，最硬 |
| 升级回归 | 跑到对话才知道坏 | 静默失效最危险 | 探底脚本秒级回归 |

选 C 的理由：① 纯管道通信意味着 AI 进程没有任何网络暴露面，对"AI 隔离"是产品灵魂的项目权重最高；② 升级友好度实测最好——DSH 主包无 `main`/`exports`（纯 CLI 分发器），JS API 分散在子包且无稳定性承诺，但 C 把全部耦合集中在一个胶水脚本里，版本锁死 + 探底脚本可在升级时 2 秒回归；③ 后续事项 2（作品上下文）和 Agent 循环愿景需要消息组装权在自己手里，C 天然满足。

**前置闸门**：tasks 第 1 项为探底验证，验收矩阵如下（允许调用真实模型，费用可忽略；证据存档到 `docs/`）：

| # | 验证项 | 判定 | 结果（2026-08-28 探底） |
|---|---|---|---|
| 1 | `dsh-app-boot` 可编程启动容器 | 必须通过 | ✅ |
| 2 | 会话建立 + 多轮增量收发 | 必须通过 | ✅ |
| 3 | 流式事件可获取 | 必须通过 | ✅（`assistant/chunk` 增量块，每轮 50+ 个） |
| 4 | compaction 在无 JSONL 持久化的常驻容器内触发且无磁盘残留 | 必须通过 | ✅（`compactNow` 全流程 + 压缩后追问连贯） |
| 5 | 无生成的带角色历史注入（`replay_history` 可行性） | 必须通过，否则走 D4 降级 | ✅（`agents.create({seed})`，真实日志与合成 seed 均可行，**无需降级**） |
| 6 | `cancel_message` 干净终止（被取消轮次不残留会话） | 必须通过，否则走 D9 不可信语义 | ✅（`agent.cancel()`；取消由 `agent/inbox/spliced` 持久记录，会话保持可用，**无需不可信语义**） |
| 7 | 容器不装载工具类插件 + 负向能力验证全失败 | 必须通过 | ✅（活跃 23 条目零工具，负向验证全失败） |
| 8 | 优雅退出、无孤儿进程、无残留锁文件 | 必须通过 | ✅（`ctx.fiber.dispose()` 干净退出，无磁盘残留） |

**闸门判定（2026-08-28）：8/8 通过，方案 C 成立，继续实现。** 完整证据与 API 事实见 `docs/resident-session-probe-results.md`。

### D2. 通信协议：stdin/stdout 上的行分隔 JSON

Rust 宿主与常驻 node 进程之间用行分隔 JSON（每行一个消息对象）双向通信，协议带版本标识：

```
Rust ──▶ node:  {type:"start_session", session_id, model, api_base, system_prompt}
                {type:"send_message",  session_id, message_id, text, selection?}
                {type:"replay_history", session_id, turns:[{role:"user"|"assistant", text}...]}
                {type:"replay_done",   session_id}
                {type:"cancel_message", session_id, message_id}
                {type:"end_session",   session_id}
                {type:"shutdown"}
node ──▶ Rust:  {type:"ready", protocol_version}
                {type:"session_started", session_id}
                {type:"delta",  session_id, message_id, seq, text}   ← 流式增量
                {type:"message_done", session_id, message_id, text}  ← 最终全文
                {type:"message_failed", session_id, message_id, code, message} ← 显式失败终态
                {type:"replay_ok", session_id}                        ← 历史注入确认
                {type:"session_ended", session_id}
                {type:"error",  session_id?, message_id?, code, message}
```

- 备选：WebSocket/HTTP（方案 A 自带）——被否，见 D1；自定义二进制协议——过度设计，行分隔 JSON 足够且可 grep 可调试。
- 每条消息带 `session_id` + `message_id`，为迟到结果隔离与幂等处理提供关联键；`delta` 带 `seq` 序号供乱序/缺失检测。
- `replay_history`/`replay_done`/`replay_ok` 服务崩溃恢复（见 D4）：带角色注入历史，**不触发模型生成**；框架是否支持该能力由探底验证，不支持则走 D4 的诚实降级。
- `cancel_message` 服务请求级超时与用户取消（见 D9）。
- `message_failed` 是显式失败终态：部分增量只作显示草稿，不成为成功轮次。
- 协议约束：单帧最大长度（超长帧丢弃并记诊断日志）、UTF-8、未知消息类型丢弃不致命、持续性协议异常触发会话重建；stdout/stderr 由宿主独立任务持续排空，node 侧输出队列有界，防止背压死锁。
- stderr 只作诊断日志，不承载协议。

### D3. 会话生命周期 = 对话生命周期

```
用户召唤 AI ──▶ 进程未活？启动 node 进程并等待 ready（懒启动）
              ──▶ 会话未建？start_session（携带模型配置 + 系统提示词）
新建对话   ──▶ end_session（进程保留复用，下次召唤新起会话）
切换作品   ──▶ end_session（同上）
退出应用   ──▶ shutdown（优雅退出；超时则 kill）
进程崩溃   ──▶ 宿主检测到退出 → 自动重启进程 → 通知前端重放历史
```

- 进程是单例守护对象（Rust 侧 `Mutex<Option<Child>>` 形态的守护者），会话是进程内的逻辑单元；一个进程可先后服务多个会话。
- 不按"每条消息"换会话（行动计划决策 12）。
- 旧会话结束即弃，DSH 侧不保留任何可恢复状态（见 D5）。
- 生命周期事件表（本应用为单窗口桌面应用，窗口关闭即应用退出；多窗口明确不支持，未来引入时需重新立项）：

| 事件 | 动作 |
|---|---|
| 用户召唤 AI（进程未活） | 懒启动进程 → 等待 ready → start_session |
| 用户召唤 AI（进程已活） | start_session（若会话未建） |
| 新建对话 | end_session（进程保留复用） |
| 切换作品 / 卸载作品 / 返回欢迎页 | end_session（进程保留复用） |
| 配置页往返 | 不动会话（沿用现有"配置页往返保留临时对话"语义） |
| 窗口关闭 / 应用退出 | shutdown（优雅退出，超时 kill 进程树） |
| 进程崩溃 / 持续协议异常 | 自动重启进程 → 前端按 D4 恢复 |

### D4. 崩溃恢复：进程重启 + 带角色历史注入，不落盘

- 前端本来就持有全部显示历史（渲染必需），崩溃后由前端把历史以**带角色方式**注入新会话（协议 `replay_history` 携带 user/assistant 顺序轮次 + `replay_done`，node 侧确认 `replay_ok`），**重放期间不触发模型生成**，注入完成后才恢复追问输入。
- **前提由探底验证**：DSH 框架必须支持"无生成的历史注入"。若 rc.7 不支持，诚实降级为"保留面板显示历史 + 中文提示新建对话"——绝不用"重发用户消息触发再生成"伪造恢复（那会产生新回复、污染上下文、浪费调用）。
- 不开启 DSH JSONL 持久化插件——维持"后端不持久保存临时对话"的现有规格；聊天记录持久化是事项 4 的独立决策。
- 备选：开启 JSONL 持久化 + `--resume`——被否，会把"临时对话"变成磁盘事实，与现有规格冲突，且事项 4 尚未拍板存储位置。
- 重放期间面板显示"恢复对话中"状态，追问输入锁定；重放失败则提示新建对话，显示历史不丢。
- 术语边界：显示历史是运行期 UI 状态副本，不是作品事实、不是持久化事实源；重放只重建 DSH 会话上下文，不产生任何写入用户文档的路径。

### D5. 超限处理：compaction 承接 + 诚实兜底

- 装配 `dsh-compaction-basic` 等压缩插件，长对话达到阈值由框架自动压缩。
- **compaction 与"不落盘"的相容性由探底实证**：验证压缩在无 JSONL 持久化插件的常驻容器内真实触发、压缩后追问继续可用、进程目录无会话文件残留、压缩产物（日志/缓存/临时文件）不含用户内容与 API Key。若 compaction 依赖持久化才能工作，本 change 停下汇报，不得把它当作已成立方案。
- compaction 不足仍超限时，映射为现有 `request_too_large` 类错误，中文提示新建对话——绝不静默砍历史（行动计划决策 14：AI 带着残缺记忆陪想是慢性毒药；框架压缩是显式机制，静默丢弃才是毒药）。
- 前端去掉现有"每轮全量重发"路径后，不再需要任何手搓截断规则。

### D6. 流式回复：delta 事件直通面板

- node 侧把 DSH 的流式输出转成 `delta` 事件（带 `seq` 序号）；Rust 侧经 Tauri event 转发前端；面板按打字机方式追加渲染。
- **最终事实的唯一权威来源由探底确定**：若 DSH 提供最终全文，`message_done` 携带全文作为该轮最终事实（前端以 done 替换累积 delta，防拼接歧义）；若 DSH 不提供全文，则**有序 delta 累积**为最终内容，协议不承诺 done 全文——二选一，不双承诺。
- `message_failed` 是显式失败终态：断流、部分增量后出错、完成事件丢失都归入失败；部分文本只作显示草稿，不成为成功 assistant 轮次，可按既有重试语义重试。
- `message_id` 幂等：重复事件不重复追加轮次或累积文本。
- 生成期间仍维持"同一作品同一时刻只允许一个请求"的现有单请求锁语义。

### D7. 安全边界：常驻模式下默认拒绝

- **默认拒绝，而非黑名单禁用**：C 形态的容器装配权在我们手里——胶水脚本只装配文本生成所必需的插件，**根本不装载**任何工具类、文件系统类、命令执行类、网络类或子代理类插件。禁用工具清单（`FORBIDDEN_TOOL_IDS`）因此整体不可达，且清单未来扩充时自动覆盖，无需同步两处。
- 能力网关（`capability_gateway.rs`）不变：只放行文本生成；胶水脚本的协议面只有 D2 列出的消息类型，不存在任何文档写入通道。
- **负向运行时验证**（纳入探底回归脚本）：在常驻进程内尝试写任意文件、执行系统命令、访问未授权作品文件、调用未知工具，全部必须失败且无磁盘副作用；检查 node 进程工作目录与环境不包含作品目录写权限。
- API Key 仍由 Rust 宿主从钥匙串读出，经 `start_session` 的内存消息（或环境变量）注入 node 进程，不落盘、不进日志；协议消息不记录 Key。
- node 进程以 vendored node 运行时启动（沿用现有解析逻辑），不依赖用户 PATH。

### D9. 请求超时与取消：不污染会话

- 协议提供 `cancel_message`：请求级超时或用户取消时，宿主发送取消指令终止该轮生成。
- **干净终止由探底验证**：确认被取消/超时的轮次不会残留在会话上下文中（否则重试会重复、历史会失真）。
- 若框架无法确认干净终止：该会话视为**不可信**，宿主结束会话并提示新建对话——绝不在状态不明的会话上继续追问（残缺记忆是慢性毒药）。面板显示历史保留，不静默丢弃。
- 协议异常分级：单帧解析错误丢弃并记日志，不影响会话；持续性异常触发会话重建（走 D4 恢复流程）。

### D8. 旧选区工具退场：UI 移除，代码保留

- 移除：选区浮动 AI 入口与小菜单、`及时召唤`、`思维扩展`预备态、单条线性追问的旧锚定逻辑。
- 保留：选区快照冻结与纯文本投影机制（`selectedText` 投影规则），继续服务直接提问的"可选重点提示"（`persistent-ai-panel-entry`）。
- 退场代码不删除，留作以后拆用（用户 2026-08-28 拍板）。

## Risks / Trade-offs

- [rc.7 JS API 无稳定性承诺，探底通过后实现中仍可能踩到内部 API 的坑] → 探底脚本覆盖全部关键路径（启动/会话/压缩/流式/禁工具）；实现中每接入一个 API 面就补进探底脚本，保持升级回归资产同步增长。
- [常驻进程成为新的故障面（僵死、句柄泄漏、孤儿进程）] → 宿主守护者负责：请求级超时、心跳/空闲检查、退出时 kill 进程树；崩溃恢复路径（D4）本身也是僵死的兜底。
- [流式渲染引入前端状态复杂度（delta 乱序、收起期间累积）] → 以 `message_done` 全文为最终事实；收起期间照常累积，展开后显示完整结果（沿用现有"收起期间请求完成"语义）。
- [重放恢复在超长对话下耗时] → 重放只发生在崩溃后，属可接受的秒级等待；失败兜底为新建对话。
- [一次 change 触碰面大（运行时 + 流式 + 旧工具退场）] → tasks 按闸门分阶段：探底 → 后端常驻链路 → 前端增量/流式 → 旧工具退场 → 规格修订；每阶段可独立验证后再进下一阶段。
- [compaction 压缩质量不可控（框架炼的摘要可能失真）] → 压缩是 DSH 框架行为，产品侧不二次加工；超限兜底始终是"新建对话"出口，用户始终知情。

## Migration Plan

- 单应用内切换，无数据迁移（旧临时对话本就不持久化，应用更新后自然清空）。
- 回滚策略：change 分阶段提交，运行时切换（后端常驻链路）单独成段；若上线后严重受阻，可回退到上一提交的一次性 spawn 路径（该路径在本 change 完成前保持可编译，切换提交后才移除）。
- DSH 版本、`DSH_HOME` 布局、版本目录隔离（`dsh-sidecar-lifecycle` 现有要求）全部不动。

## Open Questions

- ~~探底验证的结论~~ **已回填（2026-08-28）**：8/8 通过，方案 C 成立。关键映射：`delta` ← `assistant/chunk`；`message_done` 全文 ← `assistant/message` 快照（框架提供）；`replay_history` ← `agents.create({seed})`（合成 seed 可行，D4 无需降级）；`cancel_message` ← `agent.cancel()`（取消不是错误，D9 的"不可信语义"仅作兜底保留）。详见 `docs/resident-session-probe-results.md`。
- `start_session` 携带 API Key 的具体传递方式（内存消息 vs 环境变量）在实现时定，两者都满足"不落盘"约束；探针已验证环境变量方式可行（`DEEPSEEK_API_KEY` 经 `dsh-credentials-local` 解析）。
- compaction 参数调优（`retainRatio`/`thresholdRatio`）在任务 2.1 装配时按目标模型容量定初值，产品验收（事项 3）阶段复核。
