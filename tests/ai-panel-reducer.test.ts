import assert from "node:assert/strict";
import test from "node:test";

import {
  initialAiPanelCoreState,
  reduceAiPanelState,
  type AiPanelCoreState,
} from "../src/ai-panel-reducer.ts";
import type { TemporaryConversation } from "../src/ai-panel-conversation.ts";
import type {
  ConversationSummary,
  MaterialProvenance,
  OnDemandReadingProvenance,
} from "../src/conversation-archive.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

/**
 * extract-ai-logic-seams 任务 1.1/1.2：`reduceAiPanelState` 的直接测试安全网。
 *
 * 覆盖全部 54 个事件 case 的迁移语义，并锁定「非法迁移返回同一引用」契约
 * （`next === state`，调用方据此不触发通知）。断言只描述迁移前后的状态，
 * 不引用实现内部细节。
 */

const reduce = reduceAiPanelState;

function snapshot(text: string, documentId = "draft"): SelectionSnapshot {
  return { documentId, selectedText: text, from: 0, to: text.length };
}

const authError: GenerateAiError = { code: "authentication", message: "认证失败" };
const notVisibleError: GenerateAiError = {
  code: "document_not_visible",
  message: "材料文档的可见性已变化，本次请求未发送。请重新发起。",
};

/** 进入直接提问 loading 的讨论（聚焦窗口）。 */
function directStarted(conversationId = "c-1", question = "问题"): AiPanelCoreState {
  return reduce(initialAiPanelCoreState(), {
    type: "begin_direct_question",
    question,
    selection: null,
    conversationId,
    createdAt: "t0",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
}

/** 进入召唤首轮 loading 的讨论（聚焦窗口）。 */
function summonStarted(conversationId = "c-1", text = "召唤选区"): AiPanelCoreState {
  return reduce(initialAiPanelCoreState(), {
    type: "begin_request",
    snapshot: snapshot(text),
    conversationId,
    createdAt: "t0",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
}

/** 已建立对话的讨论（直接提问首轮成功，聚焦窗口）。 */
function established(conversationId = "c-1", response = "首答"): AiPanelCoreState {
  return reduce(directStarted(conversationId), {
    type: "succeed_direct_question",
    response,
    conversationId,
  });
}

/** 材料权限受限的讨论（聚焦窗口，有对话本体）。 */
function restricted(conversationId = "c-1"): AiPanelCoreState {
  const conversation: TemporaryConversation = {
    id: conversationId,
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "问题" },
    firstResponse: "首答",
    turns: [],
    pending: null,
    restricted: true,
    restrictionReason: "hidden_material",
  };
  return reduce(initialAiPanelCoreState(), {
    type: "open_discussion",
    conversation,
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
}

function readingRequestEvent(conversationId = "c-1", callId = "call-1") {
  return {
    type: "reading_request" as const,
    conversationId,
    sessionId: "s-1",
    messageId: "m-1",
    callId,
    reason: "材料不足",
  };
}

function summaryOf(
  partial: Partial<ConversationSummary> & { conversation_id: string },
): ConversationSummary {
  return {
    title: partial.conversation_id,
    created_at: "t0",
    updated_at: "t0",
    last_status: "done",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
    turns: [{ role: "assistant", text: "回答", status: "done" }],
    provenance: [],
    on_demand_reading_grant: null,
    on_demand_reading_provenance: null,
    ...partial,
  };
}

function provenanceOf(documentId: string, turnIndex = 0): MaterialProvenance {
  return {
    document_id: documentId,
    material_type: "focus_document",
    document_version: null,
    turn_index: turnIndex,
    entered_model_context: true,
  };
}

// ========== 旧式预检预览（preview_first_request / block_first_request） ==========

test("preview_first_request 展开面板并进入首轮预览", () => {
  const next = reduce(initialAiPanelCoreState(), {
    type: "preview_first_request",
    snapshot: snapshot("选区"),
  });
  assert.equal(next.visibility, "open");
  assert.deepEqual(next.previewRequest, { kind: "first_preview", snapshot: snapshot("选区") });
});

test("preview_first_request 冻结快照：事后修改原对象不影响已存状态", () => {
  const snap = snapshot("原文");
  const next = reduce(initialAiPanelCoreState(), {
    type: "preview_first_request",
    snapshot: snap,
  });
  snap.selectedText = "篡改";
  assert.equal(next.previewRequest?.kind, "first_preview");
  if (next.previewRequest?.kind === "first_preview") {
    assert.equal(next.previewRequest.snapshot?.selectedText, "原文");
  }
});

test("block_first_request 记录阻塞预览并展开面板", () => {
  const next = reduce(initialAiPanelCoreState(), {
    type: "block_first_request",
    snapshot: snapshot("选区"),
  });
  assert.equal(next.visibility, "open");
  assert.equal(next.previewRequest?.kind, "first_blocked");
  if (next.previewRequest?.kind === "first_blocked") {
    assert.equal(next.previewRequest.message, "已有 AI 请求正在进行，本次请求没有发出。");
  }
});

// ========== 召唤首轮（begin_request / succeed / fail / require_configuration） ==========

test("begin_request 建立召唤首轮 loading 讨论，打开停靠窗口并聚焦", () => {
  const initial = initialAiPanelCoreState();
  const next = reduce(initial, {
    type: "begin_request",
    snapshot: snapshot("召唤选区"),
    conversationId: "c-9",
    createdAt: "t1",
    focusDocumentId: "doc-1",
    focusDocumentTitle: "草稿",
  });
  assert.equal(next.visibility, "open");
  assert.equal(next.previewRequest, null);
  assert.equal(next.generation, initial.generation + 1);
  assert.equal(next.focusedConversationId, "c-9");
  assert.equal(next.windows.get("c-9"), "docked");
  const discussion = next.discussions.get("c-9")!;
  assert.ok(discussion);
  assert.deepEqual(discussion.request, {
    kind: "loading",
    snapshot: snapshot("召唤选区"),
    conversationId: "c-9",
    phase: "first",
  });
  assert.deepEqual(discussion.pendingFirstRequest, { kind: "summon", selected_text: "召唤选区" });
  assert.deepEqual(discussion.anchor, snapshot("召唤选区"));
  assert.equal(discussion.focusDocumentId, "doc-1");
  assert.equal(discussion.focusDocumentTitle, "草稿");
  assert.equal(discussion.conversation, null);
});

test("begin_request 复用聚焦的空讨论并按本次发起重新绑定关注文档", () => {
  let state = reduce(initialAiPanelCoreState(), {
    type: "new_conversation",
    conversationId: "c-empty",
    createdAt: "t0",
    focusDocumentId: "doc-old",
    focusDocumentTitle: "旧文档",
  });
  state = reduce(state, {
    type: "begin_request",
    snapshot: snapshot("新召唤"),
    conversationId: "c-new",
    createdAt: "t1",
    focusDocumentId: "doc-new",
    focusDocumentTitle: "新文档",
  });
  assert.equal(state.discussions.size, 1, "复用空讨论，不另开新讨论");
  const discussion = state.discussions.get("c-empty")!;
  assert.equal(discussion.focusDocumentId, "doc-new");
  assert.equal(discussion.focusDocumentTitle, "新文档");
  assert.equal(discussion.request.kind, "loading");
});

test("succeed 把召唤首轮 loading 迁移为成功并建立对话", () => {
  const next = reduce(summonStarted("c-1", "召唤"), {
    type: "succeed",
    snapshot: snapshot("召唤"),
    response: "首答",
    conversationId: "c-1",
  });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.request.kind, "success");
  assert.ok(discussion.conversation, "成功后建立对话本体");
  assert.equal(discussion.conversation?.firstResponse, "首答");
  assert.deepEqual(discussion.conversation?.initialUserMaterial, {
    kind: "summon",
    selected_text: "召唤",
  });
  assert.equal(discussion.pendingFirstRequest, null);
  assert.equal(next.previewRequest, null);
});

test("succeed 的非法迁移返回同一引用：未知讨论、追问中、非生成态", () => {
  const done = established();
  assert.equal(
    reduce(done, { type: "succeed", snapshot: snapshot("x"), response: "迟到", conversationId: "c-1" }),
    done,
    "已成功的讨论不接受再次成功",
  );
  const followUp = reduce(done, { type: "begin_follow_up", question: "追问" });
  assert.equal(
    reduce(followUp, { type: "succeed", snapshot: snapshot("x"), response: "迟到", conversationId: "c-1" }),
    followUp,
    "首轮成功事件不作用于追问 loading",
  );
  assert.equal(
    reduce(done, { type: "succeed", snapshot: snapshot("x"), response: "迟到", conversationId: "unknown" }),
    done,
    "未知讨论的迟到成功被丢弃",
  );
});

test("fail 把召唤首轮 loading 迁移为 error 并保留冻结快照与讨论身份", () => {
  const next = reduce(summonStarted("c-1", "召唤"), {
    type: "fail",
    snapshot: snapshot("召唤"),
    error: authError,
    conversationId: "c-1",
  });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.deepEqual(request.error, authError);
    assert.deepEqual(request.snapshot, snapshot("召唤"));
    assert.equal(request.conversationId, "c-1");
    assert.equal(request.phase, "first");
  }
});

test("fail 在旧式预览态把瞬态预览迁移为 error", () => {
  const preview = reduce(initialAiPanelCoreState(), {
    type: "preview_first_request",
    snapshot: snapshot("预览"),
  });
  const next = reduce(preview, {
    type: "fail",
    snapshot: snapshot("预览"),
    error: authError,
    conversationId: "unknown",
  });
  assert.equal(next.previewRequest?.kind, "error");
});

test("fail 的非法迁移返回同一引用：非生成中讨论、无预览的空状态", () => {
  const done = established();
  assert.equal(
    reduce(done, { type: "fail", snapshot: snapshot("x"), error: authError, conversationId: "c-1" }),
    done,
  );
  const initial = initialAiPanelCoreState();
  assert.equal(
    reduce(initial, { type: "fail", snapshot: snapshot("x"), error: authError, conversationId: "unknown" }),
    initial,
  );
});

test("require_configuration 把召唤首轮 loading 迁移为缺配置态", () => {
  const next = reduce(summonStarted("c-1", "召唤"), {
    type: "require_configuration",
    snapshot: snapshot("召唤"),
    conversationId: "c-1",
  });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "configuration_required");
  if (request.kind === "configuration_required") {
    assert.deepEqual(request.snapshot, snapshot("召唤"));
    assert.equal(request.conversationId, "c-1");
  }
});

test("require_configuration 的非法迁移返回同一引用：非生成中讨论、空状态", () => {
  const done = established();
  assert.equal(
    reduce(done, { type: "require_configuration", snapshot: snapshot("x"), conversationId: "c-1" }),
    done,
  );
  const initial = initialAiPanelCoreState();
  assert.equal(
    reduce(initial, { type: "require_configuration", snapshot: snapshot("x"), conversationId: "unknown" }),
    initial,
  );
});

// ========== 追问（begin / succeed / fail / require_configuration） ==========

test("begin_follow_up 在聚焦讨论建立待答轮并进入追问 loading", () => {
  const next = reduce(established(), { type: "begin_follow_up", question: "为什么" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(next.nextTurnId, 2, "轮次编号推进");
  assert.deepEqual(discussion.conversation?.pending, {
    id: 1,
    question: "为什么",
    streamedText: "",
  });
  assert.deepEqual(discussion.request, {
    kind: "loading",
    snapshot: null,
    conversationId: "c-1",
    phase: "follow_up",
    turnId: 1,
  });
});

test("begin_follow_up 的非法迁移返回同一引用：空白问题、无聚焦讨论、受限讨论、已有待答轮", () => {
  const done = established();
  assert.equal(reduce(done, { type: "begin_follow_up", question: "   " }), done, "空白问题被拒绝");
  const initial = initialAiPanelCoreState();
  assert.equal(reduce(initial, { type: "begin_follow_up", question: "问题" }), initial, "无聚焦讨论");
  const limited = restricted();
  assert.equal(reduce(limited, { type: "begin_follow_up", question: "问题" }), limited, "受限讨论不可追问");
  const pending = reduce(done, { type: "begin_follow_up", question: "第一问" });
  assert.equal(
    reduce(pending, { type: "begin_follow_up", question: "第二问" }),
    pending,
    "已有进行中的待答轮时拒绝新追问",
  );
});

test("succeed_follow_up 把待答轮落为成功轮次并回到成功显示", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  const next = reduce(followUp, {
    type: "succeed_follow_up",
    turnId: 1,
    response: "追答",
    conversationId: "c-1",
  });
  const discussion = next.discussions.get("c-1")!;
  assert.deepEqual(discussion.conversation?.turns, [{ id: 1, question: "追问", response: "追答" }]);
  assert.equal(discussion.conversation?.pending, null);
  assert.deepEqual(discussion.request, {
    kind: "success",
    snapshot: null,
    response: "追答",
    conversationId: "c-1",
    phase: "follow_up",
    turnId: 1,
  });
});

test("succeed_follow_up 的非法迁移返回同一引用：轮次不符、未知讨论", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(
    reduce(followUp, { type: "succeed_follow_up", turnId: 9, response: "迟到", conversationId: "c-1" }),
    followUp,
    "轮次身份不符的迟到结果被丢弃",
  );
  assert.equal(
    reduce(followUp, { type: "succeed_follow_up", turnId: 1, response: "迟到", conversationId: "unknown" }),
    followUp,
    "未知讨论",
  );
});

test("fail_follow_up 在待答轮上记录错误并进入追问 error 显示", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  const next = reduce(followUp, {
    type: "fail_follow_up",
    turnId: 1,
    error: authError,
    conversationId: "c-1",
  });
  const discussion = next.discussions.get("c-1")!;
  assert.deepEqual(discussion.conversation?.pending?.error, authError);
  assert.deepEqual(discussion.request, {
    kind: "error",
    snapshot: null,
    error: authError,
    conversationId: "c-1",
    phase: "follow_up",
    turnId: 1,
  });
});

test("fail_follow_up 的非法迁移返回同一引用：轮次不符、未知讨论", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(
    reduce(followUp, { type: "fail_follow_up", turnId: 9, error: authError, conversationId: "c-1" }),
    followUp,
  );
  assert.equal(
    reduce(followUp, { type: "fail_follow_up", turnId: 1, error: authError, conversationId: "unknown" }),
    followUp,
  );
});

