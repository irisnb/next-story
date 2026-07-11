import assert from "node:assert/strict";
import test from "node:test";

import { orchestrateCloseRequest } from "../src/close-guard.ts";
import { EditorSaveState } from "../src/editor-save-state.ts";
import { LeaveCoordinator } from "../src/leave-guard.ts";
import { openProjectAfterAuthorization } from "../src/project-leave-flow.ts";
import type { ProjectOpenResult, ProjectState } from "../src/types.ts";

function oldProjectHarness(): {
  authorize(): Promise<boolean>;
  hasProject(): boolean;
  isDirty(): boolean;
  save(): Promise<boolean>;
} {
  let loaded = true;
  const state = new EditorSaveState("saved", "main");
  state.setCurrent("edited", "main");
  const leave = new LeaveCoordinator({
    isDirty: () => state.hasUnsavedChanges,
    choose: async () => "discard-and-leave",
    save: async () => true,
  });
  return {
    authorize: () => leave.run(),
    hasProject: () => loaded,
    isDirty: () => state.hasUnsavedChanges,
    save: () => state.save(async () => {}),
  };
}

test("discard authorization followed by cancelled folder selection retains the current project and guard", async () => {
  const old = oldProjectHarness();
  let replacements = 0;

  await openProjectAfterAuthorization({
    authorize: old.authorize,
    selectDirectory: async () => null,
    openProject: async (): Promise<ProjectOpenResult> => { throw new Error("not called"); },
    replaceProject: () => { replacements += 1; },
  });

  assert.equal(old.hasProject(), true);
  assert.equal(old.isDirty(), true);
  assert.equal(replacements, 0);
});

test("open failure retains the old project state and save ability", async () => {
  const old = oldProjectHarness();
  let reported: unknown = null;

  await openProjectAfterAuthorization({
    authorize: old.authorize,
    selectDirectory: async () => "broken-project",
    openProject: async () => { throw new Error("invalid project"); },
    replaceProject: (_state: ProjectState) => {},
    reportError: (error) => { reported = error; },
  });

  assert.equal(old.hasProject(), true);
  assert.equal(old.isDirty(), true);
  assert.equal(await old.save(), true);
  assert.equal(old.isDirty(), false);
  assert.equal((reported as Error).message, "invalid project");
});

test("destroy rejection after approved leave retains editor state and future save protection", async () => {
  const old = oldProjectHarness();
  const result = await orchestrateCloseRequest({
    isDirty: old.isDirty,
    preventDefault: () => {},
    guardLeave: old.authorize,
    destroy: async () => { throw new Error("destroy failed"); },
  });

  assert.equal(result, "kept-open");
  assert.equal(old.hasProject(), true);
  assert.equal(old.isDirty(), true);
  assert.equal(await old.save(), true);
  assert.equal(old.isDirty(), false);
});
