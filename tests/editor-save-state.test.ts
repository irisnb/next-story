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

test("derives unsaved state from both notebook baselines and recognizes a full revert", () => {
  const state = new EditorSaveState("draft saved", "main saved");

  state.setCurrent("draft edit", "main saved");
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "有未保存修改");

  state.setCurrent("draft saved", "main edit");
  assert.equal(state.hasUnsavedChanges, true);

  state.setCurrent("draft saved", "main saved");
  assert.equal(state.hasUnsavedChanges, false);
  assert.equal(state.statusText, "已保存");
});

test("freezes a save snapshot so edits made during saving remain unsaved", async () => {
  const pending = deferred();
  const saved: Array<{ draft: string; main: string }> = [];
  const state = new EditorSaveState("old draft", "old main");
  state.setCurrent("snapshot draft", "snapshot main");

  const saving = state.save(async (snapshot) => {
    saved.push(snapshot);
    await pending.promise;
  });
  assert.equal(state.statusText, "正在保存…");

  state.setCurrent("later draft", "snapshot main");
  pending.resolve();
  assert.equal(await saving, true);
  assert.deepEqual(saved, [{ draft: "snapshot draft", main: "snapshot main" }]);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "有未保存修改");
});

test("shares one in-flight save and keeps baselines unchanged after failure", async () => {
  const pending = deferred();
  let calls = 0;
  const state = new EditorSaveState("old draft", "old main");
  state.setCurrent("new draft", "new main");
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
