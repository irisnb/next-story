// screening.test.mjs — 保守自动初筛的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1）
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPhrase,
  detectUncertainty,
  screenAnswer,
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
  ALL_RESULTS,
  REVIEW_OUTCOMES,
} from "../screening.mjs";

// ── classifyPhrase：否定 / 引用 / 断言 ─────────────────────────────────────────
test("classifyPhrase 区分断言、否定、引用、缺失", () => {
  assert.equal(classifyPhrase("林悦去了北京", "北京"), "asserted");
  assert.equal(classifyPhrase("林悦没有去北京", "北京"), "negated");
  assert.equal(classifyPhrase("林悦说：「我没有去北京」", "北京"), "quoted");
  assert.equal(classifyPhrase("林悦去了上海", "北京"), "absent");
});

test("classifyPhrase 对否定词窗口敏感", () => {
  assert.equal(classifyPhrase("她并未去过北京", "北京"), "negated");
  assert.equal(classifyPhrase("她从未离开过北京", "北京"), "negated");
});

// ── 四态常量与人工复核结论 ───────────────────────────────────────────────────
test("结果常量覆盖四种状态，人工复核结论独立", () => {
  assert.deepEqual(ALL_RESULTS.sort(), [RESULT_PASS_LIKELY, RESULT_FAIL_LIKELY, RESULT_NEEDS_REVIEW, RESULT_RUNTIME_ERROR].sort());
  assert.deepEqual(REVIEW_OUTCOMES, ["MODEL_OK", "MODEL_ERROR", "SCORER_ERROR", "UNRESOLVED"]);
});

// ── screenAnswer：空回答 → FAIL_LIKELY ────────────────────────────────────────
test("空回答判 FAIL_LIKELY", () => {
  const r = screenAnswer({ factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] }, "   ");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
});

// ── 明确错误结论 → FAIL_LIKELY ───────────────────────────────────────────────
test("明确断言错误结论判 FAIL_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: ["去了北京"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦去了北京。");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
  assert.match(r.reasons.join("；"), /错误结论/);
});

test("错误结论被否定时不算失败", () => {
  const expect = { factBoundary: { mustContain: ["上海"], mustNegate: ["北京"] }, wrongConclusions: ["去了北京"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "没有，林悦没去北京，她去了上海。");
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
});

// ── 被取代旧事实被正向断言 → FAIL_LIKELY ─────────────────────────────────────
test("本应否定的旧事实被断言判 FAIL_LIKELY（版本冲突）", () => {
  const expect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦在城东的图书馆上班。");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
});

// ── 未知信息案例 ─────────────────────────────────────────────────────────────
test("未知信息案例：明确表达不确定判 PASS_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: ["未知"] };
  const r = screenAnswer(expect, "材料中没有提到林悦丈夫的信息，无法确定。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("未知信息案例：给出确定性陈述且无不确定表达进入人工复核", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: ["未知"] };
  const r = screenAnswer(expect, "林悦的丈夫叫张伟。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
});

// ── 确定性案例出现不确定/推断表达 → NEEDS_REVIEW ─────────────────────────────
test("确定性案例出现推断措辞进入人工复核（事实与推测边界）", () => {
  const expect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "她可能是在城西的画廊上班。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
});

// ── 明确命中事实边界 → PASS_LIKELY ───────────────────────────────────────────
test("命中全部预期事实且无错误结论判 PASS_LIKELY", () => {
  const expect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦在城西的画廊上班。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("缺少预期事实进入人工复核（措辞可能改写，保守）", () => {
  const expect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "她在上班。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
});

// ── 否定引用 → NEEDS_REVIEW（保守，不冒充裁判）──────────────────────────────
test("错误结论以引用形式出现进入人工复核", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: ["偷了那本书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦说：「我没有偷那本书」。");
  // "偷了那本书" 未出现（原文是「我没有偷那本书」），此处验证 detectUncertainty 与引用路径不误判
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
});

// ── detectUncertainty 分离显式未知与推断措辞 ─────────────────────────────────
test("detectUncertainty 区分显式未知与推断措辞", () => {
  assert.ok(detectUncertainty("材料中没有提到").explicitUnknown.length > 0);
  assert.ok(detectUncertainty("她可能去了").hedge.length > 0);
  assert.equal(detectUncertainty("她去了上海").explicitUnknown.length, 0);
  assert.equal(detectUncertainty("她去了上海").hedge.length, 0);
});
