import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import type { ReadonlyTemporaryConversation } from "../src/ai-panel-state.ts";
import { buildDiscussionRecord, conversationFromRecord } from "../src/ai-panel-conversation.ts";
import { summaryToRecord } from "../src/ai-feature.ts";
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
  tracked.newConversation();
  tracked.updateDirectQuestionDraft("1", "这个角色为什么犹豫？");
  assert.equal(tracked.view.directQuestionDraft, "这个角色为什么犹豫？");
  assert.equal(calls, 2);
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题");

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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "   ");
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题");
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题");
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题");
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "未发送的问题");
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
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题");
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
  state.updateDirectQuestionDraft("1", "未发送草稿");
  assert.equal(state.isOpen, true);

  assert.equal(state.newConversation(), true);
  assert.equal(state.isOpen, true, "新建对话后面板保持展开");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.conversation, null);
  assert.equal(state.followUpAvailable, false);
  assert.equal(state.conversationIdentity, null);
  assert.equal(state.view.directQuestionDraft, "", "新讨论草稿为空");
  // 旧讨论的草稿按窗口独立保留，不被新建对话清空。
  assert.equal(state.viewOf("1").directQuestionDraft, "未发送草稿");
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

test("newConversation opens an empty discussion window even at zero discussions", () => {
  let calls = 0;
  const state = new AiPanelState(() => {
    calls += 1;
  });

  assert.equal(state.newConversation(), true);
  assert.equal(calls, 1, "新建空讨论窗口通知一次");
  assert.deepEqual(state.view.request, { kind: "idle" });
  assert.equal(state.windows.size, 1, "0 条讨论时也打开一个空窗口");

  // 聚焦窗口已是空窗口：复用，不新建第二个。
  assert.equal(state.newConversation(), false);
  assert.equal(calls, 1, "复用空窗口不通知");
  assert.equal(state.windows.size, 1);
});

test("drafts are isolated per discussion window", () => {
  const state = new AiPanelState();
  // 窗口 1：直接提问失败，草稿保留供重试。
  state.newConversation();
  state.updateDirectQuestionDraft("1", "问题一");
  state.beginDirectQuestion("问题一", null);
  state.failDirectQuestion(authError);
  assert.equal(state.viewOf("1").directQuestionDraft, "问题一");

  // 窗口 2：新窗口草稿为空，切窗口不串草稿。
  assert.equal(state.newConversation(), true);
  const secondId = state.activeConversationId!;
  state.updateDirectQuestionDraft(secondId, "问题二");
  assert.equal(state.view.directQuestionDraft, "问题二");
  assert.equal(state.viewOf("1").directQuestionDraft, "问题一", "逐窗口草稿互不串用");
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

  state.newConversation();
  state.updateDirectQuestionDraft("1", "草稿");
  state.beginDirectQuestion("草稿", null);
  assert.equal(state.newConversation(), true);
  assert.equal(state.view.directQuestionDraft, "", "新讨论草稿为空");
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
  assert.equal(state.appendStreamText("unknown", "迟到"), false);

  state.beginDirectQuestion("问题", null);
  assert.equal(state.appendStreamText("1", "她可能"), true);
  assert.equal(state.appendStreamText("1", "\n在隐瞒"), true);
  const request = state.view.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.streamedText, "她可能\n在隐瞒");
  }

  state.succeedDirectQuestion("最终回答");
  assert.equal(state.appendStreamText("1", "迟到"), false);
});

test("appendStreamText advances the pending follow-up draft and resets on retry", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  assert.equal(state.appendStreamText("unknown", "无主增量"), false);

  state.beginFollowUp("追问");
  assert.equal(state.appendStreamText("1", "部分"), true);
  assert.equal(state.conversation?.pending?.streamedText, "部分");

  state.failFollowUp(1, authError);
  assert.equal(state.appendStreamText("1", "迟到"), false);
  state.acceptFollowUpRetry();
  assert.equal(state.conversation?.pending?.streamedText, "");
  assert.equal(state.appendStreamText("1", "重新开始"), true);
  assert.equal(state.conversation?.pending?.streamedText, "重新开始");
});

