// adapter.test.mjs — 确定性 DSH 驱动适配器的本地单元测试（change: dsh-capability-integration-validation）
// 覆盖任务 2.1 / 3.2 / 3.3 / 4.4 / 6.1：只读工具请求、结构化工具事件、确认等待/决策、
// 授权读取后的同轮继续、真实 DSH 事件字段不可观测时的明确降级，以及协议面回归。
// 本套件用确定性替身（无真实模型/API），任何断言都不依赖真实模型延迟。
import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicAdapter, PROTOCOL_VERSION } from "../../driver/adapter.mjs";

function start(adapter, sessionId = "s1") {
  const out = adapter.handleCommand({ type: "start_session", session_id: sessionId });
  assert.equal(out[0].type, "session_started", "start_session 应回 session_started");
  return adapter;
}

// ── 2.1 最小 Agent Loop：直接回应文本流 + 唯一终态（确定性替身）──────────────
test("2.1 直接回应：流式 delta + 恰好一个终态（确定性替身）", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "你好" });

  const deltas = out.filter((m) => m.type === "delta");
  const terminals = out.filter((m) => m.type === "message_done" || m.type === "message_failed");
  assert.ok(deltas.length >= 1, "应流式返回 delta");
  assert.equal(terminals.length, 1, "恰好一个终态");
  assert.equal(terminals[0].type, "message_done");
  assert.ok(terminals[0].text.length > 0);
  assert.equal(terminals[0].message_id, "m1");

  // 确定性：相同输入产生相同输出（无随机、无真实模型）
  const a2 = createDeterministicAdapter();
  start(a2);
  const out2 = a2.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "你好" });
  assert.deepEqual(out, out2);
});

// ── 3.3 授权读取：结构化材料回到同一轮并继续生成 ─────────────────────────────
test("3.3 授权读取成功：材料回到同一轮并继续生成回应", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document", args: { workId: "work-wuzhen", documentId: "doc-01" },
  });

  const states = out.filter((m) => m.type === "tool_event").map((m) => m.state);
  assert.ok(states.includes("started"), "应记录 tool_start");
  assert.ok(states.includes("succeeded"), "应记录 tool_success");

  const material = out.find((m) => m.type === "tool_material");
  assert.ok(material, "应返回结构化材料");
  assert.equal(material.material.workId, "work-wuzhen");
  assert.equal(material.material.documentId, "doc-01");
  assert.equal(material.material.documentName, "第一幕");

  const done = out.find((m) => m.type === "message_done");
  assert.ok(done, "授权读取完成后同一轮继续生成");
  assert.match(done.text, /第一幕/, "回应引用了读取到的材料");
});

// ── 3.2 用户拒绝扩大读取范围 ─────────────────────────────────────────────────
test("3.2 用户拒绝扩大读取范围：结构化拒绝，回应不把被拒材料当作已读", () => {
  const a = createDeterministicAdapter();
  start(a);
  const req = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document",
    args: { workId: "work-wuzhen", documentId: "doc-01", requiresApproval: true },
  });
  assert.ok(req.some((m) => m.type === "approval_wait"), "扩大范围应进入确认等待");

  const dec = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "req-1", decision: "reject" });

  const states = dec.filter((m) => m.type === "tool_event").map((m) => m.state);
  assert.ok(states.includes("denied"), "应记录 user_confirmation_reject → denied");

  const material = dec.find((m) => m.type === "tool_material");
  assert.ok(material, "应返回结构化拒绝");
  assert.ok(material.denial, "结构化拒绝在 denial 字段");
  assert.equal(material.material, undefined, "不得携带材料内容");

  const done = dec.find((m) => m.type === "message_done");
  assert.ok(done, "拒绝后仍产生回应");
  assert.ok(!done.text.includes("林悦"), "回应不得包含被拒材料正文");
  assert.ok(!done.text.includes("第一幕"), "回应不得引用被拒材料标题");
});

