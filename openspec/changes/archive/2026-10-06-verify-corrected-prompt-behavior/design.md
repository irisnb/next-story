# design：修正后提示底座的真机行为核验（最小路径）

> 前置事实：两段修正已合入主 spec（`dsh-headless-generation`「组装提示声明诚实材料边界」「追问语义围绕当前问题」等场景）。本设计定案最小技术路径、预算口径与证据边界。**本 change 目前无任何真实运行结果。**

## Context

- 验证对象＝**现有模型＋现有人设＋修正后提示**的单组表现，非对照实验：无 A/B/C、无旧提示对照、无 persona 替换（历史方案明确不恢复，见方向草案顶部注记）。
- 四场景直接取自修正所针对的行为面：事实一致性（S1）、诚实材料边界（S2）、追问不被旧选区强牵（S3）、假设不冒充事实（S4）。每场景 n=1，只做逐项符合/偏离记录。
- 既有事实（本阶段源码核读，出处见 F 表）：修正后红线层＝`constitution_prompt()` 两段新文＋永久边界原样；`compose_message_text`（私有）是常驻链每轮组装函数；`assemble_round_context`（`pub(crate)`）是常规取材组装；生产 spawn 面只传 `DEEPSEEK_API_KEY`＋`DSH_HOME`；`resolve_paths(dsh_home, None)` 在开发环境解析到 `sidecar/driver/driver.mjs`；`load_llm_config(base_dir)` 从磁盘配置＋钥匙串拼回完整配置；`message_sent` 只是回应证据回执，不是请求计数。

### 核读事实（F 表，2026-10-06 复核）

| # | 结论 | 出处 |
|---|---|---|
| F1 | 驱动内建重试：`DEFAULT_MAX_RETRIES = 2`（可重试码＝EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT）；driver.mjs 的 `llm-deepseek` patch 仅 `{ baseURL, thinking: "disabled", maxTokens }`，**不含 retryPolicy** → 缺省生效 → 单次模型请求最多 1＋2＝3 次上游尝试 | `sidecar/node_modules/@deepseek-ai/dsh-llm/lib/types/retry-policy.js:12`；`sidecar/driver/driver.mjs:110-113` |
| F2 | 隐藏调用排除：`session-title`、`session-title-llm`、`session-telemetry-otel` 在 `cordis.driver.yaml` 均 `disabled: true`——无标题/遥测类额外模型调用 | `cordis.driver.yaml` 插件清点 |
| F3 | 压缩触发：`compaction-basic` 阈值＝`thresholdRatio`（默认 0.8）×模型上下文窗口；本验证对话为 1–2 轮短文本＋输出上限 2048，与窗口量级差数个数量级，**结构性不可达**（压缩附带的摘要调用不会发生） | `dsh-compaction-basic/lib/index.js:13,60` |
| F4 | 工具取消路径：`cancel_message` → `settleAllPendingToolCalls`＋`agent.cancel()` → `whenIdle` → `message_failed(code=cancelled)`，轮终态后驱动不再为该轮发模型请求 | `driver.mjs:458-466`、`runTurn` 终态路径 |
| F5 | 同会话 `busy` 守卫拒绝并发 send；串行执行下每会话至多一轮在途 | `driver.mjs:430`；`dsh_driver.rs` 准入护栏 |
| F6 | 应用数据目录：tauri identifier `com.nextstory.desktop` → 已保存配置在 `%LOCALAPPDATA%\com.nextstory.desktop\llm-config.json`＋钥匙串（`load_llm_config(base_dir)` 为 pub） | `src-tauri/tauri.conf.json`；`llm_config/mod.rs:595` |
| F7 | 模块内测试先例：`generate.rs` `#[cfg(test)] mod tests` 既有 15 个测试可直接访问私有 `compose_message_text`；真机 ignored 测试先例＝`src-tauri/tests/real_link_on_demand_reading_test.rs`（`#[ignore]`＋手动 `--ignored --test-threads=1`，编译与 lint 进 `npm run check`） | 两文件 |
| F8 | 宿主可观测面：`send_message_and_wait` 返回成功终态（全文＋`sent_confirmed`）或 `Err`（稳定错误码）；`set_tool_call_sink` 可观测工具调用；**请求次数与 wire 层报文宿主不可观测** | `dsh_driver.rs`（MessageOutcome/sinks） |

## Goals / Non-Goals

**Goals**
1. 6 个预定轮次在真实驱动链路上执行，送出文本逐字节来自生产组装函数；宿主可观测证据完整留存。
2. 预算以**推导上界**成立（≤18 次上游尝试）且前提逐项源码复核；不可靠时启用最小计数兜底并明示。
3. 生产零改动（唯一源码改动＝`generate.rs` 测试模块新增测试代码）；`npm run check` 全绿。
4. agent 评审依判定表逐项完成并标明身份；结论措辞不越证据边界。

