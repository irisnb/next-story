// generator.mjs — 长上下文幻觉测试的确定性材料生成器（change: add-long-context-hallucination-fixtures 任务 1.2/1.3）
//
// 从 story-specs.mjs 的「单一真相源」+ manifest.json 的档位配置，确定性生成：
//   material  —— 中文合成小说正文（正文只含事实与铺陈，不含裁判元数据），
//                并附带身份、种子、实际字数、估算 token 数与内容哈希；
//   oracle    —— 独立的事实裁判元数据（实体、锚点、查询矩阵、三试计划），绝不进入正文。
//
// 确定性保证：正文由「硬编码锚点语句 + 种子伪随机填充」拼成，同一 seed 恒产出同一正文与哈希。
// 本模块导出纯函数供 validator / 测试复用；作为 CLI 运行时写盘（或 --check 只校验不写盘）。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { STORY_SPECS } from "./story-specs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "manifest.json");
const MATERIALS_DIR = join(__dirname, "materials");
const ORACLE_DIR = join(__dirname, "oracle");

/** 手写档正文文件名约定：materials/<tier>.txt（纯文本，不经种子生成）。tierKey 本身即 "coherent-10k"。 */
function handwrittenTextPath(tierKey) {
  return join(MATERIALS_DIR, `${tierKey}.txt`);
}

// ── 基础工具 ────────────────────────────────────────────────────────────────────

