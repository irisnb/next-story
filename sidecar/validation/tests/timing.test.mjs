// timing.test.mjs — 计时证据的本地单元测试（change: dsh-capability-integration-validation 任务 5.1/5.2）
// 记录提交/首字/排队/工具等待/确认等待/完成；进度提示不计入首字；失败或计时不可用时标记 incomplete。
import assert from "node:assert/strict";
import test from "node:test";

import {
  createTimingRecorder,
  markTiming,
  durationMs,
  summarizeTiming,
} from "../timing.mjs";

function fakeClock(start = 1000) {
  let t = start;
  return () => t++;
}

test("记录提交/首字/完成并计算延迟（5.1）", () => {
  const r = createTimingRecorder(fakeClock());
  markTiming(r, "submission");
  markTiming(r, "first_text", { kind: "model" });
  markTiming(r, "completion");
  const s = summarizeTiming(r, { terminal: "completed" });
  assert.equal(s.complete, true);
  assert.equal(s.durations.first_text_ms, 1);
  assert.equal(s.durations.completion_ms, 2);
  assert.deepEqual(s.conclusion, { first_text_ms: 1, completion_ms: 2 });
});

test("进度提示不计入首字（5.2）", () => {
  const r = createTimingRecorder(fakeClock());
  markTiming(r, "submission");
  const p = markTiming(r, "first_text", { kind: "progress" });
  assert.equal(p.recorded, false);
  assert.equal(p.reason, "progress_not_model_text");
  markTiming(r, "first_text", { kind: "model" });
  markTiming(r, "completion");
  const s = summarizeTiming(r, { terminal: "completed" });
  assert.equal(s.complete, true);
  assert.equal(s.durations.first_text_ms, 1, "进度提示被跳过，首字按真实模型文本计");
});

test("缺失完成标记或非完成终态时标记 incomplete，不生成延迟结论（5.2）", () => {
  const r = createTimingRecorder(fakeClock());
  markTiming(r, "submission");
  markTiming(r, "first_text", { kind: "model" });
  const s = summarizeTiming(r, { terminal: "cancelled" });
  assert.equal(s.complete, false);
  assert.equal(s.conclusion, null);
  assert.ok(s.missing.includes("completion"));
});

test("计时源不可用（clock 抛错）时标记 incomplete（5.2）", () => {
  let calls = 0;
  const brokenClock = () => {
    calls += 1;
    if (calls > 1) throw new Error("clock broken");
    return 1000;
  };
  const r = createTimingRecorder(brokenClock);
  markTiming(r, "submission");
  const bad = markTiming(r, "first_text", { kind: "model" });
  assert.equal(bad.recorded, false);
  assert.equal(bad.reason, "clock_error");
  const s = summarizeTiming(r, { terminal: "completed" });
  assert.equal(s.complete, false);
  assert.equal(s.errors.length, 1);
});

test("工具等待与确认等待的独立时长（5.1）", () => {
  const r = createTimingRecorder(fakeClock());
  markTiming(r, "submission");
  markTiming(r, "tool_wait_start");
  markTiming(r, "tool_wait_end");
  markTiming(r, "confirmation_wait_start");
  markTiming(r, "confirmation_wait_end");
  markTiming(r, "first_text", { kind: "model" });
  markTiming(r, "completion");
  const s = summarizeTiming(r, { terminal: "completed" });
  assert.equal(s.durations.tool_wait_ms, 1);
  assert.equal(s.durations.confirmation_wait_ms, 1);
});

test("queue 时长可独立记录（5.1）", () => {
  const r = createTimingRecorder(fakeClock());
  markTiming(r, "submission");
  markTiming(r, "queue_start");
  markTiming(r, "queue_end");
  markTiming(r, "first_text", { kind: "model" });
  markTiming(r, "completion");
  assert.equal(durationMs(r, "queue_start", "queue_end"), 1);
});