test("require_follow_up_configuration 把待答轮标记为缺配置并引导配置", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  const next = reduce(followUp, {
    type: "require_follow_up_configuration",
    turnId: 1,
    conversationId: "c-1",
  });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.conversation?.pending?.error?.code, "configuration_required");
  assert.equal(discussion.request.kind, "configuration_required");
  if (discussion.request.kind === "configuration_required") {
    assert.equal(discussion.request.conversationId, "c-1");
    assert.equal(discussion.request.turnId, 1);
  }
});

test("require_follow_up_configuration 的非法迁移返回同一引用：轮次不符、未知讨论", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(
    reduce(followUp, { type: "require_follow_up_configuration", turnId: 9, conversationId: "c-1" }),
    followUp,
  );
  assert.equal(
    reduce(followUp, { type: "require_follow_up_configuration", turnId: 1, conversationId: "unknown" }),
    followUp,
  );
});

// ========== 追问编辑 / 取消 / 重试（accept_edited / cancel / accept_retry / accept_first_retry） ==========

test("accept_edited_follow_up 以编辑后的问题重发并清除旧错误", () => {
  let state = established();
  state = reduce(state, { type: "begin_follow_up", question: "失败问题" });
  state = reduce(state, { type: "fail_follow_up", turnId: 1, error: authError, conversationId: "c-1" });
  const next = reduce(state, { type: "accept_edited_follow_up", question: "修改后的问题" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.conversation?.pending?.question, "修改后的问题");
  assert.equal(discussion.conversation?.pending?.error, undefined);
  assert.equal(discussion.conversation?.pending?.streamedText, "");
  assert.equal(discussion.request.kind, "loading");
});

test("accept_edited_follow_up 的非法迁移返回同一引用：待答轮无错误", () => {
  const pending = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(
    reduce(pending, { type: "accept_edited_follow_up", question: "改写" }),
    pending,
    "仅失败的待答轮可编辑重发",
  );
});

test("cancel_follow_up 取消待答轮并显示既有内容", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  const next = reduce(followUp, { type: "cancel_follow_up", turnId: 1 });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.conversation?.pending, null);
  assert.deepEqual(discussion.request, { kind: "success", snapshot: null, response: "首答" });
});

