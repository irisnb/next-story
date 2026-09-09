import assert from "node:assert/strict";
import test from "node:test";

import {
  beginConversationFollowUp,
  buildConversationRecord,
  buildDiscussionRecord,
  conversationFromRecord,
  createConversationFromFirstSuccess,
  failConversationFollowUp,
  followUpAvailableOf,
  frozenSnapshot,
  readonlyConversationView,
  succeedConversationFollowUp,
  summaryOf,
  type Discussion,
  type FirstRoundMaterial,
  type TemporaryConversation,
} from "../src/ai-panel-conversation.ts";
import { idleRequest } from "../src/ai-panel-request-state.ts";
import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

const authError: GenerateAiError = {
  code: "authentication",
  message: "认证失败",
};

function summonRequest(text: string): Extract<GenerateAiRequest, { kind: "summon" }> {
  return { kind: "summon", selected_text: text };
}

function directQuestionRequest(
  question: string,
  selectedText?: string,
): Extract<GenerateAiRequest, { kind: "direct_question" }> {
  return selectedText
    ? { kind: "direct_question", question, selected_text: selectedText }
    : { kind: "direct_question", question };
}

function conversation(
  material: FirstRoundMaterial,
  firstResponse: string,
  anchor: SelectionSnapshot | null = null,
): TemporaryConversation {
  return createConversationFromFirstSuccess("c-1", "t0", anchor, material, firstResponse);
}

test("createFromFirstSuccess accepts direct_question material with a null anchor", () => {
  const value = conversation(directQuestionRequest("这个角色为什么犹豫？"), "首轮回应");
  assert.equal(value.id, "c-1");
  assert.equal(value.anchor, null);
  assert.equal(value.initialUserMaterial.kind, "direct_question");
  assert.equal(value.firstResponse, "首轮回应");
  assert.equal(value.pending, null);
  assert.deepEqual(value.turns, []);
});

test("readonlyView handles a null anchor without throwing", () => {
  const view = readonlyConversationView(conversation(directQuestionRequest("问题"), "首轮"));
  assert.ok(view);
  assert.equal(view.anchor, null);
});

test("createFromFirstSuccess freezes the anchor and rejects external mutation", () => {
  const original = snapshot("背叛");
  const value = conversation(summonRequest("背叛"), "首轮回应", original);

  assert.equal(value.firstResponse, "首轮回应");
  assert.deepEqual(value.initialUserMaterial, summonRequest("背叛"));
  assert.equal(value.pending, null);
  assert.deepEqual(value.turns, []);

  original.selectedText = "被改写";
  assert.ok(value.anchor);
  assert.equal(value.anchor.selectedText, "背叛");
  assert.throws(() => {
    (value.anchor as { selectedText: string }).selectedText = "再改";
  });
});

test("beginFollowUp allows only one active pending turn and rejects blank questions", () => {
  const value = conversation(summonRequest("锚点"), "首轮", snapshot("锚点"));

  assert.equal(beginConversationFollowUp(value, "   ", 1).turnId, null);
  assert.equal(beginConversationFollowUp(value, "", 1).turnId, null);

  const first = beginConversationFollowUp(value, "为什么？", 1);
  assert.equal(first.turnId, 1);
  assert.equal(first.conversation!.pending?.id, 1);
  assert.equal(first.conversation!.pending?.question, "为什么？");
  assert.equal(followUpAvailableOf(first.conversation!), false);

  assert.equal(beginConversationFollowUp(first.conversation!, "第二问", 2).turnId, null);
});

test("an interrupted pending turn can be replaced by a new question", () => {
  const value = conversation(summonRequest("锚点"), "首轮", snapshot("锚点"));
  const interrupted: TemporaryConversation = {
    ...value,
    pending: { id: 1, question: "被打断的问题", streamedText: "", interrupted: true },
  };
  assert.equal(followUpAvailableOf(interrupted), true);

  const next = beginConversationFollowUp(interrupted, "新的问题", 2);
  assert.equal(next.turnId, 2);
  assert.equal(next.conversation!.pending?.question, "新的问题");
  assert.equal(next.conversation!.pending?.interrupted, undefined);
});

test("succeedFollowUp appends one successful turn and clears pending", () => {
  const value = conversation(summonRequest("锚点"), "首轮", snapshot("锚点"));
  const begun = beginConversationFollowUp(value, "为什么？", 1);
  assert.notEqual(begun.turnId, null);

  const outcome = succeedConversationFollowUp(begun.conversation!, begun.turnId!, "可能因为...");
  assert.deepEqual(outcome.turn, { id: begun.turnId, question: "为什么？", response: "可能因为..." });
  assert.equal(outcome.conversation!.pending, null);
  assert.equal(outcome.conversation!.turns.length, 1);
  assert.equal(followUpAvailableOf(outcome.conversation!), true);
});

