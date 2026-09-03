// long-context.test.mjs — 长上下文夹具的离线测试（change: add-long-context-hallucination-fixtures 任务 3.2）
// 不启动 DSH、无需 API key、不发网络请求。
import assert from "node:assert/strict";
import test from "node:test";

import { materialHash, countChars, estimateTokens, mulberry32, generateTier } from "../long-context/generator.mjs";
import { validateAll, loadFromDisk } from "../long-context/validate.mjs";
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
