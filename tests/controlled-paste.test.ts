import assert from "node:assert/strict";
import test from "node:test";

import {
  nodesToDocument,
  compareHtmlAndPlain,
  decidePasteAction,
  normalizeColor,
  plainTextToDocument,
  stripListMarker,
  tableRowsToText,
  type PasteParseResult,
  type ParsedNode,
  type TextRun,
} from "../src/controlled-paste.ts";

function run(text: string, overrides: Partial<TextRun> = {}): TextRun {
  return {
    text,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    href: null,
    color: null,
    highlight: null,
    ...overrides,
  };
}

function parsed(content: ParsedNode[], extra: Partial<PasteParseResult> = {}): PasteParseResult {
  return { content, hasImage: false, hasUnknownVisibleEmbed: false, ...extra };
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
// 颜色归一化
// ---------------------------------------------------------------------------

test("normalizeColor normalizes hex and rgb", () => {
  assert.equal(normalizeColor("#ff0000"), "#ff0000");
  assert.equal(normalizeColor("#FF0000"), "#ff0000");
  assert.equal(normalizeColor("#f00"), "#ff0000");
  assert.equal(normalizeColor("rgb(255, 0, 0)"), "#ff0000");
  assert.equal(normalizeColor("rgba(0, 255, 0, 0.5)"), "#00ff00");
  assert.equal(normalizeColor("red"), null);
  assert.equal(normalizeColor(null), null);
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
    { type: "paragraph", textRuns: [run("甲")] },
    { type: "paragraph", textRuns: [run("乙")] },
  ]);
  const action = decidePasteAction("甲\n乙", true, blocks);
  assert.equal(action.kind, "insert");
});

test("rejects when projection does not match plain text", () => {
  const blocks = parsed([{ type: "paragraph", textRuns: [run("甲")] }]);
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
// 归一化节点 → 文档
// ---------------------------------------------------------------------------

test("nodesToDocument assembles headings and flat lists", () => {
  const doc = nodesToDocument([
    { type: "heading", level: 1, textRuns: [run("标题")] },
    {
      type: "bulletList",
      items: [
        { textRuns: [run("甲")], nested: null },
        { textRuns: [run("乙", { bold: true })], nested: null },
      ],
    },
  ]);
  assert.equal(doc.content.length, 2);
  assert.equal((doc.content[0] as { type: string }).type, "heading");
  assert.equal((doc.content[1] as { type: string }).type, "bulletList");
});

test("nodesToDocument preserves nested lists", () => {
  const doc = nodesToDocument([
    {
      type: "bulletList",
      items: [
        {
          textRuns: [run("父")],
          nested: {
            type: "bulletList",
            items: [{ textRuns: [run("子")], nested: null }],
          },
        },
      ],
    },
  ]);
  assert.deepEqual(doc, {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父" }] },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});

test("nodesToDocument outputs character marks in rank order", () => {
  const doc = nodesToDocument([
    {
      type: "paragraph",
      textRuns: [
        run("彩", {
          bold: true,
          underline: true,
          color: "#ff0000",
          highlight: "#ffff00",
          href: "https://example.com",
        }),
      ],
    },
  ]);
  const paragraph = doc.content[0] as {
    content: [{ text: string; marks: { type: string }[] }];
  };
  assert.equal(paragraph.content[0].text, "彩");
  assert.deepEqual(
    paragraph.content[0].marks.map((m) => m.type),
    ["bold", "underline", "textStyle", "highlight", "link"],
  );
});
