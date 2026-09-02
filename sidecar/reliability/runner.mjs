// runner.mjs — 回答可靠性测试器命令行入口（change: add-answer-reliability-tester-core 任务 2.1）
//
// 用法：
//   $env:DEEPSEEK_API_KEY = <key>
//   node sidecar/reliability/runner.mjs --api-base <url> --model <model> [选项]
// 选项：
//   --cases <path>     案例文件或目录（默认 sidecar/reliability/fixtures）
//   --out <dir>        证据输出目录（默认 sidecar/reliability/evidence）
//   --run-id <id>      本次运行标识（默认按时间戳生成）
//   --timeout-ms <ms>  每轮默认超时（默认 180000）
//
// 证据按 <out>/<run-id>/cases/<caseId>.json 确定性落盘，另写 manifest.json 汇总。
// 本工具完全离线：不改用户作品、不进实时用户对话、不写任何生产数据。API key 绝不落盘。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadAndValidate } from "./schema.mjs";
import { screenAnswer, RESULT_RUNTIME_ERROR } from "./screening.mjs";
import { secretsFromEnv, redactObject, assertNoSecrets } from "./redact.mjs";
import { buildEvidenceRecord, apiBaseLabel, TESTER_VERSION, EVIDENCE_SCHEMA_VERSION, evidenceOutputPath } from "./evidence.mjs";
import { DriverClient, runCase } from "./driver-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CASES_DIR = join(__dirname, "fixtures");
const DEFAULT_OUT_DIR = join(__dirname, "evidence");
const DEFAULT_RUN_HOME = join(__dirname, ".run-home");
const DEFAULT_TIMEOUT_MS = 180000;