test("driver recovery keeps the conversation and returns to success display", () => {
  const state = new AiPanelState();
  assert.equal(state.beginRecovery("unknown"), false);

  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("第一问");
  state.succeedFollowUp(1, "第一答");

  assert.equal(state.beginRecovery("1"), true);
  assert.deepEqual(state.view.request, {
    kind: "recovering",
    snapshot: anchor,
    conversationId: "1",
  });
  assert.ok(state.conversation, "恢复期间保留对话与锚点");

  assert.equal(state.completeRecovery("1"), true);
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

  assert.equal(state.beginRecovery("1"), true);
  assert.equal(state.failRecovery("1"), true);
  const request = state.view.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.equal(request.error.message, "对话恢复失败，请点击新建对话开始新对话");
    assert.equal(request.conversationId, "1");
  }
  assert.equal(state.completeRecovery("1"), false);
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

// ========== 阶段 3：流式与终态按讨论身份路由（任务 1.4 / 1.5） ==========

test("concurrent streams in two discussions route increments to their own discussion", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("选区一")); // 讨论 "1"（召唤首轮 loading）
  state.beginDirectQuestion("问题二", null); // 讨论 "2"（直接提问 loading，且成为聚焦讨论）

  assert.equal(state.appendStreamText("1", "甲"), true);
  assert.equal(state.appendStreamText("2", "乙"), true);
  assert.equal(state.appendStreamText("1", "丙"), true);

  const discussionA = state.getDiscussion("1")!;
  const discussionB = state.getDiscussion("2")!;
  assert.equal(discussionA.request.kind, "loading");
  assert.equal(discussionB.request.kind, "direct_question");
  if (discussionA.request.kind === "loading") {
    assert.equal(discussionA.request.streamedText, "甲丙");
  }
  if (discussionB.request.kind === "direct_question") {
    assert.equal(discussionB.request.streamedText, "乙");
  }
});

test("late increments and terminal results for a removed discussion do not pollute others", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("选区一")); // 讨论 "1"
  state.succeed(snapshot("选区一"), "首答一");
  state.beginRequest(snapshot("选区二")); // 讨论 "2"（新讨论，聚焦）
  state.deleteDiscussion("1"); // 移除讨论 "1" 及其窗口

  // 迟到增量与终态按已删除讨论身份路由：无匹配讨论，不污染讨论 "2"
  assert.equal(state.appendStreamText("1", "迟到增量"), false);
  assert.equal(state.succeed(snapshot("选区一"), "迟到成功", "1"), false);

  // 讨论 "2" 仍为 loading，且无被污染文本；其增量仍正常路由
  const after = state.getDiscussion("2")!;
  assert.equal(after.request.kind, "loading");
  if (after.request.kind === "loading") {
    assert.equal(after.request.streamedText, undefined);
  }
  assert.equal(state.appendStreamText("2", "乙"), true);
  const discussionB = state.getDiscussion("2")!;
  if (discussionB.request.kind === "loading") {
    assert.equal(discussionB.request.streamedText, "乙");
  }
});

// ========== 阶段 3：窗口结构状态（任务 2.5） ==========

test("window structure opens a docked window and focuses it on first request", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);

  assert.equal(state.windows.size, 1);
  assert.equal(state.windows.get("1"), "docked");
  assert.equal(state.focusedConversationId, "1");
  assert.equal(state.activeConversationId, "1");
});

test("window structure reopens an open discussion by focusing without duplicating", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题一", null);
  state.succeedDirectQuestion("回答一");
  state.beginDirectQuestion("问题二", null); // 讨论 "2"
  assert.equal(state.windows.size, 2);
  assert.equal(state.focusedConversationId, "2");

  state.openDiscussion(
    {
      id: "1",
      createdAt: "t0",
      anchor: null,
      initialUserMaterial: { kind: "direct_question", question: "问题一" },
      firstResponse: "回答一",
      turns: [],
      pending: null,
    },
    null,
    null,
  );
  assert.equal(state.windows.size, 2, "重开已打开讨论不创建第二个窗口");
  assert.equal(state.windows.get("1"), "docked");
  assert.equal(state.focusedConversationId, "1");
});

test("window structure removes the window on delete and focuses nothing when it was focused", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  assert.equal(state.windows.size, 1);

  state.deleteDiscussion("1");
  assert.equal(state.windows.size, 0);
  assert.equal(state.focusedConversationId, null);
  assert.equal(state.activeConversationId, null);
});

test("window structure clears all windows on reset and loadDiscussions", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("回答");
  assert.equal(state.windows.size, 1);

  state.reset();
  assert.equal(state.windows.size, 0);
  assert.equal(state.focusedConversationId, null);

  state.beginDirectQuestion("问题二", null);
  state.succeedDirectQuestion("回答二");
  state.loadDiscussions([], []);
  assert.equal(state.windows.size, 0);
  assert.equal(state.focusedConversationId, null);
});

