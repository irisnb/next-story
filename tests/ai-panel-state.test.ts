import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import type { ReadonlyTemporaryConversation } from "../src/ai-panel-state.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

const authError: GenerateAiError = {
  code: "authentication",
  message: "认证失败",
};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;
export type _ConversationAnchorIsReadonly = Assert<
  Equal<ReadonlyTemporaryConversation["anchor"], Readonly<SelectionSnapshot> | null>
>;
export type _ConversationTurnsAreReadonly = Assert<
  Equal<ReadonlyTemporaryConversation["turns"], ReadonlyArray<Readonly<import("../src/ai-panel-state.ts").SuccessfulFollowUpTurn>>>
>;

test("beginRequest opens the panel and enters loading with the frozen snapshot", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  state.beginRequest(snap);
  assert.equal(state.isOpen, true);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: snap,
    conversationId: 1,
    phase: "first",
  });
});

test("visibility and request change independently", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("a"));
  state.close();
  assert.equal(state.isOpen, false);

  // 收起期间完成：request 更新，但面板保持收起
  state.succeed(snapshot("a"), "思考结果");
  assert.equal(state.isOpen, false);
  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: snapshot("a"),
    response: "思考结果",
    conversationId: 1,
    phase: "first",
  });

  // 重新展开后可以看到对应结果
  state.open();
  assert.equal(state.isOpen, true);
  assert.equal(state.view.request.kind, "success");
});

test("new request replaces the current result (replace-current strategy)", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("旧选区"));
  state.succeed(snapshot("旧选区"), "旧回复");

  const next = snapshot("新选区");
  state.beginRequest(next);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: next,
    conversationId: 2,
    phase: "first",
  });

  state.succeed(next, "新回复");
  assert.equal(state.view.request.kind, "success");
  if (state.view.request.kind === "success") {
    assert.equal(state.view.request.snapshot.selectedText, "新选区");
    assert.equal(state.view.request.response, "新回复");
  }
});

test("failure keeps the original snapshot and does not auto-expand a collapsed panel", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("a"));
  state.close();
  state.fail(snapshot("a"), authError);

  assert.equal(state.isOpen, false);
  assert.equal(state.view.request.kind, "error");
  if (state.view.request.kind === "error") {
    assert.ok(state.view.request.snapshot);
    assert.equal(state.view.request.snapshot.selectedText, "a");
    assert.equal(state.view.request.error.code, "authentication");
  }
});

test("configuration_required preserves the snapshot and stays collapsed", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("a"));
  state.close();
  state.requireConfiguration(snapshot("a"));

  assert.equal(state.isOpen, false);
  assert.equal(state.view.request.kind, "configuration_required");
  if (state.view.request.kind === "configuration_required") {
    assert.ok(state.view.request.snapshot);
    assert.equal(state.view.request.snapshot.selectedText, "a");
  }
});

test("blocked first request preserves the preview snapshot without creating a conversation", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");

  state.previewFirstRequest(anchor);
  state.blockFirstRequest(anchor);
  assert.deepEqual(state.view.request, {
    kind: "first_blocked",
    snapshot: anchor,
    message: "已有 AI 请求正在进行，本次请求没有发出。",
  });
  assert.equal(state.conversation, null);
  assert.equal(state.followUpAvailable, false);
});

test("retry uses the original frozen snapshot, not any new selection", () => {
  const state = new AiPanelState();
  const original = snapshot("原选区");
  state.beginRequest(original);
  state.fail(original, authError);

  const retry = state.retrySnapshot();
  assert.deepEqual(retry, original);

  // 模拟用户在编辑器里形成了另一选区——重试不受影响
  assert.equal(state.retrySnapshot()?.selectedText, "原选区");
});

test("retry snapshot is null unless in error or configuration_required", () => {
  const state = new AiPanelState();
  assert.equal(state.retrySnapshot(), null);
  state.beginRequest(snapshot("a"));
  assert.equal(state.retrySnapshot(), null);
  state.succeed(snapshot("a"), "ok");
  assert.equal(state.retrySnapshot(), null);
});

