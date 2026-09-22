// screening.mjs — 回答可靠性测试器的保守自动初筛（change: add-answer-reliability-tester-core 任务 4.x；
//   fix-reliability-scorer-mislabels 任务 1/2：mustContain 有界间隙命中＋mustNegate 等价否定形式）
//
// 结果四态（design.md D3）：
//   PASS_LIKELY    证据足够明确，倾向通过
//   FAIL_LIKELY    明确断言了错误结论 / 被取代旧事实 / 空回答
//   NEEDS_REVIEW   否定、引用、未知、事实与推测边界等无法安全判定的自然语言
//   RUNTIME_ERROR  驱动起不来、超时、提前退出、协议错误、敏感信息泄漏（由 runner 判定）
//
// 核心立场：只用关键词做"足够明确"的判定；一旦存在否定、引用、不确定、推断歧义，
// 一律落到 NEEDS_REVIEW，绝不把关键词匹配冒充绝对裁判。规则只核对案例声明的事实边界，
// 不评价创意质量或故事方向。
export const RESULT_PASS_LIKELY = "PASS_LIKELY";
export const RESULT_FAIL_LIKELY = "FAIL_LIKELY";
export const RESULT_NEEDS_REVIEW = "NEEDS_REVIEW";
export const RESULT_RUNTIME_ERROR = "RUNTIME_ERROR";

export const ALL_RESULTS = [RESULT_PASS_LIKELY, RESULT_FAIL_LIKELY, RESULT_NEEDS_REVIEW, RESULT_RUNTIME_ERROR];

// 显式"未知/未提及"标记：未知信息案例中，这些表达构成正确回答。
const EXPLICIT_UNKNOWN_MARKERS = [
  "未知", "不确定", "无法确定", "不能确定", "无法判断", "不能判断", "不得而知", "无从得知",
  "未提及", "没有提到", "没有提及", "并未提及", "没有说明", "未说明", "没有交代", "未交代", "不清楚", "材料中没有",
  "无法得知", "没有提供", "没有出现", "文中没有", "未提供", "不存在",
];

// 推断/保留措辞标记：事实与推测边界，出现即进入人工复核。
const HEDGE_MARKERS = ["可能", "也许", "或许", "大概", "似乎", "推测", "推断", "疑似", "大约", "也许不", "可能不"];

// 否定词：出现在目标短语之前的窗口内，视为该短语被否定。
// 含中文"否认/否定"类明确否认动词，识别「否认偷书」这类否定表述（fix-negated-quotation-screening 后续根因）。
// 另含「脱离/停止旧状态」类动词（辞去、离开、放弃、停止等），识别「辞去了盐镇中学的工作」这类语义否定（fix-screener-false-failures 根因 A）。
const NEGATION_MARKERS = [
  "没有", "并未", "并非", "不是", "并不", "不曾", "从未", "否认", "否定", "没", "不", "非", "无", "未",
  "辞去", "辞职", "离职", "辞退", "离开", "放弃", "停止", "不再", "退出", "卸任", "终止", "中断",
];

// 间隙匹配（design D1）：单段间隙的最大字符数与阻断标记。
// 间隙含否定/过去标记（子串包含即算）即视为不满足——宁可漏命中，也不把
// 「前邮差」「曾是邮差」这类过去/否定表述当成命中（保守方向阻断）。
export const GAP_CHAR_LIMIT = 8;
export const GAP_BLOCKING_MARKERS = [
  "不", "没", "非", "无", "未", "不曾", "不再是", "曾", "原来", "以前", "前", "已经", "已",
];

// 引号对：短语出现在引号内，视为引用而非模型自己的断言。
const QUOTE_PAIRS = [
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ["‘", "’"],
  ['"', '"'],
  ["'", "'"],
];

// 否定/引用判定窗口（短语前的字符数）
const NEGATION_WINDOW = 8;

function lower(s) {
  return String(s).toLowerCase();
}

