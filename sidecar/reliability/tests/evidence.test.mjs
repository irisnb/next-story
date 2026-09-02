// evidence.test.mjs — 证据记录构造的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1）
import assert from "node:assert/strict";
import test from "node:test";

import {
  TESTER_VERSION,
  EVIDENCE_SCHEMA_VERSION,
  apiBaseLabel,
  buildEvidenceRecord,
  evidenceOutputPath,
} from "../evidence.mjs";
import { materialHash } from "../schema.mjs";
import { RESULT_NEEDS_REVIEW } from "../screening.mjs";

test("buildEvidenceRecord 包含规格要求的全部字段", () => {
  const rec = buildEvidenceRecord({
    runId: "run-1",
    caseId: "case-1",
    material: { name: "材料", version: "1", hash: materialHash("正文") },
    model: "deepseek-v4-flash",
    apiBaseLabel: "https://api.example.com",
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:05.000Z",
    durationMs: 5000,
    steps: [{ index: 0, text: "问题？", terminal: "message_done" }],
    question: "问题？",
    response: { text: "回答", steps: [] },
    protocol: { outcome: "completed", terminal_state: "message_done" },
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: ["需人工复核"] },
    runtimeError: null,
  });

  assert.equal(rec.schema_version, EVIDENCE_SCHEMA_VERSION);
  assert.equal(rec.tester_version, TESTER_VERSION);
  assert.equal(rec.run_id, "run-1");
  assert.equal(rec.case_id, "case-1");
  assert.deepEqual(rec.material, { name: "材料", version: "1", hash: materialHash("正文") });
  assert.equal(rec.configuration.model, "deepseek-v4-flash");
  assert.equal(rec.configuration.api_base, "https://api.example.com");
  assert.equal(rec.response.text, "回答");
  assert.equal(rec.result.automatic, RESULT_NEEDS_REVIEW);
  assert.equal(rec.result.human_review, null);
  assert.equal(rec.runtime_error, null);
});

test("运行失败证据区分于模型回答失败", () => {
  const rec = buildEvidenceRecord({
    runId: "run-1",
    caseId: "case-1",
    material: { name: "材料", version: "1", hash: materialHash("正文") },
    model: "m",
    apiBaseLabel: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    steps: [],
    question: "问题？",
    response: { text: "", steps: [] },
    protocol: { outcome: "timeout", terminal_state: null },
    result: { automatic: "RUNTIME_ERROR", reasons: ["timeout: 超时"] },
    runtimeError: { category: "timeout", message: "超时" },
  });
  assert.equal(rec.runtime_error.category, "timeout");
  assert.equal(rec.response.text, "");
});

test("apiBaseLabel 只保留协议与主机，去掉路径与凭证", () => {
  assert.equal(apiBaseLabel("https://z30.top/v1/chat"), "https://z30.top");
  assert.equal(apiBaseLabel("https://api.deepseek.com"), "https://api.deepseek.com");
  assert.equal(apiBaseLabel(null), null);
  assert.equal(apiBaseLabel("not-a-url"), "not-a-url");
});

test("evidenceOutputPath 确定性命名", () => {
  assert.deepEqual(evidenceOutputPath("out", "run-1", "case-1"), {
    dir: "out/run-1/cases",
    file: "case-1.json",
  });
});
