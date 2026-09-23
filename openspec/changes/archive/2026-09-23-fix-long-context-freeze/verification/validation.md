# 验证记录（validation.md）

> 持续更新至归档。**离线部分与真实链路终验均完成于 2026-09-23（终验经用户委托、CDP 模拟真实前端操作）；待归档。**

## 一、实施摘要

| 文件 | 改动 |
|---|---|
| `src-tauri/src/dsh_driver.rs` | 常量 `STALL_WINDOW=180s`／`STALL_POLL_SLICE=250ms`；`Inner` 活动时钟（message_id→最近事件时刻）＋`ActivityGuard` RAII 防泄漏；`route_event` 对一切携带 message_id 的事件刷新时钟（`event_message_id` 逐变体核对：Delta/MessageSent/MessageDone/MessageFailed/ToolCall 必带、Error 可选）；`send_tool_result` 回填即刷新；等待循环挂起分支由裸 `recv()` 重写为 `wait_suspended_with_stall_watch`（250ms 轮询片；授权探针豁免并刷新时钟；非授权静默超窗→与超时路径同构：cancel＋CANCEL_GRACE＋`stall_error()`）；`stall_error` 复用 `GenerateAiErrorCode::Timeout`（零前端改动），文案「生成长时间无响应，已停止本轮；已完成内容保留，可重试」；测试构造器 `new_with_stall_window` 支持短窗注入 |
| `src-tauri/src/story_tool_channel.rs` | 新增 `has_pending_authorization_for_message`（按消息身份查待决授权） |
| `src-tauri/src/ai_host.rs` | 装配时把探针从 story_tool_channel 接到 driver manager |

**未动**：sidecar、前端、spec 增量、`REQUEST_TIMEOUT` 数值与 deadline 前语义（无工具轮行为逐字节不变）。

## 二、裁决记录

**3.3　超时分工与数值**：`REQUEST_TIMEOUT=180s` 维持原职——挂起前的总时限（无工具轮，行为不变）；`STALL_WINDOW=180s` 新任——挂起后的事件间隔静默上限。依据：8b 基线 42 条（首字中位约 3 秒、常态总时长 5–40 秒、最差 59.7 秒含冷启动），180 秒约为最差正常总时长的 4.5 倍、成功轮从未出现超 60 秒静默；数值与 REQUEST_TIMEOUT 统一（「180 秒什么都不发生＝停滞」一句话语义）；内部常量，不做用户设置项、非承诺。

**3.4　配置面**：**裁决不修**。H4 经权威查证反转——官方 glm-5.3 上下文窗口 1M（1,048,576），DSH 回退默认 1,000,000 与之差 4.6%，对 0.8 压缩阈值无实质影响；讨论规模远低于阈值，压缩按设计本就不触发，非缺陷。JSONL 尸检插件维持 disabled：核心修复已使冻结有界，尸检属可选诊断，且 `agents.create` 路径接线未核实。观察项登记（不动）：`thinking:"disabled"` patch 与官方「思考始终开启」出入（实测可跑通）；coding 套餐非指定环境错误码 1113 的识别备注。

**5.3　仪器沉淀评估**：归因仪器为静态源码研读（三路报告）＋定向单元测试，**未产出可复用的长上下文自动驱动测试工具**——8c 评分器三条改进候选按顺带原则**不并入**（无自然交叠），特此记录防止无声扩权。

## 三、测试与门禁（离线全绿，2026-09-23 实测）

**新增测试 7 项**（dsh_driver.rs，假驱动端到端）：
1. `stall_after_tool_result_silence_reports_error_and_releases_permit`（T1＋T2 合一：回填后静默超窗→有界停滞错误＋许可释放，同会话新 send 不被 conversation_busy 拒）
2. `dropped_tool_call_stall_is_also_covered`（sink 未接线、工具被丢弃的挂起轮同样被覆盖）
3. `authorization_wait_exempts_stall_until_resolved`（T3：授权等待豁免，静默超窗仍等；解除后正常收束）
4. `deltas_after_tool_result_refresh_stall_clock_and_complete`（T4：回填后持续增量不误判，总时长超窗仍成功）
5. `manual_cancel_during_silent_suspended_wait_returns_cancelled`（T5：停滞看护期间手动停止有效）
6. `stall_in_one_session_does_not_affect_other_session`（T7：跨讨论隔离）
7. T6（无工具轮超时行为不变）由既有 `admission_permit_release_after_timeout` 等零回归覆盖。

**门禁**：
- fixer 侧：`cargo fmt --check` ✓、`cargo clippy --all-targets` 零警告 ✓、`cargo check --all-targets` 零警告 ✓
- 主控侧：`npm run check` 全链 ✓（typecheck／lint／test:frontend／可靠性 **120/120**／驱动 **13/13**／生产构建分片 214.20／373.53／15.28 kB 不超线／`cargo test` lib **280 过＋1 既有忽略**、集成 12＋33＋2＋33 全过＋3 既有真实链路忽略）；`test:validation` 离线验证 **78/78** ✓

