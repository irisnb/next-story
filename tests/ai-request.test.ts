import assert from "node:assert/strict";
import test from "node:test";

import { AiRequestCoordinator } from "../src/ai-request.ts";
import type { GenerateAiError, GenerateAiResult, SelectionSnapshot } from "../src/types.ts";
import type { GenerateAiRequest } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

const authError: GenerateAiError = { code: "authentication", message: "认证失败" };

function makeCoordinator(
  generate: (text: string) => Promise<GenerateAiResult>,
  getToken: () => number,
) {
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    generate,
    {
      onSuccess: (snap, content) => events.push(`success:${snap.selectedText}:${content}`),
      onError: (snap, error) => events.push(`error:${snap.selectedText}:${error.code}`),
    },
    getToken,
  );
  return { coordinator, events };
}

test("executes exactly one client call even when summoned repeatedly", async () => {
  let calls = 0;
  const generate = async (text: string): Promise<GenerateAiResult> => {
    calls += 1;
    return { ok: true, content: `r:${text}` };
  };
  const { coordinator, events } = makeCoordinator(generate, () => 1);

  const first = coordinator.request(snapshot("a"))!;
  const second = coordinator.request(snapshot("b"));

  assert.equal(second, null, "第二个召唤不应执行");
  assert.equal(calls, 1, "只应发起一次生成调用");
  assert.equal(coordinator.busy, true);

  await first;
  assert.equal(calls, 1);
  assert.equal(coordinator.busy, false);
  assert.deepEqual(events, ["success:a:r:a"]);
});

test("delivers the success result to callbacks", async () => {
  const generate = async (): Promise<GenerateAiResult> => ({ ok: true, content: "思考" });
  const { coordinator, events } = makeCoordinator(generate, () => 1);
  await coordinator.request(snapshot("x"))!;
  assert.deepEqual(events, ["success:x:思考"]);
});

test("delivers the error result and unlocks afterwards", async () => {
  const generate = async (): Promise<GenerateAiResult> => ({ ok: false, error: authError });
  const { coordinator, events } = makeCoordinator(generate, () => 1);
  await coordinator.request(snapshot("y"))!;
  assert.deepEqual(events, ["error:y:authentication"]);
  assert.equal(coordinator.busy, false);
});

test("maps an unexpected invoke rejection to a visible safe error and unlocks", async () => {
  const generate = async (): Promise<GenerateAiResult> => {
    throw new Error("invoke transport exploded with secret details");
  };
  const { coordinator, events } = makeCoordinator(generate, () => 1);

  await coordinator.request(snapshot("z"))!;

  assert.deepEqual(events, ["error:z:network"]);
  assert.equal(coordinator.busy, false);
});

test("a success callback exception propagates without dispatching a network error", async () => {
  let errors = 0;
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "成功" }),
    {
      onSuccess: () => {
        throw new Error("render failed");
      },
      onError: () => {
        errors += 1;
      },
    },
    () => 1,
  );

  await assert.rejects(coordinator.request(snapshot("x"))!, /render failed/);
  assert.equal(errors, 0);
  assert.equal(coordinator.busy, false);
});

test("ignores late results after the project token changed", async () => {
  let token = 1;
  const generate = async (): Promise<GenerateAiResult> => ({ ok: true, content: "迟到" });
  const { coordinator, events } = makeCoordinator(generate, () => token);

  const pending = coordinator.request(snapshot("a"))!;
  token = 2; // 作品被替换
  await pending;

  assert.deepEqual(events, [], "迟到结果不得污染新作品");
  assert.equal(coordinator.busy, false);
});

test("applies the result when the project token is unchanged", async () => {
  const generate = async (): Promise<GenerateAiResult> => ({ ok: true, content: "ok" });
  const { coordinator, events } = makeCoordinator(generate, () => 5);
  await coordinator.request(snapshot("a"))!;
  assert.deepEqual(events, ["success:a:ok"]);
});

test("does not re-execute a second call while one is in flight even across snapshots", async () => {
  let calls = 0;
  let resolve!: (v: GenerateAiResult) => void;
  const generate = (): Promise<GenerateAiResult> =>
    new Promise<GenerateAiResult>((r) => {
      calls += 1;
      resolve = r;
    });
  const { coordinator } = makeCoordinator(generate, () => 1);

  const first = coordinator.request(snapshot("a"))!;
  const second = coordinator.request(snapshot("b"));
  assert.equal(second, null);
  assert.equal(calls, 1);

  resolve({ ok: true, content: "done" });
  await first;
  assert.equal(calls, 1);
});

test("shares the single-flight lock across structured follow-up requests", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  const requests: GenerateAiRequest[] = [];
  const coordinator = new AiRequestCoordinator(
    async (text) => ({ ok: true, content: `legacy:${text}` }),
    { onSuccess: () => {}, onError: () => {} },
    () => 1,
    async (request) => {
      requests.push(request);
      return new Promise<GenerateAiResult>((r) => {
        resolve = r;
      });
    },
  );

  const first = coordinator.requestStructured({ kind: "first", selected_text: "锚点" }, { conversationId: 1 });
  const second = coordinator.requestStructured({
    kind: "follow_up",
    selected_text: "锚点",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "追问" },
    ],
  }, { conversationId: 1, turnId: 1 });
  assert.notEqual(first, null);
  assert.equal(second, null);
  resolve({ ok: true, content: "答复" });
  await first;
  assert.deepEqual(requests, [{ kind: "first", selected_text: "锚点" }]);
});