/** 内容哈希：sha256:<64 位十六进制>，与 schema.mjs 的约定一致。 */
export function materialHash(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

/** 按 Unicode 码点计字（中文一字一码点，比 UTF-16 长度更符合「字数」直觉）。 */
export function countChars(s) {
  return [...s].length;
}

/** 估算 token 数：字数 × 每字 token 比例（估算值，供应商相关，见 manifest）。 */
export function estimateTokens(charCount, tokensPerChar) {
  return Math.round(charCount * tokensPerChar);
}

/** 确定性伪随机数生成器（mulberry32）。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// ── 中文数字（章节号）────────────────────────────────────────────────────────────

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function cnChapterNumber(n) {
  if (n <= 0) return String(n);
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return "十" + (n % 10 === 0 ? "" : CN_DIGITS[n % 10]);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return CN_DIGITS[tens] + "十" + (ones === 0 ? "" : CN_DIGITS[ones]);
  }
  return String(n);
}

// ── 填充模板与通用词汇 ──────────────────────────────────────────────────────────
//
// 填充句只用于把正文拉到目标字数并制造「无关内容」，语义上不与任何锚点事实冲突。
// 占位符：{char} 人物、{place} 地点、{obj} 物件、{spot} 处所、{weather} 天气、{time} 时间。

const WEATHER = ["细雨", "浓雾", "海风", "薄雪", "斜阳", "晨露", "晚风", "山风"];
const TIMES = ["清晨", "黄昏", "午后", "午夜", "黎明", "傍晚", "深夜", "清晨"];

const TEMPLATES = [
  "{time}，{place}起了{weather}，{char}沿着{spot}慢慢往前走。",
  "{char}在{place}停留了许久，{weather}从{spot}的方向吹来。",
  "关于{obj}，{char}心里始终没有确定的答案。",
  "{char}把{obj}轻轻收进{spot}，随后转身离开{place}。",
  "{time}的{place}格外安静，只有{weather}的声音。",
  "{char}记得那年{weather}很大，{place}的{spot}都被遮住了。",
  "没有人知道{char}为什么会在{time}独自来到{place}。",
  "{char}望着{place}出神，直到{weather}渐起才回过神来。",
  "{obj}已经旧了，可{char}还是舍不得丢掉。",
  "在{place}的{spot}旁，{char}和往常一样坐到了{time}。",
  "{weather}落在{place}，把{spot}染成一片灰白。",
  "{char}犹豫了一下，还是把{obj}放进了{spot}里。",
  "那些关于{place}的往事，{char}只偶尔在{time}才会想起。",
  "{char}沿着{place}的小路走到{spot}，天色已经暗了。",
  "{time}刚过，{char}便起身赶往{place}。",
  "{weather}里，{place}的轮廓显得模糊而遥远。",
  "{char}在{spot}前停下，耳边只有{weather}掠过{place}。",
  "这已经是{char}第不知道多少次想起{place}了。",
  "{obj}和{spot}一起，成了{char}在{place}的全部念想。",
  "{char}没有回头，径直走进了{place}的{weather}之中。",
];

function renderTemplate(template, rand, spec) {
  const chars = spec.characters.map((c) => c.name);
  return template
    .replaceAll("{char}", pick(rand, chars))
    .replaceAll("{place}", pick(rand, spec.places))
    .replaceAll("{obj}", pick(rand, spec.objects))
    .replaceAll("{spot}", pick(rand, spec.spots))
    .replaceAll("{weather}", pick(rand, WEATHER))
    .replaceAll("{time}", pick(rand, TIMES));
}

function buildFillerParagraph(rand, spec) {
  const n = 2 + Math.floor(rand() * 3); // 2-4 句
  const sentences = [];
  for (let i = 0; i < n; i++) {
    sentences.push(renderTemplate(pick(rand, TEMPLATES), rand, spec));
  }
  return sentences.join("");
}

// ── 正文构建 ────────────────────────────────────────────────────────────────────

function buildText(spec, seed, targetChars) {
  const rand = mulberry32(seed);
  const parts = [];
  const emit = (s) => parts.push(s);
  const currentLength = () => countChars(parts.join(""));

  emit(`《${spec.title}》\n\n`);

  // 锚点章节（固定）：事实逐字写入，并附少量填充使行文自然。
  for (const ch of spec.chapters) {
    emit(`第${cnChapterNumber(ch.number)}章 ${ch.title}\n\n`);
    for (const a of ch.anchors) {
      emit(a.statement + "\n\n");
    }
    const extra = 1 + Math.floor(rand() * 2); // 1-2 段填充
    for (let i = 0; i < extra; i++) emit(buildFillerParagraph(rand, spec) + "\n\n");
  }

  // 填充章节：把正文拉到目标字数（远距召回依赖这些「无关内容」把早期事实埋深）。
  let chapterNo = spec.chapters.length + 1;
  while (currentLength() < targetChars) {
    emit(`第${cnChapterNumber(chapterNo)}章 ${spec.fillerTitles[(chapterNo - 1) % spec.fillerTitles.length]}\n\n`);
    const paras = 5 + Math.floor(rand() * 7); // 5-11 段
    for (let i = 0; i < paras; i++) emit(buildFillerParagraph(rand, spec) + "\n\n");
    chapterNo++;
  }

  return parts.join("");
}

// ── 锚点/实体汇总 ──────────────────────────────────────────────────────────────

function collectAnchors(spec) {
  const anchors = [];
  for (const ch of spec.chapters) {
    for (const a of ch.anchors) {
      anchors.push({ id: a.id, chapter: ch.number, category: a.category, entity: a.entity, statement: a.statement });
    }
  }
  return anchors;
}

// ── 生成单档：material + oracle ─────────────────────────────────────────────────

export function generateTier(tierKey, manifest) {
  const tierCfg = manifest.tiers.find((t) => t.tier === tierKey);
  if (!tierCfg) throw new Error(`manifest 缺少档位 ${tierKey}`);
  const spec = STORY_SPECS[tierKey];
  if (!spec) throw new Error(`story-specs 缺少档位 ${tierKey}`);
  if (spec.title !== tierCfg.title) throw new Error(`${tierKey} 标题不一致：spec=${spec.title} manifest=${tierCfg.title}`);

  let text;
  let seed = tierCfg.seed;
  if (spec.handwritten) {
    // 手写档：正文来自手写 txt，不走种子生成；seed 记 null 表示非生成档。
    const txtPath = handwrittenTextPath(tierKey);
    if (!existsSync(txtPath)) throw new Error(`手写档缺少正文文件：${txtPath}`);
    text = readFileSync(txtPath, "utf8");
    seed = null;
  } else {
    text = buildText(spec, tierCfg.seed, tierCfg.target_chars);
  }
  const charCount = countChars(text);

  const material = {
    schema_version: 1,
    tier: tierKey,
    name: tierCfg.title,
    version: tierCfg.version,
    seed,
    target_chars: tierCfg.target_chars,
    char_count: charCount,
    estimated_tokens: estimateTokens(charCount, manifest.estimated_tokens_per_char),
    hash: materialHash(text),
    text,
  };

  const anchors = collectAnchors(spec);
  const trialCount = manifest.trial_count ?? 3;
  const queries = spec.queries.map((q) => ({
    id: q.id,
    category: q.category,
    description: q.description,
    question: q.question,
    steps: q.steps ? q.steps.map((s) => ({ text: s.text })) : [],
    expect: {
      factBoundary: {
        mustContain: q.expect.factBoundary.mustContain ?? [],
        mustNegate: q.expect.factBoundary.mustNegate ?? [],
      },
      wrongConclusions: q.expect.wrongConclusions ?? [],
      allowedUncertainty: q.expect.allowedUncertainty ?? [],
      evidenceLocations: q.expect.evidenceLocations ?? [],
      riskTags: [...(q.expect.riskTags ?? []), "long-context"],
    },
    trial_count: trialCount,
    trial_ids: [1, 2, 3].map((n) => `${q.id}-t${n}`),
  }));

  const oracle = {
    schema_version: 1,
    tier: tierKey,
    material_name: tierCfg.title,
    material_version: tierCfg.version,
    material_hash: material.hash,
    entities: spec.characters.map((c, i) => ({ id: `e${i + 1}`, name: c.name, role: c.role })),
    anchors,
    queries,
    query_count: queries.length,
  };

  return { material, oracle };
}

// ── 文件 IO 与 CLI ──────────────────────────────────────────────────────────────

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function writeAll(manifest) {
  mkdirSync(MATERIALS_DIR, { recursive: true });
  mkdirSync(ORACLE_DIR, { recursive: true });
  for (const t of manifest.tiers) {
    const { material, oracle } = generateTier(t.tier, manifest);
    writeFileSync(join(MATERIALS_DIR, `tier-${t.tier}.json`), JSON.stringify(material, null, 2) + "\n", "utf8");
    writeFileSync(join(ORACLE_DIR, `tier-${t.tier}.json`), JSON.stringify(oracle, null, 2) + "\n", "utf8");
    console.log(
      `生成 ${t.tier}：${material.name} 字数=${material.char_count}（目标 ${material.target_chars}）token≈${material.estimated_tokens} 哈希=${material.hash}`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const manifest = readManifest();

  if (!checkOnly) {
    writeAll(manifest);
    return;
  }

  // --check：只重新生成并与已检入文件比对，不写盘。
  let ok = true;
  for (const t of manifest.tiers) {
    const { material, oracle } = generateTier(t.tier, manifest);
    let materialMatch = false;
    let oracleMatch = false;
    try {
      const onDisk = JSON.parse(readFileSync(join(MATERIALS_DIR, `tier-${t.tier}.json`), "utf8"));
      materialMatch = onDisk.hash === material.hash && onDisk.char_count === material.char_count;
    } catch { materialMatch = false; }
    try {
      const onDisk = JSON.parse(readFileSync(join(ORACLE_DIR, `tier-${t.tier}.json`), "utf8"));
      oracleMatch = JSON.stringify(onDisk) === JSON.stringify(oracle);
    } catch { oracleMatch = false; }
    console.log(
      `${t.tier}: material=${materialMatch ? "一致" : "不一致"} oracle=${oracleMatch ? "一致" : "不一致"} 字数=${material.char_count}`,
    );
    if (!materialMatch || !oracleMatch) ok = false;
  }
  process.exitCode = ok ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