test("window structure notifies once per transition and is silent on illegal transitions", () => {
  let calls = 0;
  const state = new AiPanelState(() => { calls += 1; });
  state.beginDirectQuestion("问题", null);
  assert.equal(calls, 1);

  // 非法迁移（未知讨论的增量 / 删除未知讨论）不改变状态、不通知
  assert.equal(state.appendStreamText("unknown", "迟到"), false);
  assert.equal(calls, 1);
  assert.equal(state.deleteDiscussion("unknown"), false);
  assert.equal(calls, 1);

  // 合法迁移通知一次
  assert.equal(state.appendStreamText("1", "增量"), true);
  assert.equal(calls, 2);
});

// ========== 阶段 3：停止生成 / 聚焦 / 关闭窗口（任务 3.5、5.8） ==========

test("stopRequest marks a loading first round stopped and preserves streamed text", () => {
  const state = new AiPanelState();
  state.beginRequest(snapshot("选区"));
  state.appendStreamText("1", "部分回答");

  assert.equal(state.stopRequest("1"), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "stopped");
  if (request.kind === "stopped") {
    assert.equal(request.phase, "first");
    assert.equal(request.streamedText, "部分回答");
  }
  // 迟到终态不把「已停止」改回失败/成功
  assert.equal(state.succeed(snapshot("选区"), "迟到成功", "1"), false);
});

test("stopRequest marks a loading direct question stopped and preserves its question", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.appendStreamText("1", "草稿");

  assert.equal(state.stopRequest("1"), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "stopped");
    assert.equal(request.question, "问题");
    assert.equal(request.streamedText, "草稿");
  }
  assert.equal(state.succeedDirectQuestion("迟到", "1"), false);
});

test("stopRequest marks a loading follow-up stopped and keeps the pending question", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("首答");
  state.beginFollowUp("追问");
  state.appendStreamText("1", "部分");

  assert.equal(state.stopRequest("1"), true);
  assert.equal(state.getDiscussion("1")!.request.kind, "stopped");
  assert.equal(state.conversation?.pending?.interrupted, true);
  assert.equal(state.conversation?.pending?.question, "追问");
  assert.equal(state.conversation?.pending?.streamedText, "部分");
});

test("stopRequest only affects the target discussion, not others generating in parallel", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题一", null); // "1" loading
  state.beginDirectQuestion("问题二", null); // "2" loading

  assert.equal(state.stopRequest("1"), true);
  const discussionB = state.getDiscussion("2")!;
  assert.equal(discussionB.request.kind, "direct_question");
  if (discussionB.request.kind === "direct_question") {
    assert.equal(discussionB.request.status, "loading", "其他讨论不受停止影响");
  }
});

test("retryStoppedFollowUp resumes the interrupted pending turn into loading", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("首答");
  state.beginFollowUp("追问");
  state.stopRequest("1");

  assert.equal(state.retryStoppedFollowUp(), true);
  assert.equal(state.getDiscussion("1")!.request.kind, "loading");
  assert.equal(state.conversation?.pending?.interrupted, undefined);
  assert.equal(state.conversation?.pending?.question, "追问");
});

test("retryDirectQuestion re-enters loading with the same question and selection", () => {
  const state = new AiPanelState();
  const selection = snapshot("选区");
  state.beginDirectQuestion("问题", selection);
  state.stopRequest("1");

  assert.equal(state.retryDirectQuestion("1"), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "loading");
    assert.equal(request.question, "问题");
  }
});

test("focusWindow focuses an open window and is inert for non-window discussions", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题一", null); // "1"
  state.beginDirectQuestion("问题二", null); // "2" 聚焦
  assert.equal(state.focusedConversationId, "2");

  assert.equal(state.focusWindow("1"), true);
  assert.equal(state.focusedConversationId, "1");
  // 非法：未打开窗口的讨论
  assert.equal(state.focusWindow("unknown"), false);
});