test("cancel_follow_up 的非法迁移返回同一引用：轮次不符、无待答轮", () => {
  const followUp = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(reduce(followUp, { type: "cancel_follow_up", turnId: 9 }), followUp);
  const done = established();
  assert.equal(reduce(done, { type: "cancel_follow_up", turnId: 1 }), done);
});

test("accept_follow_up_retry 以原问题重发失败轮并重置流式草稿", () => {
  let state = established();
  state = reduce(state, { type: "begin_follow_up", question: "追问" });
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  state = reduce(state, { type: "fail_follow_up", turnId: 1, error: authError, conversationId: "c-1" });
  const next = reduce(state, { type: "accept_follow_up_retry" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.conversation?.pending?.question, "追问");
  assert.equal(discussion.conversation?.pending?.error, undefined);
  assert.equal(discussion.request.kind, "loading");
});

test("accept_follow_up_retry 的非法迁移返回同一引用：待答轮无错误", () => {
  const pending = reduce(established(), { type: "begin_follow_up", question: "追问" });
  assert.equal(reduce(pending, { type: "accept_follow_up_retry" }), pending);
});

test("accept_first_retry 从首轮 error 重回 loading，并保留讨论身份", () => {
  let state = summonStarted("c-1", "召唤");
  state = reduce(state, { type: "fail", snapshot: snapshot("召唤"), error: authError, conversationId: "c-1" });
  const next = reduce(state, { type: "accept_first_retry" });
  assert.deepEqual(next.discussions.get("c-1")!.request, {
    kind: "loading",
    snapshot: snapshot("召唤"),
    conversationId: "c-1",
    phase: "first",
  });
});

test("accept_first_retry 从已停止的首轮重回 loading", () => {
  let state = summonStarted("c-1", "召唤");
  state = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const next = reduce(state, { type: "accept_first_retry" });
  assert.equal(next.discussions.get("c-1")!.request.kind, "loading");
});

test("accept_first_retry 的非法迁移返回同一引用：无聚焦讨论、非可重试状态", () => {
  const initial = initialAiPanelCoreState();
  assert.equal(reduce(initial, { type: "accept_first_retry" }), initial);
  const loading = summonStarted();
  assert.equal(reduce(loading, { type: "accept_first_retry" }), loading, "生成中不可重试");
});

// ========== 草稿与选区（update_direct_question_draft / set_pending_selection / remove_pending_selection） ==========

test("update_direct_question_draft 按讨论写入草稿", () => {
  const next = reduce(established(), {
    type: "update_direct_question_draft",
    conversationId: "c-1",
    question: "新草稿",
  });
  assert.equal(next.directQuestionDrafts.get("c-1"), "新草稿");
});

test("set_pending_selection 附带冻结选区并清除忽略标记", () => {
  let state = reduce(initialAiPanelCoreState(), {
    type: "set_pending_selection",
    snapshot: snapshot("旧选区"),
  });
  state = reduce(state, { type: "remove_pending_selection" });
  const next = reduce(state, {
    type: "set_pending_selection",
    snapshot: snapshot("新选区"),
  });
  assert.deepEqual(next.pendingSelection, snapshot("新选区"));
  assert.equal(next.ignoredSelection, null, "新选区出现时清除忽略标记");
});

test("set_pending_selection 对被忽略的同一选区不再附带", () => {
  let state = reduce(initialAiPanelCoreState(), {
    type: "set_pending_selection",
    snapshot: snapshot("选区"),
  });
  state = reduce(state, { type: "remove_pending_selection" });
  const next = reduce(state, {
    type: "set_pending_selection",
    snapshot: snapshot("选区"),
  });
  assert.equal(next.pendingSelection, null, "被忽略的同一选区保持忽略");
});

test("set_pending_selection 传 null 清除待附带选区", () => {
  const state = reduce(initialAiPanelCoreState(), {
    type: "set_pending_selection",
    snapshot: snapshot("选区"),
  });
  const next = reduce(state, { type: "set_pending_selection", snapshot: null });
  assert.equal(next.pendingSelection, null);
});

test("remove_pending_selection 清除选区并记录忽略身份", () => {
  const state = reduce(initialAiPanelCoreState(), {
    type: "set_pending_selection",
    snapshot: snapshot("选区"),
  });
  const next = reduce(state, { type: "remove_pending_selection" });
  assert.equal(next.pendingSelection, null);
  assert.deepEqual(next.ignoredSelection, snapshot("选区"));
});

test("remove_pending_selection 无待附带选区时返回同一引用", () => {
  const state = initialAiPanelCoreState();
  assert.equal(reduce(state, { type: "remove_pending_selection" }), state);
});

// ========== 直接提问（begin / succeed / fail / require_configuration / append_stream_text） ==========

test("begin_direct_question 冻结问题与选区、消费待附带选区并打开聚焦窗口", () => {
  const state = reduce(initialAiPanelCoreState(), {
    type: "set_pending_selection",
    snapshot: snapshot("选区"),
  });
  const next = reduce(state, {
    type: "begin_direct_question",
    question: "问题",
    selection: snapshot("选区"),
    conversationId: "c-1",
    createdAt: "t0",
    focusDocumentId: "doc-1",
    focusDocumentTitle: "草稿",
  });
  assert.equal(next.visibility, "open");
  assert.equal(next.focusedConversationId, "c-1");
  assert.equal(next.windows.get("c-1"), "docked");
  assert.equal(next.pendingSelection, null, "发送后待附带选区被消费");
  const discussion = next.discussions.get("c-1")!;
  assert.deepEqual(discussion.request, {
    kind: "direct_question",
    question: "问题",
    selection: snapshot("选区"),
    status: "loading",
    streamedText: "",
  });
  assert.deepEqual(discussion.pendingFirstRequest, {
    kind: "direct_question",
    question: "问题",
    selected_text: "选区",
  });
});

test("begin_direct_question 的非法迁移返回同一引用：空白问题", () => {
  const state = initialAiPanelCoreState();
  assert.equal(
    reduce(state, {
      type: "begin_direct_question",
      question: "   ",
      selection: null,
      conversationId: "c-1",
      createdAt: "t0",
      focusDocumentId: null,
      focusDocumentTitle: null,
    }),
    state,
  );
});

test("succeed_direct_question 建立统一对话并清除该讨论草稿", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, {
    type: "update_direct_question_draft",
    conversationId: "c-1",
    question: "草稿",
  });
  const next = reduce(state, {
    type: "succeed_direct_question",
    response: "回答",
    conversationId: "c-1",
  });
  assert.equal(next.directQuestionDrafts.has("c-1"), false, "成功后清空未发送草稿");
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.request.kind, "success");
  assert.equal(discussion.conversation?.firstResponse, "回答");
  assert.equal(discussion.conversation?.initialUserMaterial.kind, "direct_question");
});