**Non-Goals**
- 不做对照/统计/盲标人力安排；不称应用 E2E；不测授权流、恢复、压缩、UI；不改 persona/驱动/取材/权限；不搭代理或平台（兜底计数除外且须明示）；不伪造计数或终态。

## Decisions

### D1 实现形态：模块内 `#[cfg(test)]` ignored 真机测试（最小路径）

- 落点：`src-tauri/src/llm_config/generate.rs` 既有 `mod tests` 内新增测试（建议拆 4 个场景函数＋共用夹具函数，均 `#[ignore]` 标注「真机核验：需要已保存配置＋网络，手动 --ignored 运行」）。
- 可达性（零可见性变化）：私有 `compose_message_text` 模块内直接调用；`pub(crate)` 的 `crate::project::assemble_round_context` 同 crate 可达；`pub` 的 `DshDriverManager`/`resolve_paths`/`load_llm_config`/`project::create_new_project` 等直接使用。
- 运行方式：`cargo test --manifest-path src-tauri/Cargo.toml --lib verify_corrected -- --ignored --test-threads=1`（真机往返按分钟计；编译与 lint 进 `npm run check`，默认执行跳过）。
- 不采用：集成测试（够不到私有函数，上次提案为此引入 3 处可见性提升——本次零可见性变化）；`build_task_string`（legacy 无状态链，与常驻链语义不同，不假称等价，本次完全不用）。

### D2 驱动、隔离与配置安全

- 驱动＝生产 `driver.mjs` 经 `resolve_paths(Some(<TempDir>/dsh-home), None)`（开发目录回退到仓库 `sidecar/driver`）——**persona 零改动、零副本、零派生**。
- `DSH_HOME`＝实验 TempDir（驱动状态与会话隔离）；合成作品另建 TempDir（`create_new_project`＋`create_document`＋`save_document`＋`rename_node`，notebook JSON 同既有测试夹具模式）。
- 配置：`load_llm_config(base_dir)`，`base_dir` 取 env `NS_VERIFY_APP_DATA`，缺省 `%LOCALAPPDATA%\com.nextstory.desktop`（F6）——复用用户已保存的模型与钥匙串 Key；`DriverParams{ model, api_base_url, api_key, max_tokens: Some(2048) }`；**密钥零打印零落盘**（记录里只有模型名与端点 host）。无 temperature（未设置，如实记「未设置」）。
- 不使用 `replay_history`/`replay_done`（结构性排除假种子）；不注册 story 工具路由（实验无用户侧授权，工具调用一律取消）。

### D3 组装保真：每轮送出文本＝`compose_message_text` 输出

| 轮 | kind | question | material | context |
|---|---|---|---|---|
| S1 | `First` | 题面（附档） | `None` | `Some(assemble_round_context(作品根, 文档A, None, None, &问题))` |
| S2 | `First` | 题面（附档） | `None` | `Some(…文档B…)` |
| S3-首轮 | `SummonFirst` | `""` | `Some(冻结选区)` | `None`（召唤快车道） |
| S3-追问 | `FollowUp` | 自包含新问题 | `None` | `None`（召唤来源追问快车道，生产行为） |
| S4-首轮 | `First` | 动机问题 | `None` | `Some(…文档C…)` |
| S4-追问 | `FollowUp` | 事实核对问题 | `None` | `Some(以追问问题重组)`（常规来源追问附当轮材料，生产行为） |

每轮先断言组装输出包含修正后新条款关键句、不含旧句（防源码漂移的卫兵断言），再送出；S3-首轮另断言含召唤立场句。追问轮无提示前缀（结构不变，既有测试已钉）。

### D4 预算：推导上界＋前提复核＋最小兜底

- **上界推导**：外层零重试（harness 对 `Err` 不重发）＋驱动内建重试缺省 2（F1）→ 单轮 ≤3 次上游尝试 → 6 轮 **≤18 次**。**口径如实：这是源码推导上界，不是实测请求计数**（宿主不可观测请求次数，F8）。
- **无隐藏续跑前提清单**（实现启动时逐项复核，任一不成立→不运行）：
  1. `llm-deepseek` patch 不含 retryPolicy 且 `DEFAULT_MAX_RETRIES=2`（F1）；
  2. `session-title*`/`telemetry` 禁用（F2）；
  3. 压缩阈值对本对话规模不可达（F3）；
  4. 工具调用取消后无续跑（F4）；
  5. 无 replay/授权挂起路径（D2）。
- **最小兜底（仅当前提复核失败）**：不恢复上次的大型证据代理；启用「仅计数」loopback 代理（单固定上游、只计数落盘、零报文抓取、headers 透传不记），是否启用在执行记录中明示。正常路径不建任何代理。

### D5 参数与墙钟（推荐初值，随提案一次确认）

