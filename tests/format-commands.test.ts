import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSelection } from "../src/format-commands.ts";
import type { DocNode } from "../src/structured-notebook.ts";

function paragraph(text: string, marks?: { type: "bold" | "italic" }[]): DocNode {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
      },
    ],
  } as DocNode;
}

test("reports a plain paragraph selection", () => {
  const doc = paragraph("正文");
  assert.deepEqual(analyzeSelection(doc, 1, 3), {
    paragraphStyle: "paragraph",
    bold: "off",
    italic: "off",
    list: "none",
  });
});

test("reports heading level 1", () => {
  const doc: DocNode = {
    type: "doc",
    content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] }],
  };
  assert.equal(analyzeSelection(doc, 1, 3).paragraphStyle, "heading1");
});

test("reports mixed paragraph style across touched blocks", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
    ],
  };
  // 正文文字 [1,3]，标题文字 [5,7]
  assert.equal(analyzeSelection(doc, 1, 7).paragraphStyle, "mixed");
});

test("reports bold and italic tri-state over mixed marks", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "粗", marks: [{ type: "bold" }] },
          { type: "text", text: "斜", marks: [{ type: "italic" }] },
        ],
      },
    ],
  };
  // "粗" [1,2]，"斜" [2,3]
  assert.equal(analyzeSelection(doc, 1, 2).bold, "on");
  assert.equal(analyzeSelection(doc, 1, 2).italic, "off");
  assert.equal(analyzeSelection(doc, 1, 3).bold, "mixed");
  assert.equal(analyzeSelection(doc, 1, 3).italic, "mixed");
});

test("reports a fully bold selection", () => {
  const doc = paragraph("粗体", [{ type: "bold" }]);
  assert.equal(analyzeSelection(doc, 1, 3).bold, "on");
});

test("reports bullet list selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
        ],
      },
    ],
  };
  // 甲文字 [3,4]，乙文字 [8,9]
  assert.equal(analyzeSelection(doc, 3, 9).list, "bullet");
});

test("reports ordered list selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "三" }] }] },
        ],
      },
    ],
  };
  // "三" [3,4]
  assert.equal(analyzeSelection(doc, 3, 4).list, "ordered");
});

test("reports mixed list state when a paragraph and a list item are touched", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "项" }] }] },
        ],
      },
    ],
  };
  // 正文文字 [1,3]；列表项文字 [7,8]
  assert.equal(analyzeSelection(doc, 1, 8).list, "mixed");
});
