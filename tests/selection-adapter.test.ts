import assert from "node:assert/strict";
import test from "node:test";

import { captureSelection, isMeaningfulSelection, tabToNotebookKind } from "../src/selection-adapter.ts";
import type { NotebookKind } from "../src/types.ts";

function textarea(value: string, start: number, end: number) {
  return { value, selectionStart: start, selectionEnd: end };
}

test("captures a draft snapshot with the raw selected text", () => {
  const snapshot = captureSelection("draft", textarea("你好世界", 0, 2));
  assert.deepEqual(snapshot, {
    notebook: "draft",
    selectedText: "你好",
    start: 0,
    end: 2,
  });
});

test("captures a manuscript snapshot for the main notebook", () => {
  const snapshot = captureSelection("manuscript", textarea("abc", 1, 3));
  assert.equal(snapshot?.notebook, "manuscript");
  assert.equal(snapshot?.selectedText, "bc");
});

test("preserves original text with surrounding spaces and newlines", () => {
  const value = "开头 背叛 结尾";
  const start = value.indexOf(" 背叛 ");
  const end = start + " 背叛 ".length;
  const snapshot = captureSelection("draft", textarea(value, start, end));
  // 不静默裁剪前后空格
  assert.equal(snapshot?.selectedText, " 背叛 ");
});

test("returns null for an empty selection", () => {
  assert.equal(captureSelection("draft", textarea("abc", 1, 1)), null);
  assert.equal(captureSelection("draft", textarea("abc", null, null)), null);
});

test("meaningful selection requires at least one non-whitespace character", () => {
  const whitespace = captureSelection("draft", textarea("a   b", 1, 4));
  const single = captureSelection("draft", textarea("ab", 0, 1));
  assert.equal(isMeaningfulSelection(whitespace), false);
  assert.equal(isMeaningfulSelection(single), true);
  assert.equal(isMeaningfulSelection(null), false);
});

test("a single non-whitespace character is meaningful", () => {
  const snapshot = captureSelection("draft", textarea("背叛", 0, 1));
  assert.equal(isMeaningfulSelection(snapshot), true);
  assert.equal(snapshot?.selectedText, "背");
});

test("snapshot is frozen: later edits to the textarea do not mutate it", () => {
  const source = textarea("原始文字", 0, 4);
  const snapshot = captureSelection("draft", source);
  assert.equal(snapshot?.selectedText, "原始文字");

  // 模拟用户继续编辑后再次召唤
  source.value = "完全不同的内容";
  source.selectionStart = 0;
  source.selectionEnd = 6;
  // 已冻结的快照不受影响
  assert.equal(snapshot?.selectedText, "原始文字");
});

test("maps the main tab to the manuscript notebook kind", () => {
  assert.equal(tabToNotebookKind("draft"), "draft");
  assert.equal(tabToNotebookKind("main"), "manuscript");
});

test("selection direction does not affect the captured range", () => {
  const forward = captureSelection("draft" as NotebookKind, textarea("abcdef", 1, 4));
  const backward = captureSelection("draft" as NotebookKind, textarea("abcdef", 4, 1));
  assert.deepEqual(forward, backward);
});
