// validate.mjs — 长上下文夹具校验（change: add-long-context-hallucination-fixtures 任务 3.1）
//
// 离线校验以下不变量（全部只读，不启动 DSH、不发网络请求）：
//   1. 确定性：用已记录 seed 重新生成，材料哈希必须与检入文件一致；
//   2. 字数：char_count 必须等于正文码点数，且在目标字数容差内；
//   3. 哈希：material.hash 必须等于 sha256(text)；
//   4. token 估算：estimated_tokens 与记录一致且为正；
//   5. 裁判分离：正文（会被重放给模型）不得含 API key、裁判元数据标签或查询问题；
//   6. 锚点：每个锚点 statement 必须逐字出现在正文中；
//   7. 查询矩阵：每档查询数达标、七类风险全覆盖、id 唯一、trial_count=3 且 trial id 稳定；
//   8. 裁判与材料一致：oracle.material_hash 与 material.hash 一致。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateTier, materialHash, countChars, estimateTokens } from "./generator.mjs";
import { STORY_SPECS } from "./story-specs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "manifest.json");
const MATERIALS_DIR = join(__dirname, "materials");
const ORACLE_DIR = join(__dirname, "oracle");

// 通用 API key 模式（与 redact.mjs 的 GENERIC_KEY_SOURCE 保持一致）
const SECRET_RE = /sk-[A-Za-z0-9_-]{8,}/;

// 裁判元数据的结构标签：这些标签若出现在正文里，说明裁判（答案键）被误写进了会被重放的材料。
const ORACLE_MARKERS = [
  "mustContain",
  "mustNegate",
  "wrongConclusions",
  "allowedUncertainty",
  "factBoundary",
  "evidenceLocations",
  "riskTags",
  "trial_count",
  "trial_ids",
  "risk_category",
  "query_count",
  "material_hash",
];

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * 校验单档。返回 { tier, ok, checks: [{ name, ok, detail }] }。
 * 纯函数：material / oracle 由外部传入（测试可复用）。
 */
