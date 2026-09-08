// identity.test.mjs — 请求身份模型的本地单元测试（change: dsh-capability-integration-validation 任务 1.2）
// 验证每次运行都携带作品/讨论/会话/轮次/消息/请求身份，事件路由按 session+request 匹配，
// 不依赖易重复的局部消息编号。
import assert from "node:assert/strict";
import test from "node:test";

import {
  createRequestIdentity,
  validateRequestIdentity,
  requestKey,
  isSameRequest,
  isSameSession,
} from "../identity.mjs";

const BASE = {
  workId: "work-wuzhen",
  discussionId: "discussion-1",
  sessionId: "session-1",
  turn: 1,
  messageId: "msg-1",
};

test("createRequestIdentity 保留提供的 requestId 并补齐身份字段", () => {
  const id = createRequestIdentity({ ...BASE, requestId: "req-1" });
  assert.equal(id.requestId, "req-1");
  assert.equal(id.workId, "work-wuzhen");
  assert.equal(id.discussionId, "discussion-1");
  assert.equal(id.sessionId, "session-1");
  assert.equal(id.turn, 1);
  assert.equal(id.messageId, "msg-1");
});

test("createRequestIdentity 在未提供 requestId 时生成唯一非空标识", () => {
  const a = createRequestIdentity(BASE);
  const b = createRequestIdentity(BASE);
  assert.ok(typeof a.requestId === "string" && a.requestId.length > 0);
  assert.notEqual(a.requestId, b.requestId);
});

test("validateRequestIdentity 通过完整身份，拒绝缺失字段", () => {
  const ok = validateRequestIdentity(createRequestIdentity({ ...BASE, requestId: "req-1" }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);

  const missing = validateRequestIdentity(createRequestIdentity({ ...BASE, requestId: "req-1", workId: "" }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes("workId")));
});

test("validateRequestIdentity 拒绝非正数轮次", () => {
  const bad = validateRequestIdentity(createRequestIdentity({ ...BASE, requestId: "req-1", turn: 0 }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("turn")));
});

test("requestKey 由 sessionId 与 requestId 组合，同名 messageId 也不冲突", () => {
  const a = createRequestIdentity({ ...BASE, sessionId: "session-1", messageId: "msg-1", requestId: "req-1" });
  const b = createRequestIdentity({ ...BASE, sessionId: "session-2", messageId: "msg-1", requestId: "req-1" });
  assert.notEqual(requestKey(a), requestKey(b), "不同会话下同名 messageId 不得产生同一键");
});

test("isSameRequest / isSameSession 按 sessionId+requestId 判定", () => {
  const a = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r1" });
  const b = createRequestIdentity({ ...BASE, sessionId: "s1", requestId: "r2" });
  const c = createRequestIdentity({ ...BASE, sessionId: "s2", requestId: "r1" });
  assert.equal(isSameRequest(a, a), true);
  assert.equal(isSameRequest(a, b), false);
  assert.equal(isSameRequest(a, c), false);
  assert.equal(isSameSession(a, b), true);
  assert.equal(isSameSession(a, c), false);
});
