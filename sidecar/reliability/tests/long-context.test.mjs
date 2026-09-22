// long-context.test.mjs — 长上下文夹具的离线测试（change: add-long-context-hallucination-fixtures 任务 3.2；
//   fix-reliability-scorer-mislabels 任务 3.3：时态助词检查＋negationEquivalents 结构校验）
// 不启动 DSH、无需 API key、不发网络请求。
import assert from "node:assert/strict";
import test from "node:test";

import { materialHash, countChars, estimateTokens, mulberry32, generateTier } from "../long-context/generator.mjs";
import {
  validateAll,
  validateTier,
  isBoundaryBadPhrase,
  findNegationEquivalentsProblems,
  TENSE_AUXILIARIES,
  loadFromDisk,
} from "../long-context/validate.mjs";
import { buildTierCases } from "../long-context/build-cases.mjs";
import { loadAndValidate } from "../schema.mjs";

test("materialHash 返回 sha256:<64 位十六进制>", () => {
  const h = materialHash("雾城长河");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h, materialHash("雾城长河"));
  assert.notEqual(h, materialHash("回声旅馆"));
});

test("countChars 按码点计中文", () => {
  assert.equal(countChars("苏晚出生在盐镇"), 7);
  assert.equal(countChars("abc"), 3);
});

test("estimateTokens = 字数 × 每字比例", () => {
  assert.equal(estimateTokens(10000, 0.75), 7500);
  assert.ok(estimateTokens(10086, 0.75) > 0);
});

test("mulberry32 确定性：同种子同序列", () => {
  const a = mulberry32(20260903);
  const b = mulberry32(20260903);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
  const c = mulberry32(20260904);
  const d = mulberry32(20260903);
  let differ = false;
  for (let i = 0; i < 100; i++) if (c() !== d()) differ = true;
  assert.ok(differ, "不同种子应产生不同序列");
});

test("generateTier 确定性：两次调用产出相同材料哈希与裁判", () => {
  const manifest = loadFromDisk().manifest;
  for (const t of manifest.tiers) {
    const r1 = generateTier(t.tier, manifest);
    const r2 = generateTier(t.tier, manifest);
    assert.equal(r1.material.hash, r2.material.hash, `${t.tier} 材料哈希应稳定`);
    assert.deepEqual(r1.oracle, r2.oracle, `${t.tier} 裁判应稳定`);
  }
});

test("不同档位产出不同材料", () => {
  const manifest = loadFromDisk().manifest;
  const hashes = new Set(manifest.tiers.map((t) => generateTier(t.tier, manifest).material.hash));
  assert.equal(hashes.size, manifest.tiers.length);
});

test("磁盘夹具全部通过校验（0 项失败）", () => {
  const { manifest, materials, oracles } = loadFromDisk();
  const report = validateAll(manifest, materials, oracles);
  assert.equal(report.ok, true, "全部校验项应通过");
  const failed = report.tiers.flatMap((t) => t.checks.filter((c) => !c.ok));
  assert.deepEqual(failed, [], "不应有失败校验项");
});

test("每档查询数达标且七类风险全覆盖", () => {
  const { manifest, oracles } = loadFromDisk();
  for (const t of manifest.tiers) {
    const queries = oracles[t.tier].queries;
    assert.equal(queries.length, manifest.query_counts[t.tier], `${t.tier} 查询数`);
    const cats = new Set(queries.map((q) => q.category));
    for (const c of manifest.risk_categories) {
      assert.ok(cats.has(c), `${t.tier} 缺少风险类别 ${c}`);
    }
  }
});

test("每档 trial_count=3 且 trial id 稳定唯一", () => {
  const { manifest, oracles } = loadFromDisk();
  for (const t of manifest.tiers) {
    const ids = new Set();
    for (const q of oracles[t.tier].queries) {
      assert.equal(q.trial_count, manifest.trial_count, `${q.id} trial_count`);
      assert.equal(q.trial_ids.length, manifest.trial_count, `${q.id} trial id 数量`);
      for (const tid of q.trial_ids) {
        assert.equal(typeof tid, "string");
        assert.ok(!ids.has(tid), `trial id 重复：${tid}`);
        ids.add(tid);
      }
    }
  }
});

test("正文（重放材料）不含密钥、裁判标签或查询问题", () => {
  const { materials, oracles } = loadFromDisk();
  for (const [tier, material] of Object.entries(materials)) {
    assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(material.text), `${tier} 正文不应含密钥`);
    for (const q of oracles[tier].queries) {
      assert.ok(!material.text.includes(q.question), `${tier}/${q.id} 问题不应出现在正文`);
    }
  }
});

