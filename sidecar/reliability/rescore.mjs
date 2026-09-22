// rescore.mjs — 离线重评已保存证据（change: fix-screener-residual-defects 任务 3.1；
//   fix-reliability-scorer-mislabels 任务 4.1：新增 --write 写回模式）
//
// 目的：不花 API 钱，用当前 screenAnswer 重评已保存证据的 response.text + 对应案例 expect，
// 验证评分器修复效果（design D7）。只读、无网络、不写证据、不改案例、不碰生产 driver。
//
// 写回模式（--write，design D4）：默认仍是干跑（零写入、行为与旧版一致）。加 --write 后：
//   - 逐档逐条刷新 result.automatic / result.reasons，旧值推入 result.automatic_history
//     （数组追加 { automatic, reasons, rescored_at: ISO 时间戳 }，字段已存在则追加）；
//   - manifest 的 counts 按刷新后四态重算，并记 rescored_at；per-case 的 result/reasons 同步刷新；
//   - response 正文、协议记录、运行信息、human_review 一概不动；
//   - 旧值与新值完全一致的记录不做任何写入（幂等，不产生噪音历史）；
//   - --write 可与 --run 组合，只写指定档。
//
// 用法：
//   node sidecar/reliability/rescore.mjs [--write] [--evidence <dir>] [--fixtures <dir>] [--oracle <dir>] [--run <id>]
//
// 默认路径（相对本文件）：
//   evidence = sidecar/reliability/evidence
//   fixtures = sidecar/reliability/fixtures
//   oracle   = sidecar/reliability/long-context/oracle
//
// 输出：每个运行档（evidence 一级子目录）的四态分布 + 逐条旧→新变化，最后总体分布。
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  screenAnswer,
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
} from "./screening.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_EVIDENCE_DIR = join(__dirname, "evidence");
const DEFAULT_FIXTURES_DIR = join(__dirname, "fixtures");
const DEFAULT_ORACLE_DIR = join(__dirname, "long-context", "oracle");

// 结果字符串 → 计数键。只统计四态；找不到 expect 单独计 missing_oracle，不进四态。
const RESULT_KEYS = {
  [RESULT_PASS_LIKELY]: "pass_likely",
  [RESULT_FAIL_LIKELY]: "fail_likely",
  [RESULT_NEEDS_REVIEW]: "needs_review",
  [RESULT_RUNTIME_ERROR]: "runtime_error",
};

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function listJsonFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => extname(n).toLowerCase() === ".json")
    .sort();
}

function emptyCounts() {
  return { total: 0, pass_likely: 0, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 0, changed: 0 };
}

/**
 * 构建 case_id → expect 索引。fixtures 目录下每个 *.json 是一个案例（含 id/expect）；
 * long-context oracle 目录下每个 *.json 含 queries[]（每个含 id/expect）。返回 Map。
 */
export function buildExpectIndex({ fixturesDir, oracleDir }) {
  const index = new Map();
  for (const name of listJsonFiles(fixturesDir)) {
    const obj = readJson(join(fixturesDir, name));
    if (obj && typeof obj === "object" && typeof obj.id === "string" && obj.expect) {
      index.set(obj.id, obj.expect);
    }
  }
  for (const name of listJsonFiles(oracleDir)) {
    const obj = readJson(join(oracleDir, name));
    if (obj && Array.isArray(obj.queries)) {
      for (const q of obj.queries) {
        if (q && typeof q.id === "string" && q.expect) {
          index.set(q.id, q.expect);
        }
      }
    }
  }
  return index;
}

/**
 * 对单条证据记录重评。返回 { caseId, old, next, matched, runtimeError }。
 *   old    = 证据里保存的原结果（automatic + reasons）
 *   next   = 用当前 screenAnswer 重评的结果；找不到 expect 时为 null
 *   matched= 是否在索引中找到对应 expect
 *   runtimeError = 证据 runtime_error 非空（操作失败，保持 RUNTIME_ERROR，不把空回答重评成 FAIL_LIKELY）
 */
export function rescoreRecord(record, expectIndex) {
  const caseId = record?.case_id ?? null;
  const old = {
    automatic: record?.result?.automatic ?? null,
    reasons: Array.isArray(record?.result?.reasons) ? record.result.reasons : [],
  };

  if (record?.runtime_error) {
    return { caseId, old, next: { automatic: RESULT_RUNTIME_ERROR, reasons: old.reasons }, matched: true, runtimeError: true };
  }

  const expect = expectIndex.get(caseId);
  if (!expect) {
    return { caseId, old, next: null, matched: false, runtimeError: false };
  }

  const text = typeof record?.response?.text === "string" ? record.response.text : "";
  const scr = screenAnswer(expect, text);
  return { caseId, old, next: { automatic: scr.result, reasons: scr.reasons }, matched: true, runtimeError: false };
}

