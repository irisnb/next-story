import assert from "node:assert/strict";
import test from "node:test";

import type { PlainTextEditorSelection } from "../src/plain-text-editor.ts";
import { captureSelection, isMeaningfulSelection } from "../src/selection-adapter.ts";

type SelectionEditorFixture = Readonly<{
  getText(): string;
  getSelection(): PlainTextEditorSelection;
}>;

function editor(
  text: string,
  selection: PlainTextEditorSelection,
): SelectionEditorFixture {
  return {
    getText: () => text,
    getSelection: () => selection,
  };
}

function assertSliceIdentity(
  text: string,
  snapshot: ReturnType<typeof captureSelection>,
): void {
  assert.notEqual(snapshot, null);
  if (snapshot === null) return;
  assert.equal(snapshot.selectedText, text.slice(snapshot.start, snapshot.end));
}

test("captures Chinese text using plain-text UTF-16 offsets", () => {
  const text = "你好世界";
  const snapshot = captureSelection(
    "draft",
    editor(text, { from: 1, to: 3, head: 3 }),
  );

  assert.deepEqual(snapshot, {
    notebook: "draft",
    selectedText: "你好",
    start: 0,
    end: 2,
  });
  assertSliceIdentity(text, snapshot);
});

test("counts emoji as two UTF-16 code units", () => {
  const text = "甲😀乙";
  const snapshot = captureSelection(
    "main",
    editor(text, { from: 2, to: 4, head: 4 }),
  );

  assert.deepEqual(snapshot, {
    notebook: "main",
    selectedText: "😀",
    start: 1,
    end: 3,
  });
  assertSliceIdentity(text, snapshot);
});

test("maps a paragraph boundary to one plain-text newline", () => {
  const text = "甲乙\n丙丁";
  const snapshot = captureSelection(
    "draft",
    editor(text, { from: 3, to: 5, head: 5 }),
  );

  assert.deepEqual(snapshot, {
    notebook: "draft",
    selectedText: "\n",
    start: 2,
    end: 3,
  });
  assertSliceIdentity(text, snapshot);
});

test("preserves consecutive newlines represented by an empty paragraph", () => {
  const text = "甲乙\n\n丙丁";
  const snapshot = captureSelection(
    "draft",
    editor(text, { from: 3, to: 7, head: 7 }),
  );

  assert.deepEqual(snapshot, {
    notebook: "draft",
    selectedText: "\n\n",
    start: 2,
    end: 4,
  });
  assertSliceIdentity(text, snapshot);
});

test("maps a cross-paragraph selection to the same plain-text slice", () => {
  const text = "甲😀\n\n乙丙";
  const snapshot = captureSelection(
    "main",
    editor(text, { from: 2, to: 9, head: 9 }),
  );

  assert.deepEqual(snapshot, {
    notebook: "main",
    selectedText: "😀\n\n乙",
    start: 1,
    end: 6,
  });
  assertSliceIdentity(text, snapshot);
});

test("forward and backward selections freeze the same ordered range", () => {
  const text = "甲😀\n\n乙丙";
  const forward = captureSelection(
    "draft",
    editor(text, { from: 2, to: 9, head: 9 }),
  );
  const backward = captureSelection(
    "draft",
    editor(text, { from: 2, to: 9, head: 2 }),
  );

  assert.deepEqual(backward, forward);
  assertSliceIdentity(text, forward);
  assertSliceIdentity(text, backward);
});

test("preserves surrounding whitespace without trimming", () => {
  const text = "开头 背叛 结尾";
  const snapshot = captureSelection(
    "draft",
    editor(text, { from: 3, to: 7, head: 7 }),
  );

  assert.equal(snapshot?.selectedText, " 背叛 ");
  assertSliceIdentity(text, snapshot);
});

test("returns null for an empty editor selection", () => {
  assert.equal(
    captureSelection("draft", editor("abc", { from: 2, to: 2, head: 2 })),
    null,
  );
});

test("meaningful selection requires at least one non-whitespace character", () => {
  const whitespace = captureSelection(
    "draft",
    editor("a   b", { from: 2, to: 5, head: 5 }),
  );
  const single = captureSelection(
    "draft",
    editor("ab", { from: 1, to: 2, head: 2 }),
  );

  assert.equal(isMeaningfulSelection(whitespace), false);
  assert.equal(isMeaningfulSelection(single), true);
  assert.equal(isMeaningfulSelection(null), false);
});

test("freezes copied text and offsets when the editor later changes", () => {
  let text = "原始文字";
  let selection = { from: 1, to: 5, head: 5 };
  const source: SelectionEditorFixture = {
    getText: () => text,
    getSelection: () => selection,
  };
  const snapshot = captureSelection("draft", source);

  text = "完全不同的内容";
  selection = { from: 1, to: 7, head: 7 };

  assert.deepEqual(snapshot, {
    notebook: "draft",
    selectedText: "原始文字",
    start: 0,
    end: 4,
  });
});
