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
    replayHistory: (sessionId, turns) => {
      commands.push({ cmd: "ai_replay_history", args: { sessionId, turns } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    replayDone: (sessionId) => {
      commands.push({ cmd: "ai_replay_done", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    legacyGenerate: (request) => {
      commands.push({ cmd: "generate_ai_thinking", args: { request } });
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

test("first direct question starts a session and sends kind first with question and selection", async () => {
  const ui = harness();
  const result = await ui.transport.sendViaResidentSession(
    directQuestionRequest("这个角色为什么犹豫？", "林站在天台边。"),
  );

  assert.deepEqual(result, okResult());
  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    {
      cmd: "ai_send_message",
      args: {
        sessionId: "session-1",
        messageId: "msg-1",
        kind: "first",
        question: "这个角色为什么犹豫？",
        selectedText: "林站在天台边。",
      },
    },
  ]);
});

test("direct question without selection omits the selectedText argument", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession(directQuestionRequest("只问问题"));

  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal("selectedText" in send.args, false);
});

test("follow_up sends only the last user message as the incremental question", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession(followUpRequest("当前问题"));

  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    {
      cmd: "ai_send_message",
      args: {
        sessionId: "session-1",
        messageId: "msg-1",
        kind: "follow_up",
        question: "当前问题",
      },
    },
  ]);
});

test("subsequent sends reuse the resident session without starting a new one", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession(directQuestionRequest("第一问"));
  await ui.transport.sendViaResidentSession(followUpRequest("第二问"));

  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(startCalls.length, 1, "常驻会话只启动一次");
  const sendCalls = ui.commands.filter((entry) => entry.cmd === "ai_send_message");
  assert.deepEqual(sendCalls.map((entry) => entry.args.messageId), ["msg-1", "msg-2"]);
  assert.deepEqual(sendCalls.map((entry) => entry.args.sessionId), ["session-1", "session-1"]);
});

test("legacy first-kind requests go through the one-shot generate command", async () => {
  const ui = harness();
  const request: GenerateAiRequest = { kind: "first", selected_text: "冻结选区" };
  await ui.transport.sendViaResidentSession(request);

  assert.deepEqual(ui.commands, [
    { cmd: "generate_ai_thinking", args: { request } },
  ]);
  assert.equal(ui.commands.some((entry) => entry.cmd === "ai_start_session"), false);
});

test("a failed send clears the in-flight stream target", async () => {
  const ui = harness();
  ui.failNextCommand(new Error("网络失败"));
  await assert.rejects(
    () => ui.transport.sendViaResidentSession(directQuestionRequest("问题")),
  );

  // 失败后 currentStream 已清空：迟到的增量不路由给订阅者
  const received: string[] = [];
  ui.transport.onStreamText((text) => received.push(text));
  ui.transport.installSessionEventRouting();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-1", seq: 0, text: "迟到" });
  assert.deepEqual(received, []);
});

test("endActiveSession ends the session and resets state so the next send starts fresh", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession(directQuestionRequest("第一问"));
  ui.transport.endActiveSession();

  assert.deepEqual(ui.commands[ui.commands.length - 1], {
    cmd: "ai_end_session",
    args: { sessionId: "session-1" },
  });

  await ui.transport.sendViaResidentSession(directQuestionRequest("第二问"));
  const startCalls = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.deepEqual(startCalls.map((entry) => entry.args.sessionId), ["session-1", "session-2"]);
});

test("endActiveSession without a started session sends nothing", () => {
  const ui = harness();
  ui.transport.endActiveSession();
  assert.deepEqual(ui.commands, []);
});

test("endActiveSession swallows end-session failures", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession(directQuestionRequest("问题"));
  ui.failNextCommand(new Error("结束失败"));
  assert.doesNotThrow(() => ui.transport.endActiveSession());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(ui.commands.some((entry) => entry.cmd === "ai_end_session"), true);
});

test("replayActiveSession starts a new session, replays turns, and marks done", async () => {
  const ui = harness();
  const turns: AiReplayTurn[] = [
    { role: "user", text: "用户问题：\n原问题" },
    { role: "assistant", text: "首答" },
  ];
  await ui.transport.replayActiveSession(turns);

  assert.deepEqual(ui.commands, [
    { cmd: "ai_start_session", args: { sessionId: "session-1" } },
    { cmd: "ai_replay_history", args: { sessionId: "session-1", turns } },
    { cmd: "ai_replay_done", args: { sessionId: "session-1" } },
  ]);

  // 重放后的会话是常驻会话：下一次追问复用它，不再重新启动
  await ui.transport.sendViaResidentSession(followUpRequest("恢复后的追问"));
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

  const sendPromise = ui.transport.sendViaResidentSession(directQuestionRequest("问题"));
  // 等待 ensureSessionStarted 落定，currentStream 就位后再发增量
  await Promise.resolve();
  await Promise.resolve();
  // 在途消息匹配：增量到达订阅者
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-1", seq: 0, text: "她可能" });
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-1", seq: 1, text: "在隐瞒" });
  // 不匹配的会话 / 消息：丢弃
  ui.deltaHandlers[0]({ session_id: "other", message_id: "msg-1", seq: 2, text: "X" });
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-9", seq: 3, text: "Y" });
  await sendPromise;

  // 命令完成后 currentStream 清空：迟到增量不再转发
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-1", seq: 4, text: "迟到" });
  assert.deepEqual(received, ["她可能", "在隐瞒"]);
});

test("onStreamText unsubscribe stops delivering deltas", async () => {
  const ui = harness();
  const received: string[] = [];
  const unsubscribe = ui.transport.onStreamText((text) => received.push(text));
  ui.transport.installSessionEventRouting();

  const sendPromise = ui.transport.sendViaResidentSession(directQuestionRequest("问题"));
  unsubscribe();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "msg-1", seq: 0, text: "增量" });
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
