// rescore.test.mjs — 离线重评脚本的本地单元测试（change: fix-screener-residual-defects 任务 3.1；
//   fix-reliability-scorer-mislabels 任务 4.3：干跑零写入、--write 历史保留与 manifest 重算）
//
// 覆盖：expect 索引构建（fixtures + long-context oracle）、单条证据重评、
// RUNTIME_ERROR 保留、缺失 oracle 标记、证据目录扫描与每档/总体分布聚合、
// 写回模式（refreshRecordResult / recomputeManifestCounts / writeBackRescore）。
// 全部离线：临时目录内构造最小 fixtures/oracle/evidence，不发网络、不碰真实证据与生产数据。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildExpectIndex,
  rescoreRecord,
  scanEvidenceRuns,
  rescoreAll,
  refreshRecordResult,
  recomputeManifestCounts,
  writeBackRescore,
} from "../rescore.mjs";
import {
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
  ALL_RESULTS,
} from "../screening.mjs";

const REL_DIR = fileURLToPath(new URL("..", import.meta.url)); // sidecar/reliability/

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "rescore-test-"));
}

function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

// ── buildExpectIndex：索引 fixtures 与 long-context oracle ─────────────────────
test("buildExpectIndex 同时索引 fixtures 单案例与 oracle 查询", () => {
  const root = makeTmpDir();
  const fixturesDir = join(root, "fixtures");
  const oracleDir = join(root, "oracle");
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(oracleDir, { recursive: true });

  const fixExpect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] };
  const oracleExpect = { factBoundary: { mustContain: ["盐镇"], mustNegate: [] }, wrongConclusions: ["出生在盐城"], allowedUncertainty: [] };
  writeJson(join(fixturesDir, "version-conflict-v2.json"), { id: "version-conflict-v2", expect: fixExpect });
  writeJson(join(oracleDir, "tier-10k.json"), { queries: [{ id: "lc-10k-01", expect: oracleExpect }] });

  const index = buildExpectIndex({ fixturesDir, oracleDir });
  assert.ok(index instanceof Map);
  assert.equal(index.size, 2);
  assert.deepEqual(index.get("version-conflict-v2"), fixExpect);
  assert.deepEqual(index.get("lc-10k-01"), oracleExpect);
  rmSync(root, { recursive: true, force: true });
});

test("buildExpectIndex 在目录缺失时返回空索引而不崩溃", () => {
  const root = makeTmpDir();
  const index = buildExpectIndex({ fixturesDir: join(root, "nope"), oracleDir: join(root, "also-nope") });
  assert.ok(index instanceof Map);
  assert.equal(index.size, 0);
  rmSync(root, { recursive: true, force: true });
});

// ── rescoreRecord：用当前 screenAnswer 重评 ───────────────────────────────────
test("rescoreRecord 用当前 screenAnswer 重评，产出与旧结果不同的新结果", () => {
  const index = new Map();
  const expect = { factBoundary: { mustContain: ["摄影工作室"], mustNegate: ["在印刷厂工作"] }, wrongConclusions: ["还在印刷厂"], allowedUncertainty: [] };
  index.set("lc-30k-11", expect);
  const record = {
    case_id: "lc-30k-11",
    response: { text: "根据材料内容，陆遥现在**不在**印刷厂工作。\n\n依据是第五章《换工作》中明确写道：\n\n> “陆遥原本在城北的印刷厂做排版，后来辞职去了云峰山下的摄影工作室。”" },
    result: { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：在印刷厂工作"] },
    runtime_error: null,
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.matched, true);
  assert.equal(r.runtimeError, false);
  assert.equal(r.old.automatic, RESULT_FAIL_LIKELY);
  assert.equal(r.next.automatic, RESULT_PASS_LIKELY);
});

test("rescoreRecord 保留 RUNTIME_ERROR，不把空回答重评成 FAIL_LIKELY", () => {
  const index = new Map();
  index.set("case-x", { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] });
  const record = {
    case_id: "case-x",
    response: { text: "" },
    result: { automatic: RESULT_RUNTIME_ERROR, reasons: ["timeout: 超时"] },
    runtime_error: { category: "timeout", message: "超时" },
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.runtimeError, true);
  assert.equal(r.next.automatic, RESULT_RUNTIME_ERROR);
  assert.notEqual(r.next.automatic, RESULT_FAIL_LIKELY);
});

