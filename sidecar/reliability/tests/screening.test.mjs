// screening.test.mjs — 保守自动初筛的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1；
//   fix-reliability-scorer-mislabels 任务 1/2：间隙命中＋等价否定）
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyPhrase,
  classifyPhraseOccurrences,
  detectUncertainty,
  screenAnswer,
  gapMatchOccurrence,
  isEntryNegationSatisfied,
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
test("确定性案例：mustContain 未命中且含推断措辞进入人工复核（事实与推测边界）", () => {
  const expect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "她可能是在某个画廊上班。");
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

// ── 脱离/停止旧状态的语义否定词（fix-screener-false-failures 根因 A）────────────
test("「辞去了盐镇中学的工作」中的盐镇中学判定为否定", () => {
  assert.deepEqual(classifyPhraseOccurrences("她辞去了盐镇中学的工作。", "盐镇中学"), ["negated"]);
});

test("「离开了盐城」「放弃了教师岗位」识别为语义否定", () => {
  assert.equal(classifyPhrase("林蔓离开了盐城。", "盐城"), "negated");
  assert.equal(classifyPhrase("她放弃了教师岗位。", "教师"), "negated");
  assert.equal(classifyPhrase("林晚不再教书了。", "教书"), "negated");
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

// ── fix-screener-false-failures 回归：语义否定 + 裸词改命题 ──────────────────
test("版本冲突：mustNegate 写完整命题后，正确回答不再误判 FAIL", () => {
  // 旧数据 mustNegate:["盐镇中学"] 会被「辞去了盐镇中学的工作」误判为断言；
  // 改为完整命题「在盐镇中学教书」后，正确回答命中「出版社」判 PASS。
  const expect = { factBoundary: { mustContain: ["出版社"], mustNegate: ["在盐镇中学教书"] }, wrongConclusions: ["还在盐镇中学教书"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林晚已经不在盐镇中学教书了，她辞去了盐镇中学的工作，去了城西的出版社做美术编辑。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("断言了本应否定的旧事实")));
});

test("相似实体：mustNegate 写完整命题后，提及另一主体的盐城不再误判 FAIL", () => {
  // 旧数据 mustNegate:["盐城"] 会被「林蔓搬去了盐城」误判为断言；
  // 改为完整命题「住在盐城」后，正确回答只提「林蔓搬去盐城」不命中命题。
  const expect = { factBoundary: { mustContain: ["盐镇"], mustNegate: ["住在盐城"] }, wrongConclusions: ["住在盐城"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "不是。林晚住在盐镇。她的远房表妹林蔓三年前搬去了盐城，在城里开茶馆。");
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("断言了本应否定的旧事实")));
});

test("传承链：wrongConclusions 写完整命题后，追述传承链不再误判 FAIL", () => {
  // 旧数据 wrongConclusions:["母亲"] 会被「外婆留给母亲，母亲又留给她」误判；
  // 改为完整命题「母亲留给她的」后，正确回答不命中该命题。
  const expect = { factBoundary: { mustContain: ["外婆"], mustNegate: [] }, wrongConclusions: ["母亲留给她的", "沈砚留给她的"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "林晚的怀表是外婆留给她的。怀表是外婆留给母亲的，母亲又留给了她。");
  assert.notEqual(r.result, RESULT_FAIL_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("断言了明确错误结论")));
});

// ── fix-screener-residual-defects 回归（D1 markdown 剥离）───────────────────
test("markdown 打断的否定短语仍被识别（评分前剥离 markdown）", () => {
  const expect = { factBoundary: { mustContain: ["摄影工作室"], mustNegate: ["在印刷厂工作"] }, wrongConclusions: ["还在印刷厂"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "陆遥现在**不在**印刷厂工作，他去了摄影工作室。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("真实证据：加粗否定 + 引用原文命中 mustContain 判 PASS（案例 30k-11）", () => {
  const expect = { factBoundary: { mustContain: ["摄影工作室"], mustNegate: ["在印刷厂工作"] }, wrongConclusions: ["还在印刷厂"], allowedUncertainty: [] };
  const answer = "根据材料内容，陆遥现在**不在**印刷厂工作。\n\n依据是第五章《换工作》中明确写道：\n\n> “陆遥原本在城北的印刷厂做排版，后来辞职去了云峰山下的摄影工作室。”";
  const r = screenAnswer(expect, answer);
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("未明确命中") || x.includes("未明确否定")));
});

// ── fix-screener-residual-defects 回归（D2 mustContain 引文命中）──────────────
test("引用的正确事实命中 mustContain（引用不算断言但仍算命中）", () => {
  const expect = { factBoundary: { mustContain: ["城西的文化馆"], mustNegate: [] }, wrongConclusions: ["在城东的画廊举办"], allowedUncertainty: [] };
  const r = screenAnswer(expect, "材料明确写道：“摄影展最后办在城西的文化馆”，策展人是陈屿。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

// ── fix-screener-residual-defects 回归（D3 不确定同义）───────────────────────
test("detectUncertainty 识别扩充的同义未知表达", () => {
  for (const w of ["无法得知", "没有提供", "文中没有", "没有出现", "未提供", "不存在"]) {
    assert.ok(detectUncertainty(w).explicitUnknown.length > 0, `应识别「${w}」`);
  }
});

test("未知信息案例：同义表达「无法得知」判 PASS_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: ["未知"] };
  const r = screenAnswer(expect, "材料没有提供相关线索，无法得知她的年龄。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

// ── fix-reliability-scorer-mislabels 回归（未知同义「没有提及」，源自 lc-30k-pass2/lc-30k-13 实证）──
test("未知信息案例：同义表达「没有提及」判 PASS_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: ["未知"] };
  const r = screenAnswer(expect, "根据材料，没有提及陆遥的妻子叫什么名字。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

// ── fix-screener-residual-defects 回归（D4 推断措辞不阻断）───────────────────
test("明确结论含「可推断」不再阻断（事实边界已命中）", () => {
  const expect = { factBoundary: { mustContain: ["陆芸是陆远的母亲"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "可推断陆芸是陆远的母亲。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

// ── fix-reliability-scorer-mislabels 回归（D1：mustContain 有界间隙命中）──────────
test("gapMatchOccurrence 正例：修饰语插入可命中（「陈渡是北境的一名邮差」命中「陈渡是邮差」）", () => {
  const m = gapMatchOccurrence("陈渡是北境的一名邮差，负责鹿角镇到望山集之间的邮路", "陈渡是邮差");
  assert.ok(m, "应命中");
  assert.deepEqual(m.segments.map((s) => s.start), [0, 8]); // 「陈渡是」+「邮差」，间隙「北境的一名」5 字符
  assert.equal(m.quoted, false);
});

test("gapMatchOccurrence 反例1：间隙跨子句边界不命中", () => {
  assert.equal(gapMatchOccurrence("陈渡是渔民；邮差老王常来送信", "陈渡是邮差"), null);
});

test("gapMatchOccurrence 反例2：间隙含过去标记不命中（前邮差 / 曾是邮差）", () => {
  assert.equal(gapMatchOccurrence("陈渡是一位前邮差", "陈渡是邮差"), null);
  assert.equal(gapMatchOccurrence("陈渡曾是邮差", "陈渡是邮差"), null);
});

test("gapMatchOccurrence 反例3：间隙超限（>8 字符）不命中", () => {
  // 间隙「北方结了冰的一大片原野上」共 12 字符，无边界无标记，仅因超限被拒
  assert.equal(gapMatchOccurrence("陈渡是北方结了冰的一大片原野上邮差", "陈渡是邮差"), null);
});

test("gapMatchOccurrence 反例4：首段否定前窗不满足即不命中", () => {
  assert.equal(gapMatchOccurrence("不是陈渡是邮差", "陈渡是邮差"), null);
  assert.equal(gapMatchOccurrence("她否认了「陈渡是外来的邮差」", "陈渡是邮差"), null);
});

test("gapMatchOccurrence：短于 4 字符的短语不做间隙匹配（只允许连续）", () => {
  assert.equal(gapMatchOccurrence("盐镇与盐城", "盐城"), null);
});

test("mustContain 修饰语插入命中，screenAnswer 不再误报 NEEDS_REVIEW（实锤 lc-50k-04 原文）", () => {
  const expect = { factBoundary: { mustContain: ["陈渡是邮差"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "根据材料，陈渡是北境的一名邮差，负责鹿角镇到望山集之间的邮路。此前他原本在城西的邮局做分拣，后来主动申请调去了偏远的鹿角镇邮路。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("wrongConclusions 保持连续匹配：修饰语插入的错误结论不触发 FAIL_LIKELY", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: ["林悦去了北京"], allowedUncertainty: [] };
  // 「林悦非常突然地去了北京」若走间隙匹配会判 asserted → FAIL；应保持连续匹配 → 不 FAIL
  const r = screenAnswer(expect, "林悦非常突然地去了北京。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

test("mustNegate 保持连续匹配：修饰语插入的旧事实不触发 FAIL_LIKELY、也不算被否定", () => {
  const expect = { factBoundary: { mustContain: [], mustNegate: ["林悦去了北京"] }, wrongConclusions: [], allowedUncertainty: [] };
  // 若 mustNegate 走间隙匹配，"林悦非常突然地去了北京" 会被当 asserted → FAIL；应保持连续匹配 → NEEDS_REVIEW
  const r = screenAnswer(expect, "林悦非常突然地去了北京。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
});

// ── fix-reliability-scorer-mislabels 回归（D2：mustNegate 等价否定形式）──────────
test("声明的等价否定短语满足 mustNegate（实锤 lc-10k-08 原文）", () => {
  const expect = {
    factBoundary: {
      mustContain: ["出版社"],
      mustNegate: ["苏晚在盐镇中学教书"],
      negationEquivalents: { "苏晚在盐镇中学教书": ["辞去了盐镇中学的工作"] },
    },
    wrongConclusions: [],
    allowedUncertainty: [],
  };
  const r = screenAnswer(expect, "不在。根据材料第六章，苏晚已经辞去了盐镇中学的工作，去了城西的出版社做美术编辑。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("未明确否定")));
});

test("原短语肯定断言压倒等价否定：同时含等价否定与未引用肯定断言时不满足", () => {
  const expect = {
    factBoundary: {
      mustContain: ["出版社"],
      mustNegate: ["苏晚在盐镇中学教书"],
      negationEquivalents: { "苏晚在盐镇中学教书": ["辞去了盐镇中学的工作"] },
    },
    wrongConclusions: [],
    allowedUncertainty: [],
  };
  const r = screenAnswer(expect, "苏晚在盐镇中学教书。后来她辞去了盐镇中学的工作，去了城西的出版社。");
  assert.equal(r.result, RESULT_FAIL_LIKELY);
  assert.match(r.reasons.join("；"), /断言了本应否定的旧事实/);
});

test("无 negationEquivalents 声明时行为与现状一致（转述否定仍落 NEEDS_REVIEW）", () => {
  const expect = { factBoundary: { mustContain: ["出版社"], mustNegate: ["苏晚在盐镇中学教书"] }, wrongConclusions: [], allowedUncertainty: [] };
  const r = screenAnswer(expect, "不在。根据材料第六章，苏晚已经辞去了盐镇中学的工作，去了城西的出版社做美术编辑。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
  assert.match(r.reasons.join("；"), /未明确否定旧事实/);
});

test("自带否定语义的等价短语被直接否定时不算满足（「没有辞去」＝肯定旧状态）", () => {
  const expect = {
    factBoundary: {
      mustContain: ["出版社"],
      mustNegate: ["苏晚在盐镇中学教书"],
      negationEquivalents: { "苏晚在盐镇中学教书": ["辞去了盐镇中学的工作"] },
    },
    wrongConclusions: [],
    allowedUncertainty: [],
  };
  const r = screenAnswer(expect, "苏晚没有辞去盐镇中学的工作。");
  assert.equal(r.result, RESULT_NEEDS_REVIEW);
  assert.match(r.reasons.join("；"), /未明确否定旧事实/);
});

test("纯转述等价短语须前窗口含否定/离开动词才满足（isEntryNegationSatisfied）", () => {
  const eq = { 林悦的家: ["城西的老宅"] };
  assert.equal(isEntryNegationSatisfied("林悦早已离开城西的老宅，搬去了海边。", "林悦的家", eq), true);
  assert.equal(isEntryNegationSatisfied("林悦翻新了城西的老宅。", "林悦的家", eq), false);
});

test("等价短语以引用形式出现（自带离开动词、引用内无否定）也满足（lc-10k-08 pass1 句式）", () => {
  const expect = {
    factBoundary: {
      mustContain: ["出版社"],
      mustNegate: ["苏晚在盐镇中学教书"],
      negationEquivalents: { "苏晚在盐镇中学教书": ["辞去了盐镇中学的工作"] },
    },
    wrongConclusions: [],
    allowedUncertainty: [],
  };
  const r = screenAnswer(expect, "根据材料，苏晚已经不在盐镇中学教书了。\n\n依据是第六章中明确写道：“苏晚辞去了盐镇中学的工作，去了城西的出版社做美术编辑”。");
  assert.equal(r.result, RESULT_PASS_LIKELY);
});

// ── 任务 2.3 冒烟：实锤证据原文＋当前 oracle 跑 screenAnswer（lc-50k-04 无需 oracle 改动）──
test("冒烟：lc-50k-04 证据原文＋tier-50k oracle 重评为 PASS_LIKELY", (t) => {
  const rel = fileURLToPath(new URL("..", import.meta.url));
  const caseFile = join(rel, "evidence", "lc-50k-pass2", "cases", "lc-50k-04.json");
  const oracleFile = join(rel, "long-context", "oracle", "tier-50k.json");
  if (!existsSync(caseFile) || !existsSync(oracleFile)) return t.skip("缺证据或 oracle 文件，跳过冒烟");
  const record = JSON.parse(readFileSync(caseFile, "utf8"));
  const oracle = JSON.parse(readFileSync(oracleFile, "utf8"));
  const q = oracle.queries.find((x) => x.id === "lc-50k-04");
  const r = screenAnswer(q.expect, record.response.text);
  assert.equal(r.result, RESULT_PASS_LIKELY);
  assert.ok(!r.reasons.some((x) => x.includes("未明确命中")));
});