test("每个锚点语句逐字出现在正文中", () => {
  const { materials, oracles } = loadFromDisk();
  for (const [tier, material] of Object.entries(materials)) {
    for (const a of oracles[tier].anchors) {
      assert.ok(material.text.includes(a.statement), `${tier}/${a.id} 锚点未命中`);
    }
  }
});

test("组装出的案例通过现有 schema 校验（可被 runner 运行）", () => {
  const { materials, oracles } = loadFromDisk();
  for (const [tier, material] of Object.entries(materials)) {
    const cases = buildTierCases(material, oracles[tier]);
    const source = cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
    const r = loadAndValidate(source);
    assert.equal(r.parseError, null, `${tier} 解析失败：${r.parseError}`);
    assert.equal(r.invalid.length, 0, `${tier} 校验失败：${r.invalid.map((i) => i.errors.join("；")).join(" / ")}`);
    assert.equal(r.valid.length, cases.length, `${tier} 案例数应全部合法`);
  }
});

test("手写档标记 handwritten 且 seed 为 null，正文来自手写 txt", () => {
  const { manifest, materials } = loadFromDisk();
  const cfg = manifest.tiers.find((t) => t.tier === "coherent-10k");
  assert.ok(cfg, "manifest 应包含 coherent-10k 档");
  assert.equal(cfg.handwritten, true, "coherent-10k 应标记为手写档");
  assert.equal(cfg.seed, null, "coherent-10k seed 应为 null（非种子生成）");
  assert.equal(materials["coherent-10k"].seed, null, "手写档材料 seed 应为 null");
  assert.ok(materials["coherent-10k"].char_count >= 9500 && materials["coherent-10k"].char_count <= 10500, "手写档字数应在 1 万字容差内");
});

test("validateTier 拒绝 mustNegate/wrongConclusions 中的裸亲属称谓、裸职业词与缺主语谓词", () => {
  const { manifest, materials, oracles } = loadFromDisk();
  const tierKey = manifest.tiers[0].tier;
  const base = oracles[tierKey];

  // 构造一份「合法档」副本：把会被新校验拒绝的边界短语过滤掉，其余保持不变，作为注入基准。
  const clean = structuredClone(base);
  for (const q of clean.queries) {
    const fb = q.expect?.factBoundary ?? {};
    if (Array.isArray(fb.mustNegate)) fb.mustNegate = fb.mustNegate.filter((p) => !isBoundaryBadPhrase(p));
    if (Array.isArray(q.expect?.wrongConclusions)) q.expect.wrongConclusions = q.expect.wrongConclusions.filter((p) => !isBoundaryBadPhrase(p));
  }
  assert.equal(validateTier(tierKey, manifest, materials[tierKey], clean).ok, true, "清洗后的副本应为合法档（基准）");

  const categories = {
    裸亲属称谓: ["侄子", "儿子", "女儿", "外甥", "外甥女", "兄弟", "儿媳", "徒弟"],
    裸职业词: ["医生", "教师", "老师", "邮差", "警察", "演员", "渔民", "木匠", "猎户", "策展人"],
    缺主语谓词: ["住在盐镇", "在盐镇中学教书", "在城西的邮局工作", "在望山岗负责邮路", "母亲留下的", "拆开看了", "还是灯塔"],
  };

  for (const [label, phrases] of Object.entries(categories)) {
    for (const phrase of phrases) {
      for (const field of ["mustNegate", "wrongConclusions"]) {
        const copy = structuredClone(clean);
        const q = copy.queries[0];
        if (field === "mustNegate") {
          q.expect.factBoundary.mustNegate.push(phrase);
        } else {
          q.expect.wrongConclusions.push(phrase);
        }
        const report = validateTier(tierKey, manifest, materials[tierKey], copy);
        assert.equal(report.ok, false, `${label}「${phrase}」进入 ${field} 应使 ok=false`);
        assert.ok(
          report.checks.some((c) => c.name === "no-bare-kindred-occupation-predicate" && c.ok === false),
          `${label}「${phrase}」应触发 no-bare-kindred-occupation-predicate 校验`
        );
      }
    }
  }
});

// ── fix-reliability-scorer-mislabels 任务 3.3：时态助词检查（正反例）──────────────
test("validateTier 拒绝 mustNegate/wrongConclusions 中的时态助词（还在/仍然/依旧/已经）", () => {
  const { manifest, materials, oracles } = loadFromDisk();
  const tierKey = manifest.tiers[0].tier;

  for (const aux of TENSE_AUXILIARIES) {
    for (const field of ["mustNegate", "wrongConclusions"]) {
      const copy = structuredClone(oracles[tierKey]);
      const q = copy.queries[0];
      const phrase = `某人${aux}某处教书`;
      if (field === "mustNegate") q.expect.factBoundary.mustNegate.push(phrase);
      else q.expect.wrongConclusions.push(phrase);
      const report = validateTier(tierKey, manifest, materials[tierKey], copy);
      assert.equal(report.ok, false, `「${phrase}」进入 ${field} 应使 ok=false`);
      assert.ok(
        report.checks.some((c) => c.name === "no-tense-auxiliary-in-boundary" && c.ok === false),
        `「${phrase}」应触发 no-tense-auxiliary-in-boundary 校验`
      );
    }
  }
});