/**
 * 扫描证据目录：每个一级子目录视为一次运行（档），读取其 cases/*.json 证据记录。
 * 返回 [{ runId, records, caseFiles }]；runId 取目录名，跳过无 cases/ 子目录的目录。
 * caseFiles 与 records 等长对位（第 i 条记录来自第 i 个文件），供写回模式定位。
 */
export function scanEvidenceRuns(evidenceDir) {
  if (!evidenceDir || !existsSync(evidenceDir)) return [];
  return readdirSync(evidenceDir)
    .filter((name) => {
      const p = join(evidenceDir, name);
      return statSync(p).isDirectory() && existsSync(join(p, "cases"));
    })
    .sort()
    .map((name) => {
      const casesDir = join(evidenceDir, name, "cases");
      const jsonFiles = listJsonFiles(casesDir);
      const records = jsonFiles.map((n) => readJson(join(casesDir, n)));
      return { runId: name, records, caseFiles: jsonFiles.map((n) => join(casesDir, n)) };
    });
}

function summarize(entries) {
  const counts = emptyCounts();
  for (const e of entries) {
    counts.total += 1;
    if (e.next) {
      const key = RESULT_KEYS[e.next.automatic];
      if (key) counts[key] += 1;
      else counts.missing_oracle += 1;
    } else {
      counts.missing_oracle += 1;
    }
    if (e.matched && e.next && e.old.automatic !== e.next.automatic) counts.changed += 1;
  }
  return counts;
}

/**
 * 完整离线重评：构建 expect 索引 → 扫描证据 → 逐条重评 → 聚合每档与总体分布。
 * 纯读取，无网络、无写入。返回 { runs, overall }；runFilter 可选，只处理指定 runId。
 */
export function rescoreAll({ evidenceDir, fixturesDir, oracleDir, runFilter } = {}) {
  const expectIndex = buildExpectIndex({ fixturesDir, oracleDir });
  const runs = scanEvidenceRuns(evidenceDir)
    .filter((r) => !runFilter || r.runId === runFilter)
    .map((r) => {
      const entries = r.records.map((rec) => rescoreRecord(rec, expectIndex));
      return { runId: r.runId, entries, counts: summarize(entries) };
    });

  return { runs, overall: summarize(runs.flatMap((r) => r.entries)) };
}

// ── 写回模式（design D4，fix-reliability-scorer-mislabels 任务 4.1）───────────────

/**
 * 把单条证据的自动结果刷新为重评结果（就地修改 record.result），原值推入 automatic_history。
 * 旧值与新值（automatic 与 reasons 逐字一致）完全一致时不做任何变动——重复写回幂等、
 * 不产生噪音历史。只动 result.automatic / result.reasons / result.automatic_history，
 * 不碰 response 正文、协议记录、运行信息与 human_review。返回 { changed }。
 */
export function refreshRecordResult(record, next, rescoredAt) {
  const result = record?.result ?? {};
  record.result = result;
  const oldAutomatic = result.automatic ?? null;
  const oldReasons = Array.isArray(result.reasons) ? result.reasons : [];
  const same = oldAutomatic === next.automatic && JSON.stringify(oldReasons) === JSON.stringify(next.reasons);
  if (same) return { changed: false };
  const history = Array.isArray(result.automatic_history) ? result.automatic_history : [];
  history.push({ automatic: oldAutomatic, reasons: oldReasons, rescored_at: rescoredAt });
  result.automatic_history = history;
  result.automatic = next.automatic;
  result.reasons = next.reasons;
  return { changed: true };
}

/** 按 manifest 现有形状重算 counts：matched 记录取重评结果，缺失 oracle 的记录保留原结果。 */
export function recomputeManifestCounts(entries) {
  const counts = { total: entries.length, pass_likely: 0, fail_likely: 0, needs_review: 0, runtime_error: 0 };
  for (const e of entries) {
    const finalResult = e.next ? e.next.automatic : e.old.automatic;
    const key = RESULT_KEYS[finalResult];
    if (key) counts[key] += 1;
  }
  return counts;
}

/**
 * 写回重评（design D4）：rescoreAll 的写盘版本。逐档逐条刷新证据记录（旧值进 automatic_history），
 * 重算 manifest counts 并记 rescored_at、同步刷新 manifest per-case result/reasons。
 * timestamp 可注入（测试用）；缺省取当前 ISO 时间。返回 { summary, rescoredAt }：
 *   summary = [{ runId, counts, caseWrites, manifestWrites }]
 */
