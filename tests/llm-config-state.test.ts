import assert from "node:assert/strict";
import test from "node:test";

import { LlmConfigUiState } from "../src/llm-config-state.ts";
import type { LlmConfig } from "../src/types.ts";

const savedConfig: LlmConfig = {
  api_base_url: "https://api.example.com",
  api_key: "saved-key",
  model: "saved-model",
};

const editedConfig: LlmConfig = {
  api_base_url: "https://api.example.com",
  api_key: "edited-key",
  model: "saved-model",
};

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

test("loaded and saved LLM config values become the clean baseline", () => {
  const state = new LlmConfigUiState();
  const generation = state.beginOpen("welcome-page");
  state.completeRefresh(generation);

  state.commitBaseline(savedConfig);
  assert.equal(state.hasUnsavedChanges(savedConfig), false);
  assert.equal(state.hasUnsavedChanges(editedConfig), true);

  state.commitBaseline(editedConfig);
  assert.equal(state.hasUnsavedChanges(editedConfig), false);
});

test("discard clears LLM config dirty state without saving edited values", () => {
  const state = new LlmConfigUiState();
  state.commitBaseline(savedConfig);

  assert.equal(state.hasUnsavedChanges(editedConfig), true);
  state.discardChanges();
  assert.equal(state.hasUnsavedChanges(editedConfig), false);
});

test("failed save leaves edited LLM config dirty against the saved baseline", () => {
  const state = new LlmConfigUiState();
  state.commitBaseline(savedConfig);

  assert.equal(state.beginOperation(true), true);
  state.endOperation();

  assert.equal(state.hasUnsavedChanges(editedConfig), true);
  assert.equal(state.hasUnsavedChanges(savedConfig), false);
});
