import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeSelectionToPlainText,
  type DocNode,
} from "../src/structured-notebook.ts";

// ---------------------------------------------------------------------------
// 6.1 结构化选区 → 纯文本切片
//
// 位置模型（ProseMirror 官方）：doc 节点自身的开/闭 token 不计入位置，
// 第一个 block 从 0 开始。doc > paragraph("你好") 的位置是：
//   0 = 段落前（"你"前）、1 = "你"后、2 = "好"后、3 = 段落后
// ---------------------------------------------------------------------------

test("projects a plain paragraph selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "背叛" }] }],
  };
  // 段落 [0,4]，文字 [1,3]
  assert.equal(serializeSelectionToPlainText(doc, 1, 3), "背叛");
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
  // heading [0,4]，文字 [1,3]
  assert.equal(serializeSelectionToPlainText(doc, 1, 3), "标题");
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
  // 第一项文字 [3,6]，第二项文字 [10,13]
  assert.equal(serializeSelectionToPlainText(doc, 3, 13), "- 第一项\n- 第二项");
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
  // 第三项文字 [3,6]，第四项文字 [10,13]
  assert.equal(serializeSelectionToPlainText(doc, 3, 13), "3. 第三项\n4. 第四项");
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
  // "第三项" 文字 [3,6]："第"[3,4] "三"[4,5] "项"[5,6]；"三项" = [4,6]
  assert.equal(serializeSelectionToPlainText(doc, 4, 6), "三项");
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
  // 选择文字 [3,5]；段落 [8,12]，代价文字 [9,11]
  assert.equal(serializeSelectionToPlainText(doc, 3, 11), "3. 选择\n代价");
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
  // "选择"[3,5] "择"=[4,5]；"代价"[9,11] "代"=[9,10]
  assert.equal(serializeSelectionToPlainText(doc, 4, 10), "择\n代");
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
  // 甲 [0,3] 文字 [1,2]；空段落 [3,5]；乙 [5,8] 文字 [6,7]
  assert.equal(serializeSelectionToPlainText(doc, 1, 7), "甲\n\n乙");
});

test("produces no leading or trailing LF for boundary-aligned selection", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "甲" }] },
      { type: "paragraph", content: [{ type: "text", text: "乙" }] },
    ],
  };
  // 甲文字 [1,2]，乙文字 [4,5]
  assert.equal(serializeSelectionToPlainText(doc, 1, 5), "甲\n乙");
});

test("preserves leading and trailing spaces and emoji", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "  前 后  🎬" }] },
    ],
  };
  const text = "  前 后  🎬";
  // 段落 [0, 2+text.length]，文字 [1, 1+text.length]
  assert.equal(serializeSelectionToPlainText(doc, 1, 1 + text.length), text);
});

test("returns empty string for an empty range", () => {
  const doc: DocNode = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }],
  };
  assert.equal(serializeSelectionToPlainText(doc, 1, 1), "");
});

test("projects nested list items with indentation", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父项" }] },
              {
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项一" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项二" }] }] },
                ],
              },
            ],
          },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "父项二" }] }] },
        ],
      },
    ],
  };
  // 父项文字 [3,5]，子项一 [9,12]，子项二 [16,19]，父项二 [25,28]
  assert.equal(
    serializeSelectionToPlainText(doc, 3, 28),
    "- 父项\n  - 子项一\n  - 子项二\n- 父项二",
  );
});

test("partial nested list item gets no prefix or indent", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "父项" }] },
              {
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子项一" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  // 只选子项一中间的 "项" 字（[10,11]），不补前缀不补缩进
  assert.equal(serializeSelectionToPlainText(doc, 10, 11), "项");
});
