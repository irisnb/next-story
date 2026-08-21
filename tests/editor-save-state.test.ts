import assert from "node:assert/strict";
import test from "node:test";

import { EditorSaveState } from "../src/editor-save-state.ts";

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("derives unsaved state from the current document baseline and recognizes a full revert", () => {
  const state = new EditorSaveState("saved");

  state.setCurrent("edit");
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "有未保存修改");

  state.setCurrent("saved");
  assert.equal(state.hasUnsavedChanges, false);
  assert.equal(state.statusText, "已保存");
});

test("freezes a save snapshot so edits made during saving remain unsaved", async () => {
  const pending = deferred();
  const saved: string[] = [];
  const state = new EditorSaveState("old");
  state.setCurrent("snapshot");

  const saving = state.save(async (content) => {
    saved.push(content);
    await pending.promise;
  });
  assert.equal(state.statusText, "正在保存…");

  state.setCurrent("later");
  pending.resolve();
  assert.equal(await saving, true);
  assert.deepEqual(saved, ["snapshot"]);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "有未保存修改");
});

test("shares one in-flight save and keeps the baseline unchanged after failure", async () => {
  const pending = deferred();
  let calls = 0;
  const state = new EditorSaveState("old");
  state.setCurrent("new");
  const writer = async (): Promise<void> => {
    calls += 1;
    await pending.promise;
  };

  const first = state.save(writer);
  const second = state.save(writer);
  assert.equal(first, second);
  assert.equal(calls, 1);

  pending.reject(new Error("磁盘不可写"));
  assert.equal(await first, false);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "保存失败：磁盘不可写");
});

test("keeps contents unsaved when a standalone backend save is rejected", async () => {
  const state = new EditorSaveState("old");
  state.setCurrent("new");

  const saved = await state.save(async () => {
    throw new Error("磁盘写入失败");
  });

  assert.equal(saved, false);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.isSaving, false);
  assert.equal(state.statusText, "保存失败：磁盘写入失败");
});

test("retries the current document content after a failed save", async () => {
  const state = new EditorSaveState("old");
  state.setCurrent("current");

  const failed = await state.save(async () => {
    throw new Error("磁盘写入失败");
  });
  const retriedSnapshots: string[] = [];
  const retried = await state.save(async (content) => {
    retriedSnapshots.push(content);
  });

  assert.equal(failed, false);
  assert.equal(retried, true);
  assert.deepEqual(retriedSnapshots, ["current"]);
  assert.equal(state.hasUnsavedChanges, false);
});
