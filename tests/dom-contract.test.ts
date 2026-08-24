import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("production uses a single generic editor mount and three module tabs", () => {
  assert.doesNotMatch(html, /<textarea\b[^>]*\bid="(?:draft|main)-textarea"/);
  assert.doesNotMatch(html, /\bid="draft-textarea"/);
  assert.doesNotMatch(html, /\bid="main-textarea"/);
  assert.match(html, /<div\b[^>]*\bid="editor-textarea"/);
  assert.match(html, /<button\b[^>]*\bid="tab-writing"[^>]*>写作<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="tab-files"[^>]*>文件管理<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="tab-settings"[^>]*>设置<\/button>/);
});

test("writing module exposes a lightweight document switcher and empty state", () => {
  assert.match(html, /<button\b[^>]*\bid="current-doc-toggle"/);
  assert.match(html, /<span\b[^>]*\bid="current-document-name"/);
  assert.match(html, /<div\b[^>]*\bid="document-list"/);
  assert.match(html, /<div\b[^>]*\bid="writing-empty-state"[^>]*>[^<]*去文件管理新建一篇/);
});

test("writing module exposes a Word export entry", () => {
  assert.match(html, /<button\b[^>]*\bid="btn-export-word"[^>]*>导出 Word<\/button>/);
});

test("LLM config lives inside the settings module, not a standalone page", () => {
  assert.doesNotMatch(html, /\bid="llm-config-page"/);
  assert.match(html, /<section\b[^>]*\bid="module-settings"/);
  assert.match(html, /<button\b[^>]*\bid="btn-back-config"[^>]*>返回写作<\/button>/);
});

test("file management module exposes tree, recycle bin, and new-node actions", () => {
  assert.match(html, /<button\b[^>]*\bid="fm-new-document"[^>]*>新建文档<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-new-folder"[^>]*>新建文件夹<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-open-recycle-bin"[^>]*>回收站<\/button>/);
  assert.match(html, /<div\b[^>]*\bid="fm-file-tree"/);
  assert.match(html, /<div\b[^>]*\bid="fm-recycle-list"/);
});