test("succeed_direct_question 的非法迁移返回同一引用：未知讨论、非 loading", () => {
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "succeed_direct_question", response: "迟到", conversationId: "unknown" }),
    loading,
  );
  const done = established();
  assert.equal(
    reduce(done, { type: "succeed_direct_question", response: "迟到", conversationId: "c-1" }),
    done,
  );
});

test("fail_direct_question 进入 error 终态并丢弃流式草稿", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  const next = reduce(state, {
    type: "fail_direct_question",
    error: authError,
    conversationId: "c-1",
  });
  assert.deepEqual(next.discussions.get("c-1")!.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "error",
    error: authError,
  });
});

test("fail_direct_question 的非法迁移返回同一引用：未知讨论、非 loading", () => {
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "fail_direct_question", error: authError, conversationId: "unknown" }),
    loading,
  );
  const done = established();
  assert.equal(
    reduce(done, { type: "fail_direct_question", error: authError, conversationId: "c-1" }),
    done,
  );
});

test("require_direct_question_configuration 进入缺配置终态", () => {
  const next = reduce(directStarted("c-1", "问题"), {
    type: "require_direct_question_configuration",
    conversationId: "c-1",
  });
  assert.deepEqual(next.discussions.get("c-1")!.request, {
    kind: "direct_question",
    question: "问题",
    selection: null,
    status: "configuration_required",
  });
});

test("require_direct_question_configuration 的非法迁移返回同一引用：未知讨论、非 loading", () => {
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "require_direct_question_configuration", conversationId: "unknown" }),
    loading,
  );
  const done = established();
  assert.equal(
    reduce(done, { type: "require_direct_question_configuration", conversationId: "c-1" }),
    done,
  );
});

test("append_stream_text 按讨论身份路由增量到对应载体", () => {
  // 直接提问 loading：增量进入请求上的流式草稿。
  const direct = reduce(directStarted("c-1", "问题"), {
    type: "append_stream_text",
    conversationId: "c-1",
    text: "她可能",
  });
  let request = direct.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.streamedText, "她可能");

  // 召唤首轮 loading：增量进入请求上的流式草稿。
  const summon = reduce(summonStarted("c-2", "召唤"), {
    type: "append_stream_text",
    conversationId: "c-2",
    text: "甲",
  });
  request = summon.discussions.get("c-2")!.request;
  assert.equal(request.kind, "loading");
  if (request.kind === "loading") assert.equal(request.streamedText, "甲");

  // 追问 loading：增量进入待答轮。
  let followUp = reduce(established("c-3"), { type: "begin_follow_up", question: "追问" });
  followUp = reduce(followUp, { type: "append_stream_text", conversationId: "c-3", text: "部分" });
  assert.equal(followUp.discussions.get("c-3")!.conversation?.pending?.streamedText, "部分");
});

test("append_stream_text 的非法迁移返回同一引用：未知讨论、无接受载体", () => {
  const done = established();
  assert.equal(
    reduce(done, { type: "append_stream_text", conversationId: "unknown", text: "迟到" }),
    done,
  );
  assert.equal(
    reduce(done, { type: "append_stream_text", conversationId: "c-1", text: "迟到" }),
    done,
    "已成功的讨论不接受迟到增量",
  );
});

// ========== 崩溃恢复（begin_recovery / complete_recovery / fail_recovery） ==========

test("begin_recovery 进入恢复态，保留对话与锚点", () => {
  const next = reduce(established(), { type: "begin_recovery", conversationId: "c-1" });
  assert.deepEqual(next.discussions.get("c-1")!.request, {
    kind: "recovering",
    snapshot: null,
    conversationId: "c-1",
  });
  assert.ok(next.discussions.get("c-1")!.conversation, "恢复期间保留对话本体");
});

test("begin_recovery 的非法迁移返回同一引用：未知讨论、无对话本体", () => {
  const done = established();
  assert.equal(reduce(done, { type: "begin_recovery", conversationId: "unknown" }), done);
  const loading = directStarted();
  assert.equal(reduce(loading, { type: "begin_recovery", conversationId: "c-1" }), loading);
});

test("complete_recovery 回到成功显示（首轮回应）", () => {
  let state = established("c-1", "首答");
  state = reduce(state, { type: "begin_recovery", conversationId: "c-1" });
  const next = reduce(state, { type: "complete_recovery", conversationId: "c-1" });
  assert.deepEqual(next.discussions.get("c-1")!.request, {
    kind: "success",
    snapshot: null,
    response: "首答",
    conversationId: "c-1",
    phase: "first",
  });
});

test("complete_recovery 的非法迁移返回同一引用：非恢复态、未知讨论", () => {
  const done = established();
  assert.equal(reduce(done, { type: "complete_recovery", conversationId: "c-1" }), done);
  assert.equal(reduce(done, { type: "complete_recovery", conversationId: "unknown" }), done);
});