test("validateTier 接受不含时态助词的边界短语（磁盘档全过为正例基准）", () => {
  const { manifest, materials, oracles } = loadFromDisk();
  const tierKey = manifest.tiers[0].tier;
  const report = validateTier(tierKey, manifest, materials[tierKey], oracles[tierKey]);
  const check = report.checks.find((c) => c.name === "no-tense-auxiliary-in-boundary");
  assert.ok(check, "应存在 no-tense-auxiliary-in-boundary 检查");
  assert.equal(check.ok, true, "磁盘档（已去助词）应通过时态助词检查");
});

// ── fix-reliability-scorer-mislabels 任务 3.3：negationEquivalents 结构校验（正反例）──
test("findNegationEquivalentsProblems：键不在同查询 mustNegate、裸实体、裸称谓、缺主语谓词均报问题", () => {
  const names = new Set(["苏晚", "盐镇", "盐城", "陈屿"]);
  const baseQuery = {
    id: "q-x",
    expect: {
      factBoundary: { mustContain: ["盐镇"], mustNegate: ["苏晚住在盐城"], negationEquivalents: {} },
      wrongConclusions: [],
    },
  };

  // 键不在 mustNegate
  const q1 = structuredClone(baseQuery);
  q1.expect.factBoundary.negationEquivalents = { 苏晚住在雾港: ["搬离了雾港"] };
  assert.ok(findNegationEquivalentsProblems(q1, names).some((p) => p.includes("不在同查询 mustNegate")));

  // 等价短语是裸实体（人名/地名）
  const q2 = structuredClone(baseQuery);
  q2.expect.factBoundary.negationEquivalents = { 苏晚住在盐城: ["盐城"] };
  assert.ok(findNegationEquivalentsProblems(q2, names).some((p) => p.includes("裸实体")));

  // 等价短语是裸职业词 / 缺主语谓词
  const q3 = structuredClone(baseQuery);
  q3.expect.factBoundary.negationEquivalents = { 苏晚住在盐城: ["老师"] };
  assert.ok(findNegationEquivalentsProblems(q3, names).some((p) => p.includes("裸称谓/缺主语谓词")));
  const q4 = structuredClone(baseQuery);
  q4.expect.factBoundary.negationEquivalents = { 苏晚住在盐城: ["住在盐城"] };
  assert.ok(findNegationEquivalentsProblems(q4, names).some((p) => p.includes("裸称谓/缺主语谓词")));

  // 值不是数组 / 声明不是对象
  const q5 = structuredClone(baseQuery);
  q5.expect.factBoundary.negationEquivalents = { 苏晚住在盐城: "不住在盐城" };
  assert.ok(findNegationEquivalentsProblems(q5, names).some((p) => p.includes("不是数组")));
  const q6 = structuredClone(baseQuery);
  q6.expect.factBoundary.negationEquivalents = ["不住在盐城"];
  assert.ok(findNegationEquivalentsProblems(q6, names).some((p) => p.includes("不是对象")));

  // 未声明（字段缺省）合法
  const q7 = structuredClone(baseQuery);
  delete q7.expect.factBoundary.negationEquivalents;
  assert.deepEqual(findNegationEquivalentsProblems(q7, names), []);
});

test("validateTier 接受合法的 negationEquivalents 声明（键绑定 mustNegate、等价短语为完整命题）", () => {
  const { manifest, materials, oracles } = loadFromDisk();
  const tierKey = manifest.tiers[0].tier;
  const copy = structuredClone(oracles[tierKey]);
  const q = copy.queries.find((x) => x.expect.factBoundary.mustNegate.length > 0);
  const key = q.expect.factBoundary.mustNegate[0];
  q.expect.factBoundary.negationEquivalents = { [key]: [`${key}的说法不成立`] };
  const report = validateTier(tierKey, manifest, materials[tierKey], copy);
  const check = report.checks.find((c) => c.name === "negation-equivalents-structure");
  assert.ok(check, "应存在 negation-equivalents-structure 检查");
  assert.equal(check.ok, true, "合法声明应通过");
  assert.equal(report.ok, true, "整档应保持通过");
});
