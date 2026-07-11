import assert from "node:assert/strict";
import test from "node:test";

import { decideSummonVisibility } from "../src/selection-entry.ts";

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
