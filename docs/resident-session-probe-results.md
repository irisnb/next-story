# 探底实验存档：DSH rc.7 常驻会话能力验证（2026-08-28）

> change: `resident-ai-session` 任务 1.1。脚本：`sidecar/probe/probe.mjs`（独立探针，不进产品代码）。
> 运行方式：`$env:DEEPSEEK_API_KEY = <key>; node sidecar/probe/probe.mjs <api_base> <model>`
> 每次运行在独立临时 `DSH_HOME`（`sidecar/probe/.probe-home`，可随时删除重建）。
> 本脚本同时是升级回归脚本（任务 2.5 扩展后覆盖完整协议面）：DSH 升级后重跑，秒级回归。

## 验收矩阵结果：8/8 全部通过

| # | 验证项 | 结果 | 关键证据 |
|---|---|---|---|
| ① | 容器可编程启动 | ✅ | `boot()`（`@deepseek-ai/dsh-app-boot`）+ `loadProfile`/`composeEntries` 组装 headless profile + 探针 patch，返回已稳定根上下文 |
| ② | 会话建立 + 多轮增量收发 | ✅ | `agents.create()` → `agent.followup(createUserMessage(...))` → `agent.whenIdle()`；第二轮正确引用第一轮内容 |
| ③ | 流式事件可获取 | ✅ | 实测 52–62 个 `assistant/chunk` 增量块/轮，可实时逐块观察 |
| ④ | compaction 无持久化可用 | ✅ | `ctx.compaction.compactNow(agent, signal, id)` 在禁用 JSONL 持久化的容器内完成：`compaction/start` → `compaction/summary` → `compaction/end`，压缩后追问连贯 |
| ⑤ | 无生成的带角色历史注入 | ✅ | `agents.create({ seed })` 两种方式均可行：A. 真实日志整体 seed；B. **从显示历史重建的合成 seed**（克隆轮次结构、替换文本）——崩溃恢复路线打通 |
| ⑥ | cancel 干净终止 | ✅ | `agent.cancel()`：取消由 `agent/inbox/spliced` 事件持久记录（无 `turn/end`），部分文本保留为 chunk（框架标记为未完成轮次），取消后追问连贯且模型知晓已取消 |
| ⑦ | 默认拒绝（无工具能力） | ✅ | 容器只装配文本生成必需插件，活跃 23 条目中零工具条目；负向验证无磁盘副作用 |
| ⑧ | 优雅退出 + 无磁盘残留 | ✅ | `ctx.fiber.dispose()` 干净退出、无孤儿进程；`DSH_HOME` 仅 4 个脚手架文件（profile 清单/patch/workspace、匿名用户 id），无会话 JSONL、无 sqlite、无凭据文件、无锁文件，内容级扫描无对话文本/key 泄漏 |

## 关键 API 事实（实现任务 2.x/3.x/4.x 的依据）

- **启动**：`boot(binName, absoluteConfigPath, patches, prepare?)`；条目 = `loadProfile(binName, "headless", installAnchor, home, {userLayer:false})` 的层 + 自定义 patch，经 `composeEntries` 合成后写 YAML（`!!js` 方言需自定义 js-yaml schema round-trip）。裸包名从配置目录父级解析（`sidecar/probe/` → `sidecar/node_modules`）。
- **驱动 Agent**：`agents.create({ sessionId, meta:{cwd}, seed?, agentOptions:{provider,model}, setup })`；`setup` 必须是块体（返回 undefined，返回值会被当 `AgentSetupCommit` 调 `.commit()` 报错）；内部调 `installModelSelection(agentCtx, {current: selection, assembled: undefined})`。
- **发消息**：`agent.followup(createUserMessage({content:[{type:"text",text}], source:{kind:"user"}}))`；`await agent.whenIdle()` 等待轮次结束。
- **流式**：轮询 `agent.session.events`（追加后快照失效重建）。事件序列：`agent/inbox/spliced → turn/start → step/start → user/message → request/header → request/context → assistant/chunk×N → assistant/message → step/end → turn/end`。`assistant/chunk` 的 `data.chunk.type` 有 `block-start`/增量/`finish`；`assistant/message` 是整段快照（可作 `message_done` 全文来源）。
- **取消**：`agent.cancel()`。**无 `turn/end` 事件**；取消由 `agent/inbox/spliced`（2 条）持久记录；部分文本保留为 chunk。产品语义：取消 = 轮次未完成（面板显示"已取消"），不映射为错误。
- **compaction**：`ctx.compaction.compactNow(agent, signal, commandId)`。区域选择 = 最老整轮单位（保留尾部之外，`retainRatio` 默认 0.16 可配）；收缩校验严格（摘要必须小于被压缩区域）——小对话会正确失败（`ManualCompactionError`），产品场景（上下文 80% 自动触发，区域数万 token）摘要必然更小。`compaction/summary` 事件的 `summary[].text` 是摘要正文。
- **历史注入**：`agents.create({ seed })`，seed 事件必须 seq 从 0 连续、无未闭合 turn/step。真实日志直接可用；**合成 seed（显示历史重建）也通过验证**——产品崩溃恢复可按"克隆轮次结构 + 替换文本"构造，无需落盘。
- **禁工具**：默认拒绝 = 不装载工具类插件（非黑名单 disable）。`FORBIDDEN_TOOL_IDS` 整体不可达，清单扩充自动覆盖。

## 环境发现（与 change 无关但必须告知用户）

1. **当前产品的 AI 配置打不通 API**（既有问题，非本次改造造成；2026-08-28 经用户澄清修正解读）：
   - 两把 key 分属两个服务，互不相关：钥匙串 `llm-api-key`（sk-e4b4b…）是 Next Story 自己保存的 key；`llm-config.json` 明文里的（sk-5d2a2…）是 z30 中转的 key（用户在 opencode 里也用同一把）。
   - 实测确认的问题：配置的 API 地址 `https://z30.top` 少了 `/v1`——适配器在 baseURL 后直接拼 `/chat/completions`，实际请求打到 `https://z30.top/chat/completions`，返回的是 HTML 网页 → `STREAM_CLOSED` 错误。
   - 修复（二选一，用户决定）：用 z30 中转 → 地址改为 `https://z30.top/v1`（配 z30 的 key）；用 DeepSeek 官方 → 地址改为 `https://api.deepseek.com`（配钥匙串那把 key）。在应用配置页重新保存即可。
2. **规格偏离**：`llm-config.json` 中残留明文 `api_key` 字段，违反现行规格"API Key 只存钥匙串、配置文件只存非敏感字段"。既有问题，不在本 change 范围，建议另立小 change 清理（加载时迁移 + 重写文件）。

## design.md 回填对照

- D2 协议：`delta` ← `assistant/chunk`；`message_done` 全文 ← `assistant/message` 快照（框架提供，无需自行拼接）。
- D4 崩溃恢复：`replay_history` 协议消息映射为 `agents.create({seed})`；合成 seed（显示历史重建）已验证可行，**无需降级方案**。
- D5 compaction：机制验证通过；`retainRatio`/`thresholdRatio` 立项时按模型容量调参；自动触发（80% 阈值）场景区域大，收缩校验必然满足。
- D9 取消：映射为 `agent.cancel()`；产品按"无 turn/end + inbox/spliced 标记"处理，取消不是错误。
