import assert from "node:assert/strict";
import test from "node:test";

// 目标：extract-shared-document-models 的共享节点位置尺寸与块遍历函数。
// 该共享模块（src/shared-document-models.ts）是唯一共享位置实现：
// nodeSize 计算节点尺寸，collectSharedBlocks 展开为带位置/深度/段落/列表的块记录，
// 供 structured-notebook 的 collectLines 与 format-commands 的 collectBlocks 复用。
import { nodeSize, collectSharedBlocks, letterMarker, romanMarker, orderedListMarker } from "../src/shared-document-models.ts";

test("shared nodeSize follows the ProseMirror position model", () => {
  // text 节点尺寸 = 文字长度
  assert.equal(nodeSize({ type: "text", text: "正文" }), 2);
  // 普通块节点尺寸 = 2 + 子内容尺寸（开/闭 token 各占 1）
  assert.equal(
    nodeSize({ type: "paragraph", content: [{ type: "text", text: "你好" }] }),
    4,
  );
  // 空块尺寸 = 2
  assert.equal(nodeSize({ type: "paragraph" }), 2);
  // 嵌套列表递归累加：listItem(2) + paragraph(2 + 文本) + 嵌套 listItem(2 + 文本)
  assert.equal(
    nodeSize({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "a" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "b" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    2 + 2 + 3 + 2 + 2 + 3,
  );
});

test("collectSharedBlocks records a plain paragraph with positions", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "背叛" }] }],
  };
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 1);
  const record = records[0];
  // 段落 [0,4]，文字 [1,3]
  assert.equal(record.start, 0);
  assert.equal(record.end, 4);
  assert.equal(record.textStart, 1);
  assert.equal(record.textEnd, 3);
  assert.equal(record.text, "背叛");
  assert.equal(record.depth, 0);
  assert.equal(record.list, null);
  assert.equal(record.node.type, "paragraph");
});

test("collectSharedBlocks records a heading like a paragraph", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] },
    ],
  };
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 1);
  // heading [0,4]，文字 [1,3]
  assert.equal(records[0].start, 0);
  assert.equal(records[0].end, 4);
  assert.equal(records[0].text, "标题");
  assert.equal(records[0].list, null);
  assert.equal(records[0].node.type, "heading");
});

test("collectSharedBlocks records bullet list items with prefix and depth", () => {
  const doc = {
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
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 2);
  // 第一项文字 [3,6]，第二项文字 [10,13]
  assert.deepEqual(records[0].list, {
    kind: "bullet",
    prefix: "- ",
    style: "1",
    listStart: 0,
    listEnd: 16,
  });
  assert.equal(records[0].start, 2);
  assert.equal(records[0].end, 7);
  assert.equal(records[0].textStart, 3);
  assert.equal(records[0].textEnd, 6);
  assert.equal(records[0].text, "第一项");
  assert.equal(records[0].depth, 0);
  assert.deepEqual(records[1].list, {
    kind: "bullet",
    prefix: "- ",
    style: "1",
    listStart: 0,
    listEnd: 16,
  });
  assert.equal(records[1].textStart, 10);
  assert.equal(records[1].textEnd, 13);
  assert.equal(records[1].text, "第二项");
});

test("collectSharedBlocks numbers ordered list items from attrs.start", () => {
  const doc = {
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
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].list, {
    kind: "ordered",
    prefix: "3. ",
    style: "1",
    listStart: 0,
    listEnd: 16,
  });
  assert.deepEqual(records[1].list, {
    kind: "ordered",
    prefix: "4. ",
    style: "1",
    listStart: 0,
    listEnd: 16,
  });
});

test("collectSharedBlocks generates letter and roman prefixes by list style", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3, type: "A" },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 4, type: "i" },
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "丙" }] }] }],
      },
    ],
  };
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 3);
  // 大写字母从 start=3 起：C.、D.
  assert.equal(records[0].list?.prefix, "C. ");
  assert.equal(records[0].list?.style, "A");
  assert.equal(records[1].list?.prefix, "D. ");
  // 小写罗马从 start=4 起：iv.
  assert.equal(records[2].list?.prefix, "iv. ");
  assert.equal(records[2].list?.style, "i");
});

test("nested ordered lists keep independent styles and prefixes", () => {
  const doc = {
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
                attrs: { start: 1, type: "I" },
                content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 2);
  assert.equal(records[0].list?.style, "1");
  assert.equal(records[0].list?.prefix, "1. ");
  assert.equal(records[1].list?.style, "I");
  assert.equal(records[1].list?.prefix, "I. ");
  // 父列表与子列表的节点范围各自独立。
  assert.ok(records[1].list!.listStart > records[0].list!.listStart);
  assert.ok(records[1].list!.listEnd <= records[0].list!.listEnd);
});

test("letterMarker uses bijective base-26", () => {
  assert.equal(letterMarker(1, true), "A");
  assert.equal(letterMarker(2, true), "B");
  assert.equal(letterMarker(26, true), "Z");
  assert.equal(letterMarker(27, true), "AA");
  assert.equal(letterMarker(52, true), "AZ");
  assert.equal(letterMarker(53, true), "BA");
  assert.equal(letterMarker(1, false), "a");
  assert.equal(letterMarker(27, false), "aa");
});

test("romanMarker uses standard subtractive notation", () => {
  assert.equal(romanMarker(1, true), "I");
  assert.equal(romanMarker(2, true), "II");
  assert.equal(romanMarker(4, true), "IV");
  assert.equal(romanMarker(9, true), "IX");
  assert.equal(romanMarker(14, true), "XIV");
  assert.equal(romanMarker(1954, true), "MCMLIV");
  assert.equal(romanMarker(2026, true), "MMXXVI");
  assert.equal(romanMarker(3999, true), "MMMCMXCIX");
  // 超过 3999 与浏览器 ol[type=I] 一致：重复 M，不引入上划线扩展。
  assert.equal(romanMarker(4000, true), "MMMM");
  assert.equal(romanMarker(4, false), "iv");
  assert.equal(romanMarker(9, false), "ix");
});

test("orderedListMarker dispatches by style", () => {
  assert.equal(orderedListMarker(3, "1"), "3");
  assert.equal(orderedListMarker(3, "A"), "C");
  assert.equal(orderedListMarker(3, "a"), "c");
  assert.equal(orderedListMarker(3, "I"), "III");
  assert.equal(orderedListMarker(4, "i"), "iv");
});

test("collectSharedBlocks tracks nested list depth", () => {
  const doc = {
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
  const records = collectSharedBlocks(doc);
  assert.equal(records.length, 4);
  // 父项文字 [3,5]，子项一 [9,12]，子项二 [16,19]，父项二 [25,28]
  assert.equal(records[0].textStart, 3);
  assert.equal(records[0].depth, 0);
  assert.equal(records[1].textStart, 9);
  assert.equal(records[1].depth, 1);
  assert.equal(records[2].textStart, 16);
  assert.equal(records[2].depth, 1);
  assert.equal(records[3].textStart, 25);
  assert.equal(records[3].depth, 0);
});
