import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("production notebooks use generic editor mounts while preserving their interface names", () => {
  assert.doesNotMatch(html, /<textarea\b[^>]*\bid="(?:draft|main)-textarea"/);
  assert.match(html, /<div\b[^>]*\bid="draft-textarea"[^>]*\bdata-placeholder="在这里写草稿\.\.\."[^>]*><\/div>/);
  assert.match(html, /<div\b[^>]*\bid="main-textarea"[^>]*\bdata-placeholder="在这里写正文\.\.\."[^>]*><\/div>/);
  assert.match(html, /<button\b[^>]*\bid="tab-draft"[^>]*>草稿本<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="tab-main"[^>]*>正文本<\/button>/);
});
