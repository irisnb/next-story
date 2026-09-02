// runner-pipeline.test.mjs — runCase 协议编排 + 证据构建 + 脱敏的离线集成测试（任务 2.2/3.2/3.3）
// 用假 client 模拟 driver.mjs 的 JSONL 协议，不启动真实 DSH、无需 API key。
import assert from "node:assert/strict";
import test from "node:test";

import { runCase } from "../driver-client.mjs";
import { screenAnswer } from "../screening.mjs";
import { buildEvidenceRecord, apiBaseLabel } from "../evidence.mjs";
import { secretsFromEnv, redactObject, assertNoSecrets } from "../redact.mjs";
import { materialHash, validateCase } from "../schema.mjs";

const KEY = "sk-e4b4b0123456789abcdef0123456789";

/**
 * 假 driver client：send 同步把应答事件推进 inbox，waitFor / waitMessageDone 按游标消费。
 * answerFor(text) 决定每轮 send_message 的 canned 回答；failMessage 为真时改为返回 message_failed。
 */
function fakeClient({ answerFor, failMessage = false }) {
  const inbox = [];
  let cursor = 0;
  const client = {
    sent: [],
    inbox,
    send(msg) {
      client.sent.push(msg);
      switch (msg.type) {
        case "start_session":
          inbox.push({ type: "session_started", session_id: msg.session_id });
          break;
        case "replay_done":
          inbox.push({ type: "replay_ok", session_id: msg.session_id });
          break;
        case "send_message":
          if (failMessage) {
            inbox.push({ type: "message_failed", session_id: msg.session_id, message_id: msg.message_id, code: "cancelled", message: "生成已被取消" });
          } else {
            inbox.push({ type: "delta", session_id: msg.session_id, message_id: msg.message_id, seq: 0, text: "一" });
            inbox.push({ type: "delta", session_id: msg.session_id, message_id: msg.message_id, seq: 1, text: "二" });
            inbox.push({ type: "message_done", session_id: msg.session_id, message_id: msg.message_id, text: answerFor(msg.text) });
          }
          break;
        case "end_session":
          inbox.push({ type: "session_ended", session_id: msg.session_id });
          break;
      }
    },
    async waitFor(predicate) {
      for (; cursor < inbox.length; cursor++) {
        if (predicate(inbox[cursor])) { cursor++; return inbox[cursor - 1]; }
      }
      throw new Error("fake client：无匹配事件");
    },
    async waitMessageDone(sessionId, messageId) {
      const deltas = [];
      const terminal = await this.waitFor((e) => {
        if (e.type === "delta" && e.session_id === sessionId && e.message_id === messageId) deltas.push(e.text);
        if (e.type === "error" && (e.session_id === sessionId || e.message_id === messageId)) return true;
        return (e.type === "message_done" || e.type === "message_failed")
          && e.session_id === sessionId && e.message_id === messageId;
      });
      return { terminal, deltas, folded: deltas.join("") };
    },
  };
  return client;
}

function caseDef(overrides = {}) {
  const c = {
    id: "version-conflict-v2",
    material: { name: "林悦的工作", version: "2", hash: materialHash("她在城西的画廊上班。"), text: "她在城西的画廊上班。" },
    question: "林悦在哪里工作？",
    expect: {
      factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] },
      wrongConclusions: ["城东的图书馆"],
      allowedUncertainty: [],
      evidenceLocations: ["第一句"],
      riskTags: ["version-conflict"],
    },
  };
  return { ...c, ...overrides };
}

test("runCase 注入材料种子并按序发送问题，记录完整回答", async () => {
  const client = fakeClient({ answerFor: () => "林悦在城西的画廊上班。" });
  const run = await runCase(client, caseDef(), 1000);

  const types = client.sent.map((m) => m.type);
  assert.deepEqual(types, ["start_session", "replay_history", "replay_done", "send_message", "end_session"]);

  const replay = client.sent.find((m) => m.type === "replay_history");
  assert.ok(replay.turns[0].text.includes("她在城西的画廊上班。"), "材料正文应经 replay 种子注入");
  assert.equal(replay.turns[0].role, "user");
  assert.equal(replay.turns[1].role, "assistant");

  const sendMsg = client.sent.find((m) => m.type === "send_message");
  assert.equal(sendMsg.text, "林悦在哪里工作？");

  assert.equal(run.protocol.outcome, "completed");
  assert.equal(run.protocol.delta_count, 2);
  assert.equal(run.response.text, "林悦在城西的画廊上班。");
  assert.equal(run.response.steps.length, 1);
  assert.equal(run.response.steps[0].message_id, "version-conflict-v2-m0");
  assert.equal(run.runtimeError, null);
});

test("runCase 支持多轮步骤并逐轮关联回答", async () => {
  const client = fakeClient({ answerFor: (t) => (t.includes("补充") ? "好的，已记录。" : "现在她在城西的画廊上班。") });
  const c = caseDef();
  c.steps = [{ text: "补充：她现在换工作了。" }];
  const run = await runCase(client, c, 1000);

  const sends = client.sent.filter((m) => m.type === "send_message");
  assert.equal(sends.length, 2, "应发送 1 个前置步骤 + 1 个最终问题");
  assert.equal(run.response.steps.length, 2);
  assert.equal(run.response.steps[0].response_text, "好的，已记录。");
  assert.equal(run.response.text, "现在她在城西的画廊上班。");
});

test("message_failed 记入运行错误并区分于模型回答失败", async () => {
  const failing = fakeClient({ answerFor: () => "x", failMessage: true });
  const run = await runCase(failing, caseDef(), 1000);
  assert.equal(run.protocol.outcome, "message_failed");
  assert.equal(run.runtimeError.category, "message_failed");
  assert.equal(run.response.text, "");
});

test("证据构建 + 脱敏：完整回答落证据且无密钥", async () => {
  const client = fakeClient({ answerFor: () => `回答末尾疑似密钥 ${KEY}` });
  const run = await runCase(client, caseDef(), 1000);
  const screen = screenAnswer(caseDef().expect, run.response.text);

  const evidence = buildEvidenceRecord({
    runId: "run-1",
    caseId: caseDef().id,
    material: caseDef().material,
    model: "deepseek-v4-flash",
    apiBaseLabel: apiBaseLabel("https://z30.top/v1/chat"),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    steps: run.response.steps,
    question: caseDef().question,
    response: run.response,
    protocol: run.protocol,
    result: screen,
    runtimeError: run.runtimeError,
  });

  const secrets = secretsFromEnv(KEY);
  const redacted = redactObject(evidence, secrets);
  const serialized = JSON.stringify(redacted, null, 2);
  const leakCheck = assertNoSecrets(serialized, secrets);

  assert.equal(leakCheck.ok, true, "证据序列化后不得含密钥");
  assert.equal(serialized.includes(KEY), false);
  assert.equal(redacted.response.text.includes("[REDACTED]"), true, "回答中的密钥应被脱敏");
  assert.equal(evidence.configuration.api_base, "https://z30.top", "api base 只保留主机");
});
