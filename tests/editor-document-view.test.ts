import assert from "node:assert/strict";
import test from "node:test";

import { createEditorDocumentView } from "../src/editor-document-view.ts";
import type { ContentTree } from "../src/types.ts";

class FakeClassList {
  private values = new Set<string>();
  toggle(name: string, force?: boolean): void {
    if (force === true || (force === undefined && !this.values.has(name))) this.values.add(name);
    else if (force === false || this.values.has(name)) this.values.delete(name);
  }
  add(name: string): void { this.values.add(name); }
  contains(name: string): boolean { return this.values.has(name); }
}

class FakeElement {
  classList = new FakeClassList();
  children: FakeElement[] = [];
  textContent = "";
  type = "";
  className = "";
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  replaceChildren(): void { this.children = []; }
  appendChild(child: FakeElement): void { this.children.push(child); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
}

test("document view renders empty state and toggles the list", () => {
  const tree: ContentTree = { root_children: [], nodes: {}, recycle_bin: [] };
  const currentDocumentName = new FakeElement();
  const documentList = new FakeElement();
  const writingEmptyState = new FakeElement();
  const editorTextarea = new FakeElement();
  const currentDocToggle = new FakeElement();
  documentList.classList.add("hidden");
  const view = createEditorDocumentView({
    dom: {
      currentDocumentName: currentDocumentName as unknown as HTMLElement,
      documentList: documentList as unknown as HTMLElement,
      writingEmptyState: writingEmptyState as unknown as HTMLElement,
      editorTextarea: editorTextarea as unknown as HTMLElement,
      currentDocToggle: currentDocToggle as unknown as HTMLButtonElement,
    },
    getTree: () => tree, getCurrentDocumentId: () => null, onSwitchDocument: () => {}, emptyStateText: "空态",
  });
  view.render();
  assert.equal(writingEmptyState.textContent, "空态");
  assert.equal(editorTextarea.classList.contains("hidden"), true);
  view.toggleList();
  assert.equal(documentList.classList.contains("hidden"), false);
  assert.equal(currentDocToggle.attributes.get("aria-expanded"), "true");
});

test("document view renders documents and forwards selection", () => {
  const tree: ContentTree = {
    root_children: ["a", "b"],
    nodes: {
      a: { id: "a", name: "A", kind: "Document", children: [] },
      b: { id: "b", name: "B", kind: "Document", children: [] },
    },
    recycle_bin: [],
  };
  const documentList = new FakeElement();
  documentList.classList.add("hidden");
  const selected: string[] = [];
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document: unknown }).document = {
    createElement: (() => new FakeElement() as unknown as HTMLElement) as Document["createElement"],
  } as unknown as Document;
  const view = createEditorDocumentView({
    dom: {
      currentDocumentName: new FakeElement() as unknown as HTMLElement,
      documentList: documentList as unknown as HTMLElement,
      writingEmptyState: new FakeElement() as unknown as HTMLElement,
      editorTextarea: new FakeElement() as unknown as HTMLElement,
      currentDocToggle: new FakeElement() as unknown as HTMLButtonElement,
    },
    getTree: () => tree, getCurrentDocumentId: () => "a", onSwitchDocument: (id) => selected.push(id), emptyStateText: "空态",
  });
  view.render();
  assert.equal(documentList.children.length, 2);
  assert.equal(documentList.children[0].classList.contains("active"), true);
  documentList.children[1].listeners.get("click")?.();
  assert.deepEqual(selected, ["b"]);
  (globalThis as typeof globalThis & { document: unknown }).document = previousDocument;
});
