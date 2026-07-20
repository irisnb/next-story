import assert from "node:assert/strict";
import test from "node:test";

import { TemporaryConversationState, frozenSnapshot } from "../src/ai-panel-conversation.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

const authError: GenerateAiError = {
  code: "authentication",
  message: "认证失败",
};

test("createFromFirstSuccess freezes the anchor and rejects external mutation", () => {
  const state = new TemporaryConversationState();
  const original = snapshot("背叛");
  const conversation = state.createFromFirstSuccess(1, original, "首轮回应");

  assert.equal(conversation.id, 1);
  assert.equal(conversation.firstResponse, "首轮回应");
  assert.equal(conversation.pending, null);
  assert.deepEqual(conversation.turns, []);

  // 返回的 anchor 是冻结快照，外部改原对象不影响对话
  original.selectedText = "被改写";
  assert.equal(conversation.anchor.selectedText, "背叛");
  assert.throws(() => {
    (conversation.anchor as { selectedText: string }).selectedText = "再改";
  });
});

test("beginFollowUp allows only one pending turn and rejects blank questions", () => {
  const state = new TemporaryConversationState();
  state.createFromFirstSuccess(1, snapshot("锚点"), "首轮");

  assert.equal(state.beginFollowUp("   "), null);
  assert.equal(state.beginFollowUp(""), null);

  const turnId = state.beginFollowUp("为什么？");
  assert.equal(turnId, 1);
  assert.equal(state.current?.pending?.id, 1);
  assert.equal(state.current?.pending?.question, "为什么？");
  assert.equal(state.followUpAvailable, false);

  // 已有 pending 时不能再开新的
  assert.equal(state.beginFollowUp("第二问"), null);
});

test("succeedFollowUp appends one successful turn and clears pending", () => {
  const state = new TemporaryConversationState();
  state.createFromFirstSuccess(1, snapshot("锚点"), "首轮");
  const turnId = state.beginFollowUp("为什么？");
  assert.notEqual(turnId, null);

  const turn = state.succeedFollowUp(turnId!, "可能因为...");
  assert.deepEqual(turn, { id: turnId, question: "为什么？", response: "可能因为..." });
  assert.equal(state.current?.pending, null);
  assert.equal(state.current?.turns.length, 1);
  assert.equal(state.followUpAvailable, true);
});

test("failFollowUp and retry preserve question; stale turn ids are rejected", () => {
  const state = new TemporaryConversationState();
  state.createFromFirstSuccess(1, snapshot("锚点"), "首轮");
  const turnId = state.beginFollowUp("为什么？")!;

  assert.equal(state.failFollowUp(999, authError), false);
  assert.equal(state.failFollowUp(turnId, authError), true);
  assert.equal(state.current?.pending?.error?.code, "authentication");
  assert.equal(state.retryFollowUpQuestion(), "为什么？");

  const acceptedId = state.acceptFollowUpRetry();
  assert.equal(acceptedId, turnId);
  assert.equal(state.current?.pending?.error, undefined);
  assert.equal(state.current?.pending?.question, "为什么？");
});

test("edit failed question and cancel restore prior response without touching successful turns", () => {
  const state = new TemporaryConversationState();
  state.createFromFirstSuccess(1, snapshot("锚点"), "首轮");
  const firstTurn = state.beginFollowUp("第一问")!;
  state.succeedFollowUp(firstTurn, "第一答");

  const secondTurn = state.beginFollowUp("第二问")!;
  state.failFollowUp(secondTurn, authError);

  assert.equal(state.acceptEditedFollowUp("修改后的第二问"), secondTurn);
  assert.equal(state.current?.pending?.question, "修改后的第二问");
  assert.equal(state.current?.pending?.error, undefined);
  assert.equal(state.current?.turns.length, 1);

  // 再次失败后取消：回到上一成功回应
  state.failFollowUp(secondTurn, authError);
  const restored = state.cancelFollowUp(secondTurn);
  assert.equal(restored, "第一答");
  assert.equal(state.current?.pending, null);
  assert.equal(state.current?.turns.length, 1);
  assert.equal(state.current?.turns[0].response, "第一答");
});

test("follow-up request uses frozen selected text and successful turns only", () => {
  const state = new TemporaryConversationState();
  const anchor = snapshot("原选区");
  state.createFromFirstSuccess(3, anchor, "首轮回应");
  const turnId = state.beginFollowUp("第一问")!;
  state.succeedFollowUp(turnId, "第一答");
  state.beginFollowUp("当前追问");

  const request = state.followUpRequest();
  assert.deepEqual(request, {
    kind: "follow_up",
    selected_text: "原选区",
    messages: [
      { role: "assistant", content: "首轮回应" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "当前追问" },
    ],
  });

  // 编辑预览：失败轮次存在时可用新问题构造请求，但不改已成功轮次
  state.failFollowUp(state.current!.pending!.id, authError);
  const preview = state.followUpRequestForQuestion("编辑后的问题");
  assert.equal(preview?.selected_text, "原选区");
  assert.equal(preview?.messages[preview.messages.length - 1].content, "编辑后的问题");
  assert.equal(state.current?.turns.length, 1);
});

test("readonlyView cannot mutate internal conversation state", () => {
  const state = new TemporaryConversationState();
  state.createFromFirstSuccess(1, snapshot("锚点"), "首轮");
  const turnId = state.beginFollowUp("为什么？")!;
  state.failFollowUp(turnId, authError);

  const view = state.readonlyView();
  assert.ok(view);
  assert.throws(() => {
    (view!.turns as SuccessfulFollowUpTurnMutable[]).push({
      id: 99,
      question: "注入",
      response: "注入",
    });
  });
  assert.throws(() => {
    (view!.pending as { question: string }).question = "被改写";
  });
  assert.equal(state.current?.pending?.question, "为什么？");
  assert.equal(state.current?.turns.length, 0);
});

test("frozenSnapshot freezes a shallow copy", () => {
  const original = snapshot("文本");
  const frozen = frozenSnapshot(original);
  original.selectedText = "改掉";
  assert.equal(frozen.selectedText, "文本");
  assert.throws(() => {
    (frozen as { selectedText: string }).selectedText = "再改";
  });
});

type SuccessfulFollowUpTurnMutable = {
  id: number;
  question: string;
  response: string;
};
