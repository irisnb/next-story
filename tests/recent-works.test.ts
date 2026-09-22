import assert from "node:assert/strict";
import test from "node:test";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import type { AppDom } from "../src/dom.ts";
import { renderRecentWorkEntries, setupProjectFlow } from "../src/new-project-form.ts";
import { selectDirectory, type RecentWorkEntry } from "../src/project-api.ts";
import type {
  ContentTree,
  ProjectMetadata,
  ProjectOpenResult,
  ProjectTreeState,
} from "../src/types.ts";

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

  // 渲染条目里的 SVG 图标用 setAttribute 设 class/aria-hidden/href；测试不读它，记录即可。
  setAttribute(name: string, value: string): void {
    (this.attributes ??= new Map<string, string>()).set(name, value);
  }
  attributes = new Map<string, string>();

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

function entry(name: string, path: string): RecentWorkEntry {
  return { name, path, last_opened_at: "2026-09-23T00:00:00Z" };
}

/** 等待可观察状态出现；async 链的微任务数量不固定，不能靠固定次数的硬等。 */
async function flushUntil(predicate: () => boolean, maxTicks = 60): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("flushUntil timed out");
}

interface FlowHooks {
  onProjectReady(projectState: ProjectTreeState): void;
  guardLeave(): Promise<boolean>;
}

function projectFlowFixture(hooks: FlowHooks): {
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
    // 最近作品条目的文档图标走 SVG 命名空间创建（与 index.html 精灵图配套）。
    createElementNS: (_ns: string, _tag: string) => new FakeElement(),
  } as unknown as Document;

  // 与 index.html 一致：空态文案初始带 hidden 类且文本已内联。
  const emptyState = element("recent-works-empty");
  emptyState.classList.add("hidden");
  emptyState.textContent = "还没有打开过的作品";

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
    onProjectReady: hooks.onProjectReady,
    guardLeave: hooks.guardLeave,
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