test("reset clears the panel after project unload or replace", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("a"));
  state.succeed(snapshot("a"), "ok");
  state.reset();
  assert.equal(state.isOpen, false);
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("notifies listeners on every state change", () => {
  let calls = 0;
  const state = new AiPanelState(() => {
    calls += 1;
  });
  state.beginRequest(snapshot("a"));
  state.succeed(snapshot("a"), "ok");
  state.close();
  assert.equal(calls, 3);
});

test("subscribe returns an unsubscribe function that removes the listener", () => {
  const calls: string[] = [];
  const state = new AiPanelState();
  const unsubscribe = state.subscribe(() => calls.push("tick"));
  state.open();
  assert.deepEqual(calls, ["tick"]);

  unsubscribe();
  state.close();
  assert.deepEqual(calls, ["tick"], "退订后不应再收到通知");
});

test("forms one anchored linear conversation after the first success", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");

  assert.equal(state.followUpAvailable, true);
  // 断言签名会把 conversation 收窄为字面量（此时 pending 为 null），
  // 因此这里显式以 ReadonlyTemporaryConversation 作为期望类型，避免污染后续 pending 访问。
  assert.deepEqual(state.conversation, {
    id: 1,
    anchor,
    initialUserMaterial: { kind: "first", selected_text: "冻结选区" },
    firstResponse: "首次回应",
    turns: [],
    pending: null,
  } as ReadonlyTemporaryConversation);

  const turn = state.beginFollowUp("第一个问题");
  assert.equal(turn, 1);
  assert.equal(state.followUpAvailable, false);
  assert.equal(state.conversation?.pending?.question, "第一个问题");
  assert.equal(state.conversation?.pending?.id, 1);

  state.succeedFollowUp(1, "第一个回答");
  assert.deepEqual(state.conversation?.turns, [
    { id: 1, question: "第一个问题", response: "第一个回答" },
  ]);
  assert.equal(state.conversation?.pending, null);
});

test("previews and commits an edited failed question without changing successful turns", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("失败问题");
  state.failFollowUp(1, authError);

  assert.equal(state.conversation?.pending?.question, "失败问题");
  assert.equal(state.conversation?.pending?.error?.code, "authentication");
  assert.equal(state.retryFollowUpQuestion(), "失败问题");
  const preview = state.followUpRequestForQuestion("修改问题");
  assert.equal(preview?.kind, "follow_up");
  assert.equal(preview?.messages[preview.messages.length - 1].content, "修改问题");
  assert.equal(state.conversation?.pending?.question, "失败问题");
  assert.equal(state.acceptEditedFollowUp("修改问题"), true);
  assert.equal(state.conversation?.pending?.question, "修改问题");
  assert.equal(state.conversation?.pending?.error, undefined);
  assert.deepEqual(state.conversation?.turns, []);
});

test("a new summon replaces the old conversation while visibility stays independent", () => {
  const state = new AiPanelState();
  const first = snapshot("旧");
  state.beginRequest(first);
  state.succeed(first, "旧答");
  state.close();

  const next = snapshot("新");
  state.beginRequest(next);
  assert.equal(state.isOpen, true);
  assert.equal(state.conversation, null);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: next,
    conversationId: 2,
    phase: "first",
  });
});

test("allocates and preserves conversation identity from accepted first summon through success", () => {
  const state = new AiPanelState();
  const anchor = snapshot("同一选区");

  state.beginRequest(anchor);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: anchor,
    conversationId: 1,
    phase: "first",
  });
  state.succeed(anchor, "首次回应");

  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: anchor,
    response: "首次回应",
    conversationId: 1,
    phase: "first",
  });
  assert.equal(state.conversationIdentity?.conversationId, 1);
});

test("returns a defensive conversation view that cannot mutate payload state", () => {
  const state = new AiPanelState();
  const anchor = snapshot("不可变锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("问题");
  state.failFollowUp(1, authError);

  const view = state.conversation;
  assert.ok(view);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.anchor), true);
  assert.equal(Object.isFrozen(view.turns), true);
  assert.equal(Object.isFrozen(view.pending), true);

  assert.ok(view.anchor);
  assert.equal(Reflect.set(view.anchor, "selectedText", "篡改"), false);
  assert.equal(Reflect.set(view.pending!, "question", "篡改问题"), false);
  assert.equal(state.followUpRequest()?.selected_text, "不可变锚点");
  const messages = state.followUpRequest()?.messages;
  assert.equal(messages?.[messages.length - 1]?.content, "问题");
});