// ── 3.3 确认后继续（扩大范围 → 用户确认 → 同一轮继续）────────────────────────
test("3.3 确认后继续：授权读取完成后材料回到同一轮", () => {
  const a = createDeterministicAdapter();
  start(a);
  a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document",
    args: { workId: "work-wuzhen", documentId: "doc-01", requiresApproval: true },
  });
  const dec = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "req-1", decision: "confirm" });

  const states = dec.filter((m) => m.type === "tool_event").map((m) => m.state);
  assert.ok(states.includes("succeeded"), "确认后授权读取成功");
  const material = dec.find((m) => m.type === "tool_material");
  assert.equal(material.material.documentName, "第一幕");
  assert.ok(dec.find((m) => m.type === "message_done"), "读取完成后继续生成");
});

// ── story.list 成功：不解引用缺失的 material 字段 ─────────────────────────────
test("story.list 成功：列出文档并继续生成，不解引用缺失 material", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-list", message_id: "m1",
    tool: "story.list", args: { workId: "work-wuzhen" },
  });

  const states = out.filter((m) => m.type === "tool_event").map((m) => m.state);
  assert.ok(states.includes("started"), "应记录 tool_start");
  assert.ok(states.includes("succeeded"), "应记录 tool_success");

  const list = out.find((m) => m.type === "tool_list");
  assert.ok(list, "应返回 tool_list 事件");
  assert.equal(list.documents.length, 2, "允许可见文档应为 2 篇");

  const done = out.find((m) => m.type === "message_done");
  assert.ok(done, "列出后同一轮继续生成");
  assert.ok(!done.text.includes("undefined"), "回应不得解引用缺失的 material 字段");
  assert.match(done.text, /2 篇文档/, "回应应引用列出的文档数量");
});

// ── 审批状态按 session_id + request_id 键控，同 request_id 跨会话不碰撞 ───────
test("同一 request_id 跨会话不碰撞：各会话审批互不串扰", () => {
  const a = createDeterministicAdapter();
  start(a, "s1");
  start(a, "s2");

  a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document",
    args: { workId: "work-wuzhen", documentId: "doc-01", requiresApproval: true },
  });
  a.handleCommand({
    type: "tool_request", session_id: "s2", request_id: "req-1", message_id: "m2",
    tool: "story.read_document",
    args: { workId: "work-wuzhen", documentId: "doc-01", requiresApproval: true },
  });

  const dec1 = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "req-1", decision: "confirm" });
  assert.ok(dec1.some((m) => m.type === "tool_material" && m.material), "s1 的 req-1 应确认成功");
  assert.equal(dec1.find((m) => m.type === "tool_material").material.documentName, "第一幕");

  // s2 的 req-1 仍待确认，不应被 s1 的决策消耗
  const dec2 = a.handleCommand({ type: "tool_decision", session_id: "s2", request_id: "req-1", decision: "confirm" });
  assert.ok(dec2.some((m) => m.type === "tool_material" && m.material), "s2 的 req-1 应独立确认成功");
});

test("跨会话不能误审批：错误 session_id 的决策不生效", () => {
  const a = createDeterministicAdapter();
  start(a, "s1");
  start(a, "s2");

  a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document",
    args: { workId: "work-wuzhen", documentId: "doc-01", requiresApproval: true },
  });

  const wrong = a.handleCommand({ type: "tool_decision", session_id: "s2", request_id: "req-1", decision: "confirm" });
  assert.ok(
    wrong.some((m) => m.type === "error" && m.code === "approval_not_found"),
    "跨会话决策应报 approval_not_found，不得误审批",
  );

  const dec = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "req-1", decision: "confirm" });
  assert.ok(dec.some((m) => m.type === "tool_material" && m.material), "正确身份的决策仍应成功");
});

// ── 默认拒绝：越权/未知工具失败关闭 ───────────────────────────────────────────
test("越权工具请求（写入类）失败关闭，不返回内容", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "fs.write", args: {},
  });
  const ev = out.find((m) => m.type === "tool_event");
  assert.equal(ev.state, "failed");
  assert.equal(ev.reason, "forbidden_capability");
  assert.ok(!out.some((m) => m.type === "tool_material" && m.material), "不得返回材料");
  assert.ok(out.some((m) => m.type === "message_failed"), "越权请求以失败关闭");
});

test("允许但不可见文档（隐藏）读取失败关闭，结构化拒绝且不暴露内容", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document", args: { workId: "work-wuzhen", documentId: "doc-02-hidden" },
  });
  const states = out.filter((m) => m.type === "tool_event").map((m) => m.state);
  assert.ok(states.includes("failed"), "终态应为 failed");
  const material = out.find((m) => m.type === "tool_material");
  assert.equal(material.denial.reason, "document_not_visible");
  assert.equal(material.material, undefined);
});

