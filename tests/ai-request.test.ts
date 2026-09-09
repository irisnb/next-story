import assert from "node:assert/strict";
import test from "node:test";

import { AiRequestCoordinator } from "../src/ai-request.ts";
import type { GenerateAiError, GenerateAiResult, SelectionSnapshot } from "../src/types.ts";
import type { GenerateAiRequest } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
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

test("executes exactly one client call for the same discussion even when summoned repeatedly", async () => {
  let calls = 0;
  const generate = async (text: string): Promise<GenerateAiResult> => {
    calls += 1;
    return { ok: true, content: `r:${text}` };
  };
  const { coordinator, events } = makeCoordinator(generate, () => 1);

  const first = coordinator.request(snapshot("a"))!;
  const second = coordinator.request(snapshot("b"));

  assert.equal(second, null, "同一讨论（legacy 兜底身份）的第二个召唤不应执行");
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

test("does not re-execute a second call while one is in flight for the same discussion", async () => {
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

test("rejects a second structured request in the same discussion", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  const requests: GenerateAiRequest[] = [];
  const coordinator = new AiRequestCoordinator(
    async (text) => ({ ok: true, content: `legacy:${text}` }),
    { onSuccess: () => {}, onError: () => {} },
    () => 1,
    async (_conversationId, request) => {
      requests.push(request);
      return new Promise<GenerateAiResult>((r) => { resolve = r; });
    },
  );

  const first = coordinator.requestStructured({ kind: "summon", selected_text: "锚点" }, { conversationId: "1" });
  const second = coordinator.requestStructured({
    kind: "follow_up",
    selected_text: "锚点",
    messages: [
      { role: "assistant", content: "首答" },
      { role: "user", content: "追问" },
    ],
  }, { conversationId: "1", turnId: 1 });
  assert.notEqual(first, null);
  assert.equal(second, null);
  resolve({ ok: true, content: "答复" });
  await first;
  assert.deepEqual(requests, [{ kind: "summon", selected_text: "锚点" }]);
});

test("different discussions generate in parallel without blocking each other", async () => {
  let resolveA!: (value: GenerateAiResult) => void;
  let resolveB!: (value: GenerateAiResult) => void;
  const calls: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async (text) => ({ ok: true, content: `legacy:${text}` }),
    { onSuccess: () => {}, onError: () => {}, onStructuredSuccess: (_, id) => calls.push(`ok:${id.conversationId}`) },
    () => 1,
    async (conversationId) => {
      calls.push(`start:${conversationId}`);
      return new Promise<GenerateAiResult>((r) => {
        if (conversationId === "a") resolveA = r;
        else resolveB = r;
      });
    },
  );

  const first = coordinator.requestStructured({ kind: "summon", selected_text: "A" }, { conversationId: "a" });
  const second = coordinator.requestStructured({ kind: "summon", selected_text: "B" }, { conversationId: "b" });
  assert.notEqual(first, null);
  assert.notEqual(second, null, "不同讨论的请求互不阻塞");

  resolveA({ ok: true, content: "答复A" });
  await first;
  resolveB({ ok: true, content: "答复B" });
  await second;
  assert.deepEqual(calls, ["start:a", "start:b", "ok:a", "ok:b"]);
});

test("releaseStaleRequestOwnership invalidates in-flight results after a project switch", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "legacy" }),
    { onSuccess: () => {}, onError: () => {}, onStructuredSuccess: () => events.push("success") },
    () => 1,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
  );
  const pending = coordinator.requestStructured({ kind: "summon", selected_text: "锚点" }, { conversationId: "1" });
  coordinator.releaseStaleRequestOwnership();
  resolve({ ok: true, content: "迟到" });
  await pending;
  assert.deepEqual(events, []);
});

test("direct question request routes success to the direct question callback", async () => {
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "first" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onDirectQuestionSuccess: (content) => events.push(`dq:${content}`),
    },
    () => 1,
    async () => ({ ok: true, content: "直接提问回答" }),
  );

  await coordinator.requestDirectQuestion({
    kind: "direct_question",
    question: "问题",
  })!;
  assert.deepEqual(events, ["dq:直接提问回答"]);
  assert.equal(coordinator.busy, false);
});

test("direct question request routes failure to the direct question callback", async () => {
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "first" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onDirectQuestionError: (error) => events.push(`dq:${error.code}`),
    },
    () => 1,
    async () => ({ ok: false, error: authError }),
  );

  await coordinator.requestDirectQuestion({
    kind: "direct_question",
    question: "问题",
  })!;
  assert.deepEqual(events, ["dq:authentication"]);
  assert.equal(coordinator.busy, false);
});

test("direct question result is discarded after the project token changes", async () => {
  let token = 1;
  let resolve!: (value: GenerateAiResult) => void;
  const events: string[] = [];
  const coordinator = new AiRequestCoordinator(
    async () => ({ ok: true, content: "first" }),
    {
      onSuccess: () => {},
      onError: () => {},
      onDirectQuestionSuccess: () => events.push("stale-applied"),
    },
    () => token,
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
  );

  const pending = coordinator.requestDirectQuestion({
    kind: "direct_question",
    question: "旧作品问题",
  })!;
  token = 2;
  resolve({ ok: true, content: "迟到旧作品回答" });
  await pending;

  assert.deepEqual(events, []);
  assert.equal(coordinator.busy, false);
});

test("direct question request shares the single-flight lock with a same-discussion request", async () => {
  let resolve!: (value: GenerateAiResult) => void;
  const coordinator = new AiRequestCoordinator(
    async () => new Promise<GenerateAiResult>((r) => { resolve = r; }),
    { onSuccess: () => {}, onError: () => {} },
    () => 1,
    async () => ({ ok: true, content: "x" }),
  );

  const first = coordinator.request(snapshot("a"))!;
  const blocked = coordinator.requestDirectQuestion({
    kind: "direct_question",
    question: "问题",
  });
  assert.equal(blocked, null, "同一讨论（legacy 兜底身份）已有请求进行中，直接提问应被单飞拒绝");
  resolve({ ok: true, content: "r" });
  await first;
  assert.equal(coordinator.busy, false);
});