test("beginThinkingExpansion opens a prestate anchored to the frozen selection", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");

  state.beginThinkingExpansion(anchor);
  state.updateThinkingExpansionDirection("想追的方向");

  assert.equal(state.isOpen, true);
  assert.deepEqual(state.view.request, {
    kind: "thinking_expansion",
    snapshot: anchor,
    direction: "想追的方向",
  });
  assert.equal(state.conversation, null);

  const changedSelection = snapshot("后来选区");
  assert.equal(state.view.request.kind, "thinking_expansion");
  if (state.view.request.kind === "thinking_expansion") {
    assert.equal(state.view.request.snapshot.selectedText, "冻结选区");
    assert.notDeepEqual(state.view.request.snapshot, changedSelection);
  }
});

test("direct question draft updates and notifies once", () => {
  const state = new AiPanelState();
  let calls = 0;
  const tracked = new AiPanelState(() => { calls += 1; });

  tracked.updateDirectQuestionDraft("这个角色为什么犹豫？");
  assert.equal(tracked.view.directQuestionDraft, "这个角色为什么犹豫？");
  assert.equal(calls, 1);
  assert.equal(state.view.directQuestionDraft, "");
});

test("pending selection is replaced by a new meaningful selection and cleared when empty", () => {
  const state = new AiPanelState();
  const first = snapshot("第一段选区");
  const second = snapshot("第二段选区");

  state.setPendingSelection(first);
  assert.deepEqual(state.view.pendingSelection, first);

  // 新选区替换旧选区
  state.setPendingSelection(second);
  assert.deepEqual(state.view.pendingSelection, second);

  // 清除选区移除待附带材料
  state.setPendingSelection(null);
  assert.equal(state.view.pendingSelection, null);
});

test("beginDirectQuestion freezes question and selection into loading and clears pending selection", () => {
  const state = new AiPanelState();
  const selection = snapshot("待附带选区");
  state.setPendingSelection(selection);
  state.updateDirectQuestionDraft("问题");

  assert.equal(state.beginDirectQuestion("问题", selection), true);
  assert.equal(state.isOpen, true);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection,
    status: "loading",
  });
  assert.equal(state.view.pendingSelection, null, "发送后待附带选区被消费");
});

test("empty direct question is rejected without entering loading", () => {
  const state = new AiPanelState();
  state.updateDirectQuestionDraft("   ");
  assert.equal(state.beginDirectQuestion("   \n", null), false);
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("beginDirectQuestion freezes the selection so later mutation of the original object is inert", () => {
  const state = new AiPanelState();
  const selection = snapshot("待附带选区");
  state.beginDirectQuestion("问题", selection);

  // 调用后修改原对象：不应影响已冻结的请求选区
  selection.selectedText = "篡改后的选区";
  selection.from = 99;
  selection.to = 100;

  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: { documentId: "draft", selectedText: "待附带选区", from: 0, to: 5 },
    status: "loading",
  });

  // 成功进入统一对话后，对话锚点也不受原对象后续修改影响
  state.succeedDirectQuestion("回答");
  assert.deepEqual(state.conversation?.anchor, {
    documentId: "draft",
    selectedText: "待附带选区",
    from: 0,
    to: 5,
  });
});

test("direct question success enters the unified conversation and clears the draft", () => {
  const state = new AiPanelState();
  const selection = snapshot("选区");
  state.updateDirectQuestionDraft("问题");
  state.beginDirectQuestion("问题", selection);

  assert.equal(state.succeedDirectQuestion("回答"), true);
  assert.equal(state.view.directQuestionDraft, "", "成功后清空未发送草稿");
  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: selection,
    response: "回答",
    conversationId: 1,
    phase: "first",
  });
  assert.ok(state.conversation);
  assert.equal(state.conversation?.initialUserMaterial.kind, "direct_question");
  assert.deepEqual(state.conversation?.anchor, selection, "首轮选区作为对话锚点冻结");
  assert.equal(state.conversation?.firstResponse, "回答");
  assert.equal(state.followUpAvailable, true);
});