/**
 * 评分前剥离常见 markdown 标记（design D1）：`**`、`*`、`>`、`#`、反引号。
 * 只用于评分，不用于保存；证据仍保留原始回答。剥离后短语可恢复连续，
 * 例如「**不在**印刷厂工作」→「不在印刷厂工作」。
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/>/g, "")
    .replace(/#/g, "");
}

/** 目标短语在文本中的首次出现位置（大小写不敏感，中文无影响）。找不到返回 -1。 */
export function indexOfPhrase(text, phrase) {
  return lower(text).indexOf(lower(phrase));
}

/** 短语是否被引号包裹或处于未闭合引号内。 */
export function isQuoted(text, idx, len) {
  const before = text[idx - 1] ?? "";
  const after = text[idx + len] ?? "";
  for (const [open, close] of QUOTE_PAIRS) {
    if (before === open && after === close) return true;
  }
  const prefix = text.slice(0, idx);
  for (const [open, close] of QUOTE_PAIRS) {
    if (prefix.lastIndexOf(open) > prefix.lastIndexOf(close)) return true;
  }
  return false;
}

// 子句边界标点：否定作用域不跨越这些标点，避免「否认偷书，但其实偷了」的第二个「偷」被前文「否认」误判为否定。
const CLAUSE_BOUNDARIES = ["，", "。", "；", "！", "？", "、", "：", "…", "\n"];

/** 短语出现位置之前的小窗口内是否含否定词（不跨子句边界）。 */
export function hasNegationBefore(text, idx) {
  let window = text.slice(Math.max(0, idx - NEGATION_WINDOW), idx);
  let lastBoundary = -1;
  for (const b of CLAUSE_BOUNDARIES) {
    lastBoundary = Math.max(lastBoundary, window.lastIndexOf(b));
  }
  if (lastBoundary >= 0) window = window.slice(lastBoundary + 1);
  return NEGATION_MARKERS.some((m) => window.includes(m));
}

/**
 * 对单个短语做三值判定（仅首次出现，公开返回形状保持稳定）：
 *   "asserted" 短语明确出现且未被否定、未被引用（模型自己的断言）
 *   "negated"  短语出现但被否定（"没去北京"中的"北京"）
 *   "quoted"   短语出现在引号内（引用，无法判定是否模型自己的结论）
 *   "absent"   短语未出现
 */
export function classifyPhrase(text, phrase) {
  if (!phrase || typeof phrase !== "string") return "absent";
  const idx = indexOfPhrase(text, phrase);
  if (idx < 0) return "absent";
  if (isQuoted(text, idx, phrase.length)) return "quoted";
  if (hasNegationBefore(text, idx)) return "negated";
  return "asserted";
}

/** 目标短语在文本中的所有出现位置（大小写不敏感，中文无影响）。找不到返回空数组。 */
export function findPhraseOccurrences(text, phrase) {
  if (!phrase || typeof phrase !== "string") return [];
  const haystack = lower(text);
  const needle = lower(phrase);
  if (needle === "") return [];
  const positions = [];
  let start = 0;
  while (true) {
    const idx = haystack.indexOf(needle, start);
    if (idx < 0) break;
    positions.push(idx);
    start = idx + needle.length;
  }
  return positions;
}

/**
 * 对单次出现做细分分类（比 classifyPhrase 多一个"引用内否定"）：
 *   "asserted"       未引用、未否定的直接断言（模型自己的立场）
 *   "negated"        未引用、被否定的表达
 *   "quoted"         引用内且引用内未否定（无法判定是否模型结论）
 *   "quoted-negated" 引用内明确否定（"我没有偷书"中的"偷"）
 */
function classifyOccurrence(text, idx, len) {
  const quoted = isQuoted(text, idx, len);
  const negated = hasNegationBefore(text, idx);
  if (quoted && negated) return "quoted-negated";
  if (quoted) return "quoted";
  if (negated) return "negated";
  return "asserted";
}

/** 目标短语在文本中的所有出现逐次分类。找不到返回空数组。 */
export function classifyPhraseOccurrences(text, phrase) {
  return findPhraseOccurrences(text, phrase).map((idx) => classifyOccurrence(text, idx, lower(phrase).length));
}

/** 是否存在未被引用、未被否定的直接断言出现（模型自己的立场）。 */
function hasAssertedOccurrence(text, phrase) {
  return classifyPhraseOccurrences(text, phrase).some((c) => c === "asserted");
}

