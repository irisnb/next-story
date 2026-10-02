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

test("writing module exposes a unified export entry with format/scope/filename dialog", () => {
  assert.match(html, /<button\b[^>]*\bid="btn-export"[^>]*>导出<\/button>/);
  assert.doesNotMatch(html, /\bid="btn-export-word"/);
  // 统一导出对话框：格式三选一（Word 默认选中）、范围选择器、文件名建议输入。
  assert.match(html, /\bid="export-dialog"/);
  assert.match(
    html,
    /<input type="radio" name="export-format" value="word" checked>/,
    "Word 应为默认格式",
  );
  assert.match(html, /<input type="radio" name="export-format" value="pdf">/);
  assert.match(html, /<input type="radio" name="export-format" value="markdown">/);
  assert.match(html, /\bid="export-scope"/);
  assert.match(html, /\bid="export-filename"/);
  assert.match(html, /\bid="btn-export-confirm"/);
  assert.match(html, /\bid="btn-export-cancel"/);
});

test("LLM config lives inside the settings module, not a standalone page", () => {
  assert.doesNotMatch(html, /\bid="llm-config-page"/);
  assert.match(html, /<section\b[^>]*\bid="module-settings"/);
  assert.match(html, /<button\b[^>]*\bid="btn-back-config"[^>]*>返回写作<\/button>/);
  // 任务 8.1：max_tokens 可选输入位于设置模块的 LLM 配置表单（留空 = 默认 131072）。
  assert.match(html, /<input\b[^>]*\bid="max-tokens"[^>]*placeholder="[^"]*131072/);
  assert.match(html, /\bid="max-tokens-error"/);
});

test("file management module exposes tree, recycle bin, and new-node actions", () => {
  assert.match(html, /<button\b[^>]*\bid="fm-new-document"[^>]*>新建文档<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-new-folder"[^>]*>新建文件夹<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-import-word"[^>]*>导入 Word 文档<\/button>/);
  assert.match(html, /<button\b[^>]*\bid="fm-open-recycle-bin"[^>]*>回收站<\/button>/);
  assert.match(html, /<div\b[^>]*\bid="fm-file-tree"/);
  assert.match(html, /<div\b[^>]*\bid="fm-recycle-list"/);
});

test("word import dialog exposes conclusion, collapsible losses, split choice, and target", () => {
  // add-word-import：预检对话框骨架（复用导出对话框的 .export-dialog）。
  assert.match(html, /<dialog\b[^>]*\bid="word-import-dialog"/);
  assert.match(html, /\bid="word-import-conclusion"/);
  assert.match(html, /\bid="word-import-structure"/);
  // 损耗明细可折叠（details/summary），明细列表完整呈现。
  assert.match(html, /<details\b[^>]*\bid="word-import-losses"[^>]*class="[^"]*hidden/);
  assert.match(html, /\bid="word-import-loss-list"/);
  // 拆分二选一：默认不拆（whole 选中），无建议时整个字段隐藏。
  assert.match(html, /\bid="word-import-split-field"[^>]*class="[^"]*hidden/);
  assert.match(
    html,
    /<input type="radio" name="word-import-split" value="whole" id="word-import-split-whole" checked>/,
    "默认不拆分",
  );
  assert.match(html, /\bid="word-import-split-by-marker"/);
  assert.match(html, /\bid="word-import-split-marker-label"/);
  // 目标位置默认根级，取消 / 确认按钮层级与导出对话框一致。
  assert.match(html, /\bid="word-import-target"/);
  assert.match(html, /\bid="btn-word-import-cancel"/);
  assert.match(html, /\bid="btn-word-import-confirm"/);
});

test("AI dock header exposes new-conversation and collapse entries", () => {
  assert.match(html, /<button\b[^>]*\bid="ai-new-conversation"[^>]*title="新建对话"/);
  assert.match(html, /<button\b[^>]*\bid="ai-dock-collapse"[^>]*title="收起停靠区"/);
  assert.match(html, /<button\b[^>]*\bid="ai-conversation-list-toggle"[^>]*title="会话列表"/);
  assert.match(html, /<template\b[^>]*\bid="ai-window-template"/);
  assert.match(html, /<aside\b[^>]*\bid="ai-dock"/);
});
