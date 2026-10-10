# task 7.9 隔离数据重启 / 有效运行态复验（独立验证记录）

日期：2026-10-10。范围：change `update-frontend-ui-v5`，tasks `7.9`：验证重开有效后台讨论（生成/排队/授权）只选身份不读盘且状态保留；隐藏/切换/排队/授权不中断；无有效运行态的历史未完成轮重开标中断、不自动重发；文档切换草稿保留、实时未发送选区清除。**仅验证本 lane；未改任何产品源码 / 主 tasks / implementation-record。未提交、未归档、未勾任务。**

## 层级声明（不夸大）

- 使用**真实 Node 磁盘存储**（`mkdtemp` 临时目录；`conversation_save` 写 JSON、`conversation_read`/`conversation_list` 读回），档案由控制器自身保存路径产生，不手工构造非法档案。
- 传输层为 **fake**（零真实模型/网络调用），因此本轮**不是**真实模型链路；「应用重启」由**两个独立控制器实例共享同一磁盘存储**模拟，**不是 Windows 进程重启**。
- 未读取密钥 / 生产正文 / 全局链路；全部数据在隔离临时目录内，测试结束清理。

## 新增验证 fixture

- `verification/restart-isolation-2026-10-10.test.ts`（独立脚本，`node --test` 运行；不进入 `npm run test:frontend` 的 `tests/*` 收集）。

三个用例：

1. `runtime reopen selects identity without disk load and preserves the in-flight request`：首轮成功后经显示层提交追问并挂起（背景生成中，运行期讨论有对话）→ `openDiscussion(summary)` 重开 → 断言**零读盘**（`reads.length` 不变）且请求仍 `loading`（状态保留）。
2. `restart via disk store: unfinished in-flight round reopens interrupted with no auto-send`：实例 1 产生未完成（pending）轮并落盘（断言磁盘档案含 `assistant: pending`）→ 结束实例 1；实例 2（新鲜控制器，仅磁盘恢复）`beginProject`→`openDiscussion` → 断言**读盘一次**、`pending.interrupted === true`、**发送计数为 0（不自动重发）**。
3. `restart isolation does not touch the enabled chain or model (no side effects)`：`beginProject` 不发模型请求（`sendCount===0`）、只加载列表不读正文（`reads===0`）；fixture 未注入任何链路库/LLM 回调。

## 与 7.9 三条合同的对应

| 7.9 合同 | 覆盖证据 |
| --- | --- |
| 重开有效后台讨论（生成/排队/授权）只选身份、不读盘、状态保留 | 新 fixture 用例 1（生成中）；`select_discussion` 运行期优先分支（`state.hasRuntimeConversation`/`getDiscussion` → `selectDiscussion`，不触发 `conversationRead`）。排队/授权讨论同样有运行期身份，走同一分支；其状态保留由 `ai-feature-orchestration.test.ts`（排队）与 `agent-on-demand-reading.test.ts` 7.6（授权等待退出后重开）覆盖。 |
| 隐藏/切换/排队/授权不中断 | `ai-runtime-independence.test.ts`（隐藏不取消在途/排队）、`ai-single-projection.test.ts`（切换后台生成存活）、`ai-feature-orchestration.test.ts`（排队继续）。 |
| 无有效运行态历史未完成轮重开标中断、不自动重发 | 新 fixture 用例 2（两实例磁盘重启）；`ai-feature-persistence.test.ts` 4.4（同进程 harness）。 |
| 文档切换草稿保留、实时未发送选区清除 | `editor.test.ts`（切文档清实时选区、保留 AI 状态）、`ai-runtime-independence.test.ts`（`clearUnsentSelection` 清实时选区保留按讨论草稿）。 |

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test openspec/changes/update-frontend-ui-v5/verification/restart-isolation-2026-10-10.test.ts` | **3/3 通过、0 失败** |
| `node --test tests/ai-feature-persistence.test.ts tests/ai-runtime-independence.test.ts tests/ai-single-projection.test.ts tests/ai-feature-orchestration.test.ts tests/agent-on-demand-reading.test.ts tests/editor.test.ts` | **110/110 通过、0 失败** |

（本轮不改源码，未跑全量 `npm run check` / build / Rust；由父 final check 统管。fixture 未进入项目 tsconfig include，类型由编辑器 LSP 按项目 TS 配置零报错。）

## 副作用 / 安全

- 进程：验证期间**未启动** `next-story`（开始时无运行实例，结束后仍无）；未产生任何锁。
- 数据：仅使用 `%TEMP%\ns-restart-*` 隔离目录，测试 `finally` 清理；残留目录已手动清除（当前计数 0）。
- 网络/模型/密钥/正文/全局链路：**零触碰**。

## 剩余 blocker / 未完成

- **真实 Windows 进程重启 + 截图**：未做。需要安全后端 fixture 接入真实 app 持久化（会触及生产配置/launch），按指示「若需改生产配置不要做」，故采用两实例磁盘存储替代，并如实标注非进程重启。
- **真实模型链路**：未做（传输为 fake），任务 7.4 的真实链路验收另计。
- **排队/授权讨论的“重开零读盘”未单独写用例**：与其生成的运行期优先分支同源（`hasRuntimeConversation` → `selectDiscussion`），现有 `ai-feature-orchestration`/`agent-on-demand-reading` 覆盖其状态保留；如需逐项零读盘断言可在后续补。
- **用户真实点击 / 视觉比对**：属 observer/父代理最终验收。

未提交、未归档、未修改主 tasks。父代理负责最终状态汇总与全门禁。
