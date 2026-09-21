// adapter.test.mjs — 确定性 DSH 驱动适配器的本地单元测试（change: add-agent-on-demand-reading 任务组 1 协议面对齐）
// 覆盖：直接回应文本流 + message_sent 回执 + 唯一终态、tool_call/tool_result 工具往返（授权读取、
// 结构化拒绝、授权请求工具、目录/检索）、同轮继续、取消与迟到结果隔离、越权失败关闭、
// 崩溃恢复降级，以及任务 1.5 的生产事件全集覆盖断言（替身不使用生产不认识的事件）。
// 本套件用确定性替身（无真实模型/API），任何断言都不依赖真实模型延迟。
// 工具执行方由测试 harness 扮演宿主：经 validation/bridge.mjs 对固定 fixture 算出受控只读结果，
// 再以 tool_result 回填——与生产 D2 方向一致（驱动只桥接，执行在宿主）。
import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicAdapter, PROTOCOL_VERSION } from "../../driver/adapter.mjs";
import { loadProtocol } from "../../driver/protocol.mjs";
import { readMaterial, listAllowedDocuments } from "../bridge.mjs";
import { STORY_FIXTURE } from "../fixtures/story-fixture.mjs";

function start(adapter, sessionId = "s1") {
  const out = adapter.handleCommand({ type: "start_session", session_id: sessionId });
  assert.equal(out[0].type, "session_started", "start_session 应回 session_started");
  return adapter;
}

// 发起一轮带工具计划的发送（替身扮演模型+驱动，确定性假循环），返回 { out, call }。
function toolRound(adapter, { sessionId = "s1", messageId = "m1", callId = "call-1", tool, args }) {
  const out = adapter.handleCommand({
    type: "send_message", session_id: sessionId, message_id: messageId,
    text: "请参考作品材料回答", tool_call: { tool, args, call_id: callId },
  });
  const call = out.find((m) => m.type === "tool_call");
  assert.ok(call, "替身应发出 tool_call（驱动→宿主）");
  assert.equal(out.filter((m) => m.type === "message_done" || m.type === "message_failed").length, 0,
    "等待宿主 tool_result 期间轮次挂起，不产生终态");
  return { out, call };
}

// 扮演宿主回填工具结果。
function toolResult(adapter, call, payload) {
  return adapter.handleCommand({
    type: "tool_result", session_id: call.session_id, call_id: call.call_id, ...payload,
  });
}

// ── 2.1 最小 Agent Loop：直接回应文本流 + 回执 + 唯一终态（确定性替身）────────
test("2.1 直接回应：流式 delta + message_sent 回执 + 恰好一个终态（确定性替身）", () => {
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

  // provider 发送回执（对齐生产）：恰好一次，且先于终态。
  const sents = out.filter((m) => m.type === "message_sent");
  assert.equal(sents.length, 1, "message_sent 恰好一次");
  assert.ok(out.indexOf(sents[0]) < out.indexOf(terminals[0]), "回执必须先于终态");

  // 确定性：相同输入产生相同输出（无随机、无真实模型）
  const a2 = createDeterministicAdapter();
  start(a2);
  const out2 = a2.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "你好" });
  assert.deepEqual(out, out2);
});

// ── 3.3 授权读取：宿主执行回填，材料回到同一轮并继续生成 ─────────────────────
test("3.3 授权读取成功：tool_result 回填后材料回到同一轮并继续生成回应", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });

  // 宿主（harness）执行：受控只读桥接对 fixture 读正文。
  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  assert.equal(exec.ok, true, "fixture 读取应成功");

  const res = toolResult(a, call, { ok: true, result: { material: exec.material } });
  const sent = res.find((m) => m.type === "message_sent");
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "工具结果回填后同一轮继续生成");
  assert.match(done.text, /第一幕/, "回应引用了读取到的材料");
  assert.ok(sent && res.indexOf(sent) < res.indexOf(done), "回执先于终态");
});

