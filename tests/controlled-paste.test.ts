import assert from "node:assert/strict";
import test from "node:test";

import {
  blocksToDocument,
  compareHtmlAndPlain,
  decidePasteAction,
  plainTextToDocument,
  stripListMarker,
  tableRowsToText,
  type PasteParseResult,
} from "../src/controlled-paste.ts";

function parsed(blocks: PasteParseResult["blocks"], extra: Partial<PasteParseResult> = {}): PasteParseResult {
  return { blocks, hasImage: false, hasUnknownVisibleEmbed: false, ...extra };
}

// ---------------------------------------------------------------------------
// 比较函数（任务 5.3）
// ---------------------------------------------------------------------------

test("compare normalizes CRLF, NBSP, and trailing whitespace", () => {
  assert.equal(compareHtmlAndPlain("甲\n乙", "甲\r\n乙\u00a0  "), true);
});

test("compare strips a single trailing LF on both sides", () => {
  assert.equal(compareHtmlAndPlain("甲\n乙", "甲\n乙\n"), true);
});

test("compare accepts plain-text list markers for html list items", () => {
  assert.equal(compareHtmlAndPlain("甲\n乙", "- 甲\n- 乙"), true);
  assert.equal(compareHtmlAndPlain("甲\n乙", "1. 甲\n2. 乙"), true);
  assert.equal(compareHtmlAndPlain("甲\n乙", "• 甲\n* 乙"), true);
});

test("compare preserves empty lines and Tab", () => {
  assert.equal(compareHtmlAndPlain("甲\n\n乙", "甲\n\n乙"), true);
  assert.equal(compareHtmlAndPlain("甲\t乙", "甲\t乙"), true);
});

test("compare rejects when text differs", () => {
  assert.equal(compareHtmlAndPlain("甲\n乙", "甲\n丙"), false);
});

test("compare rejects when line counts differ", () => {
  assert.equal(compareHtmlAndPlain("甲\n乙", "甲"), false);
});

test("stripListMarker strips bullet and numbered markers", () => {
  assert.equal(stripListMarker("- 甲"), "甲");
  assert.equal(stripListMarker("• 甲"), "甲");
  assert.equal(stripListMarker("* 甲"), "甲");
  assert.equal(stripListMarker("3. 甲"), "甲");
  assert.equal(stripListMarker("甲"), "甲");
});

// ---------------------------------------------------------------------------
// 纯文本 → 文档
// ---------------------------------------------------------------------------

test("plainTextToDocument converts lines to paragraphs", () => {
  const doc = plainTextToDocument("甲\n\n乙");
  assert.deepEqual(doc, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "甲" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "乙" }] },
    ],
  });
});

// ---------------------------------------------------------------------------
// 表格降级（任务 5.2）
// ---------------------------------------------------------------------------

test("tableRowsToText joins cells with Tab", () => {
  assert.deepEqual(tableRowsToText([["a", "b", "c"], ["d", "e", "f"]]), ["a\tb\tc", "d\te\tf"]);
});

// ---------------------------------------------------------------------------
// 粘贴决策（任务 5.3）
// ---------------------------------------------------------------------------

test("inserts plain text when no HTML is present", () => {
  const action = decidePasteAction("甲\n乙", false, parsed([]));
  assert.equal(action.kind, "insert");
});

test("inserts HTML when projection matches plain text", () => {
  const blocks = parsed([
    { type: "paragraph", textRuns: [{ text: "甲", bold: false, italic: false }] },
    { type: "paragraph", textRuns: [{ text: "乙", bold: false, italic: false }] },
  ]);
  const action = decidePasteAction("甲\n乙", true, blocks);
  assert.equal(action.kind, "insert");
});

test("rejects when projection does not match plain text", () => {
  const blocks = parsed([{ type: "paragraph", textRuns: [{ text: "甲", bold: false, italic: false }] }]);
  const action = decidePasteAction("乙", true, blocks);
  assert.equal(action.kind, "reject");
});

test("rejects image-only content as a no-op", () => {
  const blocks = parsed([], { hasImage: true });
  const action = decidePasteAction("", true, blocks);
  assert.equal(action.kind, "nothing");
});

test("rejects unknown visible embed when only HTML is present", () => {
  const blocks = parsed([], { hasUnknownVisibleEmbed: true });
  const action = decidePasteAction("", true, blocks);
  assert.equal(action.kind, "reject");
});

// ---------------------------------------------------------------------------
// 归一化块 → 文档
// ---------------------------------------------------------------------------

test("blocksToDocument groups consecutive list items and preserves headings", () => {
  const doc = blocksToDocument([
    { type: "heading", level: 1, textRuns: [{ text: "标题", bold: false, italic: false }] },
    { type: "paragraph", listType: "bullet", textRuns: [{ text: "甲", bold: false, italic: false }] },
    { type: "paragraph", listType: "bullet", textRuns: [{ text: "乙", bold: true, italic: false }] },
  ]);
  assert.equal(doc.content.length, 2);
  assert.equal((doc.content[0] as { type: string }).type, "heading");
  assert.equal((doc.content[1] as { type: string }).type, "bulletList");
});
