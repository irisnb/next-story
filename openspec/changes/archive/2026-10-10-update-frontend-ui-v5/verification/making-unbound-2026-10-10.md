# 空库直接口述（未绑定制作会话）实施与验证证据

日期：2026-10-10。范围：change `update-frontend-ui-v5`，制作泳道「空库直接口述入口 + 未绑定会话协议」，有界限定操作。**未归档、未提交、未勾任务。**

## 根因（实现前，实测）

- `src/making/making-module.ts` 原「开始新制作」在 `viewChainId === null` 时报错「先在链路库选择或新建一条链路」，空库无法直接口述。
- `src/making/making-session-controller.ts` 的 `startNewSession` 在制作对象为空时直接 return；`MakingConversationRecord.chain_id` 为必填字符串。
- `src-tauri/src/making_session.rs` 的 `validate_record` 拒绝空 `chain_id`，`list_making_conversations` 仅按链路过滤。
- 已核实 `session_id + SessionKind::Making` 身份已支持，无需改 sidecar 驱动协议。

## 改动

- Rust：`making_session.rs`（`chain_id: Option<String>`、空字符串拒绝、按 `Option<&str>` 列表、命令 `Option<String>`）；`chain_library.rs`（新增 `ensure_chain_with_first_version_in_dir` + store 方法 + 命令 `making_chain_ensure_for_conversation`，幂等、不改 active）；`lib.rs` 注册命令。
- TS：`project-api.ts`（类型 `string | null`、`makingConversationList(null)`、新增 `makingChainEnsureForConversation`）；`making-session-controller.ts`（未绑定会话开始/发送/停止/保存/重开、保存草稿建链路并绑定、试问禁用、刷新不清会话）；`making-module.ts`（空库允许直接口述）。

## 命令与结果（本 lane 定向）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/making-conversation.test.ts` | 32/32 通过（新增 6 项：空库未绑定、重启重开、浏览/刷新不清、取消保存不建链路、首次保存建首版并绑定不启用、未绑定禁试问） |
| `node --test tests/making-module.test.ts tests/making-trial.test.ts tests/making-conversation.test.ts` | 94/94 通过 |
| `npm run test:frontend` | 1353/1353 通过、0 失败、0 跳过 |
| `npm run typecheck` | 通过（exit 0） |
| `npm run lint` | 通过（exit 0） |
| `npm run build`（tsc + vite） | 通过（exit 0） |
| `cargo test --lib -- ensure_chain making_conversation_unbound making_conversation_legacy making_conversation_empty` | 6/6 通过（幂等建链路、补首版本、空名回退、未绑定往返与列表、旧档案字符串兼容、空字符串拒绝） |
| `npm run fmt:rust` | 通过（exit 0，先 `cargo fmt` 修正一处测试换行） |
| `npm run clippy:rust`（`--all-targets -D warnings`） | 通过（exit 0） |
| `npm run test:rust` | 通过（lib 505 通过 / 1 ignored；各集成测试全绿） |

环境说明：验证开始前存在一个遗留 `next-story.exe`（target/debug，来自既有调试实例）锁定构建产物；已停止该调试进程以便 clippy / test:rust 构建，未改仓库权限或配置。

## 覆盖的验收要点

- 空库口述仍无链路：新会话 `chain_id === null`，不建链路、不发链路现状附言。
- 未绑定 persist / restart / reopen：每轮整档以 `null` 落盘；新装配后可从未绑定最近入口重开并见历史。
- 浏览另一链路 / refresh / tab 不清未绑定会话、不自动绑定：`setChain` 仅真实变化且绑定不一致时复位。
- 取消保存无链路：`confirm` 为 false 时不调用建链路命令、库为空、仍为未绑定。
- 首次保存建首版并绑定且不启用：`making_chain_ensure_for_conversation` 建确定性链路 id + 首版本，`active` 保持 `null`，会话绑定并切制作对象。
- 幂等 / 部分成功可重试（**2026-10-10 oracle 复审后修正，见下节**）：相同卡内容重试返回 idempotent，不重复建链路/版本；不同卡内容返回 conflict，不追加、不谎称成功；仅有链路无版本时补首版。
- 旧档兼容：字符串 `chain_id` 反序列化为 `Some`。
- 试问与日常/读取隔离：未绑定禁试问；制作助手不读作品、不注册 story 工具（未改动）；未调用生产模型。

## 剩余（不在本 lane 范围）

