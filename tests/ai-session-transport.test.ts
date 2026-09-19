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
  failBusinessCommand(command: string, message: string): void;
}

function okResult(content = "思考"): GenerateAiResult {
  return { ok: true, content };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(overrides: Partial<ResidentSessionDependencies> = {}): TransportHarness {
  const commands: { cmd: string; args: Record<string, unknown> }[] = [];
  const deltaHandlers: ((payload: AiDeltaPayload) => void)[] = [];
  const driverLostHandlers: (() => void)[] = [];
  const ids = ["session-1", "session-2", "session-3"];
  let idIndex = 0;
  let failure: unknown = null;
  const businessFailures = new Map<string, string>();

  function commandResult(command: string): GenerateAiResult {
    const message = businessFailures.get(command);
    return message === undefined
      ? okResult()
      : { ok: false, error: { code: "service", message } };
  }

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
      return Promise.resolve(commandResult("ai_start_session"));
    },
    sendMessage: (sessionId, messageId, kind, question, selectedText, identityOrCall) => {
      const args: Record<string, unknown> = { sessionId, messageId, kind, question };
      if (selectedText !== undefined) args.selectedText = selectedText;
      if (identityOrCall && typeof identityOrCall !== "function") {
        if (identityOrCall.documentId !== undefined) args.documentId = identityOrCall.documentId;
        if (identityOrCall.projectPath !== undefined) args.projectPath = identityOrCall.projectPath;
        if (identityOrCall.documentVersion !== undefined) args.documentVersion = identityOrCall.documentVersion;
        if (identityOrCall.snapshot !== undefined) args.snapshot = identityOrCall.snapshot;
        if (identityOrCall.focusDocumentId !== undefined) args.focusDocumentId = identityOrCall.focusDocumentId;
        if (identityOrCall.focusProjectPath !== undefined) args.focusProjectPath = identityOrCall.focusProjectPath;
        if (identityOrCall.focusDocumentVersion !== undefined) args.focusDocumentVersion = identityOrCall.focusDocumentVersion;
        if (identityOrCall.focusSnapshot !== undefined) args.focusSnapshot = identityOrCall.focusSnapshot;
      }
      commands.push({ cmd: "ai_send_message", args });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    cancelMessage: (sessionId, messageId) => {
      commands.push({ cmd: "ai_cancel_message", args: { sessionId, messageId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(okResult());
    },
    endSession: (sessionId) => {
      commands.push({ cmd: "ai_end_session", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(commandResult("ai_end_session"));
    },
    replayHistory: (sessionId, turns, origin) => {
      commands.push({ cmd: "ai_replay_history", args: { sessionId, turns, origin } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(commandResult("ai_replay_history"));
    },
    replayDone: (sessionId) => {
      commands.push({ cmd: "ai_replay_done", args: { sessionId } });
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve(commandResult("ai_replay_done"));
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
    failBusinessCommand: (command, message) => {
      if (message === "") businessFailures.delete(command);
      else businessFailures.set(command, message);
    },
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

test("first selection sends its frozen work, document, and version identity through the transport", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "direct_question",
    question: "这个问题",
    selected_text: "冻结选区",
    document_id: "doc-1",
    project_path: "C:/作品",
    document_version: "v1",
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "first",
    question: "这个问题",
    selectedText: "冻结选区",
    documentId: "doc-1",
    projectPath: "C:/作品",
    documentVersion: "v1",
  });
});

test("direct question without selection omits the selectedText argument", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("只问问题"));

  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal("selectedText" in send.args, false);
});

test("first round forwards the unsaved body snapshot through the transport", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "direct_question",
    question: "这个问题",
    selected_text: "冻结选区",
    document_id: "doc-1",
    project_path: "C:/作品",
    document_version: "v1",
    snapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "first",
    question: "这个问题",
    selectedText: "冻结选区",
    documentId: "doc-1",
    projectPath: "C:/作品",
    documentVersion: "v1",
    snapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  });
});

test("direct question forwards focus document identity and snapshot through the transport", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "direct_question",
    question: "这个问题",
    focus_document_id: "focus-1",
    focus_project_path: "C:/作品",
    focus_document_version: "v9",
    focus_snapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "first",
    question: "这个问题",
    focusDocumentId: "focus-1",
    focusProjectPath: "C:/作品",
    focusDocumentVersion: "v9",
    focusSnapshot: '{"format":"next-story-tiptap","version":2,"document":{"type":"doc"}}',
  });
});

