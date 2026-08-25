# 实施计划：不限轮统一临时对话（persistent-ai-panel-entry 任务 5/6）

- **日期**：2026-08-26
- **状态**：待实施（本文件只是计划，不修改任何源码/测试/OpenSpec，不提交 git）
- **范围**：`openspec/changes/persistent-ai-panel-entry/` 的 **任务 5（统一临时对话）** 与 **任务 6（验证与边界检查）**
- **验证 owner**：主会话（本计划不执行验证，只定义验证步骤与命令）
- **铁律遵守**：AI 永不写作品文档；不持久化、无会话列表；不引入 Agent 循环/检索/摘要/记忆/后台预加载；一次只开一个 change

---

## 1. 背景与目标

当前代码里，**直接提问**（`direct_question` 请求 kind）首轮成功后只停留在独立的 `direct_question` 请求状态，**不能继续追问**；而**选区召唤 / 思维扩展**首轮成功后进入 `TemporaryConversation`（`ai-panel-conversation.ts`），可线性追问。

任务 5/6 的目标：让**三个首轮入口（直接提问、AI 及时召唤、思维扩展）在首轮成功后统一进入同一种不限轮临时对话**，每轮请求携带此前完整问答，首轮选区作为锚点冻结。收起保留、切文档/作品/关闭应用清空、失败保留追问重试、单飞与迟到隔离、不持久化、不写作品文档。

**核心约束**：尽量复用现有 `TemporaryConversation`、`follow_up` 请求和 reducer，**不创建第二套状态**。

---

## 2. 设计决策摘要

### 2.1 泛化 `TemporaryConversation` 支持直接提问来源

`TemporaryConversation.initialUserMaterial` 从 `Extract<GenerateAiRequest, {kind:"first"}>` 泛化为 `first | direct_question` 联合；`anchor` 从 `SelectionSnapshot` 改为 `SelectionSnapshot | null`（直接提问无选区时为 `null`）。

### 2.2 直接提问首轮成功后进入统一对话

`begin_direct_question` 分配对话 id（复用 `pendingFirstConversationId`）；`succeed_direct_question` 创建 `TemporaryConversation`（锚点 = 冻结选区或 `null`，material = `direct_question` 请求），并把请求状态迁移到统一的 `success`（`phase: "first"`），清空草稿。失败/配置缺失仍保留 `direct_question` 请求状态与草稿供重试。

### 2.3 请求状态 `snapshot` 改为可空

直接提问无选区时，统一对话的 `success`/`loading`/`error`/`configuration_required` 请求状态没有选区快照，因此这些请求状态的 `snapshot` 字段改为 `SelectionSnapshot | null`，view-model 与 scroll 控制器相应处理 `null`。

### 2.4 追问请求复用 `follow_up`，新增 `origin` 判别

`buildFollowUpRequest` 对两种来源分别组装：
- `first` 来源：维持现状（messages 以 assistant 首轮回应开头，`selected_text` 来自冻结选区）。
- `direct_question` 来源：messages 以 user 原问题开头，再接 assistant 首轮回应与后续轮次；`selected_text` 为冻结锚点（无选区时为空串）；请求带 `origin: "direct_question"`。

Rust 侧 `GenerateAiRequest::FollowUp` 新增可选 `origin` 字段，据此选择系统提示词（`DIRECT_QUESTION_SYSTEM_PROMPT`）并放宽校验（允许空 `selected_text`、允许 messages 以 user 开头）。

### 2.5 编排与生命周期不变

`ai-feature.ts` 的 `onDirectQuestionSuccess` 已调用 `state.succeedDirectQuestion`，reducer 改造后即自动创建对话；追问回调（`succeedFollowUp` 等）基于对话工作，直接提问来源的对话同样可用。作品/文档切换的 `reset` 已清空对话、草稿、待附带选区与忽略标记，无需新增清理路径。

---

## 3. 文件职责地图