test("direct question without selection succeeds with a null anchor and null snapshot", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);

  assert.equal(state.succeedDirectQuestion("回答"), true);
  assert.equal(state.conversation?.anchor, null);
  assert.equal(state.view.request.kind, "success");
  if (state.view.request.kind === "success") {
    assert.equal(state.view.request.snapshot, null);
  }
});

test("direct question success enables follow-up turns in the unified conversation", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("首答");

  const turnId = state.beginFollowUp("追问");
  assert.equal(turnId, 1);
  assert.equal(state.followUpAvailable, false);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: null,
    conversationId: 1,
    phase: "follow_up",
    turnId: 1,
  });
  assert.equal(state.conversation?.pending?.question, "追问");

  state.succeedFollowUp(1, "追问回答");
  assert.deepEqual(state.conversation?.turns, [
    { id: 1, question: "追问", response: "追问回答" },
  ]);
  assert.equal(state.followUpAvailable, true);
});

test("direct question failure keeps the draft for retry", () => {
  const state = new AiPanelState();
  state.updateDirectQuestionDraft("问题");
  state.beginDirectQuestion("问题", null);

  assert.equal(state.failDirectQuestion(authError), true);
  assert.equal(state.view.directQuestionDraft, "问题", "失败后保留草稿便于重试");
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "error",
    error: authError,
  });
});

test("direct question configuration-required keeps the draft and question", () => {
  const state = new AiPanelState();
  state.updateDirectQuestionDraft("问题");
  state.beginDirectQuestion("问题", null);

  assert.equal(state.requireDirectQuestionConfiguration(), true);
  assert.equal(state.view.directQuestionDraft, "问题");
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "configuration_required",
  });
});

test("direct question transitions are inert outside loading", () => {
  const state = new AiPanelState();
  assert.equal(state.succeedDirectQuestion("x"), false);
  assert.equal(state.failDirectQuestion(authError), false);
  assert.equal(state.requireDirectQuestionConfiguration(), false);
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("collapse and reopen preserve direct question draft and pending selection", () => {
  const state = new AiPanelState();
  const selection = snapshot("选区");
  state.updateDirectQuestionDraft("未发送的问题");
  state.setPendingSelection(selection);
  state.open();

  state.close();
  assert.equal(state.isOpen, false);
  assert.equal(state.view.directQuestionDraft, "未发送的问题");
  assert.deepEqual(state.view.pendingSelection, selection);

  state.open();
  assert.equal(state.isOpen, true);
  assert.equal(state.view.directQuestionDraft, "未发送的问题");
  assert.deepEqual(state.view.pendingSelection, selection);
});

test("reset clears direct question draft and pending selection", () => {
  const state = new AiPanelState();
  state.updateDirectQuestionDraft("问题");
  state.setPendingSelection(snapshot("选区"));
  state.beginDirectQuestion("问题", snapshot("选区"));
  state.succeedDirectQuestion("回答");
  assert.ok(state.conversation, "成功后进入统一对话");

  state.reset();
  assert.equal(state.view.directQuestionDraft, "");
  assert.equal(state.view.pendingSelection, null);
  assert.equal(state.conversation, null, "切换作品/文档后统一对话被清空");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.isOpen, false);
});

test("beginDirectQuestion replaces a prior conversation as a fresh first-round entry", () => {
  const state = new AiPanelState();
  const anchor = snapshot("旧选区");
  state.beginRequest(anchor);
  state.succeed(anchor, "旧首答");
  assert.equal(state.followUpAvailable, true);

  state.beginDirectQuestion("新问题", null);
  assert.equal(state.conversation, null);
  assert.equal(state.followUpAvailable, false);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "新问题",
    selection: null,
    status: "loading",
  });
});