test("failFollowUp preserves question; stale turn ids are rejected", () => {
  const value = conversation(summonRequest("锚点"), "首轮", snapshot("锚点"));
  const begun = beginConversationFollowUp(value, "为什么？", 1)!;

  assert.equal(failConversationFollowUp(begun.conversation!, 999, authError).ok, false);
  const failed = failConversationFollowUp(begun.conversation!, begun.turnId!, authError);
  assert.equal(failed.ok, true);
  assert.equal(failed.conversation!.pending?.error?.code, "authentication");
});

test("direct-question-origin follow-up request carries the full Q&A with origin", () => {
  const value = conversation(directQuestionRequest("原问题", "冻结选区"), "首轮回应", snapshot("冻结选区"));
  const begun = beginConversationFollowUp(value, "第一问", 1)!;
  const succeeded = succeedConversationFollowUp(begun.conversation!, begun.turnId!, "第一答");
  const current = beginConversationFollowUp(succeeded.conversation!, "当前追问", 2)!.conversation!;

  const request = buildFollowUpPayload(current);
  assert.equal(request.kind, "follow_up");
  if (request.kind === "follow_up") {
    assert.equal(request.origin, "direct_question");
    assert.equal(request.selected_text, "冻结选区");
    assert.deepEqual(request.messages, [
      { role: "user", content: "原问题" },
      { role: "assistant", content: "首轮回应" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "当前追问" },
    ]);
  }
});

test("summon-origin follow-up request omits origin", () => {
  const value = conversation(summonRequest("原选区"), "首轮回应", snapshot("原选区"));
  const begun = beginConversationFollowUp(value, "第一问", 1)!;
  const succeeded = succeedConversationFollowUp(begun.conversation!, begun.turnId!, "第一答");
  const current = beginConversationFollowUp(succeeded.conversation!, "当前追问", 2)!.conversation!;

  const request = buildFollowUpPayload(current);
  assert.equal(request.kind, "follow_up");
  if (request.kind === "follow_up") {
    assert.equal(request.selected_text, "原选区");
    assert.equal(request.origin, undefined);
    assert.deepEqual(request.messages, [
      { role: "assistant", content: "首轮回应" },
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "当前追问" },
    ]);
  }
});

function buildFollowUpPayload(value: TemporaryConversation) {
  // 复用与 ai-panel-conversation 相同的请求构造逻辑，避免重复实现。
  const material = value.initialUserMaterial;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (material.kind === "direct_question") {
    messages.push({ role: "user", content: material.question });
  }
  messages.push({ role: "assistant", content: value.firstResponse });
  for (const turn of value.turns) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.response });
  }
  messages.push({ role: "user", content: value.pending!.question });
  return {
    kind: "follow_up",
    selected_text: material.selected_text ?? "",
    ...(material.kind === "direct_question" ? { origin: "direct_question" as const } : {}),
    messages,
  };
}