- 真机/CDP：空库口述完整交互、导航、视觉由父代理与 observer 验收；本轮无真实桌面截图。
- 完整门禁 `npm run check`（含 sidecar reliability/driver/validation）由父代理在 observer/final 改动后统跑。
- 竞态（**撤回原「未见未覆盖缺口」结论**）：原实现有四处未覆盖缺口，已在 2026-10-10 oracle 复审修正（见下节）；原第 41/49 行结论作废。

## 2026-10-10 oracle 复审：四处缺口修正（先复现后修）

| 问题 | 根因（复现） | 修正 |
| --- | --- | --- |
| P1(1) 绑定保存失败态不一致 | `saveDrafts` ensure 建 A 首版后把内存 `record.chain_id` 置 A，`saveSession` 吞错；再次保存走 `chainSaveVersion` 追加第 2 版且不修绑定 | 运行时加 `pendingBindChainId` 待绑定阶段；`saveSession` 返回成功/失败；绑定保存失败进入待补绑定，**重试只补保存绑定**（不重复 ensure、不追加版本）；`persistBinding`/`retryBind` |
| P1(2) ensure 不比较卡内容 | `chain_library` 既有确定链路直接 return，不比对 cards；A 部分成功后重启草稿 B ensure 返回 A 并谎称 B 已保存 | `ensure_chain_with_first_version_in_dir` 返回 `EnsureChainResult{chain, action}`：`created/repaired/idempotent/conflict`；按卡内容（顺序敏感）判重，冲突不追加、不谎称；前端 conflict 时明确提示「请再次保存追加」 |
| P1(3) 整档覆盖可撤/改绑 | `save_making_conversation` 允许 Some→None / 另一 id 覆盖 | 同一把锁内读取现状比对绑定单调保护：`(Some,None)`/`(Some,其他)` 返回 `BindingRegression`；`None→Some` 允许。前端 `saveSession` 同会话串行队列＋快照，旧轮快照不晚到覆盖新状态 |
| P2(4) 未绑定历史/浏览覆盖 | `refreshList` 用 `makingChainId ?? browseChainId`，打开未绑定会话时 `browseChainId` 覆盖列表作用域；`renderHistoryList` 在 `makingChainId===null` 时隐藏 | 新增 `listScopeChainId()`：有打开会话时以会话自身绑定为准（未绑定＝null），不被浏览对象覆盖；历史入口在有打开会话或制作对象时可用；`startNewSession`/`openConversation` 后刷新列表 |

- ensure 边界（新增）：`assert_conversation_bindable` 校验会话真实存在 / 未删除（墓碑）/ 绑定不冲突；会话存储锁内判定后释放，再取链路库锁，两锁不重叠（避免死锁）。

新增/更新测试：

- Rust（`cargo test --lib`）：`ensure_chain_with_first_version_creates_once_and_is_idempotent`、`..._reports_conflict_without_appending`、`..._repairs_chain_without_versions`、`..._falls_back_name`、`save_rejects_binding_regression`、`assert_conversation_bindable_rejects_missing_deleted_and_conflict`、`making_conversation_unbound_roundtrip_and_list`、`making_conversation_legacy_string_chain_id_is_compatible`、`making_conversation_empty_string_chain_id_is_rejected` → 8/8 通过（`cargo test --lib` 全量 508 通过 / 1 ignored）。
- 前端 `tests/making-conversation.test.ts` 新增：绑定写入失败进入待补绑定且重试只补绑定（确保仅 1 次 ensure、0 次 chain_save_version、仍 1 版、重启可链路入口）、ensure 冲突明确不谎报且恢复绑定后追加、两个未绑定会话历史可用且浏览 B 不覆盖列表作用域 → 35/35 通过。