// ── mustContain 有界间隙命中（design D1，fix-reliability-scorer-mislabels 任务 1）────

/** 间隙是否干净：非空、不超限、不含子句边界标点、不含否定/过去标记。 */
function gapIsClean(haystack, from, to) {
  const gap = haystack.slice(from, to);
  if (gap.length === 0 || gap.length > GAP_CHAR_LIMIT) return false;
  if (CLAUSE_BOUNDARIES.some((b) => gap.includes(b))) return false;
  if (GAP_BLOCKING_MARKERS.some((m) => gap.includes(m))) return false;
  return true;
}

/**
 * 从 haystack[t] 起放一段与 needle[pi..] 连续匹配的段（长度 ≥2），再递归放后续段。
 * 段长从最大连续可匹配长度往下试（末段也须 ≥2 字符，缩短前段有时是唯一拆法）。
 * 返回段定位数组 [{start,end},...]；放不下返回 null。
 */
function placeSegmentsFrom(haystack, needle, pi, t, acc) {
  let run = 0;
  while (pi + run < needle.length && haystack[t + run] === needle[pi + run]) run++;
  for (let len = run; len >= 2; len--) {
    const end = t + len;
    const next = [...acc, { start: t, end }];
    if (pi + len === needle.length) return next;
    let from = end;
    while (true) {
      const j = haystack.indexOf(needle[pi + len], from);
      if (j < 0) break;
      if (gapIsClean(haystack, end, j)) {
        const res = placeSegmentsFrom(haystack, needle, pi + len, j, next);
        if (res) return res;
      }
      from = j + 1;
    }
  }
  return null;
}

/**
 * 有界间隙子序列匹配（design D1，仅用于 mustContain 满足判定）：
 * 连续匹配失败后，把短语按原字符顺序在归一化文本中定位为若干连续段（每段 ≥2 字符；
 * 短语不足 4 字符时拆不出两段各 ≥2，只允许连续匹配）。段间间隙须同时满足：
 *   ① 不含子句边界标点（与否定窗口同一套 CLAUSE_BOUNDARIES）；② 长度 ≤ GAP_CHAR_LIMIT；
 *   ③ 不含 GAP_BLOCKING_MARKERS（否定/过去标记，子串包含即算，保守阻断）。
 * 第一个段的起始位置仍要过 hasNegationBefore（整个出现的否定前窗检查沿用）；
 * 整个跨度按首段位置用现有 isQuoted 判引用（引号内含否定的情况已被 ③ 与前窗检查挡住，
 * 不会经间隙匹配变成 satisfied）。
 * 返回首个满足约束的定位 { start, end, segments: [{ start, end }], quoted }；找不到返回 null。
 */
export function gapMatchOccurrence(text, phrase) {
  if (!phrase || typeof phrase !== "string") return null;
  const haystack = lower(stripMarkdown(String(text ?? "")));
  const needle = lower(phrase);
  if (needle.length < 4) return null;
  const starts = [];
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle[0], from);
    if (i < 0) break;
    starts.push(i);
    from = i + 1;
  }
  for (const start of starts) {
    if (hasNegationBefore(haystack, start)) continue;
    const segments = placeSegmentsFrom(haystack, needle, 0, start, []);
    if (segments) {
      const last = segments[segments.length - 1];
      const spanLen = last.end - start;
      return { start, end: last.end, segments, quoted: isQuoted(haystack, start, spanLen) };
    }
  }
  return null;
}

/**
 * mustContain 专用：是否存在未被否定的出现（直接断言或引用）（design D2）。
 * 引用正确事实作答 = 模型自己的结论，故引用也命中；只有被否定才不算命中。
 * 连续匹配失败后再尝试有界间隙子序列匹配（design D1）：「陈渡是北境的一名邮差」
 * 命中「陈渡是邮差」类修饰语插入可命中；间隙跨子句边界、超限或含否定/过去标记仍不命中。
 */
function hasSatisfiedOccurrence(text, phrase) {
  if (classifyPhraseOccurrences(text, phrase).some((c) => c === "asserted" || c === "quoted")) return true;
  return gapMatchOccurrence(text, phrase) !== null;
}

