// schema.mjs — 回答可靠性测试器的案例格式与校验（change: add-answer-reliability-tester-core 任务 1.1）
//
// 案例是结构化 JSON / JSONL，字段语义（design.md D2）：
//   id          案例标识（必填，唯一）
//   description 人类可读说明（可选）
//   material    材料身份：name/version/hash/text。hash = sha256(text) 的 16 进制，
//               前缀 "sha256:"；text 是离线固定材料正文（不是用户作品）。
//   steps       前置多轮用户提问（可选，每个 {text} 都会得到一次真实回答并记入证据，但不评分）
//   question    最终评分问题（必填）
//   expect      评分边界：factBoundary（mustContain 应断言的事实 / mustNegate 应否定的旧事实）、
//               wrongConclusions（明确错误结论）、allowedUncertainty（允许的不确定表达，非空表示
//               该案例接受"未知/不确定"为正确回答）、evidenceLocations（原文依据位置）、
//               riskTags（风险标签）。
//   timeoutMs   该案例单轮超时（可选，默认 180000）
//
// 本模块只做纯函数校验，不发送任何消息、不写任何文件。
import { createHash } from "node:crypto";

const MATERIAL_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function materialHash(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNonEmptyStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isNonEmptyString(x));
}

/**
 * 校验单个案例对象。返回 { ok, errors }；errors 为人类可读的错误说明数组。
 * 不修改传入对象。校验通过不代表能安全运行，只代表结构完整、材料身份自洽。
 */
export function validateCase(c) {
  const errors = [];
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    return { ok: false, errors: ["案例必须是对象"] };
  }

  if (!isNonEmptyString(c.id)) errors.push("缺少案例标识 id（非空字符串）");

  // 材料身份
  const m = c.material;
  if (m === null || typeof m !== "object" || Array.isArray(m)) {
    errors.push("缺少材料身份 material（对象）");
  } else {
    if (!isNonEmptyString(m.name)) errors.push("material.name 缺失（非空字符串）");
    if (!isNonEmptyString(m.version)) errors.push("material.version 缺失（非空字符串）");
    if (typeof m.hash !== "string" || !MATERIAL_HASH_RE.test(m.hash)) {
      errors.push("material.hash 必须是 sha256:<64位十六进制>");
    } else if (isNonEmptyString(m.text) && materialHash(m.text) !== m.hash) {
      errors.push("material.hash 与 material.text 不匹配（材料被改动但哈希未更新）");
    }
    if (!isNonEmptyString(m.text)) errors.push("material.text 缺失（非空字符串）");
  }

  // 问题
  if (!isNonEmptyString(c.question)) errors.push("缺少评分问题 question（非空字符串）");

  // 前置多轮步骤（可选）
  if (c.steps !== undefined) {
    if (!Array.isArray(c.steps)) {
      errors.push("steps 必须是数组");
    } else {
      c.steps.forEach((s, i) => {
        if (s === null || typeof s !== "object" || !isNonEmptyString(s.text)) {
          errors.push(`steps[${i}].text 缺失（非空字符串）`);
        }
      });
    }
  }

  // 评分边界
  const e = c.expect;
  if (e === null || typeof e !== "object" || Array.isArray(e)) {
    errors.push("缺少评分边界 expect（对象）");
  } else {
    const fb = e.factBoundary;
    if (fb === null || typeof fb !== "object" || Array.isArray(fb)) {
      errors.push("expect.factBoundary 必须是对象");
    } else {
      if (fb.mustContain !== undefined && !isStringArray(fb.mustContain)) {
        errors.push("expect.factBoundary.mustContain 必须是字符串数组");
      }
      if (fb.mustNegate !== undefined && !isStringArray(fb.mustNegate)) {
        errors.push("expect.factBoundary.mustNegate 必须是字符串数组");
      }
    }
    if (e.wrongConclusions !== undefined && !isStringArray(e.wrongConclusions)) {
      errors.push("expect.wrongConclusions 必须是字符串数组");
    }
    if (e.allowedUncertainty !== undefined && !isStringArray(e.allowedUncertainty)) {
      errors.push("expect.allowedUncertainty 必须是字符串数组");
    }
    if (!isNonEmptyStringArray(e.evidenceLocations)) {
      errors.push("expect.evidenceLocations 缺失（非空字符串数组，说明原文依据位置）");
    }
    if (!isNonEmptyStringArray(e.riskTags)) {
      errors.push("expect.riskTags 缺失（非空字符串数组，说明风险标签）");
    }
  }

  // 可选超时
  if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== "number" || !Number.isFinite(c.timeoutMs) || c.timeoutMs <= 0)) {
    errors.push("timeoutMs 必须是正数");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 解析案例源文本：支持单个 JSON 对象、JSON 数组，或 JSONL（每行一个对象）。
 * 返回 { ok, objects, error }。空行忽略。任何解析错误都整体失败并给出行号。
 */
export function parseCaseSource(text) {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, objects: [], error: "案例源为空" };

  // 先按 JSON 解析（单对象或数组）
  try {
    const parsed = JSON.parse(trimmed);
    const objects = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, objects, error: null };
  } catch {
    // 不是合法 JSON → 按 JSONL 逐行解析
  }

  const objects = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      objects.push(JSON.parse(line));
    } catch (err) {
      return { ok: false, objects, error: `第 ${i + 1} 行 JSON 解析失败：${String(err.message ?? err)}` };
    }
  }
  if (objects.length === 0) return { ok: false, objects, error: "没有解析出任何案例对象" };
  return { ok: true, objects, error: null };
}

/**
 * 解析 + 逐案例校验。返回 { valid, invalid, parseError }。
 * valid/invalid 元素为 { case, index }；invalid 附带 errors。parseError 为解析级错误（字符串或 null）。
 */
export function loadAndValidate(text) {
  const parsed = parseCaseSource(text);
  if (!parsed.ok) return { valid: [], invalid: [], parseError: parsed.error };

  const valid = [];
  const invalid = [];
  parsed.objects.forEach((c, index) => {
    const r = validateCase(c);
    if (r.ok) valid.push({ case: c, index });
    else invalid.push({ case: c, index, errors: r.errors });
  });
  return { valid, invalid, parseError: null };
}