test("readonlyView cannot mutate internal conversation state", () => {
  const value = conversation(summonRequest("锚点"), "首轮", snapshot("锚点"));
  const begun = beginConversationFollowUp(value, "为什么？", 1)!;
  const failed = failConversationFollowUp(begun.conversation!, begun.turnId!, authError).conversation!;

  const view = readonlyConversationView(failed);
  assert.ok(view);
  assert.throws(() => {
    (view!.turns as unknown as Array<{ id: number; question: string; response: string }>).push({
      id: 99,
      question: "注入",
      response: "注入",
    });
  });
  assert.throws(() => {
    (view!.pending as { question: string }).question = "被改写";
  });
  assert.equal(failed.pending?.question, "为什么？");
  assert.equal(failed.turns.length, 0);
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

test("buildConversationRecord and conversationFromRecord round-trip a completed discussion", () => {
  const value = conversation(directQuestionRequest("原问题"), "首答", null);
  const begun = beginConversationFollowUp(value, "追问", 1)!;
  const succeeded = succeedConversationFollowUp(begun.conversation!, begun.turnId!, "追问答").conversation!;

  const record = buildConversationRecord(succeeded, "doc-1", "草稿");
  assert.equal(record.version, 1);
  assert.equal(record.conversation_id, "c-1");
  assert.equal(record.focus_document_id, "doc-1");
  assert.equal(record.first_round_material.kind, "direct_question");
  assert.deepEqual(record.turns, [
    { role: "assistant", text: "首答", status: "done" },
    { role: "user", text: "追问", status: "done" },
    { role: "assistant", text: "追问答", status: "done" },
  ]);

  const reopened = conversationFromRecord(record);
  assert.equal(reopened.id, "c-1");
  assert.equal(reopened.firstResponse, "首答");
  assert.deepEqual(reopened.turns, [{ id: 1, question: "追问", response: "追问答" }]);
  assert.equal(reopened.pending, null);
});

test("conversationFromRecord marks an in-flight pending turn as interrupted", () => {
  const value = conversation(directQuestionRequest("原问题"), "首答", null);
  const begun = beginConversationFollowUp(value, "未完成追问", 1)!.conversation!;
  const record = buildConversationRecord(begun, null, null);

  // 未完成轮在档案里是 pending；重开时转为中断。
  assert.equal(record.turns[record.turns.length - 1].status, "pending");
  const reopened = conversationFromRecord(record);
  assert.equal(reopened.pending?.question, "未完成追问");
  assert.equal(reopened.pending?.interrupted, true);
  assert.equal(followUpAvailableOf(reopened), true);
});

test("buildDiscussionRecord covers the first-round in-flight state", () => {
  const discussion: Discussion = {
    id: "c-1",
    createdAt: "t0",
    updatedAt: "t0",
    focusDocumentId: "doc-1",
    focusDocumentTitle: null,
    request: idleRequest(),
    conversation: null,
    anchor: snapshot("林站在天台边。"),
    pendingFirstRequest: summonRequest("林站在天台边。"),
  };
  const record = buildDiscussionRecord(discussion);
  assert.equal(record.conversation_id, "c-1");
  assert.equal(record.first_round_material.kind, "summon");
  assert.deepEqual(record.turns, [{ role: "assistant", text: "", status: "pending" }]);
});

test("conversationFromRecord flags a summon first-round pending turn as interrupted", () => {
  const discussion: Discussion = {
    id: "c-1",
    createdAt: "t0",
    updatedAt: "t0",
    focusDocumentId: "doc-1",
    focusDocumentTitle: null,
    request: idleRequest(),
    conversation: null,
    anchor: snapshot("林站在天台边。"),
    pendingFirstRequest: summonRequest("林站在天台边。"),
  };
  const record = buildDiscussionRecord(discussion);
  const reopened = conversationFromRecord(record);
  assert.equal(reopened.firstRoundInterrupted, true);
  assert.equal(reopened.firstResponse, "");
  assert.equal(reopened.pending, null);
});

test("conversationFromRecord flags a direct-question first-round pending turn as interrupted", () => {
  const discussion: Discussion = {
    id: "c-1",
    createdAt: "t0",
    updatedAt: "t0",
    focusDocumentId: "doc-1",
    focusDocumentTitle: null,
    request: idleRequest(),
    conversation: null,
    anchor: null,
    pendingFirstRequest: directQuestionRequest("这个角色为什么犹豫？"),
  };
  const record = buildDiscussionRecord(discussion);
  assert.deepEqual(record.turns, [
    { role: "user", text: "这个角色为什么犹豫？", status: "done" },
    { role: "assistant", text: "", status: "pending" },
  ]);
  const reopened = conversationFromRecord(record);
  assert.equal(reopened.firstRoundInterrupted, true);
  assert.equal(reopened.initialUserMaterial.kind, "direct_question");
  assert.equal(reopened.initialUserMaterial.question, "这个角色为什么犹豫？");
  assert.equal(reopened.firstResponse, "");
  assert.equal(reopened.pending, null);
});

test("conversationFromRecord keeps a completed summon first round uninterrupted", () => {
  const value = conversation(summonRequest("原选区"), "首轮回应", snapshot("原选区"));
  const record = buildConversationRecord(value, null, null);
  const reopened = conversationFromRecord(record);
  assert.equal(reopened.firstRoundInterrupted, false);
  assert.equal(reopened.firstResponse, "首轮回应");
  assert.equal(reopened.pending, null);
});

test("buildConversationRecord writes a pending first assistant turn when the first round is interrupted with no response", () => {
  const interrupted: TemporaryConversation = {
    ...conversation(summonRequest("原选区"), ""),
    firstRoundInterrupted: true,
  };
  const record = buildConversationRecord(interrupted, null, null);
  assert.equal(record.turns[0].role, "assistant");
  assert.equal(record.turns[0].text, "");
  assert.equal(record.turns[0].status, "pending");
});

test("round-trip preserves the interrupted first round through buildConversationRecord and conversationFromRecord", () => {
  const interrupted: TemporaryConversation = {
    ...conversation(summonRequest("原选区"), ""),
    firstRoundInterrupted: true,
  };
  const record = buildConversationRecord(interrupted, null, null);
  const reopened = conversationFromRecord(record);
  assert.equal(reopened.firstRoundInterrupted, true);
  assert.equal(reopened.firstResponse, "");
  assert.equal(reopened.pending, null);
});

test("buildConversationRecord keeps the first assistant turn done for a completed first round", () => {
  const value = conversation(summonRequest("原选区"), "首轮回应", snapshot("原选区"));
  const record = buildConversationRecord(value, null, null);
  assert.equal(record.turns[0].role, "assistant");
  assert.equal(record.turns[0].status, "done");
});

test("summaryOf reports an interrupted first round as pending with a pending first turn", () => {
  const interrupted: TemporaryConversation = {
    ...conversation(summonRequest("原选区"), ""),
    firstRoundInterrupted: true,
  };
  const summary = summaryOf(interrupted, null, null);
  assert.equal(summary.last_status, "pending");
  assert.equal(summary.turns[0].status, "pending");
});