**主控代码复核**：等待循环重写、活动时钟与 ActivityGuard、探针接线、`stall_error`、前端错误映射逐处过目；前端 `ai-panel-view-model.ts:412-417` error 态直接展示 `error.message`——停滞文案经既有通道直达用户，零前端改动确认。

**实施偏差五条已裁决接受**（fix-1 报告）：回填刷新时钟（防授权长等待后陈旧时钟误判）、`touch_activity` 只更新已登记条目（迟到事件不重插，零泄漏）、停滞错误复用 Timeout code、测试时序修正（回填须在 deadline 后）、挂起分支补记 `sent_confirmed`（回执语义补全）。

## 四、诚实边界（修复性质三段式）

- **治本**：H1 结构洞（宿主侧一切等待有界）；H3 名额烧伤（有界返回自动释放 RAII 许可）。
- **不治本、交付兜底**：H2 外部停滞（DSH 内部／端点侧）——修复后「慢」与「死」对用户不再有区别：都是有限等待＋中文错误＋可重试，6 分钟假死不再可能。
- **声明的设计取舍**（design D2 既定）：挂起后静默超 180 秒的轮会被判停滞并停止——若某轮实际是「极慢但终会出」，用户会看到可重试的错误而非等到天荒地老；诚实优先于沉默。
- **未做**：真实链路终验（5.1）。离线测试全部用注入短窗口，真实 180 秒时序行为离线不可测（by design）；停滞错误在真实端到端的实际呈现、长上下文正常轮的事件间隔分布，均待 5.1 实测。

## 五、真实链路终验（5.1，2026-09-23 实测，用户委托 CDP 模拟真实前端操作）

**环境**：release 测试版（含修复，`npx tauri build --no-bundle`）、`--remote-debugging-port=9222` 调试通道、8b 复用仪器 `driver.mjs`（真实鼠标／键入）、智谱 coding 端点 `glm-5.3`（凭证库存量钥匙）、8b 验证作品经最近列表一步重开（无原生对话框）。会话全程控制台**零错误**。

| 场景 | 操作（真实 UI） | 结果 | 计时 |
|---|---|---|---|
| S1 常规轮回归 | 新建对话→「手记篇里今天打算把什么理一遍？」 | ✅ 正常收束，回答引用正文事实 | 首字 5.9 秒／总 8.9 秒 |
| 授权等待豁免（计划外实证） | 重讨论跨文档追问→模型发起补读授权→弹窗等待（首次点击因仪器选择器撞隐藏重复元素失败，弹窗悬置） | ✅ **挂起约 300 秒零停滞误报**（gen 态无报错）——豁免逻辑在真实链路验证通过；处置「允许」后正常续跑 | 首字记录 336.7 秒（**大头为用户驱动授权等待，非模型延迟**，按 8b C3 惯例标注在计时体系外解读） |
| S2 重讨论压测（8b 复现形态） | 25 轮重讨论重开→追问「把沈一苇在主角篇和配角篇里的出场整理成对照表」→允许授权→工具回填→全量上下文续跑 | ✅ 正常收束，产出跨文档对照＋诚实范围说明（「手记篇及另一份隐藏文件未在检索范围」）；「按需补读」出处可见 | 授权后生成 ≤40 秒（跨命令窗口内完成）；本轮**未复现冻结**（间歇性，符合预期） |
| S3 许可释放与讨论可用 | 同讨论紧接追问「沈一苇的钟表铺在哪一篇？」 | ✅ 正常收束、答案正确（配角篇·南旧巷钟表铺） | 首字 4.0 秒／总 4.2 秒——无 conversation_busy，许可已释放 |

**诚实边界（实弹部分）**：
- 冻结本会话未复现——缺陷间歇性（8b 为多轮中三冻结），单会话不复现属预期；修复价值在**有界保证**而非本会话侥幸。「停滞触发→诚实报错」路径（180 秒静默→取消→中文错误）由 7 项单元测试锁定，实弹未走到该分支（端点本次健康），**未获实弹直接证据**，如实记录。
- 实弹直接验证到的是：正常路径无回归（S1／S3）、授权等待豁免零误报（300 秒）、重讨论压测正常收束、许可释放。
- 计时仪器口径备注：`firstResponseDurationMs` 含用户驱动授权等待，跨场景比较须剔除（本档已标注）。
- 仪器勘误留档：`driver.mjs` 的 `click <选择器>` 用 `document.querySelector` 取首个匹配，撞 DOM 中隐藏重复元素会误报「不可见」——可见性过滤的 eval 点击更稳，后续实弹沿用此法。

**证据**：`shots/01–09*.png`（欢迎页→作品重开→面板→S1 发问／结果→S2 弹窗悬置／授权后／终态）、`wait-timing-5-1.json`（3 条记录＋汇总）、控制台错误 `[]`。

## 六、剩余

1. **5.4 归档**：用户确认后 openspec archive（含 AGENTS.md「已知未归因问题」条目随归档更新、主规格同步、全量严格校验）。
