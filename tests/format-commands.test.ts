import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSelection, orderedListStyleState } from "../src/format-commands.ts";
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
    underline: "off",
    strike: "off",
    list: "none",
    textAlign: "left",
    textColor: null,
    highlight: null,
    fontFamily: null,
    fontSize: null,
    lineHeight: null,
    spacingBefore: null,
    spacingAfter: null,
    textIndent: null,
    indentLeft: null,
    indentRight: null,
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

// ---------------------------------------------------------------------------
// add-list-numbering-formats：选区触及的完整有序列表的编号样式查询
// ---------------------------------------------------------------------------

test("orderedListStyleState returns null when no ordered list is touched", () => {
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
  // 只选段落文字 [1,3]。
  assert.equal(orderedListStyleState(doc, 1, 3), null);
});

test("orderedListStyleState reports the unified style of touched lists", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1, type: "A" },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
        ],
      },
    ],
  };
  // 甲文字 [3,4]：只触及第一个列表（样式 A）。
  assert.equal(orderedListStyleState(doc, 3, 4), "A");
  // 乙文字 [10,11]：只触及第二个列表（缺省数字）。
  assert.equal(orderedListStyleState(doc, 10, 11), "1");
  // 跨两个列表 [3,11]：样式不统一 → mixed。
  assert.equal(orderedListStyleState(doc, 3, 11), "mixed");
});

test("orderedListStyleState treats nested lists as independent entries", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父" }] },
              {
                type: "orderedList",
                attrs: { start: 1, type: "i" },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  // "父" [3,4]：父项自身段落被触及 → 父列表样式（其内子列表不受牵动）。
  assert.equal(orderedListStyleState(doc, 3, 4), "1");
  // "子" [8,9]：只有子列表项被触及 → 子列表样式（父层不因选区在子列表内而计入）。
  assert.equal(orderedListStyleState(doc, 8, 9), "i");
  // 跨父项文字与子列表 [3,9]：两层各自的项都被触及 → 两种样式 mixed。
  assert.equal(orderedListStyleState(doc, 3, 9), "mixed");
});
