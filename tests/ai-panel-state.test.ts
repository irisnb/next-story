import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import type { ReadonlyTemporaryConversation } from "../src/ai-panel-state.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

const authError: GenerateAiError = {
  code: "authentication",
  message: "认证失败",
};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;
type _ConversationAnchorIsReadonly = Assert<
  Equal<ReadonlyTemporaryConversation["anchor"], Readonly<SelectionSnapshot>>
>;
type _ConversationTurnsAreReadonly = Assert<
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
    assert.equal(state.view.request.snapshot.selectedText, "a");
  }
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

test("forms one anchored linear conversation after the first success", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结选区");
  state.beginRequest(anchor);
  state.succeed(anchor, "首次回应");

  assert.equal(state.followUpAvailable, true);
  assert.deepEqual(state.conversation, {
    id: 1,
    anchor,
    firstResponse: "首次回应",
    turns: [],
    pending: null,
  });

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

  assert.equal(Reflect.set(view.anchor, "selectedText", "篡改"), false);
  assert.equal(Reflect.set(view.pending!, "question", "篡改问题"), false);
  assert.equal(state.followUpRequest()?.selected_text, "不可变锚点");
  const messages = state.followUpRequest()?.messages;
  assert.equal(messages?.[messages.length - 1]?.content, "问题");
});