| 项 | 值 | 说明 |
|---|---|---|
| 输出上限 | 2048 tokens（六轮一致） | `max_tokens=Some(2048)`；生产缺省 131072——**明确偏离并记录**；比生产小，个别长回答可能截断 |
| 单轮超时 | 180 秒 | `send_message_and_wait(.., 180s)`；超时自动 cancel＋宽限收终态 |
| 总墙钟 | 15 分钟 | 触顶停发，未发起轮记「未执行」并注明 |
| 执行顺序 | 严格串行 | 一次一轮；15 分钟窗口内跑完（降低模型状态漂移） |

### D6 工具请求：安全取消、记未完成、拒读不是失败

挂 `set_tool_call_sink`：四件套任一 `tool_call`（含 `story-request-reading` 拒读申请）→ 立即 `cancel_message` → 记**「未完成（工具请求）」**——不是失败，是可观察行为数据；不模拟授权、不回填 `tool_result`；该轮计入记录与评审附注（不进符合/偏离判定主表）。

### D7 证据记录（宿主可观测口径，不谎称 wire 层）

每轮记录（落本 change `verification/`）：git commit、场景/轮次标识、**实际送出字符串全文**（`compose_message_text` 输出＝宿主实发文本）、组装卫兵断言结果、模型名与端点 host（无 key）、参数（2048/未设置 temperature）、终态（`Ok`：全文＋`sent_confirmed`；`Err`：稳定错误码＋固定中文消息）、工具调用事件、起止时间与时长。
**如实边界**：不声称捕获 wire 层报文、请求次数或 `finish_reason`——截断从宿主不可判定，仅当回答明显中途终止时在评审中标注「疑似截断」；`sent_confirmed` 是回应证据回执，不是发送计数。

### D8 评审：agent 逐项评审＋身份标注

- 评审者＝agent（实施或独立评审 agent），**逐项依据材料原文与回答原文按判定表（附档）评审**，报告每项标注「agent 评审」身份与依据引用；**不冒称人工盲测**。用户或任何人工可事后复核，但非本 change 硬依赖。
- 每场景 n=1：只记录符合/部分偏离/明显违背与依据，**无统计结论、无「提升」宣称**；阴性（全部符合）不表述为「修正已充分可靠」，只表述为「本轮四场景未见偏离」。样本不足与 2048 截断风险在报告中如实写明。

### D9 范围与措辞纪律

范围外：工具授权流、崩溃恢复、压缩、调度、UI、完整应用链路。结论只称「隔离真实驱动链路上的行为核验」，**不称应用 E2E**；不把核验结果写成产品能力变化。

## Risks / Trade-offs

- [上界前提因依赖版本变动而失效] → D4 启动前逐项源码复核；不成立即停，兜底仅计数代理并明示。
- [agent 评审偏差] → 判定表提案期定稿（附档）、逐项引用原文依据、身份标注；人工复核开放但不依赖。
- [模型当日状态影响表现] → 15 分钟单窗口串行跑完；记录模型名/时间；不跨日混跑。
- [2048 截断] → 明确偏离记录；疑似截断如实标注，不冒充完整回答。
- [真实 Key 使用] → 仅经 `load_llm_config`→`DriverParams`→spawn env 注入；记录与日志零 key（复核查验）。

## Migration Plan

无部署。执行序＝tasks：附档指纹 → 测试实现 → 前提复核 → 六轮执行 → agent 评审 → `npm run check` → 记录归档 → 用户确认后归档。回滚＝删除新增测试代码（无生产面）。

## Open Questions

无。2048/180 秒/15 分钟为推荐初值，随提案一次确认；评审由 agent 承担并标明身份，已定为方案。

## 收尾处置（2026-10-06，用户明确授权的清理收尾决定）

- **一次性验证器定位**：本设计的执行器（`generate.rs` `mod tests::verify_corrected`，929 行 `#[cfg(test)]` 代码）在六轮核验完成、证据落档后**整体移除**；移除为精准切除，`generate.rs` 与归档基线（HEAD `ec149c2`）零 diff，原有 15 个组装测试与已提交的两段提示修复原样保留。
- **不可重跑声明**：D1–D7 描述的执行机制随执行器移除而**不再是现行代码**；`verification/` 中的历史检查记录仍然有效（记录的是当时真实发生的执行），但删除后**无法经此入口重跑**——如需再验须另行立项。
- **归档走 `archive --skip-specs`**：delta 规格（`corrected-prompt-behavior-verification`）随归档保留为**历史记录、非现行承诺**，不合入主 spec、不新建主 spec——一次性验证器不是产品能力，合入即虚构。
- **冗余清理**：重复长 npm 日志与完成标记删除（门禁通过事实以验证记录文字为准）；过时方向草案《提示底座验证-实验提案草案-2026-10-05.md》按用户决定删除。六轮原始证据、批次 meta、纠正后评审/验证记录、附档全部保留，S1/S2/S3 偏差不掩盖。
