import assert from "node:assert/strict";
import test from "node:test";

import {
  ResidentAiSessionTransport,
  type ResidentSessionDependencies,
} from "../src/ai-session-transport.ts";
import type {
  AiDeltaPayload,
  AiReplayTurn,
  ListenFn,
  UnlistenFn,
} from "../src/project-api.ts";
import type { GenerateAiRequest, GenerateAiResult } from "../src/types.ts";

interface TransportHarness {
  transport: ResidentAiSessionTransport;
  commands: { cmd: string; args: Record<string, unknown> }[];
  deltaHandlers: ((payload: AiDeltaPayload) => void)[];
  driverLostHandlers: (() => void)[];
  ids: string[];
  failNextCommand(failure: unknown): void;
}

function okResult(content = "思考"): GenerateAiResult {
  return { ok: true, content };
}

function harness(overrides: Partial<ResidentSessionDependencies> = {}): TransportHarness {
  const commands: { cmd: string; args: Record<string, unknown> }[] = [];
  const deltaHandlers: ((payload: AiDeltaPayload) => void)[] = [];
  const driverLostHandlers: (() => void)[] = [];
  const ids = ["session-1", "session-2", "session-3"];
  let idIndex = 0;
  let failure: unknown = null;

  const listen: ListenFn = <T,>(event: string, handler: (event: { payload: T }) => void) => {
    if (event === "ai-delta") {
      deltaHandlers.push((payload) => handler({ payload: payload as T }));
    } else if (event === "ai-driver-lost") {
      driverLostHandlers.push(() => handler({ payload: null as T }));
    }
    return Promise.resolve((() => {}) as UnlistenFn);
  };

  const transport = new ResidentAiSessionTransport({
    startSession: (sessionId) => {
      commands.push({ cmd: "ai_start_session", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    sendMessage: (sessionId, messageId, kind, question, selectedText) => {
      const args: Record<string, unknown> = { sessionId, messageId, kind, question };
      if (selectedText !== undefined) args.selectedText = selectedText;
      commands.push({ cmd: "ai_send_message", args });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    endSession: (sessionId) => {
      commands.push({ cmd: "ai_end_session", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    replayHistory: (sessionId, turns, origin) => {
      commands.push({ cmd: "ai_replay_history", args: { sessionId, turns, origin } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    replayDone: (sessionId) => {
      commands.push({ cmd: "ai_replay_done", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    listenDelta: (handler, listenFn = listen) =>
      listenFn<AiDeltaPayload>("ai-delta", (event) => handler(event.payload)),
    listenDriverLost: (handler, listenFn = listen) =>
      listenFn<null>("ai-driver-lost", () => handler()),
    newId: () => {
      const id = ids[Math.min(idIndex, ids.length - 1)];
      idIndex += 1;
      return id;
    },
    ...overrides,
  });

  return {
    transport,
    commands,
    deltaHandlers,
    driverLostHandlers,
    ids,
    failNextCommand: (err) => { failure = err; },
  };
}

function directQuestionRequest(question: string, selectedText?: string): GenerateAiRequest {
  return selectedText === undefined
    ? { kind: "direct_question", question }
    : { kind: "direct_question", question, selected_text: selectedText };
}

function followUpRequest(lastQuestion: string): GenerateAiRequest {
  return {
    kind: "follow_up",
    selected_text: "",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "上一问" },
      { role: "assistant", content: "上一答" },
      { role: "user", content: lastQuestion },
    ],
  };
}

test("first direct question starts a session and sends kind first with a conversation-prefixed message id", async () => {
  const ui = harness();
  const result = await ui.transport.sendViaResidentSession(
    "c-1",
    directQuestionRequest("这个角色为什么犹豫？", "林站在天台边。"),
  );

  assert.deepEqual(result, okResult());
  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    {
      cmd: "ai_send_message",
      args: {
        sessionId: "session-1",
        messageId: "c-1:msg-1",
        kind: "first",
        question: "这个角色为什么犹豫？",
        selectedText: "林站在天台边。",
      },
    },
  ]);
});

test("direct question without selection omits the selectedText argument", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("只问问题"));

  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal("selectedText" in send.args, false);
});

test("follow_up sends only the last user message as the incremental question", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("当前问题"));

  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    {
      cmd: "ai_send_message",
      args: {
        sessionId: "session-1",
        messageId: "c-1:msg-1",
        kind: "follow_up",
        question: "当前问题",
      },
    },
  ]);
});

test("subsequent sends in the same conversation reuse the resident session with incrementing global counter", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("第一问"));
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("第二问"));

  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(startCalls.length, 1, "同一讨论的会话只启动一次");
  const sendCalls = ui.commands.filter((entry) => entry.cmd === "ai_send_message");
  assert.deepEqual(sendCalls.map((entry) => entry.args.messageId), ["c-1:msg-1", "c-1:msg-2"]);
  assert.deepEqual(sendCalls.map((entry) => entry.args.sessionId), ["session-1", "session-1"]);
});