// ── 3.2 用户拒绝读取：结构化拒绝回填，回应不把被拒材料当作已读 ────────────────
test("3.2 用户拒绝读取：tool_result 拒绝回填，回应不引用被拒材料", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });

  const res = toolResult(a, call, { ok: false, error: { reason: "user_rejected" } });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "拒绝后仍产生回应（有限回答）");
  assert.match(done.text, /user_rejected/, "回应说明拒绝原因");
  assert.ok(!done.text.includes("林悦"), "回应不得包含被拒材料正文");
  assert.ok(!done.text.includes("第一幕"), "回应不得引用被拒材料标题");
  assert.ok(!res.some((m) => m.material || m.documents), "拒绝回填不得携带材料内容");
});

// ── story-request-reading 授权请求工具：允许 / 拒绝两条路 ─────────────────────
test("story-request-reading：授权通过后继续回答", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, {
    tool: "story-request-reading",
    args: { workId: "work-wuzhen", reason: "需要参考第一幕的伏笔" },
  });
  assert.equal(call.tool, "story-request-reading");
  assert.equal(call.args.reason, "需要参考第一幕的伏笔");

  const res = toolResult(a, call, { ok: true, result: { granted: true } });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "授权通过后继续生成");
  assert.match(done.text, /授权/, "回应说明授权结果");
});

test("story-request-reading：授权被拒后转为有限回答", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, {
    tool: "story-request-reading",
    args: { workId: "work-wuzhen", reason: "需要参考第一幕的伏笔" },
  });
  const res = toolResult(a, call, { ok: true, result: { granted: false } });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "被拒后仍产生回应");
  assert.match(done.text, /未获得/, "回应明确转有限回答");
});

// ── 9.1（任务组 9）：授权关闭 / 熔断收束在替身侧的离线形态 ────────────────────
// 宿主侧语义（关闭立即阻止、reading_stopped 结构化拒绝）由 Rust 通道测试钉死；
// 替身侧验证的是：驱动把这些结构化拒绝作为工具结果回填后，模型继续同一轮并
// 基于已有材料收束（不崩溃、不重开调用、不把拒绝当系统故障）。

test("9.1 授权关闭后：后续补读调用被结构化拒绝，模型转有限回答", () => {
  const a = createDeterministicAdapter();
  start(a);
  // 先有一轮成功读取（授权尚在）。
  const first = toolRound(a, { messageId: "m1", callId: "call-1", tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });
  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  const res1 = toolResult(a, first.call, { ok: true, result: { material: exec.material } });
  assert.ok(res1.find((m) => m.type === "message_done"), "授权期读取成功");

  // 用户关闭授权后的下一轮补读：宿主回填 on_demand_reading_unauthorized。
  const second = toolRound(a, { messageId: "m2", callId: "call-2", tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });
  const res2 = toolResult(a, second.call, { ok: false, error: { reason: "on_demand_reading_unauthorized" } });
  const done = res2.find((m) => m.type === "message_done");
  assert.ok(done, "关闭后拒绝仍产生回应（不表现为系统故障）");
  assert.match(done.text, /on_demand_reading_unauthorized/, "回应引用结构化拒绝原因");
  assert.ok(!res2.some((m) => m.material || m.documents), "拒绝回填不得携带材料");
});

