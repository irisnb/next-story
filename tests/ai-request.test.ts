import assert from "node:assert/strict";
import test from "node:test";

import { AiRequestCoordinator } from "../src/ai-request.ts";
import type { GenerateAiError, GenerateAiResult, SelectionSnapshot } from "../src/types.ts";

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