test("fail_recovery 进入 error 并引导新建对话", () => {
  let state = established();
  state = reduce(state, { type: "begin_recovery", conversationId: "c-1" });
  const next = reduce(state, { type: "fail_recovery", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.equal(request.error.message, "对话恢复失败，请点击新建对话开始新对话");
    assert.equal(request.conversationId, "c-1");
  }
});

test("fail_recovery 的非法迁移返回同一引用：非恢复态、未知讨论", () => {
  const done = established();
  assert.equal(reduce(done, { type: "fail_recovery", conversationId: "c-1" }), done);
  assert.equal(reduce(done, { type: "fail_recovery", conversationId: "unknown" }), done);
});

// ========== 面板可见性（close / open） ==========

test("close 收起展开的面板；已收起返回同一引用", () => {
  const open = established();
  const closed = reduce(open, { type: "close" });
  assert.equal(closed.visibility, "closed");
  assert.equal(reduce(closed, { type: "close" }), closed);
});

test("open 展开面板；已展开返回同一引用", () => {
  const initial = initialAiPanelCoreState();
  const opened = reduce(initial, { type: "open" });
  assert.equal(opened.visibility, "open");
  assert.equal(reduce(opened, { type: "open" }), opened);
});

// ========== 讨论与作品生命周期（new_conversation / reset / load_discussions / recompute / open / delete） ==========

test("new_conversation 开启新的空讨论窗口并清掉瞬态字段", () => {
  let state = established();
  state = reduce(state, { type: "set_save_error", message: "旧错误" });
  const next = reduce(state, {
    type: "new_conversation",
    conversationId: "c-2",
    createdAt: "t2",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  assert.equal(next.visibility, "open");
  assert.equal(next.focusedConversationId, "c-2");
  assert.equal(next.windows.size, 2, "旧窗口保留");
  assert.equal(next.discussions.get("c-2")!.request.kind, "idle");
  assert.equal(next.discussions.get("c-2")!.conversation, null);
  assert.equal(next.saveError, null);
  assert.equal(next.generation, state.generation + 1);
});

test("new_conversation 聚焦窗口已是空讨论时复用并返回同一引用", () => {
  const state = reduce(initialAiPanelCoreState(), {
    type: "new_conversation",
    conversationId: "c-empty",
    createdAt: "t0",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  assert.equal(
    reduce(state, {
      type: "new_conversation",
      conversationId: "c-other",
      createdAt: "t1",
      focusDocumentId: null,
      focusDocumentTitle: null,
    }),
    state,
  );
});

test("reset 清空讨论、窗口与草稿并推进代次", () => {
  let state = established();
  state = reduce(state, {
    type: "update_direct_question_draft",
    conversationId: "c-1",
    question: "草稿",
  });
  const next = reduce(state, { type: "reset" });
  assert.equal(next.visibility, "closed");
  assert.equal(next.discussions.size, 0);
  assert.equal(next.windows.size, 0);
  assert.equal(next.focusedConversationId, null);
  assert.equal(next.directQuestionDrafts.size, 0);
  assert.equal(next.pendingSelection, null);
  assert.equal(next.ignoredSelection, null);
  assert.equal(next.saveError, null);
  assert.equal(next.generation, state.generation + 1);
});

test("load_discussions 以档案重建讨论集合并清空窗口与聚焦", () => {
  const next = reduce(established(), {
    type: "load_discussions",
    summaries: [summaryOf({ conversation_id: "c-load" })],
    skipped: [],
    hiddenDocumentIds: new Set<string>(),
  });
  assert.equal(next.visibility, "closed");
  assert.equal(next.discussions.size, 1);
  assert.equal(next.discussions.has("c-1"), false, "旧内存讨论被替换");
  assert.equal(next.windows.size, 0);
  assert.equal(next.focusedConversationId, null, "加载列表不自动打开任何讨论");
  const discussion = next.discussions.get("c-load")!;
  assert.equal(discussion.request.kind, "success");
  assert.equal(discussion.conversation?.firstResponse, "回答");
});

test("load_discussions 按隐藏文档集合把出处受限的讨论标记为受限", () => {
  const next = reduce(initialAiPanelCoreState(), {
    type: "load_discussions",
    summaries: [
      summaryOf({
        conversation_id: "c-r",
        provenance: [provenanceOf("doc-hidden")],
      }),
    ],
    skipped: [],
    hiddenDocumentIds: new Set(["doc-hidden"]),
  });
  assert.equal(next.discussions.get("c-r")!.conversation?.restricted, true);
});

test("recompute_restrictions 把出处引用新隐藏文档的讨论标记受限（单调锁存）", () => {
  let state = established();
  state = reduce(state, {
    type: "record_round_provenance",
    conversationId: "c-1",
    entries: [provenanceOf("doc-x")],
  });
  const restricted = reduce(state, {
    type: "recompute_restrictions",
    hiddenDocumentIds: new Set(["doc-x"]),
  });
  assert.equal(restricted.discussions.get("c-1")!.conversation?.restricted, true);
  const relatched = reduce(restricted, {
    type: "recompute_restrictions",
    hiddenDocumentIds: new Set<string>(),
  });
  assert.equal(
    relatched.discussions.get("c-1")!.conversation?.restricted,
    true,
    "已受限讨论保持受限，不因重新可见解除",
  );
});

test("recompute_restrictions 无变化时返回同一引用", () => {
  const state = established();
  assert.equal(
    reduce(state, { type: "recompute_restrictions", hiddenDocumentIds: new Set(["doc-x"]) }),
    state,
    "出处未引用隐藏文档的讨论不受影响",
  );
});

test("open_discussion 重开讨论：打开窗口、聚焦并显示已保存轮次", () => {
  const conversation: TemporaryConversation = {
    id: "c-open",
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "原问题" },
    firstResponse: "首答",
    turns: [],
    pending: { id: 1, question: "未完成", streamedText: "", interrupted: true },
  };
  const next = reduce(initialAiPanelCoreState(), {
    type: "open_discussion",
    conversation,
    focusDocumentId: "doc-1",
    focusDocumentTitle: "草稿",
  });
  assert.equal(next.visibility, "open");
  assert.equal(next.windows.get("c-open"), "docked");
  assert.equal(next.focusedConversationId, "c-open");
  const discussion = next.discussions.get("c-open")!;
  assert.equal(discussion.request.kind, "success");
  assert.equal(discussion.conversation?.pending?.interrupted, true);
  assert.equal(discussion.focusDocumentId, "doc-1");
});

test("open_discussion 已打开的讨论只聚焦，不重复开窗", () => {
  const state = established();
  const conversation: TemporaryConversation = {
    id: "c-1",
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "问题" },
    firstResponse: "首答",
    turns: [],
    pending: null,
  };
  const next = reduce(state, {
    type: "open_discussion",
    conversation,
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  assert.equal(next.windows.size, 1);
  assert.equal(next.focusedConversationId, "c-1");
});

test("delete_discussion 移除讨论、窗口与草稿，聚焦被删讨论时清聚焦与瞬态预览", () => {
  let state = established();
  state = reduce(state, {
    type: "update_direct_question_draft",
    conversationId: "c-1",
    question: "草稿",
  });
  state = reduce(state, { type: "preview_first_request", snapshot: snapshot("预览") });
  const next = reduce(state, { type: "delete_discussion", conversationId: "c-1" });
  assert.equal(next.discussions.has("c-1"), false);
  assert.equal(next.windows.has("c-1"), false);
  assert.equal(next.directQuestionDrafts.has("c-1"), false);
  assert.equal(next.focusedConversationId, null);
  assert.equal(next.previewRequest, null);
});

test("delete_discussion 未知讨论返回同一引用", () => {
  const state = initialAiPanelCoreState();
  assert.equal(reduce(state, { type: "delete_discussion", conversationId: "unknown" }), state);
});

// ========== 保存错误提示（set_save_error / clear_save_error） ==========

test("set_save_error 设置保存失败提示，clear_save_error 清除", () => {
  const errored = reduce(initialAiPanelCoreState(), { type: "set_save_error", message: "保存失败" });
  assert.equal(errored.saveError, "保存失败");
  const cleared = reduce(errored, { type: "clear_save_error" });
  assert.equal(cleared.saveError, null);
});

test("clear_save_error 无错误时返回同一引用", () => {
  const state = initialAiPanelCoreState();
  assert.equal(reduce(state, { type: "clear_save_error" }), state);
});

// ========== 停止 / 聚焦 / 关闭窗口（stop_request / focus_window / close_window） ==========

test("stop_request 停止直接提问：保留问题与已流式内容，进入已停止终态", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  const next = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "stopped");
    assert.equal(request.question, "问题");
    assert.equal(request.streamedText, "部分");
  }
});

test("stop_request 停止召唤首轮：保留冻结材料与已流式内容", () => {
  let state = summonStarted("c-1", "召唤");
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  const next = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "stopped");
  if (request.kind === "stopped") {
    assert.equal(request.phase, "first");
    assert.deepEqual(request.snapshot, snapshot("召唤"));
    assert.equal(request.streamedText, "部分");
  }
});

test("stop_request 停止追问：待答轮标记中断并保留已流式内容", () => {
  let state = established();
  state = reduce(state, { type: "begin_follow_up", question: "追问" });
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  const next = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.request.kind, "stopped");
  assert.equal(discussion.conversation?.pending?.interrupted, true);
  assert.equal(discussion.conversation?.pending?.question, "追问");
  assert.equal(discussion.conversation?.pending?.streamedText, "部分");
});

