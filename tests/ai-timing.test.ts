import assert from "node:assert/strict";
import test from "node:test";

import {
  WaitTimingCollector,
  waitTiming,
} from "../src/ai-timing.ts";

function newCollector(): WaitTimingCollector {
  return new WaitTimingCollector();
}

test("records queued, first-response and total durations separately", () => {
  const collector = newCollector();
  collector.submit("c-1", "direct_question");
  collector.queued("c-1");
  collector.started("c-1");
  collector.firstResponse("c-1");
  collector.complete("c-1");

  const summary = collector.summarize();
  assert.equal(summary.length, 1);
  const s = summary[0];
  assert.equal(s.conversationId, "c-1");
  assert.equal(s.kind, "direct_question");
  assert.ok(s.queuedDurationMs !== null);
  assert.ok(s.firstResponseDurationMs !== null);
  assert.ok(s.totalDurationMs !== null);
});

test("queuedDurationMs is null when the request was never queued", () => {
  const collector = newCollector();
  collector.submit("c-1", "summon");
  collector.started("c-1");
  collector.complete("c-1");

  const summary = collector.summarize()[0];
  assert.equal(summary.queuedDurationMs, null);
  assert.ok(summary.firstResponseDurationMs === null, "无首次回应事件");
  assert.ok(summary.totalDurationMs !== null);
});

test("first response is recorded once and not overwritten by later deltas", () => {
  const collector = newCollector();
  collector.submit("c-1", "follow_up");
  collector.started("c-1");
  collector.firstResponse("c-1");
  // 后续增量不覆盖首个回应时间。
  collector.firstResponse("c-1");
  collector.firstResponse("c-1");
  collector.complete("c-1");

  const record = collector.getRecords()[0];
  assert.ok(record.firstResponseAt !== null);
});

test("same conversation completing multiple rounds keeps every round in exportJson", () => {
  const collector = newCollector();
  // 第一轮：排队 → 开始 → 首次回应 → 完成的完整时间线。
  collector.submit("c-1", "direct_question");
  collector.queued("c-1");
  collector.started("c-1");
  collector.firstResponse("c-1");
  collector.complete("c-1");
  // 第二轮：同讨论新一轮，未经排队。
  collector.submit("c-1", "follow_up");
  collector.started("c-1");
  collector.firstResponse("c-1");
  collector.complete("c-1");

  const parsed = JSON.parse(collector.exportJson());
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.summary.length, 2);
  assert.equal(parsed.records[0].kind, "direct_question");
  assert.equal(parsed.records[1].kind, "follow_up");
  // 两轮 summary 各自派生：第一轮排队过，第二轮从未排队。
  assert.ok(parsed.records[0].completedAt !== null);
  assert.ok(parsed.records[1].completedAt !== null);
  assert.ok(parsed.summary[0].queuedDurationMs !== null);
  assert.ok(parsed.summary[0].firstResponseDurationMs !== null);
  assert.ok(parsed.summary[0].totalDurationMs !== null);
  assert.equal(parsed.summary[1].queuedDurationMs, null);
  assert.ok(parsed.summary[1].firstResponseDurationMs !== null);
  assert.ok(parsed.summary[1].totalDurationMs !== null);
});

test("replaced in-flight round is archived as-is with missing timestamps kept null", () => {
  const collector = newCollector();
  collector.submit("c-1", "direct_question");
  collector.started("c-1");
  // 未完成即被同讨论新一轮顶替：旧轮按原样归档。
  collector.submit("c-1", "follow_up");
  collector.complete("c-1");

  const records = collector.getRecords();
  assert.equal(records.length, 2);
  const archived = records[0];
  assert.equal(archived.kind, "direct_question");
  assert.ok(archived.submittedAt !== null);
  assert.ok(archived.startedAt !== null);
  assert.equal(archived.queuedAt, null);
  assert.equal(archived.firstResponseAt, null);
  assert.equal(archived.completedAt, null);
  const current = records[1];
  assert.equal(current.kind, "follow_up");
  assert.ok(current.completedAt !== null);
});

test("history is bounded: oldest dropped beyond injected limit", () => {
  const collector = new WaitTimingCollector(3);
  for (let i = 0; i < 5; i++) {
    collector.submit(`c-${i}`, "direct_question");
    collector.complete(`c-${i}`);
  }
  const records = collector.getRecords();
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((r) => r.conversationId),
    ["c-2", "c-3", "c-4"],
  );
});

test("exportJson returns records and summary; clear empties the collector", () => {
  const collector = newCollector();
  collector.submit("c-1", "summon");
  collector.complete("c-1");
  const json = collector.exportJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.summary.length, 1);

  collector.clear();
  assert.equal(collector.getRecords().length, 0);
});

test("shared singleton exposes the same interface", () => {
  assert.equal(typeof waitTiming.submit, "function");
  assert.equal(typeof waitTiming.exportJson, "function");
});
