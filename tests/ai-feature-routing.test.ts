import assert from "node:assert/strict";
import test from "node:test";

import { applyGenerateError, retryAcceptedRequest } from "../src/ai-feature.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import type { GenerateAiError, SelectionSnapshot } from "../src/types.ts";

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

test("routes configuration_required to the configuration panel state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = {
    code: "configuration_required",
    message: "请先配置",
  };

  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "configuration_required", snapshot: snap });
});

test("routes non-configuration failures to the ordinary error state", () => {
  const state = new AiPanelState();
  const snap = snapshot("背叛");
  const error: GenerateAiError = { code: "authentication", message: "认证失败" };

  applyGenerateError(state, snap, error);

  assert.deepEqual(state.view.request, { kind: "error", snapshot: snap, error });
});

test("retry enters loading only when the coordinator accepts the request", () => {
  const state = new AiPanelState();
  const snap = snapshot("原选区");
  state.beginRequest(snap);
  state.fail(snap, { code: "network", message: "网络失败" });

  assert.equal(retryAcceptedRequest(state, () => null), false);
  assert.equal(state.view.request.kind, "error");

  assert.equal(retryAcceptedRequest(state, () => Promise.resolve()), true);
  assert.deepEqual(state.view.request, { kind: "loading", snapshot: snap });
});