| 文件 | 在本 change 中的职责 |
|------|----------------------|
| `src/ai-panel-conversation.ts` | 泛化 `TemporaryConversation`（`initialUserMaterial` 联合、`anchor` 可空）；`createConversationFromFirstSuccess` 接受可空锚点与泛化 material；`buildFollowUpRequest` 按来源组装追问载荷；`readonlyConversationView` 处理可空锚点 |
| `src/types.ts` | `GenerateAiRequest.follow_up` 新增可选 `origin?: "selection" \| "direct_question"` |
| `src/ai-panel-request-state.ts` | `loading`/`success`/`error`/`configuration_required`/`first_preview`/`first_blocked`/`thinking_expansion` 的 `snapshot` 改为可空；工厂函数接受可空快照 |
| `src/ai-panel-reducer.ts` | `begin_direct_question` 分配对话 id；`succeed_direct_question` 创建对话并迁移到 `success`；追问各 case 传可空锚点 |
| `src/ai-panel-view-model.ts` | `requestFacts` 处理可空 `snapshot`（无快照不显示选区块）；`buildDirectQuestionView` 在进入对话后返回 `null`（隐藏直接提问表单，改由统一对话呈现） |
| `src/ai-panel-scroll.ts` | `shouldReset` 处理可空 `request.snapshot` |
| `src/ai-feature.ts` | 无需结构性改动（`onDirectQuestionSuccess` 已接 `succeedDirectQuestion`）；仅验证接线 |
| `src-tauri/src/llm_config/mod.rs` | `GenerateAiRequest::FollowUp` 新增 `origin` 字段；新增 `FollowUpOrigin` 枚举 |
| `src-tauri/src/llm_config/generate.rs` | `validate_generate_ai_request` 按 `origin` 放宽校验；`build_task_string` 按 `origin` 选系统提示词并组装任务 |
| `tests/ai-panel-conversation.test.ts` | 新增直接提问来源对话测试；更新受影响的既有断言 |
| `tests/ai-panel-state.test.ts` | 新增/更新直接提问成功进入统一对话、追问、锚点冻结、收起恢复、生命周期清理测试 |
| `tests/ai-panel-view-model.test.ts` | 新增/更新可空快照与统一对话显示测试 |
| `tests/ai-panel-dom.test.ts` | 新增/更新直接提问成功后渲染统一对话与追问表单的 DOM 回归测试 |
| `tests/ai-feature-direct-question.test.ts` | 更新直接提问成功后的编排断言（进入对话） |
| `tests/ai-feature-routing.test.ts` | 新增直接提问来源追问载荷测试 |
| `src-tauri/tests/llm_config_test.rs` | 新增 `origin` 校验与任务组装测试 |

---

## 4. 任务与 TDD 步骤

> 每个行为遵循：**先写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过**。
> 命令（在仓库根目录 `D:\Next Story` 执行）：
> - 前端单测：`node --test tests/<file>.test.ts`
> - 前端全量：`npm run test:frontend`
> - 类型检查：`npm run typecheck`
> - Lint：`npm run lint`
> - 构建：`npm run build`
> - Rust 测试：`npm run test:rust`
>
> **本计划不安排任何 git commit**（项目未授权提交）。

---

### 任务 5：统一临时对话（三个首轮入口共享）

#### 5.1 泛化 `TemporaryConversation` 支持直接提问来源

**行为**：`TemporaryConversation` 能保存直接提问来源的首轮材料（问题 + 可选选区），锚点可为 `null`；`createConversationFromFirstSuccess` 接受可空锚点与泛化 material；`readonlyConversationView` 正确处理可空锚点。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-conversation.test.ts`）：
   - 新增 `createFromFirstSuccess` 用 `direct_question` material 与 `null` 锚点创建对话，断言 `initialUserMaterial.kind === "direct_question"`、`anchor === null`、`firstResponse` 正确。
   - 新增 `readonlyView` 对 `null` 锚点返回 `anchor === null` 且不抛错。
2. **运行确认失败**：`node --test tests/ai-panel-conversation.test.ts` → 类型/断言失败（当前 `initialUserMaterial` 只接受 `first`，`anchor` 非空）。
3. **最小实现**（`src/ai-panel-conversation.ts`）：
   - 新增 `export type FirstRoundMaterial = Extract<GenerateAiRequest,{kind:"first"}> | Extract<GenerateAiRequest,{kind:"direct_question"}>`。
   - `TemporaryConversation.anchor: SelectionSnapshot | null`；`initialUserMaterial: Readonly<FirstRoundMaterial>`；`ReadonlyTemporaryConversation` 同步。
   - `createConversationFromFirstSuccess(context, conversationId, snapshot: SelectionSnapshot | null, firstRequest: FirstRoundMaterial, response)`：`anchor = snapshot ? frozenSnapshot(snapshot) : null`。
   - `readonlyConversationView`：`anchor: conversation.anchor ? Object.freeze({...conversation.anchor}) : null`。
4. **运行确认通过**：`node --test tests/ai-panel-conversation.test.ts` → 通过。

#### 5.2 请求状态 `snapshot` 改为可空

**行为**：`loading`/`success`/`error`/`configuration_required`/`first_preview`/`first_blocked`/`thinking_expansion` 的 `snapshot` 可为 `null`；view-model 与 scroll 控制器不因 `null` 崩溃。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-view-model.test.ts`）：新增「`success` 请求带 `snapshot: null` 时，`buildAiPanelView` 返回 `snapshot === null` 且不抛错」。
2. **运行确认失败**：`node --test tests/ai-panel-view-model.test.ts` → 类型/断言失败。
3. **最小实现**：
   - `src/ai-panel-request-state.ts`：上述变体的 `snapshot: SelectionSnapshot | null`；工厂函数参数改为可空。
   - `src/ai-panel-view-model.ts` `requestFacts`：`snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null`（各相关 case）。
   - `src/ai-panel-scroll.ts` `shouldReset`：`request.snapshot` 为 `null` 时跳过 `sameSelectionSnapshot` 比较（`lastRequestSnapshot` 也允许 `null`）。