test("removing the pending selection keeps the same selection ignored on re-sync", () => {
  const state = new AiPanelState();
  const selection = snapshot("林站在天台边。");

  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);

  // 用户主动移除待附带选区
  state.removePendingSelection();
  assert.equal(state.view.pendingSelection, null);

  // 同一选区在 focus sync 时保持忽略，不重新附加
  state.setPendingSelection(selection);
  assert.equal(state.view.pendingSelection, null, "被忽略的同一选区不应重新附加");

  // 新选区才重新附加
  const newSelection = snapshot("新的选区");
  state.setPendingSelection(newSelection);
  assert.deepEqual(state.view.pendingSelection, newSelection);
});

test("clearing the editor selection does not mark it as ignored", () => {
  const state = new AiPanelState();
  const selection = snapshot("林站在天台边。");

  state.setPendingSelection(selection);
  // 编辑器选区被清空（非用户主动移除）
  state.setPendingSelection(null);
  assert.equal(state.view.pendingSelection, null);

  // 重新选择同一段文字应重新附加（因为不是主动移除）
  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);
});

test("reset clears the ignored selection marker", () => {
  const state = new AiPanelState();
  const selection = snapshot("旧作品选区");
  state.setPendingSelection(selection);
  state.removePendingSelection();

  state.reset();
  // 重置后同一选区可重新附加（新作品范围）
  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);
});

test("newConversation clears a completed conversation and keeps the panel open", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("追问");
  state.succeedFollowUp(1, "追问回答");
  state.updateDirectQuestionDraft("未发送草稿");
  assert.equal(state.isOpen, true);

  assert.equal(state.newConversation(), true);
  assert.equal(state.isOpen, true, "新建对话后面板保持展开");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);
  assert.equal(state.followUpAvailable, false);
  assert.equal(state.conversationIdentity, null);
  assert.equal(state.view.directQuestionDraft, "", "直接提问草稿被清空");
});

test("newConversation during first-round loading clears the pending request and rejects late results", () => {
  const state = new AiPanelState();
  const anchor = snapshot("旧选区");
  state.beginRequest(anchor);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: anchor,
    conversationId: 1,
    phase: "first",
  });

  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);

  // 迟到的首轮成功 / 失败 / 配置结果一律不得污染空状态
  state.succeed(anchor, "迟到成功");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null, "迟到成功不得重建对话");

  state.fail(anchor, authError);
  assert.deepEqual(state.view.request, { kind: "idle" }, "迟到失败不得进入错误态");

  state.requireConfiguration(anchor);
  assert.deepEqual(state.view.request, { kind: "idle" }, "迟到配置引导不得进入配置态");
});

test("newConversation during a pending follow-up clears it and rejects late follow-up results", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("追问中");
  assert.equal(state.conversation?.pending?.question, "追问中");
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: anchor,
    conversationId: 1,
    phase: "follow_up",
    turnId: 1,
  });

  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);

  // 迟到的追问成功 / 失败 / 配置结果全部被忽略
  assert.equal(state.succeedFollowUp(1, "迟到追问回答"), false);
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);

  assert.equal(state.failFollowUp(1, authError), false);
  assert.deepEqual(state.view.request, { kind: "idle" });

  assert.equal(state.requireFollowUpConfiguration(1), false);
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("newConversation notifies exactly once when it changes state", () => {
  let calls = 0;
  const state = new AiPanelState(() => {
    calls += 1;
  });
  state.beginRequest(snapshot("a"));
  assert.equal(calls, 1);

  assert.equal(state.newConversation(), true);
  assert.equal(calls, 2, "新建对话只通知一次");
});

test("newConversation is inert on a pure empty idle state without notification", () => {
  let calls = 0;
  const state = new AiPanelState(() => {
    calls += 1;
  });

  assert.equal(state.newConversation(), false);
  assert.equal(calls, 0, "空 idle 状态不应通知");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.isOpen, false, "空状态操作不改动任何维度");

  // 展开后的空白直接提问状态同样 inert
  state.open();
  assert.equal(calls, 1);
  assert.equal(state.newConversation(), false);
  assert.equal(calls, 1, "空白直接提问状态没有可结束的内容");
  assert.equal(state.isOpen, true);
});