export function writeBackRescore({ evidenceDir, fixturesDir, oracleDir, runFilter, timestamp } = {}) {
  const rescoredAt = timestamp ?? new Date().toISOString();
  const expectIndex = buildExpectIndex({ fixturesDir, oracleDir });
  const summary = [];
  for (const run of scanEvidenceRuns(evidenceDir).filter((r) => !runFilter || r.runId === runFilter)) {
    const entries = run.records.map((rec) => rescoreRecord(rec, expectIndex));
    let caseWrites = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.matched || !e.next) continue; // 缺 oracle 的记录无法重评，保持原样
      const { changed } = refreshRecordResult(run.records[i], e.next, rescoredAt);
      if (changed) {
        writeFileSync(run.caseFiles[i], JSON.stringify(run.records[i], null, 2) + "\n", "utf8");
        caseWrites += 1;
      }
    }
    let manifestWrites = 0;
    const manifestPath = join(evidenceDir, run.runId, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      const counts = recomputeManifestCounts(entries);
      let dirty = !manifest.rescored_at || JSON.stringify(manifest.counts ?? null) !== JSON.stringify(counts);
      if (Array.isArray(manifest.cases)) {
        manifest.cases = manifest.cases.map((c) => {
          const e = entries.find((x) => x.caseId === c.case_id);
          if (!e || !e.next) return c;
          if (c.result !== e.next.automatic || JSON.stringify(c.reasons ?? []) !== JSON.stringify(e.next.reasons)) {
            dirty = true;
            return { ...c, result: e.next.automatic, reasons: e.next.reasons };
          }
          return c;
        });
      }
      if (dirty || caseWrites > 0) {
        manifest.counts = counts;
        manifest.rescored_at = rescoredAt;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
        manifestWrites = 1;
      }
    }
    summary.push({ runId: run.runId, counts: summarize(entries), caseWrites, manifestWrites });
  }
  return { summary, rescoredAt };
}

function parseArgs(argv) {
  const out = { evidenceDir: null, fixturesDir: null, oracleDir: null, run: null, write: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--evidence") out.evidenceDir = argv[++i];
    else if (a === "--fixtures") out.fixturesDir = argv[++i];
    else if (a === "--oracle") out.oracleDir = argv[++i];
    else if (a === "--run") out.run = argv[++i];
    else if (a === "--write") out.write = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printCounts(label, c) {
  return `${label} total=${c.total} pass_likely=${c.pass_likely} fail_likely=${c.fail_likely} needs_review=${c.needs_review} runtime_error=${c.runtime_error} missing_oracle=${c.missing_oracle} changed=${c.changed}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法：node sidecar/reliability/rescore.mjs [--write] [--evidence <dir>] [--fixtures <dir>] [--oracle <dir>] [--run <id>]");
    console.log("默认扫描 sidecar/reliability/evidence，用当前 screenAnswer 离线重评已保存证据，不发网络请求。");
    console.log("默认干跑零写入；加 --write 刷新 result.automatic/reasons（旧值进 automatic_history）并重算 manifest counts。");
    return;
  }

  const evidenceDir = args.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const fixturesDir = args.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const oracleDir = args.oracleDir ?? DEFAULT_ORACLE_DIR;

  if (!existsSync(evidenceDir)) {
    console.error(`证据目录不存在：${evidenceDir}`);
    process.exitCode = 2;
    return;
  }

  if (args.write) {
    const { summary, rescoredAt } = writeBackRescore({ evidenceDir, fixturesDir, oracleDir, runFilter: args.run });
    for (const s of summary) {
      console.log(`WROTE ${s.runId}: ${printCounts("", s.counts).trim()} case_writes=${s.caseWrites} manifest_writes=${s.manifestWrites}`);
    }
    console.log(`rescored_at=${rescoredAt}`);
    return;
  }

  const res = rescoreAll({ evidenceDir, fixturesDir, oracleDir, runFilter: args.run });

  for (const run of res.runs) {
    console.log(printCounts(`RUN ${run.runId}:`, run.counts));
    for (const e of run.entries) {
      const from = e.old.automatic ?? "-";
      const to = e.next ? e.next.automatic : "MISSING_ORACLE";
      const mark = from === to ? " " : ">";
      console.log(`  [${from}${mark}${to}] ${e.caseId}`);
    }
    console.log("");
  }
  console.log(printCounts("OVERALL:", res.overall));
}

// 仅当作为入口脚本直接执行时运行 main()；被测试 import 时不执行（避免触发 parseArgs/process.exit）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