4. **运行确认通过**：`node --test tests/ai-panel-view-model.test.ts` → 通过。

#### 5.3 reducer：直接提问首轮成功后进入统一对话

**行为**：`begin_direct_question` 分配对话 id；`succeed_direct_question` 创建对话（锚点 = 冻结选区或 `null`，material = `direct_question` 请求），请求迁移到 `success`（`phase:"first"`），清空草稿；失败/配置缺失仍保留 `direct_question` 状态与草稿。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-state.test.ts`）：
   - 更新既有「direct question success clears the draft and keeps the frozen question」：改为断言成功后 `state.conversation` 非空、`initialUserMaterial.kind === "direct_question"`、`anchor` 为冻结选区、`view.request` 为 `{kind:"success", snapshot, response, conversationId, phase:"first"}`、草稿清空。
   - 新增「direct question 无选区成功：`conversation.anchor === null`、`view.request.snapshot === null`」。
   - 新增「direct question 成功后 `beginFollowUp` 可用并进入 `loading`（`phase:"follow_up"`）」。
   - 新增「direct question 失败保留草稿与 `direct_question` error 状态」。
2. **运行确认失败**：`node --test tests/ai-panel-state.test.ts` → 断言失败（当前成功后仍是 `direct_question` success，无对话）。
3. **最小实现**（`src/ai-panel-reducer.ts`）：
   - `begin_direct_question`：`const allocation = allocateConversationId(state.conversationContext)`；`conversationContext: clearConversationContext(allocation.context)`；`pendingFirstConversationId: allocation.conversationId`。
   - `succeed_direct_question`：校验 `request.kind === "direct_question" && request.status === "loading"`；取 `conversationId = state.pendingFirstConversationId ?? 分配`；构造 `material: Extract<GenerateAiRequest,{kind:"direct_question"}> = { kind:"direct_question", question: request.question, ...(request.selection ? { selected_text: request.selection.selectedText } : {}) }`；`anchor = request.selection ? frozenSnapshot(request.selection) : null`；`createConversationFromFirstSuccess(...)`；`request: firstSuccessRequest(created.conversation.anchor, event.response, conversationId)`；`pendingFirstConversationId: null`；`directQuestionDraft: ""`。
   - 追问各 case（`begin_follow_up`/`succeed_follow_up`/`fail_follow_up`/`require_follow_up_configuration`/`accept_edited_follow_up`/`cancel_follow_up`/`accept_follow_up_retry`）把 `conversation.anchor`（现可空）传给工厂函数。
4. **运行确认通过**：`node --test tests/ai-panel-state.test.ts` → 通过。

#### 5.4 追问载荷：直接提问来源携带完整问答与 `origin`

**行为**：`buildFollowUpRequest` 对直接提问来源组装 `follow_up` 载荷：messages 以 user 原问题开头，再接 assistant 首轮回应与后续轮次；`selected_text` 为冻结锚点（无选区为空串）；带 `origin: "direct_question"`。`first` 来源维持现状。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-conversation.test.ts`）：
   - 新增「direct question 来源对话 `followUpRequest()`：messages 首条为 `{role:"user", content: 原问题}`，随后 assistant 首轮回应与轮次，末条为当前追问；`selected_text` 为冻结选区；`origin === "direct_question"`」。
   - 新增「direct question 无选区来源：`selected_text === ""` 且 `origin === "direct_question"`」。
   - 更新既有「follow-up request uses frozen selected text…」确保 `first` 来源不携带 `origin`。
2. **运行确认失败**：`node --test tests/ai-panel-conversation.test.ts` → 断言失败。
3. **最小实现**：
   - `src/types.ts`：`follow_up` 新增 `origin?: "selection" | "direct_question"`。
   - `src/ai-panel-conversation.ts` `buildFollowUpRequest`：按 `material.kind` 分支组装 messages；`selected_text: material.selected_text ?? ""`；`...(material.kind === "direct_question" ? { origin: "direct_question" as const } : {})`；`...(material.kind === "first" && material.thinking_direction ? { thinking_direction: material.thinking_direction } : {})`。