命令与结果（本轮）：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/making-conversation.test.ts` | 35/35 |
| `node --test tests/making-module.test.ts tests/making-trial.test.ts tests/making-conversation.test.ts` | 97/97 |
| `npm run test:frontend` | 1358/1358、0 失败、0 跳过 |
| `npm run typecheck` / `npm run lint` / `npm run build` | 均 exit 0 |
| `cargo test --lib` | 508 通过 / 1 ignored |
| `npm run fmt:rust` / `npm run clippy:rust` | exit 0 |
| `npm run test:rust` | **阻塞**：`target/debug/next-story.exe`（PID 32224，非本 lane 启动）被占用，构建报 `failed to remove file`。按约定不杀用户进程；需父代理协同（停止该调试实例后重跑）。`cargo test --lib` 已覆盖库侧全部单测 |

- 未调用生产模型、未读写用户正文/密钥、未启用全局链路；旧字符串 `chain_id` 兼容；未保存不可试问（未改动）。
- 未勾任务、未提交、未归档。

## 2026-10-10 oracle 追加：两项真实竞态（先 RED 后修）

### R1 旧会话绑定完成抢当前投影
- 根因（RED 复现）：`persistBinding` / `retryBind` 在 `await saveSession` 后**无条件** `switchMakingObject`；旧会话 U1 的绑定保存较慢时用户切到 U2，U1 完成后把制作对象抢成 U1 的链路。
- 修正：新增 `isStillCurrentSession(session)`（`currentId === session.record.id` 且 `sessions.get(id) === session`，即未切走、未替换、未删除）。异步完成后（含 `refreshLibrary`/`refreshList` 之后再判定）才 `switchMakingObject`；保存本身照旧写该会话档案，不因切走而丢失。
- 测试：`tests/making-conversation.test.ts` 新增「a delayed binding save of an old session does not steal the current projection」——用 `saveGates` 延迟 U1 绑定写入，期间新建 U2；放行后断言 `currentConversationId === U2`、`makingChainId === null`（未跳链路）、`U1` 档案 `chain_id` 已保存。

### R2 ensure 校验与写入之间被 delete 插入产生孤链
- 根因（RED 复现）：`assert_conversation_bindable` 取会话存储锁校验后**释放**，`chain_library` 随后另取链路库锁写入；两步之间 `delete_making_conversation`（会话存储锁）可删除会话，之后链路仍被创建 → 孤链。
- 锁序核对（读明确）：`MAKING_CONVERSATION_STORE_LOCK` 只在 `making_session.rs` 的 save/delete/本 helper 使用，锁内不做链路库操作；`chain_library` 的 `with_library` 锁内不访问会话存储（唯一跨存储点即 ensure 命令）。即不存在 chain→session 的相反顺序。
- 修正：以受限 helper `with_conversation_store_lock(dir, conversationId, targetChainId, body)` **在会话存储锁内贯穿「校验 + body（链路库写入）」**，统一 session→chain 锁序；delete 走同一把锁，无法在两步之间插入（无孤链、无死锁）。不用持久 token、不造通用框架。
- 测试：Rust `with_conversation_store_lock_rejects_missing_deleted_and_conflict`（不存在/已删除/绑定冲突拒绝、绑定一致允许）、`with_conversation_store_lock_serializes_concurrent_delete`（body 持锁期间并发 delete 阻塞、放行后完成）、`ensure_via_helper_rejects_deleted_conversation_without_creating_chain`（删除会话后 ensure 拒绝且库中无孤链）。

### R3 saveQueue 受控延迟：首写挂起不丢后续轮与绑定
- 测试实跑（非 source 推导）：`saveQueue keeps ordering: a suspended first write cannot drop a later turn or the binding`——`saveGates` 挂起首次绑定写入，期间发第二轮消息（其整档保存入同一队列），放行后断言最终档案同时保留 `chain_id`、`第一轮`、`第二轮`。

命令与结果（追加修正）：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/making-conversation.test.ts` | 37/37 |
| `node --test tests/making-module.test.ts tests/making-trial.test.ts tests/making-conversation.test.ts` | 99/99 |
| `npm run test:frontend` | 1361/1362，1 失败在 `tests/editor.test.ts:1338`（写作列宽按钮文案，属其它 lane：`src/editor-toolbar.ts:41` 已改为「宽 · 860」，该测试仍断言「宽」；**不在本 lane 范围，未改**） |
| `npm run typecheck` / `npm run lint` / `npm run build` | 均 exit 0 |
| `cargo test --lib` | 510 通过 / 1 ignored（含新增 3 项） |
| `npm run fmt:rust` / `npm run clippy:rust`（`--all-targets -D warnings`） | exit 0 |
| `npm run test:rust` | 未重跑（`target/debug/next-story.exe` PID 32224 非本 lane 启动、占用构建产物；按约定不杀未知进程、不重复失败；`cargo test --lib` 已覆盖库侧全部单测）。需 fix2 协调停止明确 owned 的验收应用后重跑 |

保持不变：first-save 冲突仍需用户再次保存（B 提示）、global active 不改、仅绑定后可试问、旧字符串档案兼容。
