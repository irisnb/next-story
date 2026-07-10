import assert from "node:assert/strict";
import test from "node:test";

import { LlmConfigUiState } from "../src/llm-config-state.ts";

test("returns to the page that opened LLM configuration", () => {
  const state = new LlmConfigUiState();

  state.beginOpen("editor-page");
  assert.equal(state.returnPage, "editor-page");

  state.beginOpen("welcome-page");
  assert.equal(state.returnPage, "welcome-page");
});

test("keeps controls disabled while an operation is busy", () => {
  const state = new LlmConfigUiState();
  const generation = state.beginOpen("welcome-page");
  state.completeRefresh(generation);

  assert.equal(state.beginOperation(true), true);
  assert.equal(state.controlsDisabled(true), true);
  assert.equal(state.fieldsDisabled(), true);

  state.markDirty();
  assert.equal(state.beginOperation(true), false);
  assert.equal(state.controlsDisabled(true), true);

  state.endOperation();
  assert.equal(state.controlsDisabled(true), false);
  assert.equal(state.fieldsDisabled(), false);
});

test("ignores stale refreshes and does not overwrite dirty input", () => {
  const state = new LlmConfigUiState();
  const first = state.beginOpen("welcome-page");
  const second = state.beginOpen("editor-page");

  assert.deepEqual(state.completeRefresh(first), {
    isCurrent: false,
    shouldApply: false,
  });

  state.markDirty();
  assert.deepEqual(state.completeRefresh(second), {
    isCurrent: true,
    shouldApply: false,
  });
  assert.equal(state.controlsDisabled(true), false);
});
