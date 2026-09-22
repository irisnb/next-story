// review.mjs — 人工裁决落档工具（change: fix-reliability-scorer-mislabels 任务 4.2）
//
// 用途：给已保存证据记录写入人工复核结论（result.human_review 四态）与裁决理由（result.reviewer_notes）。
// 裁判分离不变量（design D4）：只写人工结论字段，永不触碰 result.automatic / reasons /
// automatic_history 等自动结果，也不改 response 正文与协议记录。manifest 只作定位确认
// （manifest 无 human_review 字段，不写它，避免 schema 漂移）。重复执行同一条裁决覆盖旧值（幂等）。
//
// 用法：
//   node sidecar/reliability/review.mjs <runId> <caseId> <MODEL_OK|MODEL_ERROR|SCORER_ERROR|UNRESOLVED> [--notes "..."] [--evidence <dir>]
//
// 默认证据目录：sidecar/reliability/evidence（相对本文件）。无网络、不重跑模型。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REVIEW_OUTCOMES } from "./screening.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_EVIDENCE_DIR = join(__dirname, "evidence");

/** 裁决值是否四态之一。 */
export function isValidOutcome(outcome) {
  return REVIEW_OUTCOMES.includes(outcome);
}

/**
 * 把人工裁决写进证据记录（纯函数，返回新对象、不改入参）：
 * result.human_review = outcome；result.reviewer_notes = notes（未提供或空白时为 null）。
 * result.automatic / reasons 等自动结果原样保留。
 */
export function applyReview(record, outcome, notes) {
  const result = record?.result ?? {};
  return {
    ...record,
    result: {
      ...result,
      human_review: outcome,
      reviewer_notes: typeof notes === "string" && notes.trim() !== "" ? notes : null,
    },
  };
}

/** 解析命令行参数：位置参数 runId / caseId / outcome，选项 --notes / --evidence / --help。 */
export function parseReviewArgs(argv) {
  const out = { runId: null, caseId: null, outcome: null, notes: null, evidenceDir: null, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--notes") out.notes = argv[++i];
    else if (a === "--evidence") out.evidenceDir = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else positional.push(a);
  }
  out.runId = positional[0] ?? null;
  out.caseId = positional[1] ?? null;
  out.outcome = positional[2] ?? null;
  return out;
}

function printUsage() {
  console.log("用法：node sidecar/reliability/review.mjs <runId> <caseId> <MODEL_OK|MODEL_ERROR|SCORER_ERROR|UNRESOLVED> [--notes \"…\"] [--evidence <dir>]");
  console.log("把人工复核结论写进 evidence/<runId>/cases/<caseId>.json 的 result.human_review / reviewer_notes；不触碰自动结果。");
}

function main() {
  const args = parseReviewArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.runId || !args.caseId || !args.outcome) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (!isValidOutcome(args.outcome)) {
    console.error(`非法裁决值：${args.outcome}（必须是 ${REVIEW_OUTCOMES.join(" / ")} 之一）`);
    process.exitCode = 2;
    return;
  }

  const evidenceDir = args.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const caseFile = join(evidenceDir, args.runId, "cases", `${args.caseId}.json`);
  if (!existsSync(caseFile)) {
    console.error(`找不到证据记录：${caseFile}`);
    process.exitCode = 2;
    return;
  }

  const record = JSON.parse(readFileSync(caseFile, "utf8"));
  const updated = applyReview(record, args.outcome, args.notes);
  writeFileSync(caseFile, JSON.stringify(updated, null, 2) + "\n", "utf8");

  const manifestPath = join(evidenceDir, args.runId, "manifest.json");
  let manifestNote = "";
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (Array.isArray(manifest.cases) && manifest.cases.some((c) => c.case_id === args.caseId)) {
      manifestNote = "（manifest 存在对应条目，自动结果未动）";
    }
  }
  console.log(`已写入人工裁决：${args.runId} / ${args.caseId} → ${args.outcome}${manifestNote}`);
}

// 仅当作为入口脚本直接执行时运行 main()；被测试 import 时不执行。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
