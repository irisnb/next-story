import assert from "node:assert/strict";
import test from "node:test";

import { type InvokeFn } from "../src/project-api.ts";
import {
  aiCancelMessage,
  aiEndSession,
  aiReplayDone,
  aiReplayHistory,
  aiSendMessage,
  aiStartSession,
} from "../src/project-api.ts";
import type { GenerateAiMessage, GenerateAiResult } from "../src/types.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
export type _FrontendCannotSubmitSystemRole = Assert<
  Equal<GenerateAiMessage["role"], "user" | "assistant">
>;

/** 记录每次调用的假 invoke。 */
function fakeInvoke() {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const invoke: InvokeFn = (cmd, args) => {
    calls.push({ cmd, args: args ?? {} });
    const ok: GenerateAiResult = { ok: true, content: "思考" };
    return Promise.resolve(ok as never);
  };
  return { invoke, calls };
}

// ========== 常驻会话命令封装（change: resident-ai-session） ==========

test("aiStartSession sends the session id with no notebook write args", async () => {
  const { invoke, calls } = fakeInvoke();
  const result = await aiStartSession("session-1", invoke);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "ai_start_session");
  assert.deepEqual(calls[0].args, { sessionId: "session-1" });
  assert.deepEqual(result, { ok: true, content: "思考" });
});

test("aiSendMessage sends a direct first message with question and optional selection", async () => {
  const { invoke, calls } = fakeInvoke();
  await aiSendMessage("session-1", "msg-1", "first", "这个问题", "冻结选区", invoke);

  assert.equal(calls[0].cmd, "ai_send_message");
  assert.deepEqual(calls[0].args, {
    sessionId: "session-1",
    messageId: "msg-1",
    kind: "first",
    question: "这个问题",
    selectedText: "冻结选区",
  });
});

test("aiSendMessage omits selectedText for follow-up questions", async () => {
  const { invoke, calls } = fakeInvoke();
  await aiSendMessage("session-1", "msg-2", "follow_up", "增量问题", undefined, invoke);

  assert.equal(calls[0].cmd, "ai_send_message");
  assert.deepEqual(calls[0].args, {
    sessionId: "session-1",
    messageId: "msg-2",
    kind: "follow_up",
    question: "增量问题",
  });
});

test("aiCancelMessage and aiEndSession are idempotent-shaped commands", async () => {
  const { invoke, calls } = fakeInvoke();
  await aiCancelMessage("session-1", "msg-1", invoke);
  await aiEndSession("session-1", invoke);

  assert.deepEqual(calls.map((entry) => entry.cmd), ["ai_cancel_message", "ai_end_session"]);
  assert.deepEqual(calls[0].args, { sessionId: "session-1", messageId: "msg-1" });
  assert.deepEqual(calls[1].args, { sessionId: "session-1" });
});

test("aiReplayHistory sends projected turns and aiReplayDone marks the end", async () => {
  const { invoke, calls } = fakeInvoke();
  const turns = [
    { role: "user" as const, text: "用户问题：\n原问题" },
    { role: "assistant" as const, text: "首答" },
  ];
  await aiReplayHistory("session-2", turns, invoke);
  await aiReplayDone("session-2", invoke);

  assert.deepEqual(calls.map((entry) => entry.cmd), ["ai_replay_history", "ai_replay_done"]);
  assert.deepEqual(calls[0].args, { sessionId: "session-2", turns, origin: "direct_question" });
  assert.equal(JSON.stringify(calls[0].args).includes("api_key"), false);
});