test("9.1 熔断触发后：补读调用收到 reading_stopped，模型基于已有材料收束", () => {
  const a = createDeterministicAdapter();
  start(a);
  // 首次读取成功（保险丝内），随后该轮保险丝触发：宿主回填 reading_stopped。
  const first = toolRound(a, { messageId: "m1", callId: "call-1", tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });
  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  const res1 = toolResult(a, first.call, { ok: true, result: { material: exec.material } });
  assert.ok(res1.find((m) => m.type === "message_done"), "保险丝内读取成功");

  const second = toolRound(a, { messageId: "m2", callId: "call-2", tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-01" } });
  const res2 = toolResult(a, second.call, { ok: false, error: { reason: "reading_stopped" } });
  const done = res2.find((m) => m.type === "message_done");
  assert.ok(done, "熔断拒绝后仍产生回应（模型收束，不悬挂轮次）");
  assert.match(done.text, /reading_stopped/, "回应引用补读已停止原因");
  assert.ok(!res2.some((m) => m.material || m.documents), "熔断拒绝不得携带材料");
});

// ── story-list：目录回填后继续生成 ───────────────────────────────────────────
test("story-list 成功：目录结果回到同一轮，回应引用数量", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { tool: "story-list", args: { workId: "work-wuzhen" } });

  const exec = listAllowedDocuments(STORY_FIXTURE, "work-wuzhen");
  assert.equal(exec.ok, true);
  assert.equal(exec.documents.length, 2, "允许可见文档应为 2 篇");

  const res = toolResult(a, call, { ok: true, result: { documents: exec.documents } });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "列出后同一轮继续生成");
  assert.match(done.text, /2 篇文档/, "回应应引用列出的文档数量");
  assert.ok(!done.text.includes("undefined"), "回应不得解引用缺失字段");
});

// ── story-search：检索片段回填后继续生成 ─────────────────────────────────────
test("story-search 成功：命中片段结果回到同一轮", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { tool: "story-search", args: { workId: "work-wuzhen", query: "画廊" } });

  const res = toolResult(a, call, {
    ok: true,
    result: { snippets: [{ documentId: "doc-01", excerpt: "…画廊…" }, { documentId: "doc-05-unsaved", excerpt: "…画廊…" }] },
  });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "检索后同一轮继续生成");
  assert.match(done.text, /2 处命中片段/, "回应应引用命中数量");
});

// ── 审批/结果按 session_id + call_id 键控，同 call_id 跨会话不碰撞 ─────────────
test("同一 call_id 跨会话不碰撞：各会话工具往返互不串扰", () => {
  const a = createDeterministicAdapter();
  start(a, "s1");
  start(a, "s2");

  const r1 = toolRound(a, { sessionId: "s1", messageId: "m1", callId: "call-1", tool: "story-read", args: { documentId: "doc-01" } });
  const r2 = toolRound(a, { sessionId: "s2", messageId: "m2", callId: "call-1", tool: "story-read", args: { documentId: "doc-01" } });

  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  const res1 = toolResult(a, r1.call, { ok: true, result: { material: exec.material } });
  assert.match(res1.find((m) => m.type === "message_done").text, /第一幕/, "s1 的 call-1 应回填成功");

  // s2 的 call-1 仍挂起，不被 s1 的结果消耗
  const res2 = toolResult(a, r2.call, { ok: true, result: { material: exec.material } });
  assert.ok(res2.some((m) => m.type === "message_done"), "s2 的 call-1 应独立回填成功");
});

test("跨会话不能误回填：错误 session_id 的 tool_result 不生效", () => {
  const a = createDeterministicAdapter();
  start(a, "s1");
  start(a, "s2");

  const { call } = toolRound(a, { sessionId: "s1", messageId: "m1", callId: "call-1", tool: "story-read", args: {} });

  const wrong = a.handleCommand({
    type: "tool_result", session_id: "s2", call_id: call.call_id, ok: true, result: { material: {} },
  });
  assert.ok(
    wrong.some((m) => m.type === "error" && m.code === "tool_call_not_found"),
    "跨会话回填应报 tool_call_not_found，不得误生效",
  );

  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-01" });
  const res = toolResult(a, call, { ok: true, result: { material: exec.material } });
  assert.ok(res.some((m) => m.type === "message_done"), "正确身份的回填仍应成功");
});

// ── 默认拒绝：越权/未知工具失败关闭 ───────────────────────────────────────────
test("越权工具计划（写入类）失败关闭，不发出 tool_call、不返回内容", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "send_message", session_id: "s1", message_id: "m1", text: "帮我改稿",
    tool_call: { tool: "fs.write", args: {} },
  });
  assert.ok(!out.some((m) => m.type === "tool_call"), "越权工具不得进入工具循环");
  const failed = out.find((m) => m.type === "message_failed");
  assert.ok(failed, "越权请求以失败关闭");
  assert.equal(failed.code, "tool_forbidden");
  assert.ok(!out.some((m) => m.material || m.documents), "不得返回材料");
});