test("stop_request 停止排队中的直接提问并清掉排队标记", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, { type: "queue_request", conversationId: "c-1" });
  const next = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "stopped");
    assert.equal(request.queued, undefined);
  }
});

test("stop_request 清除等待中的授权卡与补读过程状态，但不改变授权状态", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, readingRequestEvent());
  state = reduce(state, { type: "note_tool_call", conversationId: "c-1", tool: "story-list" });
  state = reduce(state, { type: "set_on_demand_reading", conversationId: "c-1", granted: true });
  state = reduce(state, readingRequestEvent("c-1", "call-2"));
  const next = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.pendingReadingRequest, null, "停止取消等待中的授权");
  assert.equal(discussion.readingProgress, null, "停止清除过程状态");
  assert.ok(discussion.onDemandReadingGrant, "停止不改变按需补读授权（解耦）");
});

test("stop_request 的非法迁移返回同一引用：非生成中且无残留、未知讨论、追问待答轮已收束", () => {
  const done = established();
  assert.equal(reduce(done, { type: "stop_request", conversationId: "c-1" }), done);
  assert.equal(reduce(done, { type: "stop_request", conversationId: "unknown" }), done);
  let failed = established();
  failed = reduce(failed, { type: "begin_follow_up", question: "追问" });
  failed = reduce(failed, { type: "fail_follow_up", turnId: 1, error: authError, conversationId: "c-1" });
  assert.equal(
    reduce(failed, { type: "stop_request", conversationId: "c-1" }),
    failed,
    "已失败的待答轮不可再停止",
  );
});

test("focus_window 聚焦已打开的窗口", () => {
  let state = established("c-1");
  state = reduce(state, {
    type: "begin_direct_question",
    question: "问题二",
    selection: null,
    conversationId: "c-2",
    createdAt: "t1",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  assert.equal(state.focusedConversationId, "c-2");
  const next = reduce(state, { type: "focus_window", conversationId: "c-1" });
  assert.equal(next.focusedConversationId, "c-1");
});

test("focus_window 的非法迁移返回同一引用：非窗口讨论、已聚焦", () => {
  const state = established();
  assert.equal(reduce(state, { type: "focus_window", conversationId: "unknown" }), state);
  assert.equal(reduce(state, { type: "focus_window", conversationId: "c-1" }), state);
});

test("close_window 结束显示但保留讨论；关闭聚焦窗口时清聚焦", () => {
  const state = established();
  const next = reduce(state, { type: "close_window", conversationId: "c-1" });
  assert.equal(next.windows.size, 0, "窗口被关闭");
  assert.ok(next.discussions.get("c-1"), "讨论保留");
  assert.equal(next.focusedConversationId, null);
});

test("close_window 的非法迁移返回同一引用：未打开窗口的讨论", () => {
  const state = initialAiPanelCoreState();
  assert.equal(reduce(state, { type: "close_window", conversationId: "unknown" }), state);
});

// ========== 重试与布局（retry_direct_question / retry_stopped_follow_up / set_window_placement / reset_layout） ==========

test("retry_direct_question 从已停止直接提问重回 loading 并重置流式草稿", () => {
  let state = directStarted("c-1", "问题");
  state = reduce(state, { type: "append_stream_text", conversationId: "c-1", text: "部分" });
  state = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const next = reduce(state, { type: "retry_direct_question", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "loading");
    assert.equal(request.question, "问题");
    assert.equal(request.streamedText, "");
  }
});

test("retry_direct_question 的非法迁移返回同一引用：非已停止、未知讨论", () => {
  const loading = directStarted();
  assert.equal(reduce(loading, { type: "retry_direct_question", conversationId: "c-1" }), loading);
  assert.equal(reduce(loading, { type: "retry_direct_question", conversationId: "unknown" }), loading);
});

test("retry_stopped_follow_up 恢复中断待答轮为追问 loading", () => {
  let state = established();
  state = reduce(state, { type: "begin_follow_up", question: "追问" });
  state = reduce(state, { type: "stop_request", conversationId: "c-1" });
  const next = reduce(state, { type: "retry_stopped_follow_up" });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.request.kind, "loading");
  assert.equal(discussion.conversation?.pending?.interrupted, undefined);
  assert.equal(discussion.conversation?.pending?.question, "追问");
  assert.equal(discussion.conversation?.pending?.streamedText, "");
});

test("retry_stopped_follow_up 的非法迁移返回同一引用：无待答轮、未中断、受限讨论", () => {
  const done = established();
  assert.equal(reduce(done, { type: "retry_stopped_follow_up" }), done, "无待答轮");
  const pending = reduce(done, { type: "begin_follow_up", question: "追问" });
  assert.equal(reduce(pending, { type: "retry_stopped_follow_up" }), pending, "进行中的待答轮不可重试");
  const conversation: TemporaryConversation = {
    id: "c-1",
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "问题" },
    firstResponse: "首答",
    turns: [],
    pending: { id: 1, question: "中断的追问", streamedText: "", interrupted: true },
    restricted: true,
    restrictionReason: "hidden_material",
  };
  const limited = reduce(initialAiPanelCoreState(), {
    type: "open_discussion",
    conversation,
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  assert.equal(reduce(limited, { type: "retry_stopped_follow_up" }), limited, "受限讨论不可重发");
});

test("set_window_placement 把停靠窗口切为浮动", () => {
  const state = established();
  const next = reduce(state, {
    type: "set_window_placement",
    conversationId: "c-1",
    placement: "floating",
  });
  assert.equal(next.windows.get("c-1"), "floating");
});

test("set_window_placement 的非法迁移返回同一引用：未知窗口、同值", () => {
  const state = established();
  assert.equal(
    reduce(state, { type: "set_window_placement", conversationId: "unknown", placement: "floating" }),
    state,
  );
  assert.equal(
    reduce(state, { type: "set_window_placement", conversationId: "c-1", placement: "docked" }),
    state,
  );
});

test("reset_layout 把浮动窗口收回停靠", () => {
  let state = established();
  state = reduce(state, {
    type: "set_window_placement",
    conversationId: "c-1",
    placement: "floating",
  });
  const next = reduce(state, { type: "reset_layout" });
  assert.equal(next.windows.get("c-1"), "docked");
});

test("reset_layout 全部已停靠时返回同一引用", () => {
  const state = established();
  assert.equal(reduce(state, { type: "reset_layout" }), state);
});

// ========== 排队调度（queue_request / start_queued_request / reject_queued_request） ==========

test("queue_request 把生成中的请求标记排队（直接提问与召唤首轮）", () => {
  const direct = reduce(directStarted("c-1"), { type: "queue_request", conversationId: "c-1" });
  let request = direct.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.queued, true);

  const summon = reduce(summonStarted("c-2"), { type: "queue_request", conversationId: "c-2" });
  request = summon.discussions.get("c-2")!.request;
  assert.equal(request.kind, "loading");
  if (request.kind === "loading") assert.equal(request.queued, true);
});

test("queue_request 的非法迁移返回同一引用：非生成中、已排队、未知讨论", () => {
  const done = established();
  assert.equal(reduce(done, { type: "queue_request", conversationId: "c-1" }), done);
  assert.equal(reduce(done, { type: "queue_request", conversationId: "unknown" }), done);
  const queued = reduce(directStarted(), { type: "queue_request", conversationId: "c-1" });
  assert.equal(reduce(queued, { type: "queue_request", conversationId: "c-1" }), queued);
});

test("start_queued_request 把排队请求恢复为生成中", () => {
  const queued = reduce(directStarted("c-1"), { type: "queue_request", conversationId: "c-1" });
  const next = reduce(queued, { type: "start_queued_request", conversationId: "c-1" });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") assert.equal(request.queued, undefined);
});

test("start_queued_request 的非法迁移返回同一引用：未排队、未知讨论", () => {
  const loading = directStarted();
  assert.equal(reduce(loading, { type: "start_queued_request", conversationId: "c-1" }), loading);
  assert.equal(reduce(loading, { type: "start_queued_request", conversationId: "unknown" }), loading);
});

test("reject_queued_request 把排队直接提问转为可读失败终态", () => {
  const queued = reduce(directStarted("c-1", "问题"), { type: "queue_request", conversationId: "c-1" });
  const next = reduce(queued, {
    type: "reject_queued_request",
    conversationId: "c-1",
    error: notVisibleError,
  });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "direct_question");
  if (request.kind === "direct_question") {
    assert.equal(request.status, "error");
    assert.deepEqual(request.error, notVisibleError);
    assert.equal(request.queued, undefined);
    assert.equal(request.question, "问题", "失败终态保留原问题");
  }
});