/**
 * mustNegate 目标是否被满足：至少一次明确否定（含引用内否定），且没有未被引用、
 * 未被否定的直接断言与之矛盾。引用否定「我没有偷书」可满足；「她说没偷，但她确实偷了」不可。
 */
function isNegationSatisfied(text, phrase) {
  const occurrences = classifyPhraseOccurrences(text, phrase);
  const negated = occurrences.some((c) => c === "negated" || c === "quoted-negated");
  const affirmed = occurrences.some((c) => c === "asserted");
  return negated && !affirmed;
}

// ── mustNegate 等价否定形式（design D2，fix-reliability-scorer-mislabels 任务 2）────

/** 读取 factBoundary.negationEquivalents：键 = 同查询 mustNegate 短语，值 = 转述等价短语数组。 */
function readNegationEquivalents(fb) {
  const eq = fb?.negationEquivalents;
  if (!eq || typeof eq !== "object" || Array.isArray(eq)) return {};
  return eq;
}

/**
 * 等价否定短语是否出现并表达「旧事实已被否定」（design D2）：
 *   - 短语自带否定/离开语义（如「辞去了盐镇中学的工作」「苏晚不住在盐城」）：
 *     其未被直接否定的出现（asserted/quoted，引用判定按现有 classify 语义）即表达脱离旧状态；
 *     被直接否定（「没有辞去…」）则是在肯定旧状态，不算。
 *   - 短语为纯转述对象：其前窗口须含直接否定或离开动词（negated/quoted-negated，
 *     复用 hasNegationBefore 与 NEGATION_MARKERS）。
 */
function isEquivalentNegationPresent(text, equiv) {
  if (!equiv || typeof equiv !== "string") return false;
  const classes = classifyPhraseOccurrences(text, equiv);
  if (classes.length === 0) return false;
  const selfCarried = NEGATION_MARKERS.some((m) => lower(equiv).includes(m));
  return classes.some((c) =>
    selfCarried
      ? c === "asserted" || c === "quoted"
      : c === "negated" || c === "quoted-negated"
  );
}

/**
 * 单条 mustNegate 的满足判定（design D2）：现行规则成立（原短语出现且被否定且无未引用肯定断言），
 * 或任一声明等价短语出现并表达否定；且原短语无未被引用、未被否定的肯定断言
 * （转述否定但正文又肯定旧事实 → 仍不满足）。无声明时与现行规则完全一致。
 */
export function isEntryNegationSatisfied(text, phrase, negationEquivalents = {}) {
  if (isNegationSatisfied(text, phrase)) return true;
  if (hasAssertedOccurrence(text, phrase)) return false;
  const equivs = negationEquivalents[phrase];
  if (!Array.isArray(equivs)) return false;
  return equivs.some((e) => isEquivalentNegationPresent(text, e));
}

/**
 * 检测答案中的不确定表达，返回 { explicitUnknown: string[], hedge: string[] }。
 * explicitUnknown = 明确说"材料未知/未提及"；hedge = 推断/保留措辞。
 */
export function detectUncertainty(answer) {
  const explicitUnknown = EXPLICIT_UNKNOWN_MARKERS.filter((m) => answer.includes(m));
  const hedge = HEDGE_MARKERS.filter((m) => answer.includes(m));
  return { explicitUnknown, hedge };
}

/**
 * 保守初筛核心。输入案例的 expect 对象与最终回答文本，返回 { result, reasons }。
 * 纯函数，无 IO。判定顺序：空回答 → 明确错误结论 → 被取代旧事实被断言 → 不确定表达 → 事实边界。
 */