test("未知工具名（含 dash 风格写入语义）失败关闭为 tool_unknown", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "send_message", session_id: "s1", message_id: "m1", text: "直接写",
    tool_call: { tool: "story-write", args: {} },
  });
  const failed = out.find((m) => m.type === "message_failed");
  assert.ok(failed, "未知工具必须失败关闭");
  assert.equal(failed.code, "tool_unknown");
});

test("旧点分工具名不再属于允许面（命名统一后默认拒绝）", () => {
  const a = createDeterministicAdapter();
  start(a);
  const out = a.handleCommand({
    type: "send_message", session_id: "s1", message_id: "m1", text: "旧名读稿",
    tool_call: { tool: "story.read_document", args: { documentId: "doc-01" } },
  });
  const failed = out.find((m) => m.type === "message_failed");
  assert.ok(failed, "旧点分工具名必须失败关闭");
  assert.equal(failed.code, "tool_unknown");
});

// ── 允许但不可见文档：宿主读取被拒后结构化回填，失败关闭 ─────────────────────
test("允许但不可见文档（隐藏）读取失败关闭，结构化拒绝且不暴露内容", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, {
    tool: "story-read", args: { workId: "work-wuzhen", documentId: "doc-02-hidden" },
  });

  // 宿主执行：bridge 对隐藏文档结构化拒绝。
  const exec = readMaterial(STORY_FIXTURE, { workId: "work-wuzhen", documentId: "doc-02-hidden" });
  assert.equal(exec.ok, false);
  assert.equal(exec.denial.reason, "document_not_visible");

  const res = toolResult(a, call, { ok: false, error: exec.denial });
  const done = res.find((m) => m.type === "message_done");
  assert.ok(done, "拒绝后仍产生回应");
  assert.match(done.text, /document_not_visible/, "回应引用结构化拒绝原因");
  assert.ok(!JSON.stringify(res).includes("这段隐藏笔记不应被 AI 读取。"), "不得暴露隐藏文档内容");
});

// ── 4.4 真实 DSH 事件字段不可观测时的明确降级 ────────────────────────────────
test("4.4 真实 DSH 事件字段不可观测时明确降级，不伪装成实机观测", () => {
  const a = createDeterministicAdapter();
  const obs = a.observe();
  assert.equal(obs.realDshEventFields.observable, false);
  assert.equal(obs.realDshEventFields.degraded, true);
  assert.equal(obs.modelLatency.available, false);
  assert.equal(obs.toolLoopSynthetic, true, "工具循环是合成演练，须明示");
});

// ── 4.4 崩溃重启：文本轮次可恢复，工具往返明确降级为不可恢复 ──────────────────
test("4.4 崩溃重启：文本轮次可恢复，工具往返明确不可恢复（降级路径）", () => {
  const a = createDeterministicAdapter();
  start(a);
  a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m1", text: "四乘以七等于多少？" });

  const recovery = a.exportRecovery("s1");
  assert.equal(recovery.ok, true);
  assert.ok(recovery.recoverable.turns.length >= 1, "文本轮次可恢复");
  assert.equal(recovery.toolMaterial.recoverable, false, "工具往返不跨重启持久化，属降级边界");

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

test("6.1 等待 tool_result 的轮次可被停止取消，迟到结果不生效", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { messageId: "m1", callId: "call-1", tool: "story-read", args: {} });

  const cancelled = a.handleCommand({ type: "cancel_message", session_id: "s1", message_id: "m1" });
  assert.equal(cancelled.find((m) => m.type === "message_failed")?.code, "cancelled", "挂起轮次可被取消");

  // 取消后迟到的 tool_result：拒绝，不重开调用、不产生第二个终态
  const late = toolResult(a, call, { ok: true, result: { material: { documentName: "迟到" } } });
  assert.ok(late.some((m) => m.type === "error" && m.code === "tool_call_not_found"), "迟到结果应被拒绝");
  assert.ok(!late.some((m) => m.type === "message_done" || m.type === "message_failed"), "迟到结果不得产生终态");

  assert.ok(a.handleCommand({ type: "send_message", session_id: "s1", message_id: "m2", text: "取消后追问" })
    .some((m) => m.type === "message_done"), "取消后追问仍可用");
});