test("follow_up forwards focus document identity through the transport", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "follow_up",
    selected_text: "",
    focus_document_id: "focus-1",
    focus_project_path: "C:/作品",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "当前问题" },
    ],
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "follow_up",
    question: "当前问题",
    focusDocumentId: "focus-1",
    focusProjectPath: "C:/作品",
  });
});

test("summon first round forwards the unsaved body snapshot", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "summon",
    selected_text: "冻结选区",
    document_id: "doc-1",
    document_version: "v1",
    snapshot: "快照JSON",
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "summon_first",
    question: "",
    selectedText: "冻结选区",
    documentId: "doc-1",
    documentVersion: "v1",
    snapshot: "快照JSON",
  });
});

test("follow_up forwards the retained snapshot when present", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "follow_up",
    selected_text: "冻结选区",
    snapshot: "快照JSON",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "当前问题" },
    ],
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "follow_up",
    question: "当前问题",
    snapshot: "快照JSON",
  });
});

test("follow_up forwards document, project, and version identity together with the snapshot", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", {
    kind: "follow_up",
    selected_text: "冻结选区",
    document_id: "doc-1",
    project_path: "C:/作品",
    document_version: "v1",
    snapshot: "快照JSON",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "当前问题" },
    ],
  });

  assert.deepEqual(ui.commands[1].args, {
    sessionId: "session-1",
    messageId: "c-1:msg-1",
    kind: "follow_up",
    question: "当前问题",
    documentId: "doc-1",
    projectPath: "C:/作品",
    documentVersion: "v1",
    snapshot: "快照JSON",
  });
});

test("follow_up without selection or snapshot forwards no identity", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("当前问题"));

  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal("documentId" in send.args, false);
  assert.equal("projectPath" in send.args, false);
  assert.equal("documentVersion" in send.args, false);
  assert.equal("snapshot" in send.args, false);
});

test("a request without a snapshot omits the snapshot argument", async () => {
  const ui = harness();
  await ui.transport.sendViaResidentSession("c-1", directQuestionRequest("只问问题"));

  const send = ui.commands.find((entry) => entry.cmd === "ai_send_message")!;
  assert.equal("snapshot" in send.args, false);
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
  ui.transport.onStreamText((event) => received.push(event.text));
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

test("replaySession rejects a start business failure without replaying or registering the session", async () => {
  const ui = harness();
  ui.failBusinessCommand("ai_start_session", "启动失败");

  await assert.rejects(
    ui.transport.replaySession("c-1", [], "direct_question"),
    /启动失败/,
  );
  assert.deepEqual(ui.commands.map((entry) => entry.cmd), ["ai_start_session"]);

  ui.failBusinessCommand("ai_start_session", "");
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("重新开始"));
  const starts = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].args.sessionId, "session-2");
});

test("replaySession rejects a history business failure and ends the partial session", async () => {
  const ui = harness();
  ui.failBusinessCommand("ai_replay_history", "历史重放失败");

  await assert.rejects(
    ui.transport.replaySession("c-1", [], "direct_question"),
    /历史重放失败/,
  );
  assert.deepEqual(ui.commands.map((entry) => entry.cmd), [
    "ai_start_session",
    "ai_replay_history",
    "ai_end_session",
  ]);

  ui.failBusinessCommand("ai_replay_history", "");
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("重新开始"));
  const starts = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].args.sessionId, "session-2");
});

test("replaySession rejects a done business failure and ends the partial session", async () => {
  const ui = harness();
  ui.failBusinessCommand("ai_replay_done", "重放完成失败");

  await assert.rejects(
    ui.transport.replaySession("c-1", [], "direct_question"),
    /重放完成失败/,
  );
  assert.deepEqual(ui.commands.map((entry) => entry.cmd), [
    "ai_start_session",
    "ai_replay_history",
    "ai_replay_done",
    "ai_end_session",
  ]);

  ui.failBusinessCommand("ai_replay_done", "");
  await ui.transport.sendViaResidentSession("c-1", followUpRequest("重新开始"));
  const starts = ui.commands.filter((entry) => entry.cmd === "ai_start_session");
  assert.equal(starts.length, 2);
  assert.equal(starts[1].args.sessionId, "session-2");
});

