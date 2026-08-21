import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { buildAiPanelView } from "../src/ai-panel-view-model.ts";
import type { AiPanelView } from "../src/ai-panel-view-model.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

/**
 * 纯显示决策边界的直接测试（OpenSpec change: ai-panel-rendering-boundaries，任务 1.2 / 1.3）。
 *
 * 这些测试在生产实现前编写，预期因缺少 `src/ai-panel-view-model.ts` 而失败。
 * 它们只断言结构化显示决策与操作可用性（布尔、计数、契约字段透传），
 * 不断言 DOM 节点、CSS 步骤或格式化文案，也不触碰网络、action 或可变模块状态。
 * 所有 fixture 都由真实的 `AiPanelState` 状态迁移驱动，避免虚构不兼容的形状。
 */

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

const authError: GenerateAiError = {
  code: "authentication",
  message: "认证失败",
};

function viewOf(state: AiPanelState): AiPanelView {
  return buildAiPanelView(state.view, state.conversation);
}

test("idle state hides every content region and marks the panel collapsed", () => {
  // Given: 一个全新的、未召唤过 AI 的面板状态
  const state = new AiPanelState();

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 面板收起，所有内容区与操作均不可见/不可用
  assert.equal(view.panelVisible, false);
  assert.equal(view.snapshot, null);
  assert.equal(view.thinkingExpansion, null);
  assert.equal(view.loadingVisible, false);
  assert.equal(view.response, null);
  assert.equal(view.conversation, null);
  assert.equal(view.errorBlock, null);
  assert.equal(view.configBlock, false);
  assert.equal(view.followUpError, null);
  assert.equal(view.followUpForm, null);
  assert.equal(view.retryAvailable, false);
});

test("first preview shows the frozen snapshot without loading, response, or conversation", () => {
  // Given: 用户在选区上触发首次预览
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");
  state.previewFirstRequest(anchor);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 面板展开并显示冻结选区原文，尚未进入 loading
  assert.equal(view.panelVisible, true);
  assert.deepEqual(view.snapshot, { text: "冻结选区" });
  assert.equal(view.loadingVisible, false);
  assert.equal(view.response, null);
  assert.equal(view.conversation, null);
  assert.equal(view.followUpForm, null);
});

test("first loading shows the snapshot and the first-phase loading indicator", () => {
  // Given: 用户接受首次召唤，进入首次 loading
  const state = new AiPanelState();
  const anchor = snapshot("背叛");
  state.beginRequest(anchor);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 展示选区 + loading 指示，无回复、无对话
  assert.equal(view.panelVisible, true);
  assert.deepEqual(view.snapshot, { text: "背叛" });
  assert.equal(view.loadingVisible, true);
  assert.equal(view.response, null);
  assert.equal(view.conversation, null);
  assert.equal(view.errorBlock, null);
  assert.equal(view.configBlock, false);
});

test("thinking expansion shows the prestate with selection length and current direction", () => {
  // Given: 用户开启思维扩展并填写方向
  const state = new AiPanelState();
  const anchor = snapshot("五个字啊");
  state.beginThinkingExpansion(anchor);
  state.updateThinkingExpansionDirection("想追的方向");

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 显示思维扩展预状态（选区长度为数字、方向透传），不显示 loading/回复
  assert.deepEqual(view.snapshot, { text: "五个字啊" });
  assert.ok(view.thinkingExpansion);
  assert.equal(view.thinkingExpansion.selectionLength, anchor.selectedText.length);
  assert.equal(view.thinkingExpansion.direction, "想追的方向");
  assert.equal(view.loadingVisible, false);
  assert.equal(view.response, null);
  assert.equal(view.conversation, null);
});

test("first success without a follow-up conversation shows the standalone response", () => {
  // Given: 首次召唤成功
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 独立回复区显示首次回应，且此时已具备一个可追问的对话
  assert.deepEqual(view.snapshot, { text: "锚点" });
  assert.equal(view.loadingVisible, false);
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
  ]);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, true);
});

test("first error shows the error block and makes retry available", () => {
  // Given: 首次召唤失败
  const state = new AiPanelState();
  const anchor = snapshot("原选区");
  state.beginRequest(anchor);
  state.fail(anchor, authError);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 错误区显示可读消息（契约字段透传），提供“重新请求”，无独立回复/对话
  assert.deepEqual(view.snapshot, { text: "原选区" });
  assert.ok(view.errorBlock);
  assert.equal(view.errorBlock.message, "认证失败");
  assert.equal(view.retryAvailable, true);
  assert.equal(view.response, null);
  assert.equal(view.conversation, null);
  assert.equal(view.configBlock, false);
});

test("configuration required shows the config block and offers retry when no conversation exists", () => {
  // Given: 首次召唤因缺少配置被引导到配置状态
  const state = new AiPanelState();
  const anchor = snapshot("待配置选区");
  state.beginRequest(anchor);
  state.requireConfiguration(anchor);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 显示配置引导区并提供重试，不显示普通错误区
  assert.deepEqual(view.snapshot, { text: "待配置选区" });
  assert.equal(view.configBlock, true);
  assert.equal(view.retryAvailable, true);
  assert.equal(view.errorBlock, null);
  assert.equal(view.response, null);
});

