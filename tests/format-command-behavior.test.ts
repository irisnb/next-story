import assert from "node:assert/strict";
import test from "node:test";

import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "prosemirror-state";
import { liftListItem, wrapInList } from "prosemirror-schema-list";

import { buildRichTextExtensions } from "../src/rich-text-editor.ts";
import { fixSplitOrderedListStart, setOrderedListStyleInSelection } from "../src/list-numbering.ts";

const schema = getSchema(buildRichTextExtensions());

function stateFrom(doc: unknown, from: number, to: number): EditorState {
  const node = schema.nodeFromJSON(doc);
  const state = EditorState.create({ schema, doc: node });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function json(state: EditorState): { content: { type: string; attrs?: { start: number } }[] } {
  return state.doc.toJSON() as { content: { type: string; attrs?: { start: number } }[] };
}

function orderedList(start: number, texts: string[]): unknown {
  return {
    type: "orderedList",
    attrs: { start },
    content: texts.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}

test("wraps paragraphs into a bullet list", () => {
  const state = stateFrom(
    {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "甲" }] },
        { type: "paragraph", content: [{ type: "text", text: "乙" }] },
      ],
    },
    2,
    6,
  );
  let next = state;
  wrapInList(schema.nodes.bulletList)(state, (tr) => {
    next = state.apply(tr);
    return true;
  });
  assert.equal(json(next).content[0].type, "bulletList");
});

test("splitting an ordered list preserves the trailing segment numbering via the fix", () => {
  // orderedList start=3，三项显示 3/4/5；选中第二项文字 "四" [9,10]
  const state = stateFrom(
    { type: "doc", content: [orderedList(3, ["三", "四", "五"])] },
    9,
    10,
  );
  let next = state;
  const lifted = liftListItem(schema.nodes.listItem)(state, (tr) => {
    next = state.apply(tr);
    return true;
  });
  assert.equal(lifted, true);

  // 抬出后：orderedList(start=3)[三] + paragraph(四) + orderedList(start=3)[五]（start 需修正为 5）
  const before = json(next);
  assert.equal(before.content[0].type, "orderedList");
  assert.equal(before.content[2].type, "orderedList");

  // 应用编号修正
  const tr = next.tr;
  fixSplitOrderedListStart(next.doc, tr, 3, 5);
  next = next.apply(tr);

  const out = json(next);
  assert.equal(out.content[0].attrs?.start, 3);
  assert.equal(out.content[2].attrs?.start, 5);
});

test("fix leaves a non-split ordered list untouched", () => {
  const state = stateFrom(
    { type: "doc", content: [orderedList(3, ["三"])] },
    4,
    5,
  );
  const tr = state.tr;
  fixSplitOrderedListStart(state.doc, tr, 3, 5);
  // 无 dispatch 时不产生步骤，doc 不变
  assert.equal(tr.steps.length, 0);
});

// ---------------------------------------------------------------------------
// add-list-numbering-formats：拆分保留样式 ＋ 底层样式命令
// ---------------------------------------------------------------------------

function orderedListWithStyle(start: number, style: string, texts: string[]): unknown {
  return {
    type: "orderedList",
    attrs: style === "1" ? { start } : { start, type: style },
    content: texts.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}

function listNodes(state: EditorState): { attrs: { start: number; type: string | null } }[] {
  const out: { attrs: { start: number; type: string | null } }[] = [];
  state.doc.forEach((node) => {
    if (node.type.name === "orderedList") {
      // ProseMirror 的 attrs 为 null 原型对象，strict deepEqual 需克隆成普通对象。
      out.push({
        attrs: {
          start: node.attrs.start as number,
          type: (node.attrs.type as string | null) ?? null,
        },
      });
    }
  });
  return out;
}

test("splitting a styled ordered list keeps the style on both fragments", () => {
  // 样式 A、start=3，三项显示 C/D/E；选中第二项文字 "四" [9,10] 抬出。
  const state = stateFrom(
    { type: "doc", content: [orderedListWithStyle(3, "A", ["三", "四", "五"])] },
    9,
    10,
  );
  let next = state;
  const lifted = liftListItem(schema.nodes.listItem)(state, (tr) => {
    next = state.apply(tr);
    return true;
  });
  assert.equal(lifted, true);

  const tr = next.tr;
  fixSplitOrderedListStart(next.doc, tr, 3, 5);
  next = next.apply(tr);

  const lists = listNodes(next);
  assert.equal(lists.length, 2, "抬出中段后剩首尾两个有序列表");
  // 首段保留样式 A 与 start=3；尾段保留样式 A 且 start 修正为 5。
  assert.deepEqual(lists[0].attrs, { start: 3, type: "A" });
  assert.deepEqual(lists[1].attrs, { start: 5, type: "A" });
});

test("setOrderedListStyleInSelection restyles complete touched lists only", () => {
  const state = stateFrom(
    {
      type: "doc",
      content: [
        orderedListWithStyle(1, "1", ["甲", "乙"]),
        { type: "paragraph", content: [{ type: "text", text: "隔断" }] },
        orderedListWithStyle(1, "A", ["丙"]),
      ],
    },
    // 选中第一列表第二项 "乙" 的文字 [8,9]：只触及第一个列表的项。
    8,
    9,
  );
  const tr = state.tr;
  const changed = setOrderedListStyleInSelection(state.doc, tr, 8, 9, "I");
  const next = state.apply(tr);
  assert.equal(changed, 1, "只改选区触及的第一个列表");
  const lists = listNodes(next);
  assert.deepEqual(lists[0].attrs, { start: 1, type: "I" });
  assert.deepEqual(lists[1].attrs, { start: 1, type: "A" }, "未触及的列表不变");
});

test("setOrderedListStyleInSelection writes null for the decimal default", () => {
  const state = stateFrom(
    { type: "doc", content: [orderedListWithStyle(1, "A", ["甲"])] },
    2,
    3,
  );
  const tr = state.tr;
  const changed = setOrderedListStyleInSelection(state.doc, tr, 2, 3, "1");
  const next = state.apply(tr);
  assert.equal(changed, 1);
  assert.equal(listNodes(next)[0].attrs.type, null, "切回数字时写 null（序列化省略）");
});

test("setOrderedListStyleInSelection is a no-op for untouched or same-style lists", () => {
  const state = stateFrom(
    {
      type: "doc",
      content: [
        orderedListWithStyle(1, "1", ["甲"]),
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] }] },
      ],
    },
    // 第一个有序列表 [0,7]；无序列表块 [7,14]，其项文字 "乙" 在 [10,11]：
    // 选中无序列表项文字：不触及任何有序列表。
    10,
    11,
  );
  const tr = state.tr;
  assert.equal(setOrderedListStyleInSelection(state.doc, tr, 10, 11, "I"), 0);
  assert.equal(tr.steps.length, 0);

  // 样式相同的列表：不产生步骤（幂等）。
  const sameState = stateFrom(
    { type: "doc", content: [orderedListWithStyle(1, "A", ["甲"])] },
    2,
    3,
  );
  const sameTr = sameState.tr;
  assert.equal(setOrderedListStyleInSelection(sameState.doc, sameTr, 2, 3, "A"), 0);
  assert.equal(sameTr.steps.length, 0);
});

