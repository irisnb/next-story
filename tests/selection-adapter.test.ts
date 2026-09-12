import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import { captureSelection, isMeaningfulSelection } from "../src/selection-adapter.ts";
import { canonicalNotebookJson } from "../src/structured-notebook.ts";
import type { RichTextEditorSelection } from "../src/rich-text-editor.ts";

function editor(document: JSONContent, selection: RichTextEditorSelection) {
  return {
    getDocument: () => document,
    getSelection: () => selection,
  };
}

function paragraphDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

test("captures a structured selection as a plain-text slice with Tiptap positions", () => {
  const doc = paragraphDoc("你好世界");
  const snapshot = captureSelection(
    "draft",
    editor(doc, { from: 1, to: 3, head: 3 }),
  );

  assert.deepEqual(snapshot, {
    documentId: "draft",
    selectedText: "你好",
    from: 1,
    to: 3,
    bodySnapshot: canonicalNotebookJson(doc),
  });
});

test("normalizes forward and backward selections to the same ordered range", () => {
  const doc = paragraphDoc("你好世界");
  const forward = captureSelection("main", editor(doc, { from: 1, to: 3, head: 3 }));
  const backward = captureSelection("main", editor(doc, { from: 3, to: 1, head: 1 }));

  assert.deepEqual(backward, forward);
});

test("returns null for a collapsed selection", () => {
  assert.equal(
    captureSelection("draft", editor(paragraphDoc("abc"), { from: 1, to: 1, head: 1 })),
    null,
  );
});

test("meaningful selection requires at least one non-whitespace character", () => {
  const whitespace = captureSelection(
    "draft",
    editor(paragraphDoc("   "), { from: 1, to: 4, head: 4 }),
  );
  const single = captureSelection(
    "draft",
    editor(paragraphDoc("ab"), { from: 1, to: 2, head: 2 }),
  );

  assert.equal(isMeaningfulSelection(whitespace), false);
  assert.equal(isMeaningfulSelection(single), true);
  assert.equal(isMeaningfulSelection(null), false);
});

test("captures selection identity when a context is provided", () => {
  const doc = paragraphDoc("你好世界");
  const snapshot = captureSelection(
    "draft",
    editor(doc, { from: 1, to: 3, head: 3 }),
    { projectPath: "D:\\作品", documentVersion: "v1" },
  );

  assert.deepEqual(snapshot, {
    documentId: "draft",
    selectedText: "你好",
    from: 1,
    to: 3,
    bodySnapshot: canonicalNotebookJson(doc),
    projectPath: "D:\\作品",
    documentVersion: "v1",
  });
});

test("omits identity fields when no context is provided", () => {
  const snapshot = captureSelection(
    "draft",
    editor(paragraphDoc("你好世界"), { from: 1, to: 3, head: 3 }),
  );

  assert.equal(snapshot?.projectPath, undefined);
  assert.equal(snapshot?.documentVersion, undefined);
});

test("freezes the snapshot when the editor later changes", () => {
  let document: JSONContent = paragraphDoc("原始文字");
  let selection: RichTextEditorSelection = { from: 1, to: 5, head: 5 };
  const source = {
    getDocument: () => document,
    getSelection: () => selection,
  };

  const snapshot = captureSelection("draft", source);
  const frozenBody = canonicalNotebookJson(document);

  document = paragraphDoc("完全不同的内容");
  selection = { from: 1, to: 5, head: 5 };

  assert.deepEqual(snapshot, {
    documentId: "draft",
    selectedText: "原始文字",
    from: 1,
    to: 5,
    bodySnapshot: frozenBody,
  });
});
