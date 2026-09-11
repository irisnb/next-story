import assert from "node:assert/strict";
import test from "node:test";

import {
  clampLeft,
  clampTop,
  clampWidth,
  clampHeight,
  snapResult,
  sideBySideFloatingGeometry,
  WINDOW_MIN_WIDTH_PX,
  WINDOW_MIN_HEIGHT_PX,
  SNAP_THRESHOLD_PX,
} from "../src/ai-dock.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";

test("clampWidth and clampHeight enforce the minimum window size", () => {
  assert.equal(clampWidth(100), WINDOW_MIN_WIDTH_PX);
  assert.equal(clampWidth(500), 500);
  assert.equal(clampHeight(50), WINDOW_MIN_HEIGHT_PX);
  assert.equal(clampHeight(400), 400);
});

test("clampLeft and clampTop keep a window inside the app bounds", () => {
  assert.equal(clampLeft(-20, 300, 800), 0);
  assert.equal(clampLeft(700, 300, 800), 500);
  assert.equal(clampLeft(200, 300, 800), 200);
  assert.equal(clampTop(-5, 200, 600), 0);
  assert.equal(clampTop(500, 200, 600), 400);
});

test("snapResult snaps start and end edges and reports the aligned edge as guide", () => {
  // 起始边吸附到 0，参考线画在被对齐的边（即 0）。
  assert.deepEqual(snapResult(4, 300, [0], SNAP_THRESHOLD_PX), { value: 0, guide: 0 });
  // 远离候选边：不吸附，无参考线。
  assert.deepEqual(snapResult(10, 300, [0], SNAP_THRESHOLD_PX), { value: 10, guide: null });
  // 起始边吸附到 104。
  assert.deepEqual(snapResult(100, 300, [0, 104], SNAP_THRESHOLD_PX), { value: 104, guide: 104 });
  // 结束边（start + size）吸附：value 回退 size，guide 停在被对齐边（P0-4）。
  assert.deepEqual(snapResult(196, 300, [500], SNAP_THRESHOLD_PX), { value: 200, guide: 500 });
  // 结束边（start + size）吸附到 400：value 回退 300，guide 停在被对齐边。
  assert.deepEqual(snapResult(95, 300, [0, 400], SNAP_THRESHOLD_PX), { value: 100, guide: 400 });
});

test("window geometry never enters the reducer state", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  // 状态只存「停靠/浮动」归属，不含位置/尺寸/层叠。
  assert.equal(state.windows.get("1"), "docked");
  assert.deepEqual([...state.windows.keys()], ["1"]);
  // 值只有「docked」/「floating」，没有任何几何字段。
  assert.equal(state.windows.get("1"), "docked");
});

test("one discussion maps to at most one window, and delete closes its window", () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问题", null);
  state.succeedDirectQuestion("回答");
  assert.equal(state.windows.size, 1);

  state.deleteDiscussion("1");
  assert.equal(state.windows.size, 0);
  assert.equal(state.getDiscussion("1"), null);
});

test("sideBySideFloatingGeometry lays two floating windows equal-width, top-aligned and inside bounds", () => {
  const { first, second } = sideBySideFloatingGeometry(
    { left: 40, top: 60, width: 400, height: 300 },
    { left: 500, top: 120, width: 360, height: 280 },
    { width: 900, height: 600 },
  );
  assert.equal(first.width, second.width);
  assert.equal(first.top, second.top, "顶边对齐");
  assert.equal(first.top, 60, "以 first 的 top 为锚");
  assert.equal(second.left, first.left + first.width + 8, "等宽贴邻");
  assert.ok(first.width >= WINDOW_MIN_WIDTH_PX);
  assert.ok(first.left >= 0 && second.left + second.width <= 900, "不越出应用边界");
});

test("sideBySideFloatingGeometry clamps to min size in a narrow bounds", () => {
  const { first, second } = sideBySideFloatingGeometry(
    { left: 0, top: 0, width: 400, height: 100 },
    { left: 0, top: 0, width: 360, height: 80 },
    { width: 400, height: 300 },
  );
  assert.equal(first.width, WINDOW_MIN_WIDTH_PX);
  assert.equal(second.width, WINDOW_MIN_WIDTH_PX);
  assert.equal(first.height, WINDOW_MIN_HEIGHT_PX);
  assert.equal(second.height, WINDOW_MIN_HEIGHT_PX);
});
