import assert from "node:assert/strict";
import test from "node:test";

import { setupFileManagement, type FileManagementServices } from "../src/file-management.ts";
import type { AppDom } from "../src/dom.ts";
import type { ContentTree, ProjectTreeState } from "../src/types.ts";

type Listener = () => void;

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: readonly string[] = []) {
    for (const value of initial) this.values.add(value);
  }

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, Listener[]>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  textContent = "";
  value = "";
  type = "";
  selected = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(_name: string, _value: string): void {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }

  querySelector<T>(_selector: string): T | null {
    return null;
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

const TREE: ContentTree = {
  root_children: ["doc-1", "folder-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "未命名文档", kind: "Document", children: [] },
    "folder-1": { id: "folder-1", name: "角色", kind: "Folder", children: ["doc-2"] },
    "doc-2": { id: "doc-2", name: "小芳", kind: "Document", children: [] },
  },
  recycle_bin: [],
};

const RECYCLE_TREE: ContentTree = {
  root_children: ["doc-1"],
  nodes: {
    "doc-1": { id: "doc-1", name: "未命名文档", kind: "Document", children: [] },
  },
  recycle_bin: [
    {
      root_id: "folder-1",
      original_parent: null,
      original_index: 1,
      nodes: {
        "folder-1": { id: "folder-1", name: "角色", kind: "Folder", children: ["doc-2"] },
        "doc-2": { id: "doc-2", name: "小芳", kind: "Document", children: [] },
      },
    },
  ],
};

function findButton(root: FakeElement, label: string): FakeElement | null {
  if (root.type === "button" && root.textContent === label) return root;
  for (const child of root.children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

function makeHarness(tree: ContentTree, initial: Partial<FileManagementServices> = {}): {
  controller: ReturnType<typeof setupFileManagement>;
  elements: Map<string, FakeElement>;
  calls: string[];
  treeChanges: ContentTree[];
  restore(): void;
} {
  const ids = [
    "fm-new-document", "fm-new-folder", "fm-status", "fm-file-tree",
    "fm-open-recycle-bin", "fm-recycle-bin", "fm-back-from-recycle", "fm-recycle-list",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
  } as unknown as Document;

  const calls: string[] = [];
  const treeChanges: ContentTree[] = [];
  let currentTree = tree;

  const dom = {
    fmNewDocument: elements.get("fm-new-document") as unknown as HTMLButtonElement,
    fmNewFolder: elements.get("fm-new-folder") as unknown as HTMLButtonElement,
    fmStatus: elements.get("fm-status") as unknown as HTMLElement,
    fmFileTree: elements.get("fm-file-tree") as unknown as HTMLElement,
    fmOpenRecycleBin: elements.get("fm-open-recycle-bin") as unknown as HTMLButtonElement,
    fmRecycleBin: elements.get("fm-recycle-bin") as unknown as HTMLElement,
    fmBackFromRecycle: elements.get("fm-back-from-recycle") as unknown as HTMLButtonElement,
    fmRecycleList: elements.get("fm-recycle-list") as unknown as HTMLElement,
  } as unknown as AppDom;

  const services: FileManagementServices = {
    openContentTree: async () => {
      calls.push("open_content_tree");
      return currentTree;
    },
    createDocument: async () => {
      calls.push("create_document");
      return "new-doc";
    },
    createFolder: async () => {
      calls.push("create_folder");
      return "new-folder";
    },
    renameNode: async () => { calls.push("rename_node"); },
    moveNode: async () => { calls.push("move_node"); },
    deleteNode: async () => { calls.push("delete_node"); },
    restoreNode: async () => { calls.push("restore_node"); },
    ...initial,
  };

  const controller = setupFileManagement(dom, {
    onTreeChanged: (next) => { treeChanges.push(next); },
    services,
  });

  const state: ProjectTreeState = {
    projectPath: "D:\\作品",
    projectName: "作品",
    tree,
  };
  controller.showProject(state);

  return {
    controller,
    elements,
    calls,
    treeChanges,
    restore: () => { globalThis.document = previousDocument; },
  };
}

function collectText(root: FakeElement): string[] {
  const result: string[] = [];
  if (root.textContent !== "") result.push(root.textContent);
  for (const child of root.children) result.push(...collectText(child));
  return result;
}

test("renders the file tree with folders and documents in root order", () => {
  const h = makeHarness(TREE);
  try {
    const fileTree = h.elements.get("fm-file-tree")!;
    const text = collectText(fileTree);
    assert.ok(text.includes("未命名文档"));
    assert.ok(text.includes("角色"));
    // 折叠的文件夹默认不展示其子文档。
    assert.equal(text.includes("小芳"), false);
  } finally {
    h.restore();
  }
});

test("new document at root invokes createDocument and refreshes the tree", async () => {
  const h = makeHarness(TREE);
  try {
    h.elements.get("fm-new-document")!.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(h.calls.includes("create_document"));
    assert.ok(h.calls.includes("open_content_tree"));
  } finally {
    h.restore();
  }
});

test("deleting a node invokes deleteNode", async () => {
  const h = makeHarness(TREE);
  try {
    const deleteButton = findButton(h.elements.get("fm-file-tree")!, "删除");
    assert.ok(deleteButton, "每个节点都应提供删除操作");
    deleteButton.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(h.calls.includes("delete_node"));
  } finally {
    h.restore();
  }
});

test("recycle bin lists deleted subtrees and restore invokes restoreNode", async () => {
  const h = makeHarness(RECYCLE_TREE);
  try {
    h.elements.get("fm-open-recycle-bin")!.click();
    const recycleList = h.elements.get("fm-recycle-list")!;
    const text = collectText(recycleList);
    assert.ok(text.includes("角色"));

    const restoreButton = findButton(recycleList, "恢复");
    assert.ok(restoreButton);
    restoreButton.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(h.calls.includes("restore_node"));
  } finally {
    h.restore();
  }
});

test("rename via prompt invokes renameNode with the entered name", async () => {
  const previousPrompt = globalThis.window?.prompt;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ...(globalThis.window ?? {}), prompt: () => "新名字" },
  });
  try {
    const h = makeHarness(TREE);
    const renameButton = findButton(h.elements.get("fm-file-tree")!, "重命名");
    assert.ok(renameButton);
    renameButton.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(h.calls.includes("rename_node"));
    h.restore();
  } finally {
    if (previousPrompt !== undefined) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousPrompt });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