// ── 4.4 真实 DSH 事件字段不可观测时的明确降级 ────────────────────────────────
test("4.4 真实 DSH 事件字段不可观测时明确降级，不伪装成实机观测", () => {
  const a = createDeterministicAdapter();
  const obs = a.observe();
  assert.equal(obs.realDshEventFields.observable, false);
  assert.equal(obs.realDshEventFields.degraded, true);
  assert.equal(obs.modelLatency.available, false);

  start(a);
  const out = a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document", args: { workId: "work-wuzhen", documentId: "doc-01" },
  });
  for (const m of out.filter((x) => x.type === "tool_event" || x.type === "tool_material")) {
    assert.equal(m.synthetic, true, `${m.type} 必须标记 synthetic`);
    assert.equal(m.observed, false, `${m.type} 必须标记未实机观测`);
  }
});

// ── 4.4 崩溃重启：文本轮次可恢复，工具材料明确降级为不可恢复 ────────────────
test("4.4 崩溃重启：文本轮次可恢复，工具材料明确不可恢复（降级路径）", () => {
  const a = createDeterministicAdapter();
  start(a);
  a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "四乘以七等于多少？" });

  const recovery = a.exportRecovery("s1");
  assert.equal(recovery.ok, true);
  assert.ok(recovery.recoverable.turns.length >= 1, "文本轮次可恢复");
  assert.equal(recovery.toolMaterial.recoverable, false, "工具材料不跨重启持久化，属降级边界");

  // 新适配器（模拟驱动重启）
  const b = createDeterministicAdapter();
  start(b);
  b.handleCommand({ type: "replay_history", session_id: "s1", turns: recovery.recoverable.turns });
  const replayOk = b.handleCommand({ type: "replay_done", session_id: "s1" });
  assert.equal(replayOk[0].type, "replay_ok");
  const follow = b.handleCommand({ type: "send_message", session_id: "s1", message_id: "m2", text: "根据之前对话继续" });
  assert.ok(follow.some((m) => m.type === "message_done"), "重启后追问可用");
});

// ── 6.1 协议面回归：追问 / 流式 / 取消 / 取消后追问 / 迟到与未知请求隔离 ──────
test("6.1 追问 + 流式 + 取消 + 取消后追问可用", () => {
  const a = createDeterministicAdapter();
  start(a);
  assert.ok(a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "第一问" })
    .some((m) => m.type === "message_done"));
  assert.ok(a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m2", text: "第二问" })
    .some((m) => m.type === "message_done"));

  // 挂起的长生成
  const r3 = a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m3", text: "长任务", suspend: true });
  assert.ok(r3.some((m) => m.type === "delta"), "挂起前应有流式 delta");
  assert.ok(!r3.some((m) => m.type === "message_done" || m.type === "message_failed"), "挂起时不产生终态");

  const rCancel = a.handleCommand({ type: "cancel_message", session_id: "s1", message_id: "m3" });
  assert.equal(rCancel.find((m) => m.type === "message_failed").code, "cancelled");

  assert.ok(a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m4", text: "取消后追问" })
    .some((m) => m.type === "message_done"), "取消后追问仍可用");
});

test("6.1 迟到/未知请求身份不改变已结束请求", () => {
  const a = createDeterministicAdapter();
  start(a);
  a.handleCommand({
    type: "tool_request", session_id: "s1", request_id: "req-1", message_id: "m1",
    tool: "story.read_document", args: { workId: "work-wuzhen", documentId: "doc-01" },
  });
  // 已完成的请求再来一次 decision → 拒绝，不重新打开调用
  const late = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "req-1", decision: "confirm" });
  assert.ok(late.some((m) => m.type === "error"), "迟到决策应报错而非重开");
  // 未知请求身份
  const unknown = a.handleCommand({ type: "tool_decision", session_id: "s1", request_id: "no-such", decision: "confirm" });
  assert.ok(unknown.some((m) => m.type === "error"), "未知请求身份应报错");
});

test("协议版本号为 1", () => {
  assert.equal(PROTOCOL_VERSION, 1);
});
