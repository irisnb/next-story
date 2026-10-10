import assert from "node:assert/strict";
import test from "node:test";
import { AiPanelState } from "../src/ai-panel-state.ts";

test("selecting a discussion preserves the other discussion request", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("A", null);
  const a = state.activeConversationId!;
  state.beginDirectQuestion("B", null);
  const b = state.activeConversationId!;
  const request = state.viewOf(b).request;
  state.selectDiscussion(a);
  assert.equal(state.focusedConversationId, a);
  assert.deepEqual(state.viewOf(b).request, request);
});

test("deleting a discussion removes only that discussion", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("A", null);
  const a = state.activeConversationId!;
  state.beginDirectQuestion("B", null);
  const b = state.activeConversationId!;
  state.deleteDiscussion(a);
  assert.equal(state.getDiscussion(a), null);
  assert.ok(state.getDiscussion(b));
});
