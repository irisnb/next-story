import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeSelectionToPlainText,
  type DocNode,
} from "../src/structured-notebook.ts";

// ---------------------------------------------------------------------------
// 6.1 结构化选区 → 纯文本切片
// ---------------------------------------------------------------------------

test("projects a plain paragraph selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "背叛" }] }],
  };
  // 段落 [1,5]，文字 [2,4]
  assert.equal(serializeSelectionToPlainText(doc, 2, 4), "背叛");
});

test("drops heading level and inline marks", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "标", marks: [{ type: "bold" }] }, { type: "text", text: "题" }],
      },
    ],
  };
  // heading [1,6]，文字 [2,4]
  assert.equal(serializeSelectionToPlainText(doc, 2, 4), "标题");
});

test("projects full bullet list items with markers", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第一项" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第二项" }] }] },
        ],
      },
    ],
  };
  // 第一项文字 [4,7]，第二项文字 [11,14]
  assert.equal(serializeSelectionToPlainText(doc, 4, 14), "- 第一项\n- 第二项");
});

test("projects full ordered list items with actual numbers", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第三项" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第四项" }] }] },
        ],
      },
    ],
  };
  // 第三项文字 [4,7]，第四项文字 [11,14]
  assert.equal(serializeSelectionToPlainText(doc, 4, 14), "3. 第三项\n4. 第四项");
});

test("projects a partial list item without marker", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "第三项" }] }] },
        ],
      },
    ],
  };
  // "三项" 位于 [5,7]
  assert.equal(serializeSelectionToPlainText(doc, 5, 7), "三项");
});

test("joins a full list item and a following paragraph with a single LF", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "选择" }] }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "代价" }] },
    ],
  };
  // 选择文字 [4,6]；段落 [9,13]，代价文字 [10,12]
  assert.equal(serializeSelectionToPlainText(doc, 4, 12), "3. 选择\n代价");
});

test("projects a partial list item crossing into a paragraph without marker", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "选择" }] }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "代价" }] },
    ],
  };
  // "择" 位于 [5,6]，"代" 位于 [10,11]
  assert.equal(serializeSelectionToPlainText(doc, 5, 11), "择\n代");
});

test("preserves an empty paragraph as an empty line", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "甲" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "乙" }] },
    ],
  };
  // 甲 [1,4] 文字 [2,3]；空段落 [4,6]；乙 [6,9] 文字 [7,8]
  assert.equal(serializeSelectionToPlainText(doc, 2, 8), "甲\n\n乙");
});

test("produces no leading or trailing LF for boundary-aligned selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "甲" }] },
      { type: "paragraph", content: [{ type: "text", text: "乙" }] },
    ],
  };
  // 甲文字 [2,3]，乙文字 [5,6]
  assert.equal(serializeSelectionToPlainText(doc, 2, 6), "甲\n乙");
});

test("preserves leading and trailing spaces and emoji", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "  前 后  🎬" }] },
    ],
  };
  // 段落 [1,?]，文字长度 = "  前 后  🎬" 的 UTF-16 长度
  const text = "  前 后  🎬";
  // 段落 [1, 3+text.length]，文字 [2, 2+text.length]
  assert.equal(serializeSelectionToPlainText(doc, 2, 2 + text.length), text);
});

test("returns empty string for an empty range", () => {
  const doc: DocNode = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }],
  };
  assert.equal(serializeSelectionToPlainText(doc, 2, 2), "");
});