test("rescoreRecord 对缺失 oracle 的案例标记未匹配，next 为 null", () => {
  const index = new Map();
  const record = {
    case_id: "unknown-case",
    response: { text: "某个回答" },
    result: { automatic: RESULT_PASS_LIKELY, reasons: [] },
    runtime_error: null,
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.matched, false);
  assert.equal(r.next, null);
});

// ── scanEvidenceRuns：证据目录扫描 ────────────────────────────────────────────
test("scanEvidenceRuns 扫描每个运行的 cases 子目录", () => {
  const root = makeTmpDir();
  const evidenceDir = join(root, "evidence");
  mkdirSync(join(evidenceDir, "run-1", "cases"), { recursive: true });
  mkdirSync(join(evidenceDir, "run-2", "cases"), { recursive: true });
  mkdirSync(join(evidenceDir, "no-cases-dir")); // 无 cases 子目录，应被跳过
  writeJson(join(evidenceDir, "run-1", "cases", "a.json"), { case_id: "a" });
  writeJson(join(evidenceDir, "run-2", "cases", "b.json"), { case_id: "b" });

  const runs = scanEvidenceRuns(evidenceDir);
  assert.deepEqual(runs.map((r) => r.runId), ["run-1", "run-2"]);
  assert.equal(runs[0].records[0].case_id, "a");
  assert.equal(runs[1].records[0].case_id, "b");
  rmSync(root, { recursive: true, force: true });
});

test("scanEvidenceRuns 对缺失目录返回空数组", () => {
  assert.deepEqual(scanEvidenceRuns(join(makeTmpDir(), "missing")), []);
});

// ── rescoreAll：端到端聚合每档与总体分布 ──────────────────────────────────────
test("rescoreAll 输出每档与总体四态分布、缺失 oracle 计数与变更计数", () => {
  const root = makeTmpDir();
  const fixturesDir = join(root, "fixtures");
  const oracleDir = join(root, "oracle");
  const evidenceDir = join(root, "evidence");
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(oracleDir, { recursive: true });

  writeJson(join(fixturesDir, "case-a.json"), {
    id: "case-a",
    expect: { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] },
  });
  writeJson(join(oracleDir, "tier-10k.json"), {
    queries: [{ id: "lc-10k-01", expect: { factBoundary: { mustContain: ["盐镇"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] } }],
  });

  const run1 = join(evidenceDir, "run-1");
  mkdirSync(join(run1, "cases"), { recursive: true });
  writeJson(join(run1, "cases", "case-a.json"), {
    case_id: "case-a",
    response: { text: "林悦在城西的画廊上班。" },
    result: { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：城东的图书馆"] },
    runtime_error: null,
  });
  writeJson(join(run1, "cases", "case-z.json"), {
    case_id: "case-z",
    response: { text: "某个回答" },
    result: { automatic: RESULT_PASS_LIKELY, reasons: [] },
    runtime_error: null,
  });

  const run2 = join(evidenceDir, "run-2");
  mkdirSync(join(run2, "cases"), { recursive: true });
  writeJson(join(run2, "cases", "lc-10k-01.json"), {
    case_id: "lc-10k-01",
    response: { text: "苏晚出生在盐镇。" },
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: [] },
    runtime_error: null,
  });

  const res = rescoreAll({ evidenceDir, fixturesDir, oracleDir });

  assert.equal(res.runs.length, 2);
  const byId = Object.fromEntries(res.runs.map((r) => [r.runId, r]));
  assert.deepEqual(byId["run-1"].counts, {
    total: 2, pass_likely: 1, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 1, changed: 1,
  });
  assert.deepEqual(byId["run-2"].counts, {
    total: 1, pass_likely: 1, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 0, changed: 1,
  });
  assert.equal(res.overall.total, 3);
  assert.equal(res.overall.pass_likely, 2);
  assert.equal(res.overall.missing_oracle, 1);
  assert.equal(res.overall.changed, 2);
  // 总体守恒：四态 + 缺失 = total
  assert.equal(
    res.overall.total,
    res.overall.pass_likely + res.overall.fail_likely + res.overall.needs_review + res.overall.runtime_error + res.overall.missing_oracle
  );
  rmSync(root, { recursive: true, force: true });
});

