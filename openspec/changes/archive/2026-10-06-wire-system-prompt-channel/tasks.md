# 任务清单：wire-system-prompt-channel

## 1. 驱动侧（sidecar）

- [x] 1.1 `driver.mjs` 在 `createAgentFor` 的 setup 回调按 `session.systemPrompt` 注册 per-agent sections：遮蔽 `deployment:persona`（陪想身份）、追加 `nextstory:constitution`（红线，order 10）、预留 `nextstory:chain-cards` 挂载位次序（order 20，空则不注册）
- [x] 1.2 `protocol.json` 将 `start_session.system_prompt` 描述更新为「宿主必发；驱动注册为 system 层段落」；`adapter.mjs` 按新语义消费与校验
- [x] 1.3 清理 `buildSeedEvents` 的 `system` 死参数（移除或注释指明制度性内容走 section 通道），消除未来误用入口
- [x] 1.4 驱动侧测试：system_prompt 非空时注册生效且次序正确（身份→红线→挂载位）、默认英文 persona 被顶替不残留、正常与重放两路一致

## 2. Rust 宿主侧

- [x] 2.1 新增 system_prompt 纯常量组装函数（身份句＋红线文本，单一来源；起草身份句中文措辞两版供用户过目择一）
- [x] 2.2 `dsh_driver.rs`：`start_session` 携带 system_prompt；崩溃恢复重放时由相同常量重算并重发
- [x] 2.3 `generate.rs` 瘦身：`compose_system_prompt` 移除红线与身份（保留入口姿态句与工具使用说明）；`replay_prompt_prefix` 移除（重放依赖 start_session 携带）
- [x] 2.4 legacy 无状态链路（`build_task_string` / `generate_via_dsh`）等价基准对齐：system 层经通道携带，task 文本不再内嵌制度性内容
- [x] 2.5 Rust 侧测试：首轮 user 文本不含红线与身份句（禁止双份投递）、重发 system_prompt 与原发逐字相等

## 3. 前端对齐

- [x] 3.1 `ai-feature.ts` 显示历史投影与重放对齐：重放首轮不再拼提示词前缀，标签格式与后端新组装保持一致
- [x] 3.2 前端相关测试更新（显示历史投影、崩溃恢复重放渲染）

## 4. 测试与验收

- [x] 4.1 `npm run check` 全绿（typecheck／lint／前端／可靠性／驱动／验证／构建／fmt／clippy／Rust）
- [x] 4.2 既有回归重点复核：材料链路 8 场景、编排回归 5 场景、长上下文套件、崩溃恢复套件【离线契约层经 `npm run check` 全绿覆盖（验证 78／可靠性 121／Rust 430）；应用级崩溃恢复经真机实测（见 4.4）；材料附带在真机直接提问轮验证（回复引用检索片段并如实声明边界）】
- [x] 4.3 P2 实测闭环：真机长对话触发框架压缩后 dump 请求，断言 system 层仍完整含红线（摸底遗留待验证项归档）【装置 `sidecar/driver/tests/manual/p2-compaction-envelope.test.mjs`：真实 DSH 栈＋mock 记录端点，压缩触发两次，全部 6 请求信封完整，四断言全过】
- [x] 4.4 真机验收（账本第 21 条，涉及外部进程与协议变更）：现役端点全场景冒烟、崩溃恢复一致性（重放前后行为对称）、首字延迟与缓存命中观察不恶化【tauri:dev 新代码＋智谱 glm-5.3 现役端点＋8b 作品：直接提问 16.6s／同讨论追问 12.1s／杀驱动进程→自动重启重放→恢复后追问 12.1s 对话连续；轮次总时长与既往基线同区间。诚实边界：召唤入口未在真机重跑（组合层由 generate 测试覆盖、与直接提问共享信封链路）；首字计时口径缺陷（含用户消息渲染）致首内容计时不采信，以轮次总时长为延迟证据；控制台未挂表监听、以无异常行为观察代替】
- [x] 4.5 验证记录落盘并归档 change（openspec archive）【验证记录 `verification/验证记录.md`＋冒烟证据 smoke1/2；归档经用户确认（2026-10-06），主规格同步执行】
