import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelScrollResetController } from "../src/ai-panel-scroll.ts";
import type { PanelRequestState } from "../src/ai-panel-state.ts";
import type { SelectionSnapshot } from "../src/types.ts";

function snapshot(
  selectedText: string,
  notebook: SelectionSnapshot["notebook"] = "draft",
  start = 0,
): SelectionSnapshot {
  return { notebook, selectedText, start, end: start + selectedText.length };
}

function loading(value: SelectionSnapshot): PanelRequestState {
  return { kind: "loading", snapshot: value };
}

test("resets for the initial request and each different snapshot identity", () => {
  const controller = new AiPanelScrollResetController();
  const first = snapshot("相同文字", "draft", 0);

  assert.equal(controller.shouldReset(loading(first)), true);
  assert.equal(controller.shouldReset(loading(snapshot("不同文字", "draft", 0))), true);
  assert.equal(controller.shouldReset(loading(snapshot("相同文字", "draft", 5))), true);
  assert.equal(controller.shouldReset(loading(snapshot("相同文字", "manuscript", 0))), true);
});

test("preserves scroll when retrying the same frozen snapshot", () => {
  const controller = new AiPanelScrollResetController();
  const value = snapshot("原问题", "draft", 3);

  assert.equal(controller.shouldReset(loading(value)), true);
  assert.equal(
    controller.shouldReset({
      kind: "error",
      snapshot: value,
      error: { code: "network", message: "失败" },
    }),
    false,
  );
  assert.equal(controller.shouldReset(loading({ ...value })), false);
});

test("preserves scroll across visibility renders and same-snapshot completion", () => {
  const controller = new AiPanelScrollResetController();
  const value = snapshot("问题");

  assert.equal(controller.shouldReset(loading(value)), true);
  assert.equal(controller.shouldReset(loading(value)), false, "close/open 重绘不得重置");
  assert.equal(
    controller.shouldReset({ kind: "success", snapshot: value, response: "回答" }),
    false,
  );
});