export function validateTier(tierKey, manifest, material, oracle) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail: detail ?? null });

  const tierCfg = manifest.tiers.find((t) => t.tier === tierKey);

  // 1. 确定性：重新生成并比对哈希
  const regen = generateTier(tierKey, manifest);
  push("deterministic-hash", regen.material.hash === material.hash, `重新生成哈希=${regen.material.hash}`);

  // 2. 字数自洽 + 容差
  const actual = countChars(material.text);
  push("char-count-consistent", actual === material.char_count, `countChars(text)=${actual} 记录 char_count=${material.char_count}`);
  const drift = Math.abs(material.char_count - tierCfg.target_chars) / tierCfg.target_chars;
  push("char-count-in-tolerance", drift <= manifest.size_tolerance_ratio, `偏差=${(drift * 100).toFixed(2)}%（容差 ${(manifest.size_tolerance_ratio * 100).toFixed(0)}%）`);

  // 3. 哈希自洽
  push("hash-consistent", materialHash(material.text) === material.hash, `sha256(text)=${materialHash(material.text)}`);

  // 4. token 估算
  const expectedTokens = estimateTokens(material.char_count, manifest.estimated_tokens_per_char);
  push("estimated-tokens-consistent", material.estimated_tokens === expectedTokens && material.estimated_tokens > 0, `记录=${material.estimated_tokens} 期望=${expectedTokens}`);

  // 5. 裁判分离：正文不含密钥 / 裁判标签 / 查询问题
  push("no-secret-in-material", !SECRET_RE.test(material.text), "正文不含 sk- 密钥模式");
  const leakedMarkers = ORACLE_MARKERS.filter((m) => material.text.includes(`"${m}"`) || material.text.includes(m));
  push("no-oracle-markers-in-material", leakedMarkers.length === 0, leakedMarkers.length ? `正文泄漏裁判标签：${leakedMarkers.join("、")}` : "正文不含裁判标签");
  const leakedQuestions = (oracle.queries ?? []).filter((q) => material.text.includes(q.question)).map((q) => q.id);
  push("no-query-question-in-material", leakedQuestions.length === 0, leakedQuestions.length ? `正文含查询问题：${leakedQuestions.join("、")}` : "正文不含查询问题");

  // 6. 锚点逐字出现
  const missingAnchors = (oracle.anchors ?? []).filter((a) => !material.text.includes(a.statement)).map((a) => a.id);
  push("anchors-present-in-material", missingAnchors.length === 0, missingAnchors.length ? `缺失锚点：${missingAnchors.join("、")}` : `${(oracle.anchors ?? []).length} 个锚点全部命中`);

  // 7. 查询矩阵
  const expectedCount = manifest.query_counts[tierKey];
  const queries = oracle.queries ?? [];
  push("query-count", queries.length === expectedCount, `实际 ${queries.length} 期望 ${expectedCount}`);

  const ids = new Set(queries.map((q) => q.id));
  push("query-ids-unique", ids.size === queries.length, ids.size === queries.length ? `${queries.length} 个 id 唯一` : "存在重复 id");

  const categories = new Set(queries.map((q) => q.category));
  const missingCats = manifest.risk_categories.filter((c) => !categories.has(c));
  push("risk-category-coverage", missingCats.length === 0, missingCats.length ? `缺少风险类别：${missingCats.join("、")}` : "七类风险全覆盖");

  const badTrials = queries.filter((q) => q.trial_count !== manifest.trial_count || !Array.isArray(q.trial_ids) || q.trial_ids.length !== manifest.trial_count || q.trial_ids.some((t) => typeof t !== "string")).map((q) => q.id);
  push("trial-plan", badTrials.length === 0, badTrials.length ? `三试计划不完整：${badTrials.join("、")}` : "全部查询 trial_count=3 且 trial id 稳定");

  const badExpect = queries.filter((q) => {
    const e = q.expect ?? {};
    const fb = e.factBoundary ?? {};
    return !Array.isArray(fb.mustContain) || !Array.isArray(fb.mustNegate) || !Array.isArray(e.wrongConclusions) || !Array.isArray(e.allowedUncertainty) || !Array.isArray(e.evidenceLocations) || e.evidenceLocations.length === 0 || !Array.isArray(e.riskTags) || e.riskTags.length === 0;
  }).map((q) => q.id);
  push("query-expect-complete", badExpect.length === 0, badExpect.length ? `expect 不完整：${badExpect.join("、")}` : "全部查询 expect 完整");

  // 8. 裁判与材料一致
  push("oracle-material-hash", oracle.material_hash === material.hash, oracle.material_hash === material.hash ? "oracle 指向当前材料哈希" : `oracle=${oracle.material_hash} material=${material.hash}`);

  // 9. 裸实体词：mustNegate/wrongConclusions 不得单独使用人名/地名/物名（正确回答会合法提及，导致误判）
  const spec = STORY_SPECS[tierKey];
  const entityNames = new Set([
    ...(spec?.characters ?? []).map((c) => c.name),
    ...(spec?.places ?? []),
    ...(spec?.objects ?? []),
  ]);
  const bareEntities = queries.flatMap((q) => {
    const fb = q.expect?.factBoundary ?? {};
    const phrases = [...(fb.mustNegate ?? []), ...(q.expect?.wrongConclusions ?? [])];
    return phrases.filter((p) => entityNames.has(p)).map((p) => `${q.id}:「${p}」`);
  });
  push("no-bare-entity-in-boundary", bareEntities.length === 0, bareEntities.length ? `裸实体词：${bareEntities.join("、")}` : "mustNegate/wrongConclusions 无裸实体词");

  return { tier: tierKey, ok: checks.every((c) => c.ok), checks };
}

/** 从磁盘读取全部档位并校验。返回 { ok, manifest, tiers: [{tier, ok, checks}] }。 */
export function validateAll(manifest, materials, oracles) {
  const results = manifest.tiers.map((t) => validateTier(t.tier, manifest, materials[t.tier], oracles[t.tier]));
  return { ok: results.every((r) => r.ok), manifest, tiers: results };
}

export function loadFromDisk() {
  const manifest = readJson(MANIFEST_PATH);
  const materials = {};
  const oracles = {};
  for (const t of manifest.tiers) {
    materials[t.tier] = readJson(join(MATERIALS_DIR, `tier-${t.tier}.json`));
    oracles[t.tier] = readJson(join(ORACLE_DIR, `tier-${t.tier}.json`));
  }
  return { manifest, materials, oracles };
}

function main() {
  const { manifest, materials, oracles } = loadFromDisk();
  const report = validateAll(manifest, materials, oracles);
  for (const tier of report.tiers) {
    console.log(`\n== ${tier.tier} ==`);
    for (const c of tier.checks) {
      console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}${c.detail ? " — " + c.detail : ""}`);
    }
    console.log(`  => ${tier.ok ? "OK" : "FAILED"}`);
  }
  const failed = report.tiers.flatMap((t) => t.checks.filter((c) => !c.ok));
  console.log(`\nVALIDATION ${report.ok ? "PASSED" : "FAILED"}（${failed.length} 项失败）`);
  process.exitCode = report.ok ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
