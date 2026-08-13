import assert from "node:assert/strict";
import test from "node:test";

import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "prosemirror-state";
import { liftListItem, wrapInList } from "prosemirror-schema-list";

import { buildRichTextExtensions } from "../src/rich-text-editor.ts";
import { fixSplitOrderedListStart } from "../src/list-numbering.ts";

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
