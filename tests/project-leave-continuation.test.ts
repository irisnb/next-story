import assert from "node:assert/strict";
import test from "node:test";

import { orchestrateCloseRequest } from "../src/close-guard.ts";
import { EditorSaveState } from "../src/editor-save-state.ts";
import { LeaveCoordinator } from "../src/leave-guard.ts";
import { openProjectAfterAuthorization } from "../src/project-leave-flow.ts";
import type {
  ContentTree,
  ProjectMetadata,
  ProjectOpenResult,
  ProjectTreeState,
} from "../src/types.ts";

const TREE: ContentTree = {
  root_children: ["doc-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "未命名文档", kind: "Document", children: [] },
  },
  recycle_bin: [],
};

function metadata(name = "候选作品"): ProjectMetadata {
  return {
    name,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    version: 3,
  };
}

function openResult(name = "候选作品"): ProjectOpenResult {
  return { metadata: metadata(name), tree: TREE };
}

function oldProjectHarness(): {
  authorize(): Promise<boolean>;
  hasProject(): boolean;
  isDirty(): boolean;
  save(): Promise<boolean>;
} {
  let loaded = true;
  const state = new EditorSaveState("saved");
  state.setCurrent("edited");
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

test("cancelled folder selection never reaches authorization or replacement", async () => {
  const old = oldProjectHarness();
  let replacements = 0;
  let authorizations = 0;

  await openProjectAfterAuthorization({
    authorize: async () => { authorizations += 1; return true; },
    selectDirectory: async () => null,
    openProject: async (): Promise<ProjectOpenResult> => { throw new Error("not called"); },
    replaceProject: () => { replacements += 1; },
  });

  assert.equal(old.hasProject(), true);
  assert.equal(old.isDirty(), true);
  assert.equal(authorizations, 0, "未选目录前不进入授权");
  assert.equal(replacements, 0);
});

test("open failure retains the old project state and save ability", async () => {
  const old = oldProjectHarness();
  let reported: unknown = null;
  let authorizations = 0;

  await openProjectAfterAuthorization({
    authorize: async () => { authorizations += 1; return true; },
    selectDirectory: async () => "broken-project",
    openProject: async () => { throw new Error("invalid project"); },
    replaceProject: (_state: ProjectTreeState) => {},
    reportError: (error) => { reported = error; },
  });

  assert.equal(old.hasProject(), true);
  assert.equal(old.isDirty(), true);
  assert.equal(authorizations, 0, "读取候选作品失败不进入授权");
  assert.equal(await old.save(), true);
  assert.equal(old.isDirty(), false);
  assert.equal((reported as Error).message, "invalid project");
});

test("authorization runs only after the candidate project is read, immediately before replacement", async () => {
  const calls: string[] = [];

  await openProjectAfterAuthorization({
    authorize: async () => { calls.push("authorize"); return true; },
    selectDirectory: async () => { calls.push("select"); return "候选作品"; },
    openProject: async () => {
      calls.push("open");
      return openResult();
    },
    replaceProject: () => { calls.push("replace"); },
  });

  assert.deepEqual(calls, ["select", "open", "authorize", "replace"]);
});

test("edits made while the candidate is being read are covered by the final leave guard", async () => {
  const openDeferred: { resolve: (result: ProjectOpenResult) => void } = {
    resolve: () => { throw new Error("unused"); },
  };
  const openPromise = new Promise<ProjectOpenResult>((resolve) => {
    openDeferred.resolve = resolve;
  });
  let authorizations = 0;
  let replacements = 0;
  const old = oldProjectHarness();

  const flow = openProjectAfterAuthorization({
    authorize: async () => {
      authorizations += 1;
      // 授权在候选作品读完后才发生：本次确认（保存并离开）覆盖读取期间产生的新编辑。
      return old.save();
    },
    selectDirectory: async () => "候选作品",
    openProject: () => openPromise,
    replaceProject: () => { replacements += 1; },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(authorizations, 0, "读取候选作品期间不提前授权");

  // 读取期间用户继续编辑旧作品（新的未保存修改，旧实现会在这里丢失）
  const state = new EditorSaveState("saved");
  state.setCurrent("读取期间的新编辑");
  assert.equal(state.hasUnsavedChanges, true);

  openDeferred.resolve(openResult());
  await flow;

  assert.equal(authorizations, 1);
  assert.equal(replacements, 1);
});

test("cancelled final authorization keeps the read candidate unapplied", async () => {
  const openDeferred: { resolve: (result: ProjectOpenResult) => void } = {
    resolve: () => { throw new Error("unused"); },
  };
  const openPromise = new Promise<ProjectOpenResult>((resolve) => {
    openDeferred.resolve = resolve;
  });
  const calls: string[] = [];
  let replacements = 0;

  const flow = openProjectAfterAuthorization({
    authorize: async () => { calls.push("authorize"); return false; },
    selectDirectory: async () => { calls.push("select"); return "候选作品"; },
    openProject: async () => {
      calls.push("open");
      return openPromise;
    },
    replaceProject: () => { replacements += 1; },
  });
  await Promise.resolve();
  await Promise.resolve();

  openDeferred.resolve(openResult());
  await flow;

  assert.deepEqual(calls, ["select", "open", "authorize"]);
  assert.equal(replacements, 0, "授权取消不得替换当前作品");
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
