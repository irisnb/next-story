import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FIRST_RUN_GUIDE_STEPS } from "../src/first-run-guide-steps.ts";
import {
  FIRST_RUN_GUIDE_STORAGE_KEY,
  createGuideStepMachine,
  isFirstRunGuideCompleted,
  markFirstRunGuideCompleted,
} from "../src/first-run-guide.ts";
import { memoryStorageFixture } from "./memory-storage-fixture.ts";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("完成标记：无键视为未完成", () => {
  const storage = memoryStorageFixture();
  assert.equal(isFirstRunGuideCompleted(storage), false);
});

test("完成标记：空字符串值视为未完成", () => {
  const storage = memoryStorageFixture({ [FIRST_RUN_GUIDE_STORAGE_KEY]: "" });
  assert.equal(isFirstRunGuideCompleted(storage), false);
});

test("完成标记：markFirstRunGuideCompleted 写入后即完成", () => {
  const storage = memoryStorageFixture();
  markFirstRunGuideCompleted(storage);
  assert.equal(isFirstRunGuideCompleted(storage), true);
  assert.notEqual(storage.data[FIRST_RUN_GUIDE_STORAGE_KEY], "");
});

test("完成标记：键名固定，写入值往返一致（模拟重启后仍判定完成）", () => {
  assert.equal(FIRST_RUN_GUIDE_STORAGE_KEY, "next-story.onboarding-completed");
  const storage = memoryStorageFixture();
  markFirstRunGuideCompleted(storage);
  const written = storage.data[FIRST_RUN_GUIDE_STORAGE_KEY];
  assert.ok(typeof written === "string" && written.length > 0);
  // 模拟重启：新存储实例注入已写入的键值仍判定完成。
  const reloaded = memoryStorageFixture({ [FIRST_RUN_GUIDE_STORAGE_KEY]: written });
  assert.equal(isFirstRunGuideCompleted(reloaded), true);
});

test("步进机：四步顺序前进，末卡封顶不再前进", () => {
  const machine = createGuideStepMachine(4);
  assert.equal(machine.index, 0);
  assert.equal(machine.canPrev, false);
  assert.equal(machine.isLast, false);
  machine.next();
  assert.equal(machine.index, 1);
  machine.next();
  assert.equal(machine.index, 2);
  machine.next();
  assert.equal(machine.index, 3);
  assert.equal(machine.isLast, true);
  machine.next();
  assert.equal(machine.index, 3, "末卡再点「下一张」停留在末卡");
});

test("步进机：首张 prev 无操作，中间卡可后退", () => {
  const machine = createGuideStepMachine(4);
  machine.prev();
  assert.equal(machine.index, 0, "首张后退停留在第一张");
  assert.equal(machine.canPrev, false);
  machine.next();
  assert.equal(machine.canPrev, true);
  machine.prev();
  assert.equal(machine.index, 0);
});

test("步进机：reset 后回第一张，可循环使用", () => {
  const machine = createGuideStepMachine(4);
  machine.next();
  machine.next();
  machine.reset();
  assert.equal(machine.index, 0);
  assert.equal(machine.canPrev, false);
  assert.equal(machine.isLast, false);
  machine.next();
  assert.equal(machine.index, 1, "reset 后仍可继续步进");
});

test("四卡数据：标题顺序与 design.md 附录 A 定稿一致", () => {
  assert.equal(FIRST_RUN_GUIDE_STEPS.length, 4);
  assert.deepEqual(
    FIRST_RUN_GUIDE_STEPS.map((step) => step.title),
    ["这是一款陪你写故事的软件", "「项目」就是个文件夹", "核心是 AI 陪想", "开始之后"],
  );
});

test("四卡数据：标题含「项目」「AI」关键词，段落非空", () => {
  assert.match(FIRST_RUN_GUIDE_STEPS[1]!.title, /项目/);
  assert.match(FIRST_RUN_GUIDE_STEPS[2]!.title, /AI/);
  for (const step of FIRST_RUN_GUIDE_STEPS) {
    assert.ok(step.paragraphs.length > 0, `「${step.title}」至少一段正文`);
    for (const paragraph of step.paragraphs) {
      assert.ok(paragraph.trim().length > 0, `「${step.title}」段落非空`);
    }
  }
});

test("DOM 契约：首启向导是原生 dialog 且 7 个 id 齐全", () => {
  assert.match(html, /<dialog\b[^>]*\bid="first-run-guide-dialog"/);
  const requiredIds = [
    "first-run-guide-title",
    "first-run-guide-skip",
    "first-run-guide-body",
    "first-run-guide-dots",
    "first-run-guide-prev",
    "first-run-guide-next",
  ];
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `缺少 #${id}`);
  }
});

test("DOM 契约：「跳过」「上一张」「下一张」按钮文字存在", () => {
  assert.match(html, /<button\b[^>]*\bid="first-run-guide-skip"[^>]*>\s*跳过\s*</);
  assert.match(html, /<button\b[^>]*\bid="first-run-guide-prev"[^>]*>\s*上一张\s*</);
  assert.match(html, /<button\b[^>]*\bid="first-run-guide-next"[^>]*>\s*下一张\s*</);
});
