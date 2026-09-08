// isolation.test.mjs — 会话隔离与迟到结果隔离的本地单元测试（change: dsh-capability-integration-validation 任务 4.1/4.2/4.3）
// 事件按 session+request 身份路由；取消/失败/超时/迟到不污染其他请求、其他作品或新请求。
import assert from "node:assert/strict";
import test from "node:test";

import { createRequestIdentity } from "../identity.mjs";
import {
  createIsolationRegistry,
  registerRequest,
  deliverEvent,
  finishRequest,
  cancelRequest,
  isActive,
  requestStateOf,
  eventsFor,
} from "../isolation.mjs";

const BASE = { workId: "work-wuzhen", discussionId: "d", turn: 1, messageId: "m" };

test("两个会话交错事件，各收到自己的文本与工具结果（4.1）", () => {
  const r = createIsolationRegistry();
  const a = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r1" });
  const b = createRequestIdentity({ ...BASE, sessionId: "s2", requestId: "r2" });
  registerRequest(r, a);
  registerRequest(r, b);

  deliverEvent(r, { sessionId: "s1", requestId: "r1", kind: "text", text: "A1" });
  deliverEvent(r, { sessionId: "s2", requestId: "r2", kind: "text", text: "B1" });
  deliverEvent(r, { sessionId: "s1", requestId: "r1", kind: "tool", tool: "read", result: "A" });
  deliverEvent(r, { sessionId: "s2", requestId: "r2", kind: "tool", tool: "read", result: "B" });

  assert.deepEqual(eventsFor(r, a).map((e) => e.text ?? e.result), ["A1", "A"]);
  assert.deepEqual(eventsFor(r, b).map((e) => e.text ?? e.result), ["B1", "B"]);
});

test("取消一个请求，另一个请求继续运行（4.2）", () => {
  const r = createIsolationRegistry();
  const a = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r1" });
  const b = createRequestIdentity({ ...BASE, sessionId: "s2", requestId: "r2" });
  registerRequest(r, a);
  registerRequest(r, b);

  const cancel = cancelRequest(r, a);
  assert.equal(cancel.ok, true);
  assert.equal(isActive(r, a), false);
  assert.equal(isActive(r, b), true);

  const d = deliverEvent(r, { sessionId: "s2", requestId: "r2", kind: "text", text: "B继续" });
  assert.equal(d.outcome, "delivered");
  assert.equal(eventsFor(r, b).length, 1);
});

test("取消/失败状态不互相传播（4.2）", () => {
  const r = createIsolationRegistry();
  const a = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r1" });
  const b = createRequestIdentity({ ...BASE, sessionId: "s2", requestId: "r2" });
  registerRequest(r, a);
  registerRequest(r, b);
  finishRequest(r, a, "cancelled");
  finishRequest(r, b, "failed");

  assert.equal(requestStateOf(r, a), "cancelled");
  assert.equal(requestStateOf(r, b), "failed");

  // 已取消请求 a 的迟到事件不落到 b
  const late = deliverEvent(r, { sessionId: "s1", requestId: "r1", kind: "text", text: "迟到" });
  assert.equal(late.outcome, "late_request");
  assert.equal(eventsFor(r, b).length, 0);
});

test("未知请求身份被拒绝，不改变任何活动请求（spec: unknown request identity）", () => {
  const r = createIsolationRegistry();
  const a = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r1" });
  registerRequest(r, a);
  const d = deliverEvent(r, { sessionId: "s1", requestId: "no-such-request", kind: "text", text: "x" });
  assert.equal(d.outcome, "unknown_request");
  assert.equal(r.invalidEvents.length, 1);
  assert.equal(eventsFor(r, a).length, 0);
});

test("已结束请求的迟到事件不污染其他作品与新请求（4.3）", () => {
  const r = createIsolationRegistry();
  const oldReq = createRequestIdentity({ ...BASE, workId: "work-a", sessionId: "s1", requestId: "r1" });
  registerRequest(r, oldReq);
  finishRequest(r, oldReq, "completed");

  const late = deliverEvent(r, { sessionId: "s1", requestId: "r1", kind: "tool", result: "迟到结果" });
  assert.equal(late.outcome, "late_request");
  assert.equal(r.lateEvents.length, 1);

  // 其他作品的新请求不受污染
  const newReq = createRequestIdentity({ ...BASE, workId: "work-b", sessionId: "s2", requestId: "r2" });
  registerRequest(r, newReq);
  assert.equal(eventsFor(r, newReq).length, 0);
  // 已结束请求的事件列表未被追加
  assert.equal(eventsFor(r, oldReq).length, 0);
});
