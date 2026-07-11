import assert from "node:assert/strict";
import test from "node:test";

import { createFocusRestorer } from "../src/leave-dialog.ts";

test("restores focus to the connected element that invoked the leave dialog", () => {
  let focuses = 0;
  const invoker = {
    isConnected: true,
    focus: () => { focuses += 1; },
  };
  const restore = createFocusRestorer(() => invoker);

  restore.capture();
  restore.restore();

  assert.equal(focuses, 1);
});

test("does not focus an invoking element that was disconnected before the dialog finished", () => {
  let focuses = 0;
  const invoker = {
    isConnected: true,
    focus: () => { focuses += 1; },
  };
  const restore = createFocusRestorer(() => invoker);

  restore.capture();
  invoker.isConnected = false;
  restore.restore();

  assert.equal(focuses, 0);
});
