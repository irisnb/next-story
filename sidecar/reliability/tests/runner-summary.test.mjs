// runner-summary.test.mjs — 回归测试：runner 汇总阶段不得因 screenAnswer 的 { result, reasons }
// 形状与 runtimeError 分支的 { automatic, reasons } 形状混用而读到 undefined 崩溃（undefined.toLowerCase()）。
// 直接复现 bug：screenAnswer 返回 { result, reasons }，而汇总用 screen.automatic 取值。
import assert from "node:assert/strict";
import test from "node:test";

import { buildRunSummary, normalizeScreen } from "../runner.mjs";

test("normalizeScreen 把 screenAnswer 的 { result, reasons } 归一为 { automatic, reasons }", () => {
  assert.deepEqual(
    normalizeScreen({ result: "PASS_LIKELY", reasons: ["命中预期事实"] }),
    { automatic: "PASS_LIKELY", reasons: ["命中预期事实"] },
  );
});

test("normalizeScreen 对已归一形状原样返回", () => {
  const already = { automatic: "FAIL_LIKELY", reasons: ["错"] };
  assert.deepEqual(normalizeScreen(already), already);
});

test("buildRunSummary 对 screenAnswer 形状的结果正确计数且不崩溃", () => {
  const { counts, cases } = buildRunSummary([
    { case_id: "a", screen: { result: "PASS_LIKELY", reasons: ["命中"] }, evidence_file: "a.json" },
    { case_id: "b", screen: { result: "NEEDS_REVIEW", reasons: ["需复核"] }, evidence_file: "b.json" },
    { case_id: "c", screen: { result: "FAIL_LIKELY", reasons: ["错"] }, evidence_file: "c.json" },
  ]);

  assert.deepEqual(counts, { total: 3, pass_likely: 1, fail_likely: 1, needs_review: 1, runtime_error: 0 });
  assert.equal(cases.length, 3);
  assert.equal(cases[0].result, "PASS_LIKELY");
  assert.deepEqual(cases[1].reasons, ["需复核"]);
  assert.equal(cases[0].evidence_file, "a.json");
});

test("buildRunSummary 对 runtimeError 形状的 { automatic, reasons } 同样正确", () => {
  const { counts, cases } = buildRunSummary([
    { case_id: "r", screen: { automatic: "RUNTIME_ERROR", reasons: ["timeout: 超时"] }, evidence_file: "r.json" },
  ]);
  assert.equal(counts.runtime_error, 1);
  assert.equal(cases[0].result, "RUNTIME_ERROR");
});

test("buildRunSummary 对缺失结果的 screen 防御性不崩溃", () => {
  const { counts, cases } = buildRunSummary([
    { case_id: "x", screen: { reasons: [] }, evidence_file: null },
  ]);
  assert.equal(counts.total, 1);
  assert.equal(cases[0].result, null);
});
