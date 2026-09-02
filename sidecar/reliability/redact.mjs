// redact.mjs — 回答可靠性测试器的密钥脱敏（change: add-answer-reliability-tester-core 任务 3.3）
//
// API key 只经 DEEPSEEK_API_KEY 环境变量注入（与 driver.mjs 一致），绝不落盘。
// 本模块提供：脱敏替换、泄漏检测。证据、stdout、stderr 序列化前必须经 redactSecrets 处理，
// 写入后再用 findSecretLeaks 复核。
const GENERIC_KEY_SOURCE = "sk-[A-Za-z0-9_-]{8,}";

/** 每次取新正则，避免共享 /g 正则 .test() 的 lastIndex 副作用。 */
function genericKeyRe(global = true) {
  return new RegExp(GENERIC_KEY_SOURCE, global ? "g" : "");
}

/** 需要脱敏的密钥集合（至少含环境 key；可扩展其它 secret）。 */
export function secretsFromEnv(apiKey) {
  const set = new Set();
  if (apiKey && typeof apiKey === "string" && apiKey.length >= 4) set.add(apiKey);
  return [...set];
}

/** 将文本中的精确密钥与通用 sk- 模式替换为 [REDACTED]。返回新字符串。 */
export function redactSecrets(text, secrets) {
  let out = String(text);
  for (const s of secrets) {
    if (s && typeof s === "string" && s.length >= 4) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  return out.replace(genericKeyRe(), "[REDACTED]");
}

/** 深度遍历对象，对所有字符串值做 redactSecrets。返回新对象，不修改入参。 */
export function redactObject(obj, secrets) {
  if (typeof obj === "string") return redactSecrets(obj, secrets);
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, secrets));
  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactObject(v, secrets);
    return out;
  }
  return obj;
}

/**
 * 在序列化文本中查找泄漏：返回泄漏类型数组（"exact-key" / "sk-pattern"）。空数组 = 无泄漏。
 * "sk-pattern" 只在存在除精确密钥以外的其它 sk- 令牌时报告，避免同一把 key 重复计数。
 */
export function findSecretLeaks(text, secrets) {
  const leaks = [];
  let remaining = String(text);
  for (const secret of secrets) {
    if (secret && typeof secret === "string" && secret.length >= 4 && remaining.includes(secret)) {
      leaks.push("exact-key");
      remaining = remaining.split(secret).join("");
      break;
    }
  }
  if (genericKeyRe(false).test(remaining)) leaks.push("sk-pattern");
  return leaks;
}

/** 断言序列化后的证据/诊断不含任何密钥。返回 { ok, leaks }。 */
export function assertNoSecrets(serialized, secrets) {
  const leaks = findSecretLeaks(serialized, secrets);
  return { ok: leaks.length === 0, leaks };
}
