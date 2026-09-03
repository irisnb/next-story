// build-cases.mjs — 把材料 + 裁判组装成现有 runner 可运行的案例文件（change: add-long-context-hallucination-fixtures 任务 2.5/3.3）
//
// 产物写入 .generated/tier-<档>.jsonl（已 gitignore，不入库），每行一个现有 schema 格式的案例：
//   { id, description, material{name,version,hash,text}, steps?, question, expect, trial_count, trial_ids }
// 这些文件可被现有 runner 直接运行：node sidecar/reliability/runner.mjs --cases <文件> --api-base <url> --model <model>
//
// 本工具不修改生产驱动契约、不修改评分语义；trial_count / trial_ids 为规划元数据，runner 暂不使用。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "manifest.json");
const MATERIALS_DIR = join(__dirname, "materials");
const ORACLE_DIR = join(__dirname, "oracle");
const OUT_DIR = join(__dirname, ".generated");

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** 把单个裁判查询组装成现有 schema 案例对象。 */
export function buildCase(material, query) {
  const c = {
    id: query.id,
    description: query.description,
    material: {
      name: material.name,
      version: material.version,
      hash: material.hash,
      text: material.text,
    },
    question: query.question,
    expect: query.expect,
    trial_count: query.trial_count,
    trial_ids: query.trial_ids,
  };
  if (Array.isArray(query.steps) && query.steps.length > 0) {
    c.steps = query.steps;
  }
  return c;
}

/** 组装整档案例数组。 */
export function buildTierCases(material, oracle) {
  return oracle.queries.map((q) => buildCase(material, q));
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const t of manifest.tiers) {
    const material = readJson(join(MATERIALS_DIR, `tier-${t.tier}.json`));
    const oracle = readJson(join(ORACLE_DIR, `tier-${t.tier}.json`));
    const cases = buildTierCases(material, oracle);
    const lines = cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
    const outPath = join(OUT_DIR, `tier-${t.tier}.jsonl`);
    writeFileSync(outPath, lines, "utf8");
    console.log(`写出 ${t.tier}：${cases.length} 个案例 → ${outPath}`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
