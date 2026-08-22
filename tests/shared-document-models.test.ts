import assert from "node:assert/strict";
import test from "node:test";

// 目标：extract-shared-document-models 的共享节点位置尺寸与块遍历函数。
// 该共享模块（src/shared-document-models.ts）是唯一共享位置实现：
// nodeSize 计算节点尺寸，collectSharedBlocks 展开为带位置/深度/段落/列表的块记录，
// 供 structured-notebook 的 collectLines 与 format-commands 的 collectBlocks 复用。
import { nodeSize, collectSharedBlocks } from "../src/shared-document-models.ts";

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
  assert.deepEqual(records[0].list, { kind: "bullet", prefix: "- " });
  assert.equal(records[0].start, 2);
  assert.equal(records[0].end, 7);
  assert.equal(records[0].textStart, 3);
  assert.equal(records[0].textEnd, 6);
  assert.equal(records[0].text, "第一项");
  assert.equal(records[0].depth, 0);
  assert.deepEqual(records[1].list, { kind: "bullet", prefix: "- " });
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
  assert.deepEqual(records[0].list, { kind: "ordered", prefix: "3. " });
  assert.deepEqual(records[1].list, { kind: "ordered", prefix: "4. " });
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