test("setOrderedListStyleInSelection inside a nested list only restyles that list", () => {
  const state = stateFrom(
    {
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
                  content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    // 精确选中嵌套子列表文字 "子" [8,9]：只有子列表项的自身段落被触及——
    // 只改子列表，父层不变（规格「嵌套内切换只影响当前层」）。
    8,
    9,
  );
  const tr = state.tr;
  const changed = setOrderedListStyleInSelection(state.doc, tr, 8, 9, "I");
  const next = state.apply(tr);
  assert.equal(changed, 1, "只改直接所属的子列表");
  let seen: { type: string | null }[] = [];
  next.doc.descendants((node) => {
    if (node.type.name === "orderedList") {
      seen.push({ type: ((node.attrs.type as string | null) ?? null) as string | null });
    }
  });
  // 父列表保持缺省样式，子列表切换为大写罗马。
  assert.deepEqual(seen, [{ type: null }, { type: "I" }]);
});

test("setOrderedListStyleInSelection on parent item text does not touch its nested list", () => {
  const state = stateFrom(
    {
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
                  content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    // 只选中父项文字 "父" [3,4]：父列表被改，其内嵌套子列表不受牵动。
    3,
    4,
  );
  const tr = state.tr;
  const changed = setOrderedListStyleInSelection(state.doc, tr, 3, 4, "A");
  const next = state.apply(tr);
  assert.equal(changed, 1, "只改父列表");
  let seen: { type: string | null }[] = [];
  next.doc.descendants((node) => {
    if (node.type.name === "orderedList") {
      seen.push({ type: ((node.attrs.type as string | null) ?? null) as string | null });
    }
  });
  assert.deepEqual(seen, [{ type: "A" }, { type: "i" }], "子列表保持原样式 i");
});

test("setOrderedListStyleInSelection across parent text and nested list restyles each owning list", () => {
  const state = stateFrom(
    {
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
                  content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "子" }] }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    // 选区跨父项文字与子列表 [3,9]：父项与子项的自身段落都被触及——
    // 各自的直接所属列表（父列表＋子列表）分别被设置。
    3,
    9,
  );
  const tr = state.tr;
  const changed = setOrderedListStyleInSelection(state.doc, tr, 3, 9, "I");
  const next = state.apply(tr);
  assert.equal(changed, 2, "父列表与子列表各自被触及并设置");
  let seen: { type: string | null }[] = [];
  next.doc.descendants((node) => {
    if (node.type.name === "orderedList") {
      seen.push({ type: ((node.attrs.type as string | null) ?? null) as string | null });
    }
  });
  assert.deepEqual(seen, [{ type: "I" }, { type: "I" }]);

  // 整事务可撤销：同一事务承载全部步骤，按历史插件的撤销方式逐步骤反转后
  // 整体还原（父列表与子列表一次撤销同时回滚）。
  const undoTr = next.tr;
  for (let i = tr.steps.length - 1; i >= 0; i -= 1) {
    undoTr.step(tr.steps[i].invert(tr.docs[i]));
  }
  const undone = next.apply(undoTr);
  assert.ok(
    undone.doc.eq(state.doc),
    "撤销一个事务应同时还原父列表与子列表",
  );
});
