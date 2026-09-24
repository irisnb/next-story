import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import type { AppDom } from "../src/dom.ts";
import { setupProjectFlow } from "../src/new-project-form.ts";
import type { ContentTree, ProjectMetadata, ProjectOpenResult, ProjectTreeState } from "../src/types.ts";

type Listener = () => void;

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  toggle(value: string, force?: boolean): void {
    const target = force ?? !this.values.has(value);
    if (target) this.values.add(value); else this.values.delete(value);
  }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Listener[]>();
  textContent = "";
  value = "";
  disabled = false;
  type = "";
  className = "";
  title = "";

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  append(...nodes: FakeElement[]): void { this.children.push(...nodes); }
  replaceChildren(): void { this.children.length = 0; }
}

const TREE: ContentTree = {
  root_children: ["doc-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "未命名文档", kind: "Document", children: [] },
  },
  recycle_bin: [],
};

function metadata(name: string): ProjectMetadata {
  return {
    name,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    version: 3,
  };
}

function openResult(name: string): ProjectOpenResult {
  return { metadata: metadata(name), tree: TREE };
}

async function flushUntil(predicate: () => boolean, maxTicks = 60): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("flushUntil timed out");
}

function projectFlowFixture(onProjectReady: (state: ProjectTreeState) => void): {
  readonly dom: AppDom;
  restore(): void;
} {
  const elements = new Map<string, FakeElement>();
  const element = <T extends HTMLElement>(id: string): T => {
    const existing = elements.get(id);
    if (existing) return existing as unknown as T;
    const created = new FakeElement();
    elements.set(id, created);
    return created as unknown as T;
  };

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
  } as unknown as Document;

  setupProjectFlow({
    welcomePage: element("welcome-page"),
    newProjectPage: element("new-project-page"),
    editorPage: element("editor-page"),
    btnNewProject: element("btn-new-project"),
    btnOpenProject: element("btn-open-project"),
    projectNameInput: element("project-name"),
    saveLocationInput: element("save-location"),
    btnBrowse: element("btn-browse"),
    btnCancelNew: element("btn-cancel-new"),
    btnCreateProject: element("btn-create-project"),
    nameError: element("name-error"),
    locationError: element("location-error"),
    recentWorksList: element("recent-works-list"),
    recentWorksEmpty: element("recent-works-empty"),
  } as unknown as AppDom, {
    onProjectReady,
    guardLeave: async () => true,
  });

  return {
    dom: {
      welcomePage: elements.get("welcome-page") as unknown as HTMLElement,
      newProjectPage: elements.get("new-project-page") as unknown as HTMLElement,
      editorPage: elements.get("editor-page") as unknown as HTMLElement,
      btnNewProject: elements.get("btn-new-project") as unknown as HTMLButtonElement,
      btnOpenProject: elements.get("btn-open-project") as unknown as HTMLButtonElement,
      projectNameInput: elements.get("project-name") as unknown as HTMLInputElement,
      saveLocationInput: elements.get("save-location") as unknown as HTMLInputElement,
      btnBrowse: elements.get("btn-browse") as unknown as HTMLButtonElement,
      btnCancelNew: elements.get("btn-cancel-new") as unknown as HTMLButtonElement,
      btnCreateProject: elements.get("btn-create-project") as unknown as HTMLButtonElement,
      nameError: elements.get("name-error") as unknown as HTMLElement,
      locationError: elements.get("location-error") as unknown as HTMLElement,
      recentWorksList: elements.get("recent-works-list") as unknown as HTMLElement,
      recentWorksEmpty: elements.get("recent-works-empty") as unknown as HTMLElement,
    } as unknown as AppDom,
    restore: () => { globalThis.document = previousDocument; },
  };
}

let previousWindow: PropertyDescriptor | undefined;

function installWindow(): void {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
}

function restoreWindow(): void {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
  previousWindow = undefined;
}

test("open project is single-flight: a second click during an in-flight open is ignored", async () => {
  const openDeferred: { resolve: (result: ProjectOpenResult) => void } = {
    resolve: () => { throw new Error("unused"); },
  };
  const openPromise = new Promise<ProjectOpenResult>((resolve) => { openDeferred.resolve = resolve; });
  let openCalls = 0;
  const ready: ProjectTreeState[] = [];

  installWindow();
  mockIPC((command) => {
    if (command === "plugin:dialog|open") return "候选作品路径";
    if (command === "load_recent_works") return [];
    if (command === "open_project") { openCalls += 1; return openPromise; }
    throw new Error(`Unexpected IPC command: ${command}`);
  });

  const ui = projectFlowFixture((state) => ready.push(state));
  try {
    ui.dom.btnOpenProject.click();
    ui.dom.btnOpenProject.click();
    await flushUntil(() => openCalls === 1);
    assert.equal(openCalls, 1, "忙碌锁只允许一个打开流程");
    openDeferred.resolve(openResult("候选作品"));
    await flushUntil(() => ready.length === 1);
    assert.equal(ready[0]?.projectName, "候选作品");
    assert.deepEqual(ready[0]?.tree, TREE);
  } finally {
    ui.restore();
    clearMocks();
    restoreWindow();
  }
});

test("a new project operation is rejected while an open is in flight", async () => {
  const openDeferred: { resolve: (result: ProjectOpenResult) => void } = {
    resolve: () => { throw new Error("unused"); },
  };
  const openPromise = new Promise<ProjectOpenResult>((resolve) => { openDeferred.resolve = resolve; });
  const ready: ProjectTreeState[] = [];

  installWindow();
  mockIPC((command) => {
    if (command === "plugin:dialog|open") return "候选作品路径";
    if (command === "load_recent_works") return [];
    if (command === "open_project") return openPromise;
    if (command === "create_project") return "D:\\新作品";
    if (command === "open_content_tree") return TREE;
    throw new Error(`Unexpected IPC command: ${command}`);
  });

  const ui = projectFlowFixture((state) => ready.push(state));
  try {
    ui.dom.btnOpenProject.click();
    await flushUntil(() => true);
    await flushUntil(() => true);
    ui.dom.projectNameInput.value = "新作品";
    ui.dom.saveLocationInput.value = "D:\\新位置";
    ui.dom.btnCreateProject.click();
    await Promise.resolve();
    assert.equal(ready.length, 0);
    openDeferred.resolve(openResult("候选作品"));
    await flushUntil(() => ready.length === 1);
    assert.equal(ready[0]?.projectName, "候选作品");
  } finally {
    ui.restore();
    clearMocks();
    restoreWindow();
  }
});
