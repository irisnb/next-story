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

/** 模拟表单里的“未输入新密钥”：载荷不携带 `api_key`（掩码/空输入，后端复用旧密钥）。 */
function withoutKey(config: LlmConfig): LlmConfig {
  return { api_base_url: config.api_base_url, model: config.model };
}

test("keeps controls disabled while an operation is busy", () => {
  const state = new LlmConfigUiState();
  const generation = state.beginOpen();
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
  const first = state.beginOpen();
  const second = state.beginOpen();

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
  const generation = state.beginOpen();
  state.completeRefresh(generation);

  // 基线只记非敏感字段与 hasApiKey；携带 api_key 的配置视为“用户输入了新密钥”→ 未保存。
  state.commitBaseline(savedConfig, true);
  assert.equal(state.hasUnsavedChanges(withoutKey(savedConfig)), false);
  assert.equal(state.hasUnsavedChanges(editedConfig), true);

  state.commitBaseline(withoutKey(editedConfig), true);
  assert.equal(state.hasUnsavedChanges(withoutKey(editedConfig)), false);
});

test("user-typed key counts as unsaved; mask or empty key reuses the saved one", () => {
  const state = new LlmConfigUiState();
  state.commitBaseline(savedConfig, true);
  assert.equal(state.hasSavedKey(), true);

  // 掩码/空输入 → 不携带 api_key → 复用已保存密钥，不构成修改
  assert.equal(state.hasUnsavedChanges(withoutKey(savedConfig)), false);
  // 用户输入了新密钥 → 未保存修改
  assert.equal(state.hasUnsavedChanges({ ...withoutKey(savedConfig), api_key: "新密钥" }), true);

  // 从未保存过密钥时：空输入同样不构成修改，但表单校验会要求填写新密钥
  const fresh = new LlmConfigUiState();
  fresh.commitBaseline({ api_base_url: "https://api.example.com", model: "m" }, false);
  assert.equal(fresh.hasSavedKey(), false);
  assert.equal(
    fresh.hasUnsavedChanges({ api_base_url: "https://api.example.com", model: "m" }),
    false,
  );
});

test("discard clears LLM config dirty state without saving edited values", () => {
  const state = new LlmConfigUiState();
  state.commitBaseline(savedConfig, true);

  assert.equal(state.hasUnsavedChanges(editedConfig), true);
  state.discardChanges();
  assert.equal(state.hasUnsavedChanges(editedConfig), false);
});

test("failed save leaves edited LLM config dirty against the saved baseline", () => {
  const state = new LlmConfigUiState();
  state.commitBaseline(savedConfig, true);

  assert.equal(state.beginOperation(true), true);
  state.endOperation();

  assert.equal(state.hasUnsavedChanges(editedConfig), true);
  assert.equal(state.hasUnsavedChanges(withoutKey(savedConfig)), false);
});
