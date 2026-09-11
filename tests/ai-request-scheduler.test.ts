import assert from "node:assert/strict";
import test from "node:test";

import {
  AiRequestScheduler,
  DEFAULT_MAX_CONCURRENT,
} from "../src/ai-request-scheduler.ts";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test("default concurrency limit is at least 2", () => {
  assert.ok(DEFAULT_MAX_CONCURRENT >= 2);
});

test("requests below the limit start immediately", () => {
  const scheduler = new AiRequestScheduler(2);
  let runs = 0;
  const result = scheduler.submit({ conversationId: "a", run: () => { runs += 1; return Promise.resolve(); } });
  assert.equal(result, "started");
  assert.equal(runs, 1);
});

test("requests above the limit queue in FIFO order and start as slots free", async () => {
  const runs: string[] = [];
  const started: string[] = [];
  const scheduler = new AiRequestScheduler(2, (id) => started.push(id));

  const a = deferred();
  const b = deferred();
  const c = deferred();

  assert.equal(scheduler.submit({ conversationId: "a", run: () => { runs.push("a"); return a.promise; } }), "started");
  assert.equal(scheduler.submit({ conversationId: "b", run: () => { runs.push("b"); return b.promise; } }), "started");
  // 已达上限：c 排队。
  assert.equal(scheduler.submit({ conversationId: "c", run: () => { runs.push("c"); return c.promise; } }), "queued");
  assert.equal(scheduler.queueLength, 1);
  assert.deepEqual(runs, ["a", "b"]);

  // 释放 a：c 应开始（onStart 触发，恢复为生成中）。
  a.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(runs, ["a", "b", "c"]);
  assert.deepEqual(started, ["c"], "onStart 只在排队请求轮到开始时触发");
  assert.equal(scheduler.queueLength, 0);

  b.resolve();
  c.resolve();
  await Promise.resolve();
});

test("a queued request still occupies its discussion's single-request lock", () => {
  const scheduler = new AiRequestScheduler(1);
  const a = deferred();
  assert.equal(scheduler.submit({ conversationId: "a", run: () => a.promise }), "started");
  // b 排队（上限 1）。
  assert.equal(scheduler.submit({ conversationId: "b", run: () => Promise.resolve() }), "queued");
  // 同一讨论 b 再次提交：拒绝（排队中已占用其锁）。
  assert.equal(scheduler.submit({ conversationId: "b", run: () => Promise.resolve() }), "busy");
});

test("cancelQueued removes a queued request without starting it", async () => {
  const scheduler = new AiRequestScheduler(1);
  const a = deferred();
  let bRan = false;
  assert.equal(scheduler.submit({ conversationId: "a", run: () => a.promise }), "started");
  assert.equal(scheduler.submit({ conversationId: "b", run: () => { bRan = true; return Promise.resolve(); } }), "queued");

  assert.equal(scheduler.cancelQueued("b"), true);
  assert.equal(scheduler.cancelQueued("b"), false, "重复取消返回 false");
  a.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(bRan, false, "被取消的排队请求不发起生成");
});