test("stream text routes only deltas matching the in-flight message", async () => {
  const ui = harness();
  const received: string[] = [];
  ui.transport.onStreamText((event) => received.push(event.text));
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

test("stream text carries the conversation identity so concurrent streams do not cross", async () => {
  const ui = harness();
  const received: Array<{ conversationId: string; messageId: string; text: string }> = [];
  ui.transport.onStreamText((event) => received.push(event));
  ui.transport.installSessionEventRouting();

  const sendA = ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题A"));
  const sendB = ui.transport.sendViaResidentSession("c-2", directQuestionRequest("问题B"));
  await Promise.resolve();
  await Promise.resolve();
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 0, text: "A1" });
  ui.deltaHandlers[0]({ session_id: "session-2", message_id: "c-2:msg-2", seq: 1, text: "B1" });
  ui.deltaHandlers[0]({ session_id: "session-1", message_id: "c-1:msg-1", seq: 2, text: "A2" });
  await sendA;
  await sendB;

  assert.deepEqual(received, [
    { conversationId: "c-1", messageId: "c-1:msg-1", text: "A1" },
    { conversationId: "c-2", messageId: "c-2:msg-2", text: "B1" },
    { conversationId: "c-1", messageId: "c-1:msg-1", text: "A2" },
  ]);
});

test("onStreamText unsubscribe stops delivering deltas", async () => {
  const ui = harness();
  const received: string[] = [];
  const unsubscribe = ui.transport.onStreamText((event) => received.push(event.text));
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

test("destroySessionEventRouting unlistens both completed registrations and is idempotent", async () => {
  let deltaUnlistens = 0;
  let lostUnlistens = 0;
  const ui = harness({
    listenDelta: () => Promise.resolve(() => { deltaUnlistens += 1; }),
    listenDriverLost: () => Promise.resolve(() => { lostUnlistens += 1; }),
  });

  ui.transport.installSessionEventRouting();
  await Promise.resolve();
  ui.transport.destroySessionEventRouting();
  ui.transport.destroySessionEventRouting();

  assert.equal(deltaUnlistens, 1);
  assert.equal(lostUnlistens, 1);
});

test("destroySessionEventRouting before registration completes unlistens late registrations", async () => {
  const delta = deferred<UnlistenFn>();
  const lost = deferred<UnlistenFn>();
  let deltaUnlistens = 0;
  let lostUnlistens = 0;
  const ui = harness({
    listenDelta: () => delta.promise,
    listenDriverLost: () => lost.promise,
  });

  ui.transport.installSessionEventRouting();
  ui.transport.destroySessionEventRouting();
  delta.resolve(() => { deltaUnlistens += 1; });
  lost.resolve(() => { lostUnlistens += 1; });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(deltaUnlistens, 1);
  assert.equal(lostUnlistens, 1);
});

test("event routing can reinstall after destroy without accepting late callbacks from the old cycle", async () => {
  const deltaHandlers: Array<(payload: AiDeltaPayload) => void> = [];
  const lostHandlers: Array<() => void> = [];
  const unlistens: number[] = [];
  const ui = harness({
    listenDelta: (handler) => {
      deltaHandlers.push(handler);
      const cycle = deltaHandlers.length;
      return Promise.resolve(() => { unlistens.push(cycle); });
    },
    listenDriverLost: (handler) => {
      lostHandlers.push(handler);
      const cycle = lostHandlers.length;
      return Promise.resolve(() => { unlistens.push(cycle + 10); });
    },
  });
  let lostCalls = 0;
  ui.transport.onDriverLost(() => { lostCalls += 1; });

  ui.transport.installSessionEventRouting();
  await Promise.resolve();
  ui.transport.destroySessionEventRouting();
  ui.transport.installSessionEventRouting();
  await Promise.resolve();

  assert.equal(deltaHandlers.length, 2);
  assert.equal(lostHandlers.length, 2);
  assert.deepEqual(unlistens.sort((a, b) => a - b), [1, 11]);
  lostHandlers[0]();
  assert.equal(lostCalls, 0, "旧安装周期的迟到回调不得传播");
  lostHandlers[1]();
  assert.equal(lostCalls, 1);
});

test("cancelMessage sends ai_cancel_message for the in-flight message of the conversation", async () => {
  const ui = harness();
  const sendPromise = ui.transport.sendViaResidentSession("c-1", directQuestionRequest("问题"));
  await Promise.resolve();
  await Promise.resolve();
  ui.transport.cancelMessage("c-1");

  const cancel = ui.commands.find((entry) => entry.cmd === "ai_cancel_message");
  assert.deepEqual(cancel, {
    cmd: "ai_cancel_message",
    args: { sessionId: "session-1", messageId: "c-1:msg-1" },
  });
  await sendPromise;
});

test("cancelMessage for a conversation without an in-flight message sends nothing", () => {
  const ui = harness();
  ui.transport.cancelMessage("c-unknown");
  assert.equal(ui.commands.some((entry) => entry.cmd === "ai_cancel_message"), false);
});