test("closeWindow ends display but keeps the discussion; reopen re-adds a window", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("首答");
  assert.equal(state.windows.size, 1);

  assert.equal(state.closeWindow("1"), true);
  assert.equal(state.windows.size, 0, "关闭窗口不删除讨论");
  assert.equal(state.getDiscussion("1") !== null, true, "讨论保留");
  assert.equal(state.focusedConversationId, null);

  // 重开：重新打开窗口
  state.openDiscussion(
    {
      id: "1",
      createdAt: "t0",
      anchor: null,
      initialUserMaterial: { kind: "direct_question", question: "问题" },
      firstResponse: "首答",
      turns: [],
      pending: null,
    },
    null,
    null,
  );
  assert.equal(state.windows.size, 1);
  assert.equal(state.focusedConversationId, "1");
});

test("closeWindow is inert for a discussion without an open window", () => {
  const state = new AiPanelState();
  assert.equal(state.closeWindow("unknown"), false);
});

// ========== 阶段 3：排队与恢复覆盖（第 6、7 组） ==========

test("queueRequest marks a loading request queued and startQueuedRequest resumes it", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);

  assert.equal(state.queueRequest("1"), true);
  let request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.queued, true);

  assert.equal(state.startQueuedRequest("1"), true);
  request = state.getDiscussion("1")!.request;
  if (request.kind === "direct_question") assert.equal(request.queued, undefined);
});

test("stopRequest marks a queued request stopped", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.queueRequest("1");

  assert.equal(state.stopRequest("1"), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.status, "stopped");
});

test("recovery covers each open discussion independently", () => {
  const state = new AiPanelState();
  // 讨论 1：有对话。
  state.beginDirectQuestion("问题一", null);
  state.succeedDirectQuestion("回答一");
  // 讨论 2：有对话。
  state.beginDirectQuestion("问题二", null);
  state.succeedDirectQuestion("回答二");

  assert.equal(state.beginRecovery("1"), true);
  assert.equal(state.beginRecovery("2"), true);
  assert.equal(state.getDiscussion("1")!.request.kind, "recovering");
  assert.equal(state.getDiscussion("2")!.request.kind, "recovering");

  assert.equal(state.completeRecovery("1"), true);
  assert.equal(state.getDiscussion("1")!.request.kind, "success");
  assert.equal(state.getDiscussion("2")!.request.kind, "recovering", "其他讨论恢复状态不受影响");
  assert.equal(state.completeRecovery("2"), true);
});

// ========== 阶段 3：会话列表重做（第 8、9 组） ==========

test("renameDiscussion updates the list title and persists the custom title", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("回答");
  assert.equal(state.conversations[0].title, "问题");

  assert.equal(state.renameDiscussion("1", "第二幕转折"), true);
  assert.equal(state.conversations[0].title, "第二幕转折");
  assert.equal(state.conversations[0].custom_title, "第二幕转折");

  // 空白标题按未重命名处理。
  assert.equal(state.renameDiscussion("1", "   "), true);
  assert.equal(state.conversations[0].title, "问题");
});

test("setDiscussionPinned toggles the pinned flag", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("回答");
  assert.equal(state.conversations[0].pinned, false);

  assert.equal(state.setDiscussionPinned("1", true), true);
  assert.equal(state.conversations[0].pinned, true);
  assert.equal(state.setDiscussionPinned("1", false), true);
  assert.equal(state.conversations[0].pinned, false);
});

test("custom title and pinned survive a record round-trip", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("回答");
  state.renameDiscussion("1", "第二幕转折");
  state.setDiscussionPinned("1", true);

  const record = buildDiscussionRecord(state.getDiscussion("1")!);
  assert.equal(record.title, "第二幕转折");
  assert.equal(record.pinned, true);

  const reopened = conversationFromRecord(record);
  assert.equal(reopened.customTitle, "第二幕转折");
  assert.equal(reopened.pinned, true);
});

test("summaryToRecord restores an archive record from a list summary", () => {
  const summary = {
    conversation_id: "c-1",
    title: "我的标题",
    created_at: "t0",
    updated_at: "t1",
    last_status: "done" as const,
    focus_document_id: "doc-1",
    focus_document_title: "草稿",
    first_round_material: { kind: "direct_question" as const, question: "问题", selection_text: null },
    turns: [{ role: "assistant" as const, text: "回答", status: "done" as const }],
    custom_title: "我的标题",
    pinned: true,
  };
  const record = summaryToRecord(summary);
  assert.equal(record.conversation_id, "c-1");
  assert.equal(record.title, "我的标题");
  assert.equal(record.pinned, true);
  assert.deepEqual(record.turns, summary.turns);
});

// ========== 材料权限变化隔离（controlled-story-read-visibility 任务 5） ==========

