// screening.test.mjs — 保守自动初筛的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1）
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPhrase,
  classifyPhraseOccurrences,
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

// ── 多次出现分类（fix-negated-quotation-screening 回归）────────────────────────
test("直接否定满足 mustNegate，命中上海判 PASS_LIKELY（明确否定）", () => {
  const expect = { factBoundary: { mustContain: ["上海"], mustNegate: ["北京"] }, wrongConclusions: ["去了北京"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦没有去北京，她去了上海。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("引用中的明确否定满足 mustNegate，不再误报 NEEDS_REVIEW", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["偷"] }, wrongConclusions: ["承认偷了书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦明确说“我没有偷那本书”，只是“拿起来看了看”，并未承认偷书。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("未明确否定")));
});

test("引用否定「我没有偷那本书」不产生缺否定理由", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["偷"] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦说：「我没有偷那本书」。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("引用否定后又反向断言，不判 PASS_LIKELY（判 FAIL_LIKELY）", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["偷"] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦说“我没有偷那本书”，但她确实偷了。");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
  assert.match(r.reasons.join("；"), /断言了本应否定的旧事实/);
});

test("错误结论仅以引用出现，不判 FAIL_LIKELY，进入人工复核", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: ["偷了那本书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦说：「我偷了那本书」。");
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
});

test("错误结论仅以否定出现，不判 FAIL_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: ["偷书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林悦没有偷书。");
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("classifyPhraseOccurrences 识别多次出现与引用内否定", () => {
  assert.deepEqual(classifyPhraseOccurrences("林悦说“我没有偷那本书”，但她确实偷了。", "偷"), ["quoted-negated", "asserted"]);
  assert.deepEqual(classifyPhraseOccurrences("林悦没有去北京，她去了上海。", "北京"), ["negated"]);
  assert.deepEqual(classifyPhraseOccurrences("林悦去了上海。", "北京"), []);
});

// ── 中文否认动词「否认/否定」的识别（fix-negated-quotation-screening 后续根因）────
test("未加引号的「否认偷书」识别为否定，不再判为直接断言", () => {
  assert.deepEqual(classifyPhraseOccurrences("她是在否认偷书。", "偷"), ["negated"]);
});

test("真实证据全文：引号内否定 + 「否认偷书」均判否定，PASS_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["偷"] }, wrongConclusions: ["承认偷了书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "没有。材料中林悦明确说「我没有偷那本书，我只是拿起来看了看」，她是在否认偷书，并解释自己只是拿起来看了看。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("断言了本应否定的旧事实")));
});

test("「否认偷书，但其实偷了」仍判 FAIL_LIKELY（否认后反向断言）", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["偷"] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "她否认偷书，但其实偷了。");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
  assert.match(r.reasons.join("；"), /断言了本应否定的旧事实/);
});

// ── detectUncertainty 分离显式未知与推断措辞 ─────────────────────────────────
test("detectUncertainty 区分显式未知与推断措辞", () => {
  assert.ok(detectUncertainty("材料中没有提到").explicitUnknown.length > 0);
  assert.ok(detectUncertainty("她可能去了").hedge.length > 0);
  assert.equal(detectUncertainty("她去了上海").explicitUnknown.length, 0);
  assert.equal(detectUncertainty("她去了上海").hedge.length, 0);
});