function parseArgs(argv) {
  const out = { apiBase: null, model: null, cases: null, outDir: null, runId: null, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-base") out.apiBase = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--cases") out.cases = argv[++i];
    else if (a === "--out") out.outDir = argv[++i];
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

function resolveCaseFiles(casesPath) {
  const base = casesPath ?? DEFAULT_CASES_DIR;
  const st = statSync(base);
  if (st.isFile()) return [base];
  return readdirSync(base)
    .filter((n) => [".json", ".jsonl"].includes(extname(n).toLowerCase()))
    .sort()
    .map((n) => join(base, n));
}

function defaultRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * 归一化评分结果形状：screenAnswer 返回 { result, reasons }，而运行错误分支构造
 * { automatic, reasons }。统一为 { automatic, reasons }，避免下游读到 undefined。
 */
export function normalizeScreen(scr) {
  if (scr && typeof scr === "object" && "result" in scr && !("automatic" in scr)) {
    return { automatic: scr.result, reasons: Array.isArray(scr.reasons) ? scr.reasons : [] };
  }
  return scr;
}

/**
 * 由逐案例结果构建汇总计数与条目（供 manifest 与 stdout 摘要使用）。
 * 输入 [{ case_id, screen, evidence_file }]，screen 可为 { result, reasons } 或 { automatic, reasons }。
 * 返回 { counts, cases }；对缺失/非字符串结果做防御，绝不因 undefined 崩溃。
 */
export function buildRunSummary(caseEntries) {
  const counts = { total: 0, pass_likely: 0, fail_likely: 0, needs_review: 0, runtime_error: 0 };
  const cases = [];
  for (const entry of caseEntries) {
    const screen = normalizeScreen(entry?.screen);
    const result = screen && typeof screen.automatic === "string" ? screen.automatic : null;
    counts.total += 1;
    if (result !== null) {
      const key = result.toLowerCase();
      if (counts[key] !== undefined) counts[key] += 1;
    }
    cases.push({
      case_id: entry?.case_id ?? null,
      result,
      reasons: screen?.reasons ?? [],
      evidence_file: entry?.evidence_file ?? null,
    });
  }
  return { counts, cases };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!args.apiBase || !args.model || !apiKey) {
    console.error("用法：node sidecar/reliability/runner.mjs --api-base <url> --model <model>（需 DEEPSEEK_API_KEY 环境变量）");
    process.exit(2);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    console.error("--timeout-ms 必须是正数");
    process.exit(2);
  }

  // ── 加载 + 校验案例（不修改案例文件）────────────────────────────────────────
  let files;
  try {
    files = resolveCaseFiles(args.cases);
  } catch (err) {
    console.error(`无法定位案例路径 ${args.cases ?? DEFAULT_CASES_DIR}：${String(err.message ?? err)}`);
    process.exit(2);
  }

  const valid = [];
  const invalid = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const r = loadAndValidate(source);
    if (r.parseError) {
      invalid.push({ case: { id: file }, index: -1, errors: [`解析失败：${r.parseError}`] });
      continue;
    }
    for (const v of r.valid) valid.push({ case: v.case, index: v.index, source: file });
    for (const v of r.invalid) invalid.push({ case: v.case, index: v.index, source: file, errors: v.errors });
  }

  for (const inv of invalid) {
    console.error(`[跳过] 案例校验失败（${inv.source ?? inv.case?.id ?? "未知来源"} #${inv.index}）：${inv.errors.join("；")}`);
  }
  if (valid.length === 0) {
    console.error("没有可运行的合法案例，退出。");
    process.exit(1);
  }

  const secrets = secretsFromEnv(apiKey);
  const runId = args.runId ?? defaultRunId();
  const outDir = args.outDir ?? DEFAULT_OUT_DIR;
  const startedAt = new Date().toISOString();

  // ── 拉起真实 DSH driver ─────────────────────────────────────────────────────
  let client = null;
  let driverStartError = null;
  try {
    client = await DriverClient.start({ apiBase: args.apiBase, model: args.model, apiKey, home: DEFAULT_RUN_HOME });
  } catch (err) {
    driverStartError = { category: "driver_start_failed", message: String(err.message ?? err) };
  }

  // ── 逐案例运行 + 评分 + 证据 ────────────────────────────────────────────────
  const summaries = [];
  let runtimeErrorCount = 0;

  for (const { case: caseDef } of valid) {
    let run;
    let screen;
    if (client) {
      run = await runCase(client, caseDef, args.timeoutMs);
      if (run.runtimeError) {
        screen = { automatic: RESULT_RUNTIME_ERROR, reasons: [`${run.runtimeError.category}: ${run.runtimeError.message}`] };
        runtimeErrorCount++;
      } else {
        screen = normalizeScreen(screenAnswer(caseDef.expect, run.response.text));
      }
    } else {
      run = {
        caseId: caseDef.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        protocol: { outcome: "driver_start_failed", terminal_state: null, delta_count: 0, event_summary: [], session_id: null, final_message_id: null },
        response: { text: "", steps: [] },
        runtimeError: driverStartError,
      };
      screen = { automatic: RESULT_RUNTIME_ERROR, reasons: [`${driverStartError.category}: ${driverStartError.message}`] };
      runtimeErrorCount++;
    }

    const evidence = buildEvidenceRecord({
      runId,
      caseId: caseDef.id,
      material: caseDef.material,
      model: args.model,
      apiBaseLabel: apiBaseLabel(args.apiBase),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      steps: run.response.steps,
      question: caseDef.question,
      response: run.response,
      protocol: run.protocol,
      result: screen,
      runtimeError: run.runtimeError,
    });

    // 脱敏 → 序列化 → 复核无密钥
    const redacted = redactObject(evidence, secrets);
    const serialized = JSON.stringify(redacted, null, 2);
    const leakCheck = assertNoSecrets(serialized, secrets);
    redacted.secret_check = { passed: leakCheck.ok, leaks: leakCheck.leaks };
    if (!leakCheck.ok) {
      screen.automatic = RESULT_RUNTIME_ERROR;
      screen.reasons.push("证据或诊断含密钥泄漏");
      runtimeErrorCount++;
      console.error(`[泄漏] 案例 ${caseDef.id} 序列化证据含密钥，已标记 RUNTIME_ERROR`);
    }
    const finalSerialized = JSON.stringify(redacted, null, 2) + "\n";

    const { dir, file } = evidenceOutputPath(outDir, runId, caseDef.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), finalSerialized, "utf8");

    summaries.push({
      case_id: caseDef.id,
      screen,
      evidence_file: join(dir, file),
    });
  }

  // stderr 无密钥泄漏复核
  let stderrLeak = false;
  if (client) {
    const stderrText = client.stderrText();
    const stderrRedacted = redactObject(stderrText, secrets);
    const stderrLeakCheck = assertNoSecrets(stderrRedacted, secrets);
    stderrLeak = !stderrLeakCheck.ok;
    if (stderrLeak) {
      console.error("[泄漏] driver stderr 含密钥");
      runtimeErrorCount++;
    }
  }

  await client?.shutdown();

  // ── 汇总 manifest + stdout 摘要 ─────────────────────────────────────────────
  const { counts, cases } = buildRunSummary(summaries);

  const manifest = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    tester_version: TESTER_VERSION,
    run_id: runId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    configuration: { model: args.model, api_base: apiBaseLabel(args.apiBase) },
    counts,
    cases,
  };
  const manifestDir = join(outDir, runId);
  mkdirSync(manifestDir, { recursive: true });
  const manifestSerialized = JSON.stringify(redactObject(manifest, secrets), null, 2);
  if (!assertNoSecrets(manifestSerialized, secrets).ok) {
    console.error("[泄漏] manifest 含密钥");
    runtimeErrorCount++;
  }
  writeFileSync(join(manifestDir, "manifest.json"), manifestSerialized + "\n", "utf8");

  console.log("RUN_ID=" + runId);
  for (const s of cases) {
    console.log(`[${s.result}] ${s.case_id} — ${s.reasons.join("；")}`);
  }
  console.log(`SUMMARY total=${counts.total} pass_likely=${counts.pass_likely} fail_likely=${counts.fail_likely} needs_review=${counts.needs_review} runtime_error=${counts.runtime_error}`);
  console.log(`EVIDENCE_DIR=${manifestDir}`);

  const operationalFailure = runtimeErrorCount > 0 || stderrLeak;
  console.log(operationalFailure ? "RUNNER: OPERATIONAL FAILURES PRESENT" : "RUNNER: COMPLETE");
  process.exitCode = operationalFailure ? 1 : 0;
}

// 仅当作为入口脚本直接执行时运行 main()；被测试 import 时不执行（避免触发 parseArgs/process.exit）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`runner 未预期错误：${String(err?.stack ?? err)}`);
    process.exit(1);
  });
}