test("different conversations get separate sessions and non-colliding message ids", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("第一问"));
  await ui.transport.sendViaResidentSession("c-2", directQuestionRequest("第二问"));

  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.deepEqual(startCalls.map((entry) => entry.args.sessionId), ["session-1", "session-2"]);
  const sendCalls = ui.commands.filter((entry) => entry.cmd === "ai_send_message");
  assert.deepEqual(sendCalls.map((entry) => entry.args.messageId), ["c-1:msg-1", "c-2:msg-2"]);
});

test("a failed send clears the in-flight stream target", async () => {
  const ui = harness();
  ui.failNextCommand(new Error("网络失败"));
  await assert.rejects(
    () => ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题")),
  );

  const received: string[] = [];
  ui.transport.onStreamText((text) => received.push(text));
  ui.transport.installSessionEventRouting();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 0, text: "迟到" });
  assert.deepEqual(received, []);
});

test("endSession ends the conversation's session so the next send starts fresh", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("第一问"));
  ui.transport.endSession("c-1");

  assert.deepEqual(ui.commands[ui.commands.length - 1], {
    cmd: "ai_end_session",
    args: { sessionId: "session-1" },
  });

  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("第二问"));
  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.deepEqual(startCalls.map((entry) => entry.args.sessionId), ["session-1", "session-2"]);
});

test("endSession for an unknown conversation sends nothing", () => {
  const ui = harness();
  ui.transport.endSession("c-unknown");
  assert.deepEqual(ui.commands, []);
});

test("endSession swallows end-session failures", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题"));
  ui.failNextCommand(new Error("结束失败"));
  assert.doesNotThrow(() => ui.transport.endSession("c-1"));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(ui.commands.some((entry) => entry.cmd === "ai_end_session"), true);
});

test("endAllSessions ends every started session", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题一"));
  await ui.transport.sendViaResidentSession("c-2", directQuestionRequest("问题二"));
  ui.transport.endAllSessions();

  const endCalls = ui.commands.filter((entry) => entry.cmd === "ai_end_session");
  assert.deepEqual(endCalls.map((entry) => entry.args.sessionId), ["session-1", "session-2"]);
});

test("replaySession starts a new session, replays turns with origin, and marks done", async () => {
  const ui = harness();
  const turns: AiReplayTurn[] = [
    { role: "user", text: "用户问题：\n原问题" },
    { role: "assistant", text: "首答" },
  ];
  await ui.transport.replaySession("c-1", turns, "direct_question");

  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    { cmd: "ai_replay_history", args: { sessionId: "session-1", turns, origin: "direct_question" } },
    { cmd: "ai_replay_done", args: { sessionId: "session-1" } },
  ]);

  await ui.transport.sendViaResidentSession("c-1", followUpRequest("恢复后的追问"));
  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(startCalls.length, 1);
  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal(send.args.sessionId, "session-1");
});

test("stream text routes only deltas matching the in-flight message", async () => {
  const ui = harness();
  const received: string[] = [];
  ui.transport.onStreamText((text) => received.push(text));
  ui.transport.installSessionEventRouting();

  const sendPromise = ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题"));
  await Promise.resolve();
  await Promise.resolve();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 0, text: "她可能" });
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 1, text: "在隐瞒" });
  ui.deltaHandlers[0]({ session_id: "other", message_id: "c-1:msg-1", seq: 2, text: "X" });
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-2:msg-9", seq: 3, text: "Y" });
  await sendPromise;

  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 4, text: "迟到" });
  assert.deepEqual(received, ["她可能", "在隐瞒"]);
});

test("onStreamText unsubscribe stops delivering deltas", async () => {
  const ui = harness();
  const received: string[] = [];
  const unsubscribe = ui.transport.onStreamText((text) => received.push(text));
  ui.transport.installSessionEventRouting();

  const sendPromise = ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题"));
  unsubscribe();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 0, text: "增量" });
  await sendPromise;
  assert.deepEqual(received, []);
});

test("onDriverLost notifies subscribers and supports unsubscribe", async () => {
  const ui = harness();
  let calls = 0;
  const unsubscribe = ui.transport.onDriverLost(() => { calls += 1; });
  ui.transport.installSessionEventRouting();

  ui.driverLostHandlers[0]();
  assert.equal(calls, 1);

  unsubscribe();
  ui.driverLostHandlers[0]();
  assert.equal(calls, 1, "退订后不再通知");
});

test("installSessionEventRouting is idempotent and installs each listener once", () => {
  const ui = harness();
  ui.transport.installSessionEventRouting();
  ui.transport.installSessionEventRouting();
  ui.transport.installSessionEventRouting();

  assert.equal(ui.deltaHandlers.length, 1);
  assert.equal(ui.driverLostHandlers.length, 1);
});