test("ignores a structured result when its conversation or turn identity is stale", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  let identity: { conversationId: number; turnId?: number } | null = {
    conversationId: 4,
    turnId: 1,
  };
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "legacy" }),
    {
      onSuccess: () => events.push("legacy-success"),
      onError: () => events.push("legacy-error"),
      onStructuredSuccess: () => events.push("follow-up-success"),
      onStructuredError: () => events.push("follow-up-error"),
    },
    () => 1,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
    () => identity,
  );

  const pending = coordinator.requestStructured(
    {
      kind: "follow_up",
      selected_text: "锚点",
      messages: [
        { role: "assistant", content: "首答" },
        { role: "user", content: "问题" },
      ],
    },
    { conversationId: 4, turnId: 1 },
  );
  identity = { conversationId: 5, turnId: 2 };
  resolve({ ok: true, content: "迟到" });
  await pending;
  assert.deepEqual(events, []);
});

async function runStructuredStaleCase(
  initialIdentity: { conversationId: number; turnId: number },
  currentIdentity: { conversationId: number; turnId: number },
  changeProjectToken: boolean,
): Promise<string[]> {
  let resolve!: (value: GenerateAiResult) => void;
  let projectToken = 1;
  let identity: { conversationId: number; turnId?: number } | null = initialIdentity;
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "legacy" }),
    {
      onSuccess: () => events.push("legacy-success"),
      onError: () => events.push("legacy-error"),
      onStructuredSuccess: () => events.push("success"),
      onStructuredError: () => events.push("error"),
    },
    () => projectToken,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
    () => identity,
  );
  const pending = coordinator.requestStructured(
    { kind: "follow_up", selected_text: "锚点", messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "问题" },
    ] },
    initialIdentity,
  );
  identity = currentIdentity;
  if (changeProjectToken) projectToken = 2;
  resolve({ ok: true, content: "迟到" });
  await pending;
  return events;
}

test("structured follow-up ignores stale project token", async () => {
  assert.deepEqual(await runStructuredStaleCase({ conversationId: 1, turnId: 1 }, { conversationId: 1, turnId: 1 }, true), []);
});

test("structured follow-up ignores stale conversation identity with same turn", async () => {
  assert.deepEqual(await runStructuredStaleCase({ conversationId: 1, turnId: 1 }, { conversationId: 2, turnId: 1 }, false), []);
});

test("structured follow-up ignores stale turn identity with same conversation", async () => {
  assert.deepEqual(await runStructuredStaleCase({ conversationId: 1, turnId: 1 }, { conversationId: 1, turnId: 2 }, false), []);
});

test("stale structured failure result is ignored independently", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  let identity: { conversationId: number; turnId?: number } | null = {
    conversationId: 1,
    turnId: 1,
  };
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "legacy" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onStructuredError: () => events.push("error"),
    },
    () => 1,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
    () => identity,
  );
  const pending = coordinator.requestStructured(
    { kind: "follow_up", selected_text: "锚点", messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "问题" },
    ] },
    { conversationId: 1, turnId: 1 },
  );
  identity = { conversationId: 1, turnId: 2 };
  resolve({ ok: false, error: authError });
  await pending;
  assert.deepEqual(events, []);
});

test("stale structured promise rejection is ignored without an error callback", async () => {
  let reject!: (reason: Error) => void;
  let identity: { conversationId: number; turnId?: number } | null = {
    conversationId: 1,
    turnId: 1,
  };
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "legacy" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onStructuredError: () => events.push("error"),
    },
    () => 1,
    async () => new Promise<GenerateAiResult>((_resolve, rejectPromise) => { reject = rejectPromise; }),
    () => identity,
  );
  const pending = coordinator.requestStructured(
    { kind: "follow_up", selected_text: "锚点", messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "问题" },
    ] },
    { conversationId: 1, turnId: 1 },
  );
  identity = { conversationId: 2, turnId: 1 };
  reject(new Error("transport failed"));
  await pending;
  assert.deepEqual(events, []);
  assert.equal(coordinator.busy, false);
});

test("new accepted summon replacement invalidates an old structured follow-up result", async () => {
  const state = new (await import("../src/ai-panel-state.ts")).AiPanelState();
  const anchor = snapshot("相同锚点");
  state.beginRequest(anchor);
  state.succeed(anchor, "旧首答");
  state.beginFollowUp("旧问题");
  const oldIdentity = state.conversationIdentity;
  assert.ok(oldIdentity?.turnId);

  let resolve!: (value: GenerateAiResult) => void;
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "first" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onStructuredSuccess: () => events.push("stale-applied"),
    },
    () => 1,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
    () => state.conversationIdentity,
  );
  const pending = coordinator.requestStructured(state.followUpRequest()!, {
    conversationId: oldIdentity.conversationId,
    turnId: oldIdentity.turnId,
  });
  state.beginRequest(anchor);
  resolve({ ok: true, content: "旧迟到结果" });
  await pending;

  assert.deepEqual(events, []);
  assert.equal(state.view.request.kind, "loading");
  assert.notEqual(state.view.request.conversationId, oldIdentity.conversationId);
});