test("reject_queued_request 把排队召唤首轮转为首轮失败", () => {
  const queued = reduce(summonStarted("c-1", "召唤"), { type: "queue_request", conversationId: "c-1" });
  const next = reduce(queued, {
    type: "reject_queued_request",
    conversationId: "c-1",
    error: notVisibleError,
  });
  const request = next.discussions.get("c-1")!.request;
  assert.equal(request.kind, "error");
  if (request.kind === "error") {
    assert.deepEqual(request.error, notVisibleError);
    assert.equal(request.conversationId, "c-1");
    assert.equal(request.phase, "first");
  }
});

test("reject_queued_request 把排队追问转为追问失败并在待答轮记录错误", () => {
  let state = established();
  state = reduce(state, { type: "begin_follow_up", question: "追问" });
  state = reduce(state, { type: "queue_request", conversationId: "c-1" });
  const next = reduce(state, {
    type: "reject_queued_request",
    conversationId: "c-1",
    error: notVisibleError,
  });
  const discussion = next.discussions.get("c-1")!;
  assert.deepEqual(discussion.conversation?.pending?.error, notVisibleError);
  assert.equal(discussion.request.kind, "error");
  if (discussion.request.kind === "error") {
    assert.equal(discussion.request.phase, "follow_up");
    assert.equal(discussion.request.turnId, 1);
  }
});

test("reject_queued_request 的非法迁移返回同一引用：未排队、未知讨论", () => {
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "reject_queued_request", conversationId: "c-1", error: notVisibleError }),
    loading,
  );
  assert.equal(
    reduce(loading, { type: "reject_queued_request", conversationId: "unknown", error: notVisibleError }),
    loading,
  );
});

// ========== 会话列表元数据（rename_discussion / set_discussion_pinned / record_round_provenance） ==========

test("rename_discussion 更新讨论自定义标题", () => {
  const next = reduce(established(), {
    type: "rename_discussion",
    conversationId: "c-1",
    title: "第二幕转折",
  });
  assert.equal(next.discussions.get("c-1")!.conversation?.customTitle, "第二幕转折");
});

test("rename_discussion 的非法迁移返回同一引用：同标题、未知讨论、无对话本体", () => {
  const state = established();
  const renamed = reduce(state, { type: "rename_discussion", conversationId: "c-1", title: "标题" });
  assert.equal(reduce(renamed, { type: "rename_discussion", conversationId: "c-1", title: "标题" }), renamed);
  assert.equal(
    reduce(state, { type: "rename_discussion", conversationId: "unknown", title: "标题" }),
    state,
  );
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "rename_discussion", conversationId: "c-1", title: "标题" }),
    loading,
    "首轮在途讨论尚无对话本体，不可重命名",
  );
});

test("set_discussion_pinned 更新置顶标记", () => {
  const next = reduce(established(), {
    type: "set_discussion_pinned",
    conversationId: "c-1",
    pinned: true,
  });
  assert.equal(next.discussions.get("c-1")!.conversation?.pinned, true);
});

test("set_discussion_pinned 的非法迁移返回同一引用：同值、未知讨论", () => {
  const state = established();
  assert.equal(
    reduce(state, { type: "set_discussion_pinned", conversationId: "c-1", pinned: false }),
    state,
    "未置顶再取消置顶无变化",
  );
  assert.equal(
    reduce(state, { type: "set_discussion_pinned", conversationId: "unknown", pinned: true }),
    state,
  );
});

test("record_round_provenance 追加本轮自动取材出处", () => {
  const next = reduce(established(), {
    type: "record_round_provenance",
    conversationId: "c-1",
    entries: [provenanceOf("doc-search", 1)],
  });
  assert.deepEqual(next.discussions.get("c-1")!.conversation?.provenance, [provenanceOf("doc-search", 1)]);
});

test("record_round_provenance 的非法迁移返回同一引用：未知讨论、无对话本体", () => {
  const state = established();
  assert.equal(
    reduce(state, {
      type: "record_round_provenance",
      conversationId: "unknown",
      entries: [provenanceOf("doc-search")],
    }),
    state,
  );
  const loading = directStarted();
  assert.equal(
    reduce(loading, {
      type: "record_round_provenance",
      conversationId: "c-1",
      entries: [provenanceOf("doc-search")],
    }),
    loading,
  );
});

// ========== 关注文档（set_focus_document） ==========

test("set_focus_document 显式改绑讨论的关注文档", () => {
  const next = reduce(established(), {
    type: "set_focus_document",
    conversationId: "c-1",
    focusDocumentId: "doc-2",
    focusDocumentTitle: "文档二",
  });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.focusDocumentId, "doc-2");
  assert.equal(discussion.focusDocumentTitle, "文档二");
});

test("set_focus_document 的非法迁移返回同一引用：同值、未知讨论、受限讨论", () => {
  const state = established();
  assert.equal(
    reduce(state, {
      type: "set_focus_document",
      conversationId: "c-1",
      focusDocumentId: null,
      focusDocumentTitle: null,
    }),
    state,
  );
  assert.equal(
    reduce(state, {
      type: "set_focus_document",
      conversationId: "unknown",
      focusDocumentId: "doc-2",
      focusDocumentTitle: "文档二",
    }),
    state,
  );
  const limited = restricted();
  assert.equal(
    reduce(limited, {
      type: "set_focus_document",
      conversationId: "c-1",
      focusDocumentId: "doc-2",
      focusDocumentTitle: "文档二",
    }),
    limited,
    "受限讨论永久只读，不得改绑",
  );
});

// ========== 按需补读（reading_request / resolve / set_on_demand_reading / note_tool_call / update_on_demand_state） ==========