// ── 集成：真实证据目录可被默认路径扫描并重评（存在则断言，缺失则跳过）──────────────
test("集成：默认 evidence/fixtures/oracle 目录可被重评并产出四态分布", (t) => {
  const evidenceDir = join(REL_DIR, "evidence");
  if (!existsSync(evidenceDir)) return t.skip("无证据目录，跳过集成测试");

  const res = rescoreAll({
    evidenceDir,
    fixturesDir: join(REL_DIR, "fixtures"),
    oracleDir: join(REL_DIR, "long-context", "oracle"),
  });

  assert.ok(res.runs.length > 0, "应至少扫描到一个运行档");
  assert.ok(res.overall.total > 0, "总证据数应大于 0");

  for (const run of res.runs) {
    for (const e of run.entries) {
      if (e.matched) {
        assert.ok(ALL_RESULTS.includes(e.next.automatic), `重评结果应为四态之一，得到 ${e.next.automatic}（${e.caseId}）`);
      } else {
        assert.equal(e.next, null);
      }
    }
  }
  // 每档计数守恒
  for (const run of res.runs) {
    const c = run.counts;
    assert.equal(c.total, c.pass_likely + c.fail_likely + c.needs_review + c.runtime_error + c.missing_oracle);
  }
});

// ── fix-reliability-scorer-mislabels 任务 4.3：干跑零写入 / 写回历史保留 / manifest 重算 ──

