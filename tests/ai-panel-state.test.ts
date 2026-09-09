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
    conversationId: "1",
    phase: "first",
  });
});

test("visibility and request change independently", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("a"));
  state.close();
  assert.equal(state.isOpen, false);

  state.succeed(snapshot("a"), "思考结果");
  assert.equal(state.isOpen, false);
  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: snapshot("a"),
    response: "思考结果",
    conversationId: "1",
    phase: "first",
  });

  state.open();
  assert.equal(state.isOpen, true);
  assert.equal(state.view.request.kind, "success");
});

test("a new first request opens a new discussion and switches the active view", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("旧选区"));
  state.succeed(snapshot("旧选区"), "旧回复");

  const next = snapshot("新选区");
  state.beginRequest(next);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: next,
    conversationId: "2",
    phase: "first",
  });
  // 旧讨论保留在讨论集合中，可重开查看
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].conversation_id, "1");

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
  assert.equal(state.conversations.length, 0);
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
  const conversation = state.conversation;
  assert.ok(conversation);
  assert.equal(conversation.id, "1");
  assert.deepEqual(conversation.anchor, anchor);
  assert.deepEqual(conversation.initialUserMaterial, { kind: "summon", selected_text: "冻结选区" });
  assert.equal(conversation.firstResponse, "首次回应");
  assert.deepEqual(conversation.turns, []);
  assert.equal(conversation.pending, null);

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

test("a new summon opens a new discussion while keeping the old one archived", () => {
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
    conversationId: "2",
    phase: "first",
  });
  // 旧讨论保留，可重开
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].conversation_id, "1");
});

test("allocates and preserves conversation identity from accepted first summon through success", () => {
  const state = new AiPanelState();
  const anchor = snapshot("同一选区");

  state.beginRequest(anchor);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: anchor,
    conversationId: "1",
    phase: "first",
  });
  state.succeed(anchor, "首次回应");

  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: anchor,
    response: "首次回应",
    conversationId: "1",
    phase: "first",
  });
  assert.equal(state.conversationIdentity?.conversationId, "1");
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
  state.setPendingSelection(second);
  assert.deepEqual(state.view.pendingSelection, second);
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
    streamedText: "",
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

  selection.selectedText = "篡改后的选区";
  selection.from = 99;
  selection.to = 100;

  assert.deepEqual(state.view.request, {
    kind: "direct_question",
    question: "问题",
    selection: { documentId: "draft", selectedText: "待附带选区", from: 0, to: 5 },
    status: "loading",
    streamedText: "",
  });

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
    conversationId: "1",
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
    conversationId: "1",
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

test("beginDirectQuestion opens a new discussion when a prior conversation exists", () => {
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
    streamedText: "",
  });
  assert.equal(state.conversations.length, 1, "旧讨论保留");
});

test("removing the pending selection keeps the same selection ignored on re-sync", () => {
  const state = new AiPanelState();
  const selection = snapshot("林站在天台边。");

  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);
  state.removePendingSelection();
  assert.equal(state.view.pendingSelection, null);
  state.setPendingSelection(selection);
  assert.equal(state.view.pendingSelection, null, "被忽略的同一选区不应重新附加");

  const newSelection = snapshot("新的选区");
  state.setPendingSelection(newSelection);
  assert.deepEqual(state.view.pendingSelection, newSelection);
});

test("clearing the editor selection does not mark it as ignored", () => {
  const state = new AiPanelState();
  const selection = snapshot("林站在天台边。");

  state.setPendingSelection(selection);
  state.setPendingSelection(null);
  assert.equal(state.view.pendingSelection, null);
  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);
});

test("reset clears the ignored selection marker", () => {
  const state = new AiPanelState();
  const selection = snapshot("旧作品选区");
  state.setPendingSelection(selection);
  state.removePendingSelection();

  state.reset();
  state.setPendingSelection(selection);
  assert.deepEqual(state.view.pendingSelection, selection);
});

test("newConversation opens a new empty discussion and keeps the old one archived", () => {
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
  // 旧讨论保留为档案
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].conversation_id, "1");
});

test("newConversation during first-round loading routes late results to the old discussion", () => {
  const state = new AiPanelState();
  const anchor = snapshot("旧选区");
  state.beginRequest(anchor);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: anchor,
    conversationId: "1",
    phase: "first",
  });

  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);

  // 迟到的首轮成功路由到旧讨论（不显示在新讨论中，也不重建空讨论的对话）。
  state.succeed(anchor, "迟到成功", "1");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null, "当前显示仍是新讨论空状态");
  // 旧讨论已建立对话，仍保留在集合中
  const archived = state.conversations.find((c) => c.conversation_id === "1");
  assert.ok(archived);
  assert.equal(archived.last_status, "done");
});

test("newConversation during a pending follow-up keeps it in the archived discussion", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("追问中");
  assert.equal(state.conversation?.pending?.question, "追问中");

  assert.equal(state.newConversation(), true);
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);

  // 迟到追问结果按旧讨论身份路由，不污染新讨论
  assert.equal(state.succeedFollowUp(1, "迟到追问回答", "1"), true);
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
  state.setPendingSelection(selection);
  state.removePendingSelection();
  state.setPendingSelection(selection);
  assert.equal(state.view.pendingSelection, null, "被忽略的选区在清除前保持忽略");

  state.updateDirectQuestionDraft("草稿");
  state.beginDirectQuestion("草稿", null);
  assert.equal(state.newConversation(), true);
  assert.equal(state.view.directQuestionDraft, "");
  assert.equal(state.view.pendingSelection, null);

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

