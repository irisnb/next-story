import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGenerateError,
  editAndResendFollowUpAcceptedRequest,
  openAiConfiguration,
  retryAcceptedRequest,
  retryFollowUpAcceptedRequest,
} from "../src/ai-feature.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

test("routes configuration_required to the configuration panel state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = {
    code: "configuration_required",
    message: "请先配置",
  };

  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "configuration_required", snapshot: snap });
});

test("routes non-configuration failures to the ordinary error state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = { code: "authentication", message: "认证失败" };

  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "error", snapshot: snap, error });
});

test("retry enters loading only when the coordinator accepts the request", () => {
  const state = new AiPanelState();
  const snap = snapshot("原选区");
  state.beginRequest(snap);
  state.fail(snap, { code: "network", message: "网络失败" });

  assert.equal(retryAcceptedRequest(state, () => null), false);
  assert.equal(state.view.request.kind, "error");

  assert.equal(retryAcceptedRequest(state, () => Promise.resolve()), true);
  assert.deepEqual(state.view.request, {
    kind: "loading",
    snapshot: snap,
    conversationId: 1,
    phase: "first",
  });
});

test("builds a follow-up payload from the frozen anchor and successful turns exactly once", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("问题一");
  state.succeedFollowUp(1, "回答一");
  state.beginFollowUp("问题二");

  assert.deepEqual(state.followUpRequest(), {
    kind: "follow_up",
    selected_text: "冻结",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "问题一" },
      { role: "assistant", content: "回答一" },
      { role: "user", content: "问题二" },
    ],
  });
});

test("preserves a failed follow-up as configuration-required without auto-requesting", () => {
  const state = new AiPanelState();
  const anchor = snapshot("冻结");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("需要配置的问题");

  assert.equal(state.requireFollowUpConfiguration(1), true);
  assert.deepEqual(state.view.request, {
    kind: "configuration_required",
    snapshot: anchor,
    conversationId: 1,
    turnId: 1,
  });
  assert.equal(state.retryFollowUpQuestion(), "需要配置的问题");
});

test("rejected follow-up retry preserves the failed question and original error", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("失败问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });

  assert.equal(retryFollowUpAcceptedRequest(state, () => null), false);
  assert.equal(state.retryFollowUpQuestion(), "失败问题");
  assert.equal(state.conversation?.pending?.error?.message, "网络失败");
  assert.equal(state.view.request.kind, "error");
});

test("rejected edit-resend preserves the old failed question and error atomically", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("旧问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });

  assert.equal(editAndResendFollowUpAcceptedRequest(state, "新问题", () => null), false);
  assert.equal(state.conversation?.pending?.question, "旧问题");
  assert.equal(state.conversation?.pending?.error?.message, "网络失败");
  assert.equal(state.retryFollowUpQuestion(), "旧问题");
});

test("accepted edit-resend sends the edited payload then commits question and loading", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("旧问题");
  state.failFollowUp(1, { code: "network", message: "网络失败" });
  let sentQuestion = "";

  assert.equal(editAndResendFollowUpAcceptedRequest(state, "新问题", (payload) => {
    if (payload.kind === "follow_up") {
      sentQuestion = payload.messages[payload.messages.length - 1].content;
    }
    return Promise.resolve();
  }), true);

  assert.equal(sentQuestion, "新问题");
  assert.equal(state.conversation?.pending?.question, "新问题");
  assert.equal(state.conversation?.pending?.error, undefined);
  assert.equal(state.view.request.kind, "loading");
});

test("opening configuration preserves conversation and never auto-fires a request", () => {
  const state = new AiPanelState();
  const anchor = snapshot("锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "首答");
  state.beginFollowUp("待配置问题");
  state.requireFollowUpConfiguration(1);
  const before = state.conversation;
  let opened = 0;

  openAiConfiguration((returnPage) => {
    assert.equal(returnPage, "editor-page");
    opened += 1;
  });

  assert.equal(opened, 1);
  assert.deepEqual(state.conversation, before);
  assert.equal(state.retryFollowUpQuestion(), "待配置问题");
});