export function screenAnswer(expect, answer) {
  const fb = expect?.factBoundary ?? {};
  const mustContain = Array.isArray(fb.mustContain) ? fb.mustContain : [];
  const mustNegate = Array.isArray(fb.mustNegate) ? fb.mustNegate : [];
  const wrongConclusions = Array.isArray(expect?.wrongConclusions) ? expect.wrongConclusions : [];
  const allowedUncertainty = Array.isArray(expect?.allowedUncertainty) ? expect.allowedUncertainty : [];

  // 评分前剥离 markdown（design D1）：只对纯文本评分，证据仍保存原始回答。
  const text = stripMarkdown(typeof answer === "string" ? answer : "");
  if (text.trim() === "") {
    return { result: RESULT_FAIL_LIKELY, reasons: ["空回答（协议完成但无正文）"] };
  }

  // 1. 明确错误结论被断言（未被引用、未被否定的直接断言）→ 直接失败
  const assertedWrongs = wrongConclusions.filter((wc) => hasAssertedOccurrence(text, wc));
  if (assertedWrongs.length > 0) {
    return { result: RESULT_FAIL_LIKELY, reasons: [`断言了明确错误结论：${assertedWrongs.join("、")}`] };
  }

  // 2. 本应否定的旧事实被正向断言 → 直接失败（版本冲突 / 陈旧事实）
  const affirmedOld = mustNegate.filter((f) => hasAssertedOccurrence(text, f));
  if (affirmedOld.length > 0) {
    return { result: RESULT_FAIL_LIKELY, reasons: [`断言了本应否定的旧事实：${affirmedOld.join("、")}`] };
  }

  // 3. 不确定表达
  const { explicitUnknown, hedge } = detectUncertainty(text);

  if (allowedUncertainty.length > 0) {
    // 未知信息案例：正确回答应明确表达"未知/未提及"
    if (explicitUnknown.length > 0) {
      return { result: RESULT_PASS_LIKELY, reasons: [`答案明确表达不确定（${explicitUnknown.join("、")}），符合未知信息预期`] };
    }
    return {
      result: RESULT_NEEDS_REVIEW,
      reasons: [`未知信息案例，答案未表达明确不确定${hedge.length ? `（仅含推断措辞：${hedge.join("、")}）` : "，给出确定性陈述"}，需人工确认是否无依据断言`],
    };
  }

  // 4. 事实边界
  const reasons = [];

  // mustContain 采用非对称引文处理：出现即命中（含引用，只要未被否定）（design D2）。
  const missing = mustContain.filter((f) => !hasSatisfiedOccurrence(text, f));
  if (missing.length > 0) reasons.push(`未明确命中预期事实：${missing.join("、")}`);

  // mustNegate：现行连续否定规则，或声明的等价否定形式出现（design D2）。
  const negationEquivalents = readNegationEquivalents(fb);
  const unnegated = mustNegate.filter((f) => !isEntryNegationSatisfied(text, f, negationEquivalents));
  if (unnegated.length > 0) reasons.push(`未明确否定旧事实：${unnegated.join("、")}`);

  const quotedWrongs = wrongConclusions.filter((wc) => classifyPhraseOccurrences(text, wc).some((c) => c === "quoted"));
  if (quotedWrongs.length > 0) reasons.push(`错误结论以引用形式出现，无法判定：${quotedWrongs.join("、")}`);

  if (reasons.length > 0) {
    // 结论本身不确定：事实边界未命中 / 未否定 / 引用错误结论，含推断措辞时一并注明（design D4）。
    if (hedge.length > 0) reasons.push(`答案含推断措辞：${hedge.join("、")}`);
    return { result: RESULT_NEEDS_REVIEW, reasons };
  }

  // 事实边界已明确命中，但答案仍显式表达"未知"（如「材料没提到」）→ 保守复核。
  if (explicitUnknown.length > 0) {
    return { result: RESULT_NEEDS_REVIEW, reasons: [`答案含不确定表达（${explicitUnknown.join("、")}），但案例预期确定性事实，需人工复核`] };
  }

  // 事实边界明确命中、无错误结论、无显式未知：单有推断措辞不阻断（design D4）。
  if (hedge.length > 0) {
    return { result: RESULT_PASS_LIKELY, reasons: [`命中预期事实边界；含推断措辞（${hedge.join("、")}）但结论明确，不阻断`] };
  }
  return { result: RESULT_PASS_LIKELY, reasons: ["命中预期事实边界，且无错误结论/不确定表达"] };
}

/** 人类复核结论（design.md D3）：独立于自动结果，另存。 */
export const REVIEW_OUTCOMES = ["MODEL_OK", "MODEL_ERROR", "SCORER_ERROR", "UNRESOLVED"];