test("reading_request 显示授权卡：写入待决授权请求", () => {
  const next = reduce(directStarted(), readingRequestEvent());
  assert.deepEqual(next.discussions.get("c-1")!.pendingReadingRequest, {
    sessionId: "s-1",
    messageId: "m-1",
    callId: "call-1",
    reason: "材料不足",
  });
});

test("reading_request 的非法迁移返回同一引用：未知讨论、同一待决重复到达", () => {
  const state = directStarted();
  assert.equal(
    reduce(state, readingRequestEvent("unknown")),
    state,
  );
  const waiting = reduce(state, readingRequestEvent());
  assert.equal(reduce(waiting, readingRequestEvent()), waiting, "同一 callId 的重复请求不重复迁移");
});

test("resolve_reading_request 允许：清除授权卡并把授权写入讨论与对话本体", () => {
  let state = established();
  state = reduce(state, readingRequestEvent());
  const next = reduce(state, { type: "resolve_reading_request", conversationId: "c-1", granted: true });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.pendingReadingRequest, null, "决定后授权卡消失");
  assert.ok(discussion.onDemandReadingGrant, "授权写入讨论级真相源");
  assert.ok(discussion.conversation?.onDemandReadingGrant, "授权随对话本体落档");
});

test("resolve_reading_request 拒绝：清除授权卡且不写授权", () => {
  let state = directStarted();
  state = reduce(state, readingRequestEvent());
  const next = reduce(state, { type: "resolve_reading_request", conversationId: "c-1", granted: false });
  const discussion = next.discussions.get("c-1")!;
  assert.equal(discussion.pendingReadingRequest, null);
  assert.equal(discussion.onDemandReadingGrant ?? null, null, "拒绝不写授权");
});

test("resolve_reading_request 的非法迁移返回同一引用：无待决的拒绝、已授权且无待决的允许、未知讨论", () => {
  const state = directStarted();
  assert.equal(
    reduce(state, { type: "resolve_reading_request", conversationId: "c-1", granted: false }),
    state,
  );
  assert.equal(
    reduce(state, { type: "resolve_reading_request", conversationId: "unknown", granted: true }),
    state,
  );
  const granted = reduce(state, { type: "set_on_demand_reading", conversationId: "c-1", granted: true });
  assert.equal(
    reduce(granted, { type: "resolve_reading_request", conversationId: "c-1", granted: true }),
    granted,
    "已授权且无待决时允许不重复迁移",
  );
});

test("set_on_demand_reading 开启写授权，关闭清授权", () => {
  const state = directStarted();
  const on = reduce(state, { type: "set_on_demand_reading", conversationId: "c-1", granted: true });
  assert.ok(on.discussions.get("c-1")!.onDemandReadingGrant);
  const off = reduce(on, { type: "set_on_demand_reading", conversationId: "c-1", granted: false });
  assert.equal(off.discussions.get("c-1")!.onDemandReadingGrant, null, "关闭立即清授权");
});

test("set_on_demand_reading 已授权再开启保持原授权时间并清残留授权卡", () => {
  const on = reduce(directStarted(), { type: "set_on_demand_reading", conversationId: "c-1", granted: true });
  const grantedAt = on.discussions.get("c-1")!.onDemandReadingGrant!.granted_at;
  assert.equal(
    reduce(on, { type: "set_on_demand_reading", conversationId: "c-1", granted: true }),
    on,
    "已授权再开启且无授权卡时无变化",
  );
  const withCard = reduce(on, readingRequestEvent("c-1", "call-9"));
  const next = reduce(withCard, { type: "set_on_demand_reading", conversationId: "c-1", granted: true });
  assert.equal(next.discussions.get("c-1")!.pendingReadingRequest, null, "只清残留授权卡");
  assert.equal(next.discussions.get("c-1")!.onDemandReadingGrant!.granted_at, grantedAt, "保留原授权时间");
});

test("set_on_demand_reading 的非法迁移返回同一引用：关闭已关闭、未知讨论", () => {
  const state = directStarted();
  assert.equal(
    reduce(state, { type: "set_on_demand_reading", conversationId: "c-1", granted: false }),
    state,
  );
  assert.equal(
    reduce(state, { type: "set_on_demand_reading", conversationId: "unknown", granted: true }),
    state,
  );
});

test("note_tool_call 记录活动类型与已读文档（去重、按出现顺序）", () => {
  const state = directStarted();
  let next = reduce(state, { type: "note_tool_call", conversationId: "c-1", tool: "story-search" });
  assert.deepEqual(next.discussions.get("c-1")!.readingProgress, { status: "searching", documentIds: [] });

  next = reduce(next, { type: "note_tool_call", conversationId: "c-1", tool: "story-read", documentId: "doc-7" });
  assert.deepEqual(next.discussions.get("c-1")!.readingProgress, {
    status: "reading",
    documentIds: ["doc-7"],
  });

  next = reduce(next, { type: "note_tool_call", conversationId: "c-1", tool: "story-read", documentId: "doc-8" });
  next = reduce(next, { type: "note_tool_call", conversationId: "c-1", tool: "story-read", documentId: "doc-7" });
  assert.deepEqual(next.discussions.get("c-1")!.readingProgress, {
    status: "reading",
    documentIds: ["doc-7", "doc-8"],
  }, "同一文档去重且保持首次出现顺序");

  next = reduce(next, { type: "note_tool_call", conversationId: "c-1", tool: "story-list" });
  assert.deepEqual(next.discussions.get("c-1")!.readingProgress, {
    status: "listing",
    documentIds: ["doc-7", "doc-8"],
  });
});

test("note_tool_call 的非法迁移返回同一引用：未知工具、未知讨论、重复同类活动", () => {
  const state = directStarted();
  assert.equal(
    reduce(state, { type: "note_tool_call", conversationId: "c-1", tool: "story-write" }),
    state,
    "非补读工具不记录",
  );
  assert.equal(
    reduce(state, { type: "note_tool_call", conversationId: "unknown", tool: "story-list" }),
    state,
  );
  const listed = reduce(state, { type: "note_tool_call", conversationId: "c-1", tool: "story-list" });
  assert.equal(
    reduce(listed, { type: "note_tool_call", conversationId: "c-1", tool: "story-list" }),
    listed,
  );
});

test("update_on_demand_state 轮后合并档案授权与补读出处", () => {
  const grant = { granted_at: "t9" };
  const provenance: OnDemandReadingProvenance[] = [
    { document_id: "doc-9", version: "v9", depth: "full", turn_index: 0, entered_model_context: true },
  ];
  const next = reduce(established(), {
    type: "update_on_demand_state",
    conversationId: "c-1",
    grant,
    provenance,
  });
  const discussion = next.discussions.get("c-1")!;
  assert.deepEqual(discussion.onDemandReadingGrant, grant);
  assert.deepEqual(discussion.conversation?.onDemandReadingGrant, grant);
  assert.deepEqual(discussion.conversation?.onDemandReadingProvenance, provenance);
});

test("update_on_demand_state 的非法迁移返回同一引用：无对话本体、未知讨论、同值", () => {
  const loading = directStarted();
  assert.equal(
    reduce(loading, { type: "update_on_demand_state", conversationId: "c-1", grant: null, provenance: null }),
    loading,
    "首轮在途讨论尚无对话本体",
  );
  const done = established();
  assert.equal(
    reduce(done, { type: "update_on_demand_state", conversationId: "unknown", grant: null, provenance: null }),
    done,
  );
  assert.equal(
    reduce(done, { type: "update_on_demand_state", conversationId: "c-1", grant: null, provenance: null }),
    done,
  );
});
