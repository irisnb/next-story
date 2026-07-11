import assert from "node:assert/strict";
import test from "node:test";

import { mirroredCaretStyleProperties } from "../src/caret-coordinates.ts";

test("caret mirror uses kebab-case CSS property names", () => {
  assert.ok(mirroredCaretStyleProperties.includes("box-sizing"));
  assert.ok(mirroredCaretStyleProperties.includes("border-top-width"));
  assert.ok(mirroredCaretStyleProperties.includes("line-height"));
  assert.ok(mirroredCaretStyleProperties.includes("tab-size"));
  assert.equal(mirroredCaretStyleProperties.some((name) => /[A-Z]/.test(name)), false);
});
