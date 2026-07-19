import assert from "node:assert/strict";
import test from "node:test";

import { decideSummonVisibility, isSameSummonedSelection } from "../src/selection-entry.ts";
import type { SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

test("shows the entry for a meaningful selection whose focus end is visible", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: true, focusEndVisible: true }),
    true,
  );
});

test("hides the entry for whitespace-only selection", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: true }),
    false,
  );
});

test("hides the entry when the selection is collapsed (click elsewhere)", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: true }),
    false,
  );
});

test("hides the entry when the focus end scrolls out of the viewport", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: true, focusEndVisible: false }),
    false,
  );
});

test("hides when both selection is empty and focus end is out of view", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: false }),
    false,
  );
});

test("same coordinates with different text are a new selection", () => {
  const previous = snapshot("旧字");
  const current = snapshot("新字");
  assert.equal(isSameSummonedSelection(previous, current), false);
});

test("same notebook range and text remain the summoned selection", () => {
  const previous = snapshot("相同");
  assert.equal(isSameSummonedSelection(previous, { ...previous }), true);
});