4. **运行确认通过**：`node --test tests/ai-panel-conversation.test.ts` → 通过。

#### 5.5 Rust：`follow_up` 支持 `origin` 与直接提问来源

**行为**：Rust 接受带 `origin: "direct_question"` 的 `follow_up` 请求：允许空 `selected_text`、允许 messages 以 user 开头；`build_task_string` 用 `DIRECT_QUESTION_SYSTEM_PROMPT` 并组装「原问题 + 可选重点材料 + 轮次」。

**TDD 步骤**：

1. **写失败测试**（`src-tauri/tests/llm_config_test.rs`）：
   - 新增「direct_question origin 的 follow_up 允许空 selected_text 且 messages 以 user 开头」。
   - 新增「direct_question origin 的 follow_up 任务包含 `DIRECT_QUESTION_SYSTEM_PROMPT`、原问题、可选重点材料与轮次」。
   - 新增「selection origin（无 origin）仍拒绝空 selected_text、要求 assistant 开头」。
2. **运行确认失败**：`npm run test:rust` → 失败（当前无 `origin` 字段、校验固定）。
3. **最小实现**：
   - `src-tauri/src/llm_config/mod.rs`：`FollowUp` 新增 `origin: Option<FollowUpOrigin>`；新增 `#[derive(..., serde::Deserialize)] #[serde(rename_all="snake_case")] pub enum FollowUpOrigin { Selection, DirectQuestion }`。
   - `src-tauri/src/llm_config/generate.rs`：
     - `validate_generate_ai_request`：`is_direct = matches!(origin, Some(FollowUpOrigin::DirectQuestion))`；`!is_direct` 时要求 `selected_text` 非空；首条期望角色按 `is_direct` 取 User 否则 Assistant；末条必须 User。
     - `build_task_string`：`is_direct` 时用 `DIRECT_QUESTION_SYSTEM_PROMPT`，首条 user 消息标「用户问题」，其后按角色标「你的上一次回应」/「用户追问」，并在原问题后插入可选「重点参考材料（可选）：{selected_text}」；否则维持现状。
4. **运行确认通过**：`npm run test:rust` → 通过。

#### 5.6 view-model：统一对话显示（可空快照 + 直接提问表单隐藏）

**行为**：直接提问成功后进入统一对话，`buildDirectQuestionView` 返回 `null`（隐藏直接提问表单），`buildConversationView` 呈现首轮回应与追问表单；可空快照不显示选区块。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-view-model.test.ts`）：
   - 新增「直接提问成功进入对话后：`directQuestion === null`、`conversation` 含首轮回应、`followUpForm` 可用」。
   - 新增「`success` 请求 `snapshot: null` 时 `snapshot === null`」。
2. **运行确认失败**：`node --test tests/ai-panel-view-model.test.ts` → 断言失败。
3. **最小实现**（`src/ai-panel-view-model.ts`）：
   - `requestFacts` 各 case 处理可空 `snapshot`（见 5.2）。
   - `buildDirectQuestionView`：保持「仅 `idle` 或 `direct_question` 时可见」逻辑；成功后请求为 `success`，自然返回 `null`。
   - 确认 `buildConversationView` 不依赖 `anchor`（当前只读 `firstResponse`/`turns`/`pending`，无需改）。
4. **运行确认通过**：`node --test tests/ai-panel-view-model.test.ts` → 通过。

#### 5.7 DOM：直接提问成功后渲染统一对话与追问表单

**行为**：直接提问首轮成功后，面板隐藏直接提问表单，渲染统一对话线程与追问输入；收起/重开保留；追问提交/失败重试/编辑走既有 action。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-panel-dom.test.ts`）：
   - 新增「直接提问成功后：直接提问表单隐藏、对话线程显示首轮回应、追问输入可用」。
   - 新增「直接提问成功后收起再展开：对话与未发送追问输入保留」。
   - 新增「直接提问成功后提交追问：调用 `onSubmitFollowUp` 并渲染新轮次」。
2. **运行确认失败**：`node --test tests/ai-panel-dom.test.ts` → 断言失败（当前成功后仍显示直接提问表单，无对话）。
3. **最小实现**：`src/ai-panel.ts` 的 `render()` 已由 view-model 驱动；确认 `directQuestion` 隐藏分支与 `renderConversation`/`followUpForm` 分支在成功后正确切换（若 view-model 已正确，DOM 层通常无需改动，仅验证）。
4. **运行确认通过**：`node --test tests/ai-panel-dom.test.ts` → 通过。