test("newConversation is inert with only an unsent draft and no conversation or request", () => {
  let calls = 0;
  const state = new AiPanelState(() => {
    calls += 1;
  });
  state.open();
  state.updateDirectQuestionDraft("未发送的问题");
  assert.equal(calls, 2);

  assert.equal(state.newConversation(), false);
  assert.equal(calls, 2);
  assert.equal(state.view.directQuestionDraft, "未发送的问题", "只有草稿时不清空草稿");
});

test("newConversation reopens a collapsed panel that has an existing conversation", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.close();
  assert.equal(state.isOpen, false);

  assert.equal(state.newConversation(), true);
  assert.equal(state.isOpen, true, "收起状态下新建对话会重新展开面板");
  assert.deepEqual(state.view.request, { kind: "idle" });
});

test("newConversation clears drafts, pending selection and ignored selection markers", () => {
  const state = new AiPanelState();
  const selection = snapshot("选区");
  // 先让同一选区被主动忽略
  state.setPendingSelection(selection);
  state.removePendingSelection();
  state.setPendingSelection(selection);
  assert.equal(state.view.pendingSelection, null, "被忽略的选区在清除前保持忽略");

  state.updateDirectQuestionDraft("草稿");
  state.beginDirectQuestion("草稿", null);
  assert.equal(state.newConversation(), true);
  assert.equal(state.view.directQuestionDraft, "");
  assert.equal(state.view.pendingSelection, null);

  // 忽略标记也被清除：同一选区在新对话中可重新附加
  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection, "清除后同一选区不再被忽略");
});

test("newConversation is distinct from project reset which still closes the panel", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");

  state.newConversation();
  assert.equal(state.isOpen, true, "新建对话保持面板展开");

  state.beginRequest(snapshot("新选区"));
  state.succeed(snapshot("新选区"), "新答");
  state.reset();
  assert.equal(state.isOpen, false, "作品生命周期 reset 仍然关闭面板");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);
});

test("newConversation keeps conversation identity monotonic so new requests never reuse old identities", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  assert.equal(state.conversationIdentity?.conversationId, 1);

  assert.equal(state.newConversation(), true);

  state.beginRequest(snapshot("新选区"));
  const loading = state.view.request;
  assert.equal(loading.kind, "loading");
  if (loading.kind !== "loading") return;
  const loadingId = loading.conversationId;
  assert.ok(loadingId !== undefined);
  assert.ok(loadingId > 1, "新对话身份必须大于旧对话身份，不得复用");

  state.succeed(snapshot("新选区"), "新首答");
  assert.equal(state.conversationIdentity?.conversationId, loadingId);
  assert.ok(state.conversationIdentity!.conversationId > 1);
});

test("a result arriving while the panel shows a blocked request is still applied", () => {
  const state = new AiPanelState();
  const anchor = snapshot("选区A");
  state.beginRequest(anchor);
  // 用户再次召唤被单飞拒绝：面板进入阻塞提示，但原请求仍在途
  state.blockFirstRequest(anchor);
  assert.equal(state.view.request.kind, "first_blocked");

  // 原请求的成功结果仍然应用（面板显示真实结果，而不是一直停留在阻塞提示）
  state.succeed(anchor, "真实首答");
  assert.equal(state.view.request.kind, "success");
  assert.equal(state.conversation?.firstResponse, "真实首答");
});

test("late first-round results cannot pollute the state after newConversation and a new direct question", () => {
  const state = new AiPanelState();
  const oldAnchor = snapshot("旧选区");
  state.beginRequest(oldAnchor);

  assert.equal(state.newConversation(), true);
  state.beginDirectQuestion("新问题", null);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "新问题",
    selection: null,
    status: "loading",
  });

  // 旧首轮请求的迟到结果不得改写新的直接提问 loading 状态
  state.succeed(oldAnchor, "迟到成功");
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "新问题",
    selection: null,
    status: "loading",
  });

  state.fail(oldAnchor, authError);
  state.requireConfiguration(oldAnchor);
  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "新问题",
    selection: null,
    status: "loading",
  });
});