/** 构造最小可写回环境：一个 fixture、一档两条证据（一条漂移、一条未漂移）＋ manifest。 */
function makeWriteBackFixture() {
  const root = makeTmpDir();
  const fixturesDir = join(root, "fixtures");
  const evidenceDir = join(root, "evidence");
  mkdirSync(fixturesDir, { recursive: true });
  const expect = { factBoundary: { mustContain: ["摄影工作室"], mustNegate: ["在印刷厂工作"] }, wrongConclusions: ["还在印刷厂"], allowedUncertainty: [] };
  writeJson(join(fixturesDir, "case-a.json"), { id: "case-a", expect });

  const runDir = join(evidenceDir, "run-1");
  mkdirSync(join(runDir, "cases"), { recursive: true });
  // 漂移记录：旧评分器标 FAIL_LIKELY，当前评分器（markdown 剥离＋引用命中）应为 PASS_LIKELY
  writeJson(join(runDir, "cases", "case-a.json"), {
    case_id: "case-a",
    response: { text: "陆遥现在**不在**印刷厂工作，辞职去了云峰山下的摄影工作室。" },
    result: { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：在印刷厂工作"], human_review: null, reviewer_notes: null },
    runtime_error: null,
  });
  // 未漂移记录：旧值与新值一致，写回时不应有任何变动
  writeJson(join(runDir, "cases", "case-b.json"), {
    case_id: "case-b",
    response: { text: "某个无关回答" },
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: ["旧理由"], human_review: null, reviewer_notes: null },
    runtime_error: null,
  });
  writeJson(join(runDir, "manifest.json"), {
    run_id: "run-1",
    counts: { total: 2, pass_likely: 0, fail_likely: 1, needs_review: 1, runtime_error: 0 },
    cases: [
      { case_id: "case-a", result: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：在印刷厂工作"] },
      { case_id: "case-b", result: RESULT_NEEDS_REVIEW, reasons: ["旧理由"] },
    ],
  });
  return { root, fixturesDir, evidenceDir };
}

test("干跑（rescoreAll）零写入：证据与 manifest 逐字节不变", () => {
  const { root, fixturesDir, evidenceDir } = makeWriteBackFixture();
  const caseFile = join(evidenceDir, "run-1", "cases", "case-a.json");
  const manifestFile = join(evidenceDir, "run-1", "manifest.json");
  const beforeCase = readFileSync(caseFile, "utf8");
  const beforeManifest = readFileSync(manifestFile, "utf8");

  const res = rescoreAll({ evidenceDir, fixturesDir, oracleDir: join(root, "no-oracle") });
  assert.equal(res.runs[0].counts.changed, 1);

  assert.equal(readFileSync(caseFile, "utf8"), beforeCase, "干跑不得改证据文件");
  assert.equal(readFileSync(manifestFile, "utf8"), beforeManifest, "干跑不得改 manifest");
  rmSync(root, { recursive: true, force: true });
});

test("写回（writeBackRescore）：历史保留、human_review 不动、manifest counts 重算＋rescored_at", () => {
  const { root, fixturesDir, evidenceDir } = makeWriteBackFixture();
  const ts = "2026-09-22T00:00:00.000Z";
  const { summary } = writeBackRescore({ evidenceDir, fixturesDir, oracleDir: join(root, "no-oracle"), timestamp: ts });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].caseWrites, 1, "只有漂移记录被写");
  assert.equal(summary[0].manifestWrites, 1);

  const record = JSON.parse(readFileSync(join(evidenceDir, "run-1", "cases", "case-a.json"), "utf8"));
  assert.equal(record.result.automatic, RESULT_PASS_LIKELY, "自动结果刷新为重评结果");
  assert.ok(Array.isArray(record.result.automatic_history), "旧值进入 automatic_history");
  assert.deepEqual(
    record.result.automatic_history[0],
    { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：在印刷厂工作"], rescored_at: ts },
  );
  assert.equal(record.result.human_review, null, "human_review 不动");
  assert.equal(record.result.reviewer_notes, null, "reviewer_notes 不动");
  assert.ok(record.response.text.includes("摄影工作室"), "response 正文不动");

  const unchanged = JSON.parse(readFileSync(join(evidenceDir, "run-1", "cases", "case-b.json"), "utf8"));
  assert.equal(unchanged.result.automatic, RESULT_NEEDS_REVIEW);
  assert.equal(unchanged.result.automatic_history, undefined, "未漂移记录不产生噪音历史");

  const manifest = JSON.parse(readFileSync(join(evidenceDir, "run-1", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.counts, { total: 2, pass_likely: 1, fail_likely: 0, needs_review: 1, runtime_error: 0 });
  assert.equal(manifest.rescored_at, ts);
  assert.equal(manifest.cases.find((c) => c.case_id === "case-a").result, RESULT_PASS_LIKELY, "manifest per-case 同步刷新");

  // 第二轮写回：全部一致 → 零案例写入、历史不再追加（幂等）
  const second = writeBackRescore({ evidenceDir, fixturesDir, oracleDir: join(root, "no-oracle"), timestamp: "2026-09-22T01:00:00.000Z" });
  assert.equal(second.summary[0].caseWrites, 0);
  const record2 = JSON.parse(readFileSync(join(evidenceDir, "run-1", "cases", "case-a.json"), "utf8"));
  assert.equal(record2.result.automatic_history.length, 1, "历史不重复追加");
  rmSync(root, { recursive: true, force: true });
});

test("refreshRecordResult：旧值与新值一致时返回 changed=false 且零变动", () => {
  const record = { result: { automatic: RESULT_PASS_LIKELY, reasons: ["a"] } };
  const { changed } = refreshRecordResult(record, { automatic: RESULT_PASS_LIKELY, reasons: ["a"] }, "ts");
  assert.equal(changed, false);
  assert.deepEqual(record, { result: { automatic: RESULT_PASS_LIKELY, reasons: ["a"] } });
});

test("refreshRecordResult：已存在 automatic_history 时追加而非覆盖", () => {
  const record = {
    result: {
      automatic: RESULT_NEEDS_REVIEW,
      reasons: ["新理由"],
      automatic_history: [{ automatic: RESULT_FAIL_LIKELY, reasons: ["旧理由"], rescored_at: "t0" }],
    },
  };
  const { changed } = refreshRecordResult(record, { automatic: RESULT_PASS_LIKELY, reasons: ["更新理由"] }, "t1");
  assert.equal(changed, true);
  assert.equal(record.result.automatic_history.length, 2);
  assert.deepEqual(record.result.automatic_history[1], { automatic: RESULT_NEEDS_REVIEW, reasons: ["新理由"], rescored_at: "t1" });
});

test("recomputeManifestCounts：按重评后四态计数，缺 oracle 记录保留原结果", () => {
  const entries = [
    { old: { automatic: RESULT_FAIL_LIKELY }, next: { automatic: RESULT_PASS_LIKELY } },
    { old: { automatic: RESULT_NEEDS_REVIEW }, next: { automatic: RESULT_NEEDS_REVIEW } },
    { old: { automatic: RESULT_RUNTIME_ERROR, reasons: ["timeout"] }, next: { automatic: RESULT_RUNTIME_ERROR, reasons: ["timeout"] } },
    { old: { automatic: RESULT_PASS_LIKELY }, next: null },
  ];
  assert.deepEqual(recomputeManifestCounts(entries), { total: 4, pass_likely: 2, fail_likely: 0, needs_review: 1, runtime_error: 1 });
});