/** mockIPC 需要全局 `window`；node 测试环境默认没有，这里临时补上（与 editor.test.ts 同法）。 */
function installWindow(): void {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

function restoreWindow(): void {
  if (previousWindow) {
    Object.defineProperty(globalThis, "window", previousWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  previousWindow = undefined;
}

/** 从 FakeElement 容器取已渲染的最近作品条目按钮。 */
function renderedEntries(list: HTMLElement): FakeElement[] {
  return (list as unknown as FakeElement).children;
}

// ========== selectDirectory 的 defaultPath 透传（任务组 3⑤） ==========

test("selectDirectory forwards optional defaultPath to the folder dialog", async () => {
  installWindow();
  try {
    const optionBags: Array<Record<string, unknown>> = [];
    mockIPC((command, payload) => {
      if (command === "plugin:dialog|open") {
        optionBags.push((payload as { options: Record<string, unknown> }).options);
        return "D:\\选中的作品";
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const withPath = await selectDirectory("选择作品文件夹", "D:\\最近的作品");
    assert.equal(withPath, "D:\\选中的作品");
    assert.equal(optionBags[0]?.defaultPath, "D:\\最近的作品", "初始位置透传给对话框");
    assert.equal(optionBags[0]?.directory, true, "仍是文件夹选择对话框");

    const withoutPath = await selectDirectory("选择保存位置");
    assert.equal(withoutPath, "D:\\选中的作品");
    assert.equal(
      "defaultPath" in (optionBags[1] ?? {}),
      false,
      "不传初始位置时保持现状（无 defaultPath 字段）",
    );
  } finally {
    clearMocks();
    restoreWindow();
  }
});

// ========== 欢迎页最近作品列表渲染与空态（任务组 3④） ==========

test("welcome page renders recent works with name and path subtitle", async () => {
  installWindow();
  try {
    const entries = [entry("作品甲", "D:\\作品甲"), entry("作品乙", "D:\\作品乙")];
    mockIPC((command) => {
      if (command === "load_recent_works") return entries;
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: () => {},
      guardLeave: async () => true,
    });
    try {
      await flushUntil(() => renderedEntries(ui.dom.recentWorksList).length === 2);

      const items = renderedEntries(ui.dom.recentWorksList);
      assert.equal(items[0]?.className, "recent-work-item");
      assert.equal(items[0]?.children[1]?.textContent, "作品甲", "主文本是作品名（0 号位是装饰图标）");
      assert.equal(items[0]?.children[2]?.textContent, "D:\\作品甲", "副文本是路径");
      assert.equal(items[0]?.title, "D:\\作品甲");
      assert.equal(items[1]?.children[1]?.textContent, "作品乙");
      assert.equal(
        (ui.dom.recentWorksEmpty as unknown as FakeElement).classList.contains("hidden"),
        true,
        "列表非空时空态文案隐藏",
      );
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("welcome page renders exactly the entries the backend returned", async () => {
  installWindow();
  try {
    // 后端已做有效性检查：失效条目不会出现在返回里，前端原样渲染收到的条目。
    const entries = [entry("唯一有效作品", "D:\\唯一有效作品")];
    mockIPC((command) => {
      if (command === "load_recent_works") return entries;
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: () => {},
      guardLeave: async () => true,
    });
    try {
      await flushUntil(() => renderedEntries(ui.dom.recentWorksList).length === 1);
      assert.equal(renderedEntries(ui.dom.recentWorksList)[0]?.children[1]?.textContent, "唯一有效作品");
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("welcome page shows the empty hint when there are no recent works", async () => {
  installWindow();
  try {
    mockIPC((command) => {
      if (command === "load_recent_works") return [];
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: () => {},
      guardLeave: async () => true,
    });
    try {
      await flushUntil(() =>
        !(ui.dom.recentWorksEmpty as unknown as FakeElement).classList.contains("hidden"),
      );
      assert.equal(renderedEntries(ui.dom.recentWorksList).length, 0, "空列表不渲染条目");
      assert.equal(ui.dom.recentWorksEmpty.textContent, "还没有打开过的作品");
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("welcome page fails open to the empty hint when reading recent works errors", async () => {
  installWindow();
  try {
    let loadCalls = 0;
    mockIPC((command) => {
      if (command === "load_recent_works") {
        loadCalls += 1;
        throw new Error("存储读取失败");
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: () => {},
      guardLeave: async () => true,
    });
    try {
      // 读取命令失败：失败开放为空列表，无用户可见错误、不产生未处理拒绝。
      await flushUntil(() =>
        loadCalls === 1
        && !(ui.dom.recentWorksEmpty as unknown as FakeElement).classList.contains("hidden"),
      );
      assert.equal(renderedEntries(ui.dom.recentWorksList).length, 0);
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("renderRecentWorkEntries replaces previous entries on re-render", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => new FakeElement(),
    createElementNS: (_ns: string, _tag: string) => new FakeElement(),
  } as unknown as Document;
  try {
    const container = new FakeElement();
    const emptyState = new FakeElement();
    emptyState.classList.add("hidden");

    renderRecentWorkEntries(
      container as unknown as HTMLElement,
      emptyState as unknown as HTMLElement,
      [entry("旧作品", "D:\\旧作品")],
      () => {},
    );
    assert.equal(container.children.length, 1);

    // 刷新渲染（如返回欢迎页）：旧条目被整体替换，不叠加。
    renderRecentWorkEntries(
      container as unknown as HTMLElement,
      emptyState as unknown as HTMLElement,
      [entry("作品甲", "D:\\作品甲"), entry("作品乙", "D:\\作品乙")],
      () => {},
    );
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0]?.children[1]?.textContent, "作品甲");
    assert.equal(emptyState.classList.contains("hidden"), true, "非空列表空态隐藏");
  } finally {
    globalThis.document = previousDocument;
  }
});

// ========== 点击条目走既有打开流程（任务组 3④） ==========

test("clicking a recent work entry opens it through the shared authorized open flow", async () => {
  installWindow();
  try {
    const entries = [entry("作品甲", "D:\\作品甲"), entry("作品乙", "D:\\作品乙")];
    const openPayloads: Array<Record<string, unknown>> = [];
    const dialogCalls: string[] = [];
    let authorizeCalls = 0;
    const ready: ProjectTreeState[] = [];
    mockIPC((command, payload) => {
      if (command === "load_recent_works") return entries;
      if (command === "plugin:dialog|open") {
        dialogCalls.push(command);
        return null;
      }
      if (command === "open_project") {
        openPayloads.push(payload as Record<string, unknown>);
        return openResult("作品甲（元信息名）");
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: (state) => ready.push(state),
      guardLeave: async () => {
        authorizeCalls += 1;
        return true;
      },
    });
    try {
      await flushUntil(() => renderedEntries(ui.dom.recentWorksList).length === 2);

      renderedEntries(ui.dom.recentWorksList)[0]?.click();
      await flushUntil(() => ready.length === 1);

      assert.deepEqual(dialogCalls, [], "点击条目不弹文件夹选择对话框");
      assert.equal(openPayloads.length, 1);
      assert.equal(openPayloads[0]?.projectPath, "D:\\作品甲", "以条目路径直接读取作品");
      assert.equal(authorizeCalls, 1, "离开当前作品前仍走授权确认（guardLeave）");
      assert.equal(ready[0]?.projectName, "作品甲（元信息名）", "作品名来自读取到的元信息");
      assert.deepEqual(ready[0]?.tree, TREE);
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("clicking a recent work entry keeps the current work when authorization is denied", async () => {
  installWindow();
  try {
    const entries = [entry("作品甲", "D:\\作品甲")];
    const ready: ProjectTreeState[] = [];
    mockIPC((command) => {
      if (command === "load_recent_works") return entries;
      if (command === "open_project") return openResult("作品甲");
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: (state) => ready.push(state),
      guardLeave: async () => false,
    });
    try {
      await flushUntil(() => renderedEntries(ui.dom.recentWorksList).length === 1);

      renderedEntries(ui.dom.recentWorksList)[0]?.click();
      await flushUntil(() => true);
      await flushUntil(() => true);

      assert.equal(ready.length, 0, "授权取消则不替换当前作品");
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

// ========== 「打开作品」对话框初始位置（任务组 3⑤） ==========

test("opening via the dialog starts at the most recent work path", async () => {
  installWindow();
  try {
    const entries = [entry("作品甲", "D:\\作品甲"), entry("作品乙", "D:\\作品乙")];
    const optionBags: Array<Record<string, unknown>> = [];
    const ready: ProjectTreeState[] = [];
    mockIPC((command, payload) => {
      if (command === "load_recent_works") return entries;
      if (command === "plugin:dialog|open") {
        optionBags.push((payload as { options: Record<string, unknown> }).options);
        return "D:\\手选的作品";
      }
      if (command === "open_project") return openResult("手选的作品");
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: (state) => ready.push(state),
      guardLeave: async () => true,
    });
    try {
      await flushUntil(() => renderedEntries(ui.dom.recentWorksList).length === 2);

      (ui.dom.btnOpenProject as unknown as FakeElement).click();
      await flushUntil(() => ready.length === 1);

      assert.equal(optionBags.length, 1);
      assert.equal(optionBags[0]?.defaultPath, "D:\\作品甲", "以最近一条最近作品为初始位置");
      assert.equal(ready[0]?.projectName, "手选的作品");
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});

test("opening via the dialog passes no default path when the recent list is empty", async () => {
  installWindow();
  try {
    const optionBags: Array<Record<string, unknown>> = [];
    const ready: ProjectTreeState[] = [];
    mockIPC((command, payload) => {
      if (command === "load_recent_works") return [];
      if (command === "plugin:dialog|open") {
        optionBags.push((payload as { options: Record<string, unknown> }).options);
        return "D:\\手选的作品";
      }
      if (command === "open_project") return openResult("手选的作品");
      throw new Error(`Unexpected IPC command: ${command}`);
    });

    const ui = projectFlowFixture({
      onProjectReady: (state) => ready.push(state),
      guardLeave: async () => true,
    });
    try {
      await flushUntil(() =>
        !(ui.dom.recentWorksEmpty as unknown as FakeElement).classList.contains("hidden"),
      );

      (ui.dom.btnOpenProject as unknown as FakeElement).click();
      await flushUntil(() => ready.length === 1);

      assert.equal(optionBags.length, 1);
      assert.equal(
        "defaultPath" in (optionBags[0] ?? {}),
        false,
        "列表为空时不传初始位置，保持现状",
      );
    } finally {
      ui.restore();
      clearMocks();
    }
  } finally {
    restoreWindow();
  }
});