test("newConversation assigns distinct conversation ids so requests never reuse old identities", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  assert.equal(state.conversationIdentity?.conversationId, "1");

  assert.equal(state.newConversation(), true);

  state.beginRequest(snapshot("新选区"));
  const loading = state.view.request;
  assert.equal(loading.kind, "loading");
  if (loading.kind !== "loading") return;
  const loadingId = loading.conversationId;
  assert.ok(loadingId !== undefined);
  assert.notEqual(loadingId, "1", "新讨论身份不得复用旧身份");

  state.succeed(snapshot("新选区"), "新首答");
  assert.equal(state.conversationIdentity?.conversationId, loadingId);
});

test("a result arriving while the panel shows a blocked request is still applied", () => {
  const state = new AiPanelState();
  const anchor = snapshot("选区A");
  state.beginRequest(anchor);
  state.blockFirstRequest(anchor);
  assert.equal(state.view.request.kind, "first_blocked");

  state.succeed(anchor, "真实首答");
  assert.equal(state.view.request.kind, "success");
  assert.equal(state.conversation?.firstResponse, "真实首答");
});

test("appendStreamText advances the direct question loading draft and is inert elsewhere", () => {
  const state = new AiPanelState();
  assert.equal(state.appendStreamText("迟到"), false);

  state.beginDirectQuestion("问题", null);
  assert.equal(state.appendStreamText("她可能"), true);
  assert.equal(state.appendStreamText("\n在隐瞒"), true);
  const request = state.view.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.streamedText, "她可能\n在隐瞒");
  }

  state.succeedDirectQuestion("最终回答");
  assert.equal(state.appendStreamText("迟到"), false);
});

test("appendStreamText advances the pending follow-up draft and resets on retry", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  assert.equal(state.appendStreamText("无主增量"), false);

  state.beginFollowUp("追问");
  assert.equal(state.appendStreamText("部分"), true);
  assert.equal(state.conversation?.pending?.streamedText, "部分");

  state.failFollowUp(1, authError);
  assert.equal(state.appendStreamText("迟到"), false);
  state.acceptFollowUpRetry();
  assert.equal(state.conversation?.pending?.streamedText, "");
  assert.equal(state.appendStreamText("重新开始"), true);
  assert.equal(state.conversation?.pending?.streamedText, "重新开始");
});

test("driver recovery keeps the conversation and returns to success display", () => {
  const state = new AiPanelState();
  assert.equal(state.beginRecovery(), false);

  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("第一问");
  state.succeedFollowUp(1, "第一答");

  assert.equal(state.beginRecovery(), true);
  assert.deepEqual(state.view.request, {
    kind: "recovering",
    snapshot: anchor,
    conversationId: "1",
  });
  assert.ok(state.conversation, "恢复期间保留对话与锚点");

  assert.equal(state.completeRecovery(), true);
  assert.deepEqual(state.view.request, {
    kind: "success",
    snapshot: anchor,
    response: "首答",
    conversationId: "1",
    phase: "first",
  });
});

test("failed recovery enters the error state with a new-conversation guidance message", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginDirectQuestion("问题", anchor);
  state.succeedDirectQuestion("首答");

  assert.equal(state.beginRecovery(), true);
  assert.equal(state.failRecovery(), true);
  const request = state.view.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.equal(request.error.message, "对话恢复失败，请点击新建对话开始新对话");
    assert.equal(request.conversationId, "1");
  }
  assert.equal(state.completeRecovery(), false);
});

test("deleteDiscussion removes the discussion and drops its late results", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("追问");
  assert.equal(state.conversations.length, 1);

  assert.equal(state.deleteDiscussion("1"), true);
  assert.equal(state.conversations.length, 0);
  assert.equal(state.conversation, null);
  assert.equal(state.activeConversationId, null);

  // 已删除讨论的迟到结果被丢弃
  assert.equal(state.succeedFollowUp(1, "迟到", "1"), false);
  assert.equal(state.conversation, null);
});

test("openDiscussion shows saved turns including an interrupted pending turn", () => {
  const state = new AiPanelState();
  state.openDiscussion(
    {
      id: "c-1",
      createdAt: "t0",
      anchor: null,
      initialUserMaterial: { kind: "direct_question", question: "原问题" },
      firstResponse: "首答",
      turns: [],
      pending: { id: 1, question: "未完成", streamedText: "", interrupted: true },
    },
    "doc-1",
    "草稿",
  );

  assert.equal(state.activeConversationId, "c-1");
  assert.equal(state.conversation?.firstResponse, "首答");
  assert.equal(state.conversation?.pending?.interrupted, true);
  // 中断轮不自动重发，可继续追问
  assert.equal(state.followUpAvailable, true);
});

test("loadDiscussions replaces the in-memory list without auto-opening a discussion", () => {
  const state = new AiPanelState();
  state.loadDiscussions([
    {
      conversation_id: "c-1",
      title: "标题一",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: null,
      focus_document_title: null,
      first_round_material: { kind: "direct_question", question: "问题一", selection_text: null },
      turns: [{ role: "assistant", text: "回答一", status: "done" }],
    },
  ], []);

  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].conversation_id, "c-1");
  assert.equal(state.activeConversationId, null, "加载列表不自动打开任何讨论");
  assert.equal(state.isOpen, false);
});

test("setSaveError and clearSaveError expose the save error bit", () => {
  const state = new AiPanelState();
  assert.equal(state.saveError, null);
  state.setSaveError("讨论保存失败");
  assert.equal(state.saveError, "讨论保存失败");
  assert.equal(state.view.saveError, "讨论保存失败");
  state.clearSaveError();
  assert.equal(state.saveError, null);
});
