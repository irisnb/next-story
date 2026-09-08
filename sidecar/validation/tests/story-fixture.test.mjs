// story-fixture.test.mjs — 固定作品 fixture 的本地单元测试（change: dsh-capability-integration-validation 任务 1.1）
// fixture 覆盖允许/隐藏/回收站/另一部作品/带未保存修改的文档，且自洽。
import assert from "node:assert/strict";
import test from "node:test";

import {
  STORY_FIXTURE,
  documentsOfWork,
  getDocument,
  isVisible,
  isHidden,
  isRecycled,
  savedVersion,
  hasUnsaved,
  snapshotOf,
  validateFixture,
} from "../fixtures/story-fixture.mjs";

test("固定作品 fixture 覆盖五类文档：允许/隐藏/回收站/另一部作品/未保存", () => {
  const main = documentsOfWork(STORY_FIXTURE.mainWorkId);
  const visibilities = new Set(main.map((d) => d.visibility));
  assert.ok(visibilities.has("visible"));
  assert.ok(visibilities.has("hidden"));
  assert.ok(visibilities.has("recycled"));
  assert.ok(main.some((d) => hasUnsaved(d)), "应含带未保存修改的文档");

  const other = documentsOfWork(STORY_FIXTURE.otherWorkId);
  assert.ok(other.length >= 1, "应含另一部作品的文档");
  assert.ok(other.every((d) => d.workId === STORY_FIXTURE.otherWorkId));
});

test("未保存快照版本高于已保存版本", () => {
  const doc = documentsOfWork(STORY_FIXTURE.mainWorkId).find((d) => hasUnsaved(d));
  assert.ok(doc);
  assert.ok(snapshotOf(doc).version > savedVersion(doc));
});

test("隐藏/回收站文档可用谓词区分", () => {
  const main = documentsOfWork(STORY_FIXTURE.mainWorkId);
  const hidden = main.find((d) => isHidden(d));
  const recycled = main.find((d) => isRecycled(d));
  assert.ok(hidden);
  assert.ok(recycled);
  assert.equal(isVisible(hidden), false);
  assert.equal(isRecycled(hidden), false);
});

test("getDocument 按 id 取文档，未知 id 返回 null", () => {
  assert.ok(getDocument("doc-01"));
  assert.equal(getDocument("no-such-doc"), null);
});

test("fixture 自洽校验通过", () => {
  const r = validateFixture(STORY_FIXTURE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});