#### 5.8 编排：直接提问来源的追问与迟到隔离

**行为**：直接提问首轮成功后，追问走 `requestStructured`（`follow_up` + 对话身份），单飞与迟到隔离生效；失败保留追问供重试。

**TDD 步骤**：

1. **写失败测试**（`tests/ai-feature-direct-question.test.ts` / `tests/ai-feature-routing.test.ts`）：
   - 更新「direct question success」相关断言为进入统一对话。
   - 新增「直接提问成功后 `followUpAcceptedRequest` 发送 `follow_up` 载荷（含 `origin:"direct_question"` 与完整问答）」。
   - 新增「直接提问来源追问失败后 `retryFollowUpAcceptedRequest` 保留原问题重发」。
2. **运行确认失败**：`node --test tests/ai-feature-direct-question.test.ts tests/ai-feature-routing.test.ts` → 断言失败。
3. **最小实现**：`src/ai-feature.ts` 无需结构性改动（`onDirectQuestionSuccess` 已接 `succeedDirectQuestion`，追问回调基于对话工作）；若测试暴露接线缺口再补。
4. **运行确认通过**：上述命令 → 通过。

#### 5.9 清理：移除 `direct_question` 的 `success` 状态（低风险清理）

**行为**：统一后 `direct_question` 请求状态不再出现 `success`（成功后迁移到统一 `success`），移除该死状态并同步 view-model 与测试。

**TDD 步骤**：

1. **写失败测试**：更新 `tests/ai-panel-state.test.ts` / `tests/ai-panel-view-model.test.ts` 中任何仍断言 `direct_question` `success` 的用例为统一行为。
2. **运行确认失败**：`node --test tests/ai-panel-state.test.ts tests/ai-panel-view-model.test.ts` → 失败。
3. **最小实现**：
   - `src/ai-panel-request-state.ts`：`direct_question.status` 去掉 `"success"`。
   - `src/ai-panel-view-model.ts` `buildDirectQuestionView`：去掉 `status === "success"` 分支与 `response` 读取（成功后已隐藏）。
   - `src/ai-panel.ts`：去掉 `directQuestionResponse` 相关渲染分支（成功后隐藏）。
4. **运行确认通过**：上述命令 → 通过。

---

### 任务 6：验证与边界检查

> 验证 owner 为主会话。以下为验证步骤与命令，**由主会话执行**；本计划不执行。

#### 6.1 全量检查

- 运行：`npm run typecheck` → 通过（无类型错误）。
- 运行：`npm run lint` → 通过（无 lint 错误）。
- 运行：`npm run test:frontend` → 全部通过。
- 运行：`npm run build` → 通过。
- 运行：`npm run test:rust` → 全部通过。

#### 6.2 边界检查：无作品写回

- 检查 `src/ai-feature.ts`、`src/ai-panel.ts`、`src/ai-feature-direct-question.ts` 未新增任何 `saveProject`、编辑器 DOM 写入或「应用到正文」回调；AI 输出只进入面板临时状态。
- 检查 DOM 契约与 action 未暴露文档写入接口。

#### 6.3 边界检查：未引入越界能力

- 确认未引入 Agent 循环、自动上下文读取、检索、摘要、记忆、后台预加载、会话列表或持久化历史。
- 确认作品/文档切换 `reset` 清空统一对话、草稿、待附带选区与忽略标记；收起只改可见性不清空。

---

## 5. 收尾：更新 tasks.md 勾选

**重要**：`openspec/changes/persistent-ai-panel-entry/tasks.md` 的 **任务 5（5.1–5.6）与任务 6（6.1–6.3）勾选，必须在实现与验证全部完成后**由主会话更新。本计划不修改 tasks.md。

---

## 6. 自查清单（实施完成后由实施者报告）

- [ ] **Spec coverage**：逐条核对 `specs/` 下 `persistent-ai-panel-entry`、`ai-panel-state-structure`、`ai-panel-rendering-boundaries`、`ai-panel-dom-contract`、`ai-feature-orchestration`、`dsh-headless-generation` 的每个 Requirement/Scenario 是否被测试覆盖。
- [ ] **Placeholder**：确认无 `TODO`/`FIXME`/占位实现残留；`direct_question` 死状态已清理。
- [ ] **类型一致性**：`FirstRoundMaterial` 联合、`anchor: SelectionSnapshot | null`、请求状态 `snapshot` 可空、`follow_up.origin` 在前后端契约一致；`npm run typecheck` 通过。
- [ ] **验证 owner**：验证由主会话执行（本计划不执行验证）。
