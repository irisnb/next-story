import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import type { PendingReadingRequest } from "../src/ai-panel-reducer.ts";

/**
 * 按需补读授权请求（reading_request）必须是「有效在途轮」的身份：
 * - 只有当前轮仍在生成、可等待授权时才显示授权卡；
 * - 显式停止 / 失败 / 已完成 / 排队中的轮次，迟到的授权请求不得重现授权卡；
 * - 后台不可见讨论（不按可见性过滤）仍按在途身份接收。
 *
 * 跨轮的同 messageId 迟到由传输层按在途消息身份拦截（见 ai-session-transport.test.ts）；
 * 状态层负责「当前讨论是否还有可等待授权的在途轮」这一层判断。
 */

function readingRequest(messageId = "c-1:msg-1", callId = "call-1"): PendingReadingRequest {
  return { sessionId: "session-1", messageId, callId, reason: "材料不足" };
}

test("reading_request is accepted while a direct-question turn is loading", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  const id = state.activeConversationId!;

  assert.equal(state.receiveReadingRequest(id, readingRequest()), true);
  assert.equal(state.pendingReadingRequestOf(id)?.callId, "call-1");
  assert.equal(state.viewOf(id).readingRequest?.reason, "材料不足");
});

test("reading_request is accepted while a follow-up turn is loading", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  const id = state.activeConversationId!;
  state.succeedDirectQuestion("回答", id);
  state.beginFollowUp("追问");

  assert.equal(state.receiveReadingRequest(id, readingRequest()), true);
  assert.ok(state.pendingReadingRequestOf(id));
});

test("a late reading_request after explicit stop does not recreate the authorization card", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  const id = state.activeConversationId!;
  state.stopRequest(id);

  assert.equal(state.receiveReadingRequest(id, readingRequest()), false, "已停止轮拒绝授权请求");
  assert.equal(state.pendingReadingRequestOf(id), null);
  assert.equal(state.viewOf(id).readingRequest, null);
});

test("a late reading_request after turn success/error does not recreate the card", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  const id = state.activeConversationId!;
  state.succeedDirectQuestion("回答", id);

  assert.equal(state.receiveReadingRequest(id, readingRequest()), false, "已完成轮拒绝授权请求");
  assert.equal(state.pendingReadingRequestOf(id), null);
});

test("a reading_request for a queued (not yet sent) turn is rejected", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  const id = state.activeConversationId!;
  state.queueRequest(id);

  assert.equal(state.receiveReadingRequest(id, readingRequest()), false, "排队未发送轮不得显示授权卡");
  assert.equal(state.pendingReadingRequestOf(id), null);
});

test("a reading_request for an unknown discussion is rejected", () => {
  const state = new AiPanelState();
  assert.equal(state.receiveReadingRequest("missing", readingRequest()), false);
});
