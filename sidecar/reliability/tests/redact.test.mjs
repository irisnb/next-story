// redact.test.mjs — 密钥脱敏的本地单元测试（change: add-answer-reliability-tester-core 任务 5.1）
import assert from "node:assert/strict";
import test from "node:test";

import { secretsFromEnv, redactSecrets, redactObject, findSecretLeaks, assertNoSecrets } from "../redact.mjs";

const KEY = "sk-e4b4b0123456789abcdef0123456789";

test("secretsFromEnv 忽略过短或空值", () => {
  assert.deepEqual(secretsFromEnv("ab"), []);
  assert.deepEqual(secretsFromEnv(null), []);
  assert.deepEqual(secretsFromEnv(KEY), [KEY]);
});

test("redactSecrets 替换精确密钥与通用 sk- 模式", () => {
  const out = redactSecrets(`url=${KEY}`, [KEY]);
  assert.equal(out.includes(KEY), false);
  assert.ok(out.includes("[REDACTED]"));
  assert.equal(redactSecrets("token sk-abc12345678901234", []).includes("sk-abc"), false);
});

test("redactObject 深度脱敏字符串值", () => {
  const obj = { a: { b: `x${KEY}y` }, c: ["sk-zzzz9999999999999", 1] };
  const out = redactObject(obj, [KEY]);
  assert.equal(JSON.stringify(out).includes(KEY), false);
  assert.equal(JSON.stringify(out).includes("sk-zzzz"), false);
});

test("findSecretLeaks 检测精确密钥与 sk- 模式", () => {
  assert.deepEqual(findSecretLeaks(`hello ${KEY}`, [KEY]), ["exact-key"]);
  assert.deepEqual(findSecretLeaks("token sk-abc123456789", [KEY]), ["sk-pattern"]);
  assert.deepEqual(findSecretLeaks("nothing here", [KEY]), []);
});

test("assertNoSecrets 对干净内容通过，对含密钥内容失败", () => {
  assert.equal(assertNoSecrets("clean text", [KEY]).ok, true);
  assert.equal(assertNoSecrets(`leak ${KEY}`, [KEY]).ok, false);
  assert.deepEqual(assertNoSecrets(`leak ${KEY}`, [KEY]).leaks, ["exact-key"]);
});
