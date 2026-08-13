import assert from "node:assert/strict";
import test from "node:test";

import { getSchema, type JSONContent } from "@tiptap/core";

import {
  buildRichTextExtensions,
  RichTextEditorAdapter,
  type RichTextEditorEngine,
} from "../src/rich-text-editor.ts";
import { canonicalDoc } from "../src/structured-notebook.ts";
import type { FormatCommand } from "../src/format-commands.ts";

// ---------------------------------------------------------------------------
// 3.1 schema 只允许本轮支持的节点与标记
// ---------------------------------------------------------------------------

test("schema exposes only the supported nodes and marks", () => {
  const schema = getSchema(buildRichTextExtensions());

  assert.ok(schema.nodes.doc);
  assert.ok(schema.nodes.paragraph);
  assert.ok(schema.nodes.text);
  assert.ok(schema.nodes.heading);
  assert.ok(schema.nodes.bulletList);
  assert.ok(schema.nodes.orderedList);
  assert.ok(schema.nodes.listItem);
  assert.ok(schema.marks.bold);
  assert.ok(schema.marks.italic);

  // 不接受的节点与标记
  assert.equal(schema.nodes.image, undefined);
  assert.equal(schema.nodes.table, undefined);
  assert.equal(schema.nodes.hardBreak, undefined);
  assert.equal(schema.nodes.blockquote, undefined);
  assert.equal(schema.marks.link, undefined);
  assert.equal(schema.marks.underline, undefined);
  assert.equal(schema.marks.strike, undefined);
});

test("heading only supports levels 1 and 2", () => {
  const heading = buildRichTextExtensions().find((ext) => ext.name === "heading");
  assert.ok(heading);
  assert.deepEqual((heading.options as { levels?: number[] }).levels, [1, 2]);
});

// ---------------------------------------------------------------------------
// 3.2 结构化文档往返
// ---------------------------------------------------------------------------

const roundTripCases: { name: string; doc: JSONContent }[] = [
  { name: "blank document", doc: { type: "doc", content: [{ type: "paragraph" }] } },
  {
    name: "leading trailing and consecutive empty paragraphs",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "甲" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "乙" }] },
        { type: "paragraph" },
      ],
    },
  },
  {
    name: "chinese and emoji text",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "她推开门，看见雨落在旧站台上。镜头推进 🎬" }] },
      ],
    },
  },
  {
    name: "heading level 1 and 2",
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "一级" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二级" }] },
      ],
    },
  },
  {
    name: "bold italic and adjacent different marks",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "粗", marks: [{ type: "bold" }] },
            { type: "text", text: "斜", marks: [{ type: "italic" }] },
            { type: "text", text: "粗斜", marks: [{ type: "bold" }, { type: "italic" }] },
          ],
        },
      ],
    },
  },
  {
    name: "bullet list",
    doc: {
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
    },
  },
  {
    name: "ordered list with start 3",
    doc: {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "三" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "四" }] }] },
          ],
        },
      ],
    },
  },
];

for (const { name, doc } of roundTripCases) {
  test(`round-trips ${name} through the schema and canonicalization`, () => {
    const schema = getSchema(buildRichTextExtensions());
    const node = schema.nodeFromJSON(doc);
    const reCanonicalized = canonicalDoc(node.toJSON());
    assert.equal(JSON.stringify(reCanonicalized), JSON.stringify(canonicalDoc(doc)));
  });
}

// ---------------------------------------------------------------------------
// 适配器（fake engine）
// ---------------------------------------------------------------------------

class FakeRichTextEditorEngine implements RichTextEditorEngine {
  document: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
  readonly updateListeners = new Set<() => void>();
  focused = false;
  destroyed = false;
  selection = { from: 8, to: 3, head: 3 };
  coordinates = { left: 12, right: 13, top: 24, bottom: 25 };
  lastCoordinatePosition: number | null = null;

  getDocument() {
    return this.document;
  }

  onUpdate(listener: () => void): void {
    this.updateListeners.add(listener);
  }

  offUpdate(listener: () => void): void {
    this.updateListeners.delete(listener);
  }

  focus(): void {
    this.focused = true;
  }

  getSelection() {
    return this.selection;
  }

  coordinatesAt(position: number) {
    this.lastCoordinatePosition = position;
    return this.coordinates;
  }

  runCommand(_command: FormatCommand): boolean {
    return false;
  }

  canUndo(): boolean {
    return false;
  }

  canRedo(): boolean {
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.updateListeners.clear();
  }

  emitUpdate(document: JSONContent): void {
    this.document = document;
    for (const listener of this.updateListeners) listener();
  }
}

test("reads the engine document", () => {
  const engine = new FakeRichTextEditorEngine();
  const editor = new RichTextEditorAdapter(engine);

  assert.deepEqual(editor.getDocument(), engine.document);
});

test("subscribes to edits and returns a working unsubscribe function", () => {
  const engine = new FakeRichTextEditorEngine();
  const editor = new RichTextEditorAdapter(engine);
  const received: JSONContent[] = [];
  const unsubscribe = editor.onEdit((doc) => received.push(doc));

  const next = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
  engine.emitUpdate(next);
  unsubscribe();
  engine.emitUpdate({ type: "doc", content: [{ type: "paragraph" }] });

  assert.deepEqual(received, [next]);
});

test("returns an ordered selection while preserving its head", () => {
  const engine = new FakeRichTextEditorEngine();
  const editor = new RichTextEditorAdapter(engine);

  assert.deepEqual(editor.getSelection(), { from: 3, to: 8, head: 3 });
});

test("destroy removes subscriptions and destroys the engine", () => {
  const engine = new FakeRichTextEditorEngine();
  const editor = new RichTextEditorAdapter(engine);
  const received: JSONContent[] = [];
  editor.onEdit((doc) => received.push(doc));

  editor.destroy();
  engine.emitUpdate({ type: "doc", content: [{ type: "paragraph" }] });

  assert.equal(engine.destroyed, true);
  assert.deepEqual(received, []);
});