test("loadDiscussions marks a discussion restricted when its provenance references a hidden document", () => {
  const state = new AiPanelState();
  state.loadDiscussions([
    {
      conversation_id: "c-1",
      title: "标题一",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    },
  ], [], new Set(["doc-1"]));

  const conversation = state.conversationOf("c-1");
  assert.equal(conversation?.restricted, true);
  assert.equal(state.restrictionNoticeOf("c-1") !== null, true);
  // 受限讨论不可沿原上下文继续。
  assert.equal(state.viewOf("c-1").request.kind, "success");
});

test("loadDiscussions keeps a visible discussion unrestricted and continuable", () => {
  const state = new AiPanelState();
  state.loadDiscussions([
    {
      conversation_id: "c-1",
      title: "标题一",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    },
  ], [], new Set());

  assert.equal(state.conversationOf("c-1")?.restricted, false);
  assert.equal(state.restrictionNoticeOf("c-1"), null);
});

test("recomputeRestrictions latches already-open discussions when a source document becomes hidden (5.2)", () => {
  const state = new AiPanelState();
  state.loadDiscussions([
    {
      conversation_id: "c-1",
      title: "标题一",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: "doc-1",
      focus_document_title: null,
      first_round_material: { kind: "summon", question: "", selection_text: "选区" },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [
        { document_id: "doc-1", material_type: "selection", document_version: null, turn_index: 0, entered_model_context: true },
      ],
    },
  ], [], new Set());
  // 加载时可见：不受限。
  assert.equal(state.conversationOf("c-1")?.restricted, false);

  // 权限变更：doc-1 被隐藏 → 立即重算并锁存。
  const newlyRestricted = state.recomputeRestrictions(new Set(["doc-1"]));
  assert.deepEqual(newlyRestricted, ["c-1"]);
  assert.equal(state.conversationOf("c-1")?.restricted, true);
  assert.equal(state.restrictionNoticeOf("c-1") !== null, true);

  // 重新开启可见性（隐藏集为空）不解除：单调锁存（任务 5.4）。
  assert.deepEqual(state.recomputeRestrictions(new Set()), []);
  assert.equal(state.conversationOf("c-1")?.restricted, true);
});

test("recomputeRestrictions leaves no-material discussions unaffected", () => {
  const state = new AiPanelState();
  state.loadDiscussions([
    {
      conversation_id: "c-2",
      title: "无材料",
      created_at: "t0",
      updated_at: "t0",
      last_status: "done",
      focus_document_id: null,
      focus_document_title: null,
      first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
      turns: [{ role: "assistant", text: "回答", status: "done" }],
      provenance: [],
    },
  ], [], new Set());

  assert.deepEqual(state.recomputeRestrictions(new Set(["doc-1"])), []);
  assert.equal(state.conversationOf("c-2")?.restricted, false);
  assert.equal(state.restrictionNoticeOf("c-2"), null);
});

test("rejectQueuedRequest transitions a queued direct question to a visible failure", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.queueRequest("1");

  assert.equal(state.rejectQueuedRequest("1", { code: "document_not_visible", message: "材料文档的可见性已变化，本次请求未发送。" }), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "error");
    assert.equal(request.queued, undefined);
    assert.equal(request.error?.code, "document_not_visible");
  }
});

test("rejectQueuedRequest transitions a queued summon first round to a visible failure", () => {
  const state = new AiPanelState();
  const anchor = snapshot("选区");
  state.beginRequest(anchor);
  state.queueRequest("1");

  assert.equal(state.rejectQueuedRequest("1", { code: "document_not_visible", message: "材料文档的可见性已变化，本次请求未发送。" }), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.equal(request.error.code, "document_not_visible");
    assert.equal(request.conversationId, "1");
  }
});

test("rejectQueuedRequest fails the pending turn of a queued follow-up", () => {
  const state = new AiPanelState();
  const anchor = snapshot("选区");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("追问");
  state.queueRequest("1");

  assert.equal(state.rejectQueuedRequest("1", { code: "document_not_visible", message: "材料文档的可见性已变化，本次请求未发送。" }), true);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "error");
  assert.equal(state.conversation?.pending?.error?.code, "document_not_visible");
});

test("rejectQueuedRequest is inert for a non-queued request", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  // 未排队：拒绝不得误伤正常 loading。
  assert.equal(state.rejectQueuedRequest("1", { code: "document_not_visible", message: "x" }), false);
  const request = state.getDiscussion("1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.status, "loading");
});
