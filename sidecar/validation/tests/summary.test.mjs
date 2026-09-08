// summary.test.mjs — 验证汇总的本地单元测试（change: dsh-capability-integration-validation 任务 5.3）
// 汇总验证结果、可复用 DSH 能力与必须新增的桥接，形成阶段 2 之前的接入结论；
// 确定性验证与真实模型验证严格分离，不伪装真实延迟结论。
import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeValidation,
  REUSABLE_DSH_CAPABILITIES,
  REQUIRED_BRIDGES,
} from "../summary.mjs";

test("5.3 汇总分离确定性验证与真实模型验证，不伪装延迟结论", () => {
  const c = summarizeValidation([
    { taskId: "2.1", mode: "deterministic", verified: true },
    { taskId: "2.1-real", mode: "real", verified: false, notes: "无 API key" },
    { taskId: "3.2", mode: "deterministic", verified: true },
  ]);
  assert.equal(c.verifiedCount, 2);
  assert.equal(c.unverifiedCount, 1);
  assert.equal(c.deterministicOnly, true, "真实模型项均未验证，应标记为纯确定性验证");
  assert.equal(c.realModelLatencyAvailable, false);
  assert.deepEqual(c.unverifiedRealItems, ["2.1-real"]);
});

test("5.3 可复用 DSH 能力与必须新增桥接非空且自洽", () => {
  assert.ok(REUSABLE_DSH_CAPABILITIES.length >= 3, "应列出可复用的 DSH 能力");
  assert.ok(REQUIRED_BRIDGES.length >= 2, "应列出必须新增的桥接");
  const c = summarizeValidation([]);
  assert.deepEqual(c.reusableCapabilities, REUSABLE_DSH_CAPABILITIES);
  assert.deepEqual(c.requiredBridges, REQUIRED_BRIDGES);
});

test("5.3 全部真实模型项未验证时 conclusion 明确不提供延迟基线", () => {
  const c = summarizeValidation([{ taskId: "5.1-real", mode: "real", verified: false }]);
  assert.equal(c.deterministicOnly, true);
  assert.equal(c.realModelLatencyAvailable, false);
  assert.deepEqual(c.unverifiedRealItems, ["5.1-real"]);
});