test("6.1 迟到/未知工具结果身份不改变已结束请求", () => {
  const a = createDeterministicAdapter();
  start(a);
  const { call } = toolRound(a, { messageId: "m1", callId: "call-1", tool: "story-read", args: {} });
  toolResult(a, call, { ok: true, result: { material: { documentName: "第一幕" } } });
  // 已完成的调用再来一次结果 → 拒绝，不重新打开
  const late = toolResult(a, call, { ok: true, result: { material: { documentName: "again" } } });
  assert.ok(late.some((m) => m.type === "error"), "迟到结果应报错而非重开");
  // 未知调用身份
  const unknown = a.handleCommand({ type: "tool_result", session_id: "s1", call_id: "no-such", ok: true, result: {} });
  assert.ok(unknown.some((m) => m.type === "error"), "未知调用身份应报错");
});

// ── 任务 1.5：生产事件全集覆盖断言 + 替身不使用生产不认识的事件 ───────────────
test("任务 1.5：替身断言覆盖生产事件全集（含 message_sent 与工具桥接），且不发协议外事件", () => {
  const protocol = loadProtocol();

  // 生产事件全集（active outbound）显式钉一次；ready 是进程启动期事件，
  // 替身为进程内库、无 boot 阶段，由词表钉死而非行为发出。
  // 任务组 5 后 tool_call 已投产为 active（工具桥接）。
  assert.deepEqual(protocol.activeEvents, [
    "ready", "session_started", "delta", "message_sent",
    "message_done", "message_failed", "replay_ok", "session_ended", "error",
    "tool_call",
  ]);

  // 复合场景：收集替身可发出的全部事件类型。
  const a = createDeterministicAdapter();
  const seen = new Set();
  const run = (cmd) => { for (const m of a.handleCommand(cmd)) seen.add(m.type); };
  run({ type: "start_session", session_id: "s1" });                                  // session_started
  run({ type: "send_message", session_id: "s1", message_id: "m1", text: "第一问" });   // message_sent delta message_done
  run({ type: "send_message", session_id: "s1", message_id: "m2", text: "长任务", suspend: true });
  run({ type: "cancel_message", session_id: "s1", message_id: "m2" });                // message_failed
  const round = a.handleCommand({
    type: "send_message", session_id: "s1", message_id: "m3", text: "读稿",
    tool_call: { tool: "story-read", args: {}, call_id: "call-1" },
  });
  for (const m of round) seen.add(m.type);                                            // tool_call
  run({ type: "tool_result", session_id: "s1", call_id: "call-1", ok: true, result: { material: { documentName: "第一幕" } } });
  run({ type: "replay_history", session_id: "s1", turns: [{ role: "user", text: "历史" }] });
  run({ type: "replay_done", session_id: "s1" });                                     // replay_ok
  run({ type: "send_message", session_id: "no-such", message_id: "mx", text: "?" });  // error
  run({ type: "end_session", session_id: "s1" });                                     // session_ended

  // 全部发出类型都在协议词表内（替身 emit 时亦逐条断言，这里整集复核）。
  for (const type of seen) {
    assert.ok(protocol.knownEvents.has(type), `替身发出协议外事件：${type}`);
  }
  // 除 boot 期 ready 外，生产事件全集都被行为覆盖（tool_call 已是 active 事件）。
  const expected = new Set(protocol.activeEvents);
  expected.delete("ready");
  assert.deepEqual(seen, expected, "生产事件（除 ready）应全部被替身行为覆盖");
});

test("协议版本号来自单一真相源且为 1", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(loadProtocol().protocolVersion, 1);
});
