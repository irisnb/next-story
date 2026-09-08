// allowlist.test.mjs — 禁用能力 allowlist 的本地单元测试（change: dsh-capability-integration-validation 任务 1.3）
// 默认拒绝：通用文件、Shell、网络、子代理、无限循环、作品写入保持禁用。
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_CAPABILITIES,
  FORBIDDEN_CAPABILITIES,
  isAllowed,
  authorize,
  isStoryWrite,
} from "../allowlist.mjs";

test("允许集只含受控只读能力", () => {
  assert.deepEqual(ALLOWED_CAPABILITIES, ["story.list", "story.read_document", "story.read_snapshot"]);
});

test("禁用集覆盖六类禁止能力：文件、Shell、网络、子代理、无限循环、作品写入", () => {
  const categories = {
    filesystem: ["fs", "fs.read", "fs.write", "fs.search"],
    shell: ["shell", "bash", "pwsh"],
    network: ["network", "web", "web.search"],
    subagent: ["subagent", "subagent.spawn"],
    loop: ["loop", "goal"],
    storyWrite: ["story.write", "story.edit", "story.delete", "story.insert"],
  };
  for (const [cat, names] of Object.entries(categories)) {
    for (const n of names) {
      assert.ok(FORBIDDEN_CAPABILITIES.includes(n), `禁用集应含 ${cat} 能力 ${n}`);
      assert.equal(isAllowed(n), false, `${n} 必须默认拒绝`);
    }
  }
});

test("isAllowed 默认拒绝未知能力", () => {
  assert.equal(isAllowed("story.read_document"), true);
  assert.equal(isAllowed("story.write"), false);
  assert.equal(isAllowed("unknown.thing"), false);
});

test("authorize 对允许/禁止/未知给出结构化结果", () => {
  assert.deepEqual(authorize("story.read_document"), { allowed: true, capability: "story.read_document", reason: null });
  assert.deepEqual(authorize("fs.write"), { allowed: false, capability: "fs.write", reason: "forbidden_capability" });
  assert.deepEqual(authorize("unknown.thing"), { allowed: false, capability: "unknown.thing", reason: "unknown_capability" });
});

test("isStoryWrite 识别作品写入类能力", () => {
  assert.equal(isStoryWrite("story.write"), true);
  assert.equal(isStoryWrite("story.edit"), true);
  assert.equal(isStoryWrite("story.read_document"), false);
  assert.equal(isStoryWrite("fs.write"), false, "通用文件写入不等于作品写入");
});
