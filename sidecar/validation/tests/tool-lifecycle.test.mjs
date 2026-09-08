// tool-lifecycle.test.mjs — 工具生命周期终态闸门的本地单元测试（change: dsh-capability-integration-validation 任务 3.1/3.4）
// 每个工具调用只允许一个终态；取消/超时后的迟到结果记录为 late，不重新打开调用、不改变终态。
import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_TERMINAL_STATES,
  createToolInvocation,
  isTerminalInvocation,
  terminalStateOf,
  applyToolEvent,
} from "../tool-lifecycle.mjs";

function inv(overrides = {}) {
  return createToolInvocation({
    requestId: "req-1",
    toolId: "t1",
    tool: "story.read_document",
    capability: "story.read_document",
    startedAt: 0,
    ...overrides,
  });
}

test("createToolInvocation 记录 tool_start 并处于 started 状态", () => {
  const i = inv();
  assert.equal(i.state, "started");
  assert.equal(i.events[0].type, "tool_start");
  assert.equal(i.lateResults.length, 0);
});

test("工具成功进入终态 succeeded", () => {
  const r = applyToolEvent(inv(), { type: "tool_success", result: { text: "材料" } });
  assert.equal(r.outcome, "applied");
  assert.equal(r.invocation.state, "succeeded");
  assert.equal(isTerminalInvocation(r.invocation), true);
  assert.equal(terminalStateOf(r.invocation), "succeeded");
});

test("终态后再到 success/failure 记录为迟到，状态不变（3.4）", () => {
  let i = inv();
  i = applyToolEvent(i, { type: "tool_success" }).invocation;
  const late = applyToolEvent(i, { type: "tool_success", result: { text: "迟到结果" } });
  assert.equal(late.outcome, "late");
  assert.equal(late.invocation.state, "succeeded");
  assert.equal(late.invocation.lateResults.length, 1);
});

test("取消后迟到的成功结果不会重新打开调用（3.4）", () => {
  let i = inv();
  i = applyToolEvent(i, { type: "tool_cancel" }).invocation;
  assert.equal(i.state, "cancelled");
  const late = applyToolEvent(i, { type: "tool_success", result: { text: "x" } });
  assert.equal(late.outcome, "late");
  assert.equal(late.invocation.state, "cancelled");
  assert.equal(terminalStateOf(late.invocation), "cancelled");
});

test("超时后迟到结果记录为 late，不改变终态（3.4）", () => {
  let i = inv();
  i = applyToolEvent(i, { type: "tool_timeout" }).invocation;
  assert.equal(i.state, "timed_out");
  const late = applyToolEvent(i, { type: "tool_success" });
  assert.equal(late.outcome, "late");
  assert.equal(late.invocation.state, "timed_out");
});

test("用户确认流程：等待→确认→继续→成功", () => {
  let i = inv();
  i = applyToolEvent(i, { type: "user_confirmation_wait" }).invocation;
  assert.equal(i.state, "waiting_confirmation");
  i = applyToolEvent(i, { type: "user_confirmation_confirm" }).invocation;
  assert.equal(i.state, "started");
  i = applyToolEvent(i, { type: "tool_success" }).invocation;
  assert.equal(i.state, "succeeded");
});

test("用户拒绝进入终态 denied", () => {
  let i = inv();
  i = applyToolEvent(i, { type: "user_confirmation_wait" }).invocation;
  i = applyToolEvent(i, { type: "user_confirmation_reject" }).invocation;
  assert.equal(i.state, "denied");
  assert.equal(isTerminalInvocation(i), true);
});

test("非法转移被拒绝且状态不变（未等待就确认）", () => {
  const i = inv();
  const r = applyToolEvent(i, { type: "user_confirmation_confirm" });
  assert.equal(r.outcome, "invalid");
  assert.equal(r.invocation.state, "started");
});

test("TOOL_TERMINAL_STATES 只含五类终态", () => {
  assert.deepEqual(TOOL_TERMINAL_STATES, ["succeeded", "failed", "denied", "cancelled", "timed_out"]);
});
