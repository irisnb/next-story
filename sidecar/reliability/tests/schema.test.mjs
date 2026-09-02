// schema.test.mjs — 案例校验与解析的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1）
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCase, parseCaseSource, loadAndValidate, materialHash } from "../schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function minimalCase(overrides = {}) {
  return {
    id: "case-1",
    material: { name: "材料", version: "1", hash: materialHash("正文"), text: "正文" },
    question: "问题？",
    expect: {
      factBoundary: { mustContain: [], mustNegate: [] },
      wrongConclusions: [],
      allowedUncertainty: [],
      evidenceLocations: ["第一句"],
      riskTags: ["smoke"],
    },
    ...overrides,
  };
}

test("materialHash 返回 sha256:<64 位十六进制>", () => {
  const h = materialHash("abc");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h, materialHash("abc"));
  assert.notEqual(h, materialHash("abd"));
});

test("合法案例通过校验", () => {
  const r = validateCase(minimalCase());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("缺失 id / 材料身份 / 问题被拒绝", () => {
  assert.equal(validateCase(minimalCase({ id: "" })).ok, false);
  assert.equal(validateCase(minimalCase({ id: undefined })).ok, false);

  const noMaterial = minimalCase();
  delete noMaterial.material;
  assert.equal(validateCase(noMaterial).ok, false);

  const noQuestion = minimalCase();
  delete noQuestion.question;
  assert.equal(validateCase(noQuestion).ok, false);
});

test("材料哈希不匹配被拒绝（文本被改动但哈希未更新）", () => {
  const c = minimalCase();
  c.material.hash = materialHash("另一个文本");
  const r = validateCase(c);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("；"), /不匹配/);
});

test("哈希格式非法被拒绝", () => {
  const c = minimalCase();
  c.material.hash = "sha256:xyz";
  assert.equal(validateCase(c).ok, false);
});

test("缺失证据位置 / 风险标签被拒绝", () => {
  const noLoc = minimalCase();
  noLoc.expect.evidenceLocations = [];
  assert.equal(validateCase(noLoc).ok, false);

  const noTags = minimalCase();
  noTags.expect.riskTags = [];
  assert.equal(validateCase(noTags).ok, false);
});

test("steps 中非对象或缺失 text 被拒绝", () => {
  const bad = minimalCase({ steps: [{ notText: true }] });
  assert.equal(validateCase(bad).ok, false);
});

test("合法 steps 通过校验", () => {
  const c = minimalCase({ steps: [{ text: "前置问题" }] });
  assert.equal(validateCase(c).ok, true);
});

test("parseCaseSource 解析单个对象 / 数组 / JSONL", () => {
  assert.equal(parseCaseSource('{"id":"a"}').objects.length, 1);
  assert.equal(parseCaseSource('[{"id":"a"},{"id":"b"}]').objects.length, 2);
  assert.equal(parseCaseSource('{"id":"a"}\n{"id":"b"}\n').objects.length, 2);
});

test("parseCaseSource 对坏 JSONL 报错并给出行号", () => {
  const r = parseCaseSource('{"id":"a"}\n{bad json}\n');
  assert.equal(r.ok, false);
  assert.match(r.error, /第 2 行/);
});

test("loadAndValidate 分离合法与非法案例", () => {
  const good = JSON.stringify(minimalCase());
  const bad = JSON.stringify({ id: "", material: { name: "x" } });
  const r = loadAndValidate(`${good}\n${bad}\n`);
  assert.equal(r.parseError, null);
  assert.equal(r.valid.length, 1);
  assert.equal(r.invalid.length, 1);
});

test("全部固定 fixtures 通过校验", () => {
  const files = readdirSync(FIXTURES_DIR).filter((n) => n.endsWith(".json"));
  assert.ok(files.length >= 8, `fixtures 数量应覆盖核心场景，实际 ${files.length}`);
  for (const name of files) {
    const r = loadAndValidate(readFileSync(join(FIXTURES_DIR, name), "utf8"));
    assert.equal(r.parseError, null, `${name} 解析失败：${r.parseError}`);
    assert.equal(r.invalid.length, 0, `${name} 校验失败：${r.invalid.map((i) => i.errors.join("；")).join(" / ")}`);
    assert.equal(r.valid.length, 1, `${name} 应恰好一个案例`);
  }
});

test("fixtures 覆盖全部八类核心风险标签", () => {
  const tags = new Set();
  for (const name of readdirSync(FIXTURES_DIR).filter((n) => n.endsWith(".json"))) {
    const r = loadAndValidate(readFileSync(join(FIXTURES_DIR, name), "utf8"));
    for (const t of r.valid[0].case.expect.riskTags) tags.add(t);
  }
  for (const required of ["version-conflict", "negation", "unknown-info", "quotation-negation", "fact-vs-inference", "stale-fact", "post-compaction", "multi-hop"]) {
    assert.ok(tags.has(required), `缺少风险标签：${required}`);
  }
});