test("first blocked shows a terminal feedback message without creating a conversation", () => {
  // Given: 已有请求进行中，新的首次请求被拦截
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");
  state.previewFirstRequest(anchor);
  state.blockFirstRequest(anchor);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 显示被拦截反馈但不提供重试、不产生对话
  assert.deepEqual(view.snapshot, { text: "冻结选区" });
  assert.ok(view.errorBlock);
  assert.equal(view.errorBlock.message, "已有 AI 请求正在进行，本次请求没有发出。");
  assert.equal(view.retryAvailable, false);
  assert.equal(view.conversation, null);
  assert.equal(view.followUpForm, null);
});

test("follow-up loading shows the pending question in-thread and disables the follow-up input", () => {
  // Given: 首次成功后发起一次追问，进入追问 loading
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  state.beginFollowUp("第一个问题");

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 对话线程里追加待答用户轮次并显示思考中状态；追问输入禁用，不显示独立 loading 区
  assert.equal(view.loadingVisible, false);
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "第一个问题" },
    { role: "status", text: "正在思考…" },
  ]);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, false);
  assert.equal(view.followUpError, null);
});

test("follow-up success appends the answered turn and re-enables the input", () => {
  // Given: 一次追问成功完成
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  const turnId = state.beginFollowUp("第一个问题");
  assert.ok(turnId !== null);
  state.succeedFollowUp(turnId, "第一个回答");

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 线程含完整问答对、无待答状态，追问输入重新可用
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "第一个问题" },
    { role: "assistant", text: "第一个回答" },
  ]);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, true);
  assert.equal(view.followUpError, null);
});

test("follow-up failure shows the follow-up error with retry and edit available", () => {
  // Given: 一次追问失败
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  const turnId = state.beginFollowUp("失败问题");
  assert.ok(turnId !== null);
  state.failFollowUp(turnId, authError);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 显示追问错误区（消息透传）并同时提供“原样重试”和“修改问题”，
  //       首次错误区不显示，避免与追问错误重叠
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "失败问题" },
  ]);
  assert.ok(view.followUpError);
  assert.equal(view.followUpError.message, "认证失败");
  assert.equal(view.followUpError.retryAvailable, true);
  assert.equal(view.followUpError.editAvailable, true);
  assert.equal(view.errorBlock, null);
  assert.equal(view.retryAvailable, false);
});

test("accepting a plain follow-up retry returns to loading for the same question", () => {
  // Given: 追问失败后用户选择原样重试
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  const turnId = state.beginFollowUp("失败问题");
  assert.ok(turnId !== null);
  state.failFollowUp(turnId, authError);
  state.acceptFollowUpRetry();

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 回到追问 loading，线程重新显示同一待答问题，错误区消失
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "失败问题" },
    { role: "status", text: "正在思考…" },
  ]);
  assert.equal(view.followUpError, null);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, false);
});

test("accepting an edited follow-up resends with the revised question and clears the error", () => {
  // Given: 追问失败后用户修改问题并重发
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  const turnId = state.beginFollowUp("失败问题");
  assert.ok(turnId !== null);
  state.failFollowUp(turnId, authError);
  state.acceptEditedFollowUp("修改后的问题");

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 线程显示修改后的待答问题并回到 loading，追问错误区消失
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "修改后的问题" },
    { role: "status", text: "正在思考…" },
  ]);
  assert.equal(view.followUpError, null);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, false);
});

test("building the same view model twice is deterministic and does not mutate its inputs", () => {
  // Given: 一个包含首次回应和待处理追问的状态快照
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  state.beginFollowUp("待回答问题");
  const panelStateBefore = state.view;
  const conversationBefore = state.conversation;

  // When: 对同一组输入连续构建两次显示模型
  const firstView = buildAiPanelView(panelStateBefore, conversationBefore);
  const secondView = buildAiPanelView(panelStateBefore, conversationBefore);

  // Then: 输出稳定，且输入状态未被修改
  assert.deepEqual(secondView, firstView);
  assert.deepEqual(state.view, panelStateBefore);
  assert.deepEqual(state.conversation, conversationBefore);
});

test("follow-up configuration failure keeps the thread and exposes retry and edit actions", () => {
  // Given: 首次成功后，追问因缺少配置失败
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");
  const turnId = state.beginFollowUp("需要配置的问题");
  assert.ok(turnId !== null);
  state.requireFollowUpConfiguration(turnId);

  // When: 构建显示 view model
  const view = viewOf(state);

  // Then: 追问错误保留配置错误文案，同时提供原样重试和修改问题
  assert.ok(view.conversation);
  assert.deepEqual(view.conversation.messages, [
    { role: "assistant", text: "首次回应" },
    { role: "user", text: "需要配置的问题" },
  ]);
  assert.ok(view.followUpError);
  assert.equal(view.followUpError.message, "请先配置 LLM 后再重试");
  assert.equal(view.followUpError.retryAvailable, true);
  assert.equal(view.followUpError.editAvailable, true);
  assert.equal(view.configBlock, true);
  assert.equal(view.errorBlock, null);
  assert.ok(view.followUpForm);
  assert.equal(view.followUpForm.inputEnabled, false);
});
