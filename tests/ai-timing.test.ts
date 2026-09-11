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

test("submit for the same conversation overwrites the in-flight record", () => {
  const collector = newCollector();
  collector.submit("c-1", "direct_question");
  collector.submit("c-1", "follow_up");
  assert.equal(collector.getRecords().length, 1);
  assert.equal(collector.getRecords()[0].kind, "follow_up");
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
