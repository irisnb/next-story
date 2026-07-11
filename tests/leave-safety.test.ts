import assert from "node:assert/strict";
import test from "node:test";

import { guardLeave, LeaveCoordinator, type LeaveChoice } from "../src/leave-guard.ts";
import { CloseCoordinator, orchestrateCloseRequest } from "../src/close-guard.ts";
import { EditorSaveState, type NotebookContents } from "../src/editor-save-state.ts";
import { NotebookMemory } from "../src/notebook-memory.ts";

function deferredSave(): {
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

test("switching notebooks retains both values without asking or saving", () => {
  let prompts = 0;
  let saves = 0;
  const notebooks = new NotebookMemory("draft", "main");
  notebooks.update("draft", "draft edit");
  notebooks.switchTo("main");
  notebooks.update("main", "main edit");
  notebooks.switchTo("draft");

  assert.equal(notebooks.value("draft"), "draft edit");
  assert.equal(notebooks.value("main"), "main edit");
  assert.equal(prompts, 0);
  assert.equal(saves, 0);
});

for (const [choice, expected] of [
  ["save-and-leave", true],
  ["discard-and-leave", true],
  ["cancel", false],
] as const) {
  test(`handles dirty leave choice ${choice}`, async () => {
    let saves = 0;
    let dirty = true;
    const result = await guardLeave({
      isDirty: () => dirty,
      choose: async (): Promise<LeaveChoice> => choice,
      save: async () => { saves += 1; dirty = false; return true; },
    });
    assert.equal(result, expected);
    assert.equal(saves, choice === "save-and-leave" ? 1 : 0);
  });
}

test("leaves clean state without prompting and stays after failed save", async () => {
  let prompts = 0;
  assert.equal(await guardLeave({
    isDirty: () => false,
    choose: async () => { prompts += 1; return "cancel"; },
    save: async () => true,
  }), true);
  assert.equal(prompts, 0);

  assert.equal(await guardLeave({
    isDirty: () => true,
    choose: async () => "save-and-leave",
    save: async () => false,
  }), false);
});

test("discard authorization stays valid without mutating project state", async () => {
  let dirty = true;
  let prompts = 0;
  const leave = new LeaveCoordinator({
    isDirty: () => dirty,
    choose: async () => { prompts += 1; return "discard-and-leave"; },
    save: async () => true,
  });

  assert.equal(await leave.run(), true);
  assert.equal(dirty, true);
  assert.equal(prompts, 1);
});

test("duplicate leave requests share one pending authorization", async () => {
  let resolveChoice!: (choice: LeaveChoice) => void;
  const choice = new Promise<LeaveChoice>((resolve) => { resolveChoice = resolve; });
  let prompts = 0;
  const leave = new LeaveCoordinator({
    isDirty: () => true,
    choose: () => { prompts += 1; return choice; },
    save: async () => true,
  });

  const first = leave.run();
  const second = leave.run();
  assert.equal(first, second);
  assert.equal(prompts, 1);
  resolveChoice("discard-and-leave");
  assert.equal(await first, true);
});

test("save-and-leave waits for an in-flight A save then saves current B before unloading", async () => {
  const firstWrite = deferredSave();
  const snapshots: NotebookContents[] = [];
  const state = new EditorSaveState("saved", "main");
  state.setCurrent("A", "main");
  const writer = async (snapshot: NotebookContents): Promise<void> => {
    snapshots.push(snapshot);
    if (snapshots.length === 1) await firstWrite.promise;
  };
  const savingA = state.save(writer);
  state.setCurrent("B", "main");
  const leave = new LeaveCoordinator({
    isDirty: () => state.hasUnsavedChanges,
    choose: async () => "save-and-leave",
    save: () => state.save(writer),
  });

  const leaving = leave.run();
  firstWrite.resolve();
  assert.equal(await savingA, true);
  assert.equal(await leaving, true);
  assert.deepEqual(snapshots, [
    { draft: "A", main: "main" },
    { draft: "B", main: "main" },
  ]);
  assert.equal(state.hasUnsavedChanges, false);
});

test("save-and-leave keeps the project loaded when the follow-up B save fails", async () => {
  const firstWrite = deferredSave();
  const snapshots: NotebookContents[] = [];
  const state = new EditorSaveState("saved", "main");
  state.setCurrent("A", "main");
  const writer = async (snapshot: NotebookContents): Promise<void> => {
    snapshots.push(snapshot);
    if (snapshots.length === 1) await firstWrite.promise;
    else throw new Error("B 写入失败");
  };
  const savingA = state.save(writer);
  state.setCurrent("B", "main");
  const leave = new LeaveCoordinator({
    isDirty: () => state.hasUnsavedChanges,
    choose: async () => "save-and-leave",
    save: () => state.save(writer),
  });

  const leaving = leave.run();
  firstWrite.resolve();
  assert.equal(await savingA, true);
  assert.equal(await leaving, false);
  assert.equal(state.hasUnsavedChanges, true);
  assert.equal(state.statusText, "保存失败：B 写入失败");
});

for (const choice of ["save-and-leave", "discard-and-leave"] as const) {
  test(`confirmed native close ${choice} prevents the event and destroys the window exactly once`, async () => {
    let prevented = 0;
    let saves = 0;
    let destroys = 0;
    const result = await orchestrateCloseRequest({
      isDirty: () => true,
      preventDefault: () => { prevented += 1; },
      guardLeave: async () => {
        if (choice === "save-and-leave") saves += 1;
        return true;
      },
      destroy: async () => { destroys += 1; },
    });

    assert.equal(result, "closed");
    assert.equal(prevented, 1);
    assert.equal(saves, choice === "save-and-leave" ? 1 : 0);
    assert.equal(destroys, 1);
  });
}

test("cancelled or failed native close stays open without destroying the window", async () => {
  let destroys = 0;
  const result = await orchestrateCloseRequest({
    isDirty: () => true,
    preventDefault: () => {},
    guardLeave: async () => false,
    destroy: async () => { destroys += 1; },
  });
  assert.equal(result, "kept-open");
  assert.equal(destroys, 0);
});

test("native destroy rejection is reported and keeps the window open", async () => {
  const failure = new Error("window.destroy not allowed");
  const reported: unknown[] = [];
  const result = await orchestrateCloseRequest({
    isDirty: () => true,
    preventDefault: () => {},
    guardLeave: async () => true,
    destroy: async () => { throw failure; },
    reportError: (error) => { reported.push(error); },
  });

  assert.equal(result, "kept-open");
  assert.deepEqual(reported, [failure]);
});

test("duplicate native close requests share one confirmation and destroy exactly once", async () => {
  let resolveLeave!: (canLeave: boolean) => void;
  const leave = new Promise<boolean>((resolve) => { resolveLeave = resolve; });
  let destroys = 0;
  const close = new CloseCoordinator({
    isDirty: () => true,
    guardLeave: () => leave,
    destroy: async () => { destroys += 1; },
  });

  const first = close.run(() => {});
  const second = close.run(() => {});
  assert.equal(first, second);
  resolveLeave(true);
  assert.equal(await first, "closed");
  assert.equal(destroys, 1);
});
