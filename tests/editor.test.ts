import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import type { AiFeatureController } from "../src/ai-feature.ts";
import type { AppDom } from "../src/dom.ts";
import { setupEditor } from "../src/editor.ts";
import type { FormatCommand } from "../src/format-commands.ts";
import type { LeaveDialogController } from "../src/leave-dialog.ts";
import type {
  RichTextEditorCoordinates,
  RichTextEditorSelection,
} from "../src/rich-text-editor.ts";
import type { ContentTree, ContentTreeNode, ProjectTreeState } from "../src/types.ts";
import type { MemoryStorage } from "../src/document-memory.ts";

type Listener = (event?: unknown) => void;

function paragraphDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function notebookJson(text: string): string {
  return JSON.stringify({
    format: "next-story-tiptap",
    version: 1,
    document: paragraphDoc(text),
  });
}

/** 当前格式版本 2 的本子 JSON（保存后的期望形态）。 */
function notebookJsonCurrent(text: string): string {
  return JSON.stringify({
    format: "next-story-tiptap",
    version: 2,
    document: paragraphDoc(text),
  });
}

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, Listener[]>();
  private readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  textContent = "";
  className = "";
  value = "";
  disabled = false;
  inert = false;
  type = "";

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

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

  contains(target: unknown): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }

  focus(): void {}
  select(): void {}
}

class FakeRichTextEditor {
  private readonly listeners = new Set<(document: JSONContent) => void>();
  private document: JSONContent;
  readonly element: HTMLElement;
  readonly capturedListeners: Array<(document: JSONContent) => void> = [];
  destroyed = false;

  constructor(element: HTMLElement, initialDocument: JSONContent) {
    this.element = element;
    this.document = initialDocument;
  }

  getDocument(): JSONContent {
    return this.document;
  }

  onEdit(listener: (document: JSONContent) => void): () => void {
    this.listeners.add(listener);
    this.capturedListeners.push(listener);
    return () => { this.listeners.delete(listener); };
  }

  onSelectionChange(_listener: () => void): () => void {
    return () => {};
  }

  focus(): void {}

  getSelection(): RichTextEditorSelection {
    return { from: 1, to: 1, head: 1 };
  }

  coordinatesAt(_position: number): RichTextEditorCoordinates {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }

  runCommand(_command: FormatCommand): boolean {
    return false;
  }

  setFind(_query: string, _caseSensitive: boolean): number {
    return 0;
  }

  activateMatch(_index: number): void {}

  replaceCurrent(_replacement: string): boolean {
    return false;
  }

  replaceAll(_replacement: string): number {
    return 0;
  }

  async pastePlainText(): Promise<boolean> {
    return false;
  }

  async copySelection(): Promise<boolean> {
    return false;
  }

  async cutSelection(): Promise<void> {}

  canUndo(): boolean {
    return false;
  }

  canRedo(): boolean {
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  edit(document: JSONContent): void {
    this.document = document;
    for (const listener of this.listeners) listener(document);
  }
}

function docNode(id: string, name: string): ContentTreeNode {
  return { id, name, kind: "Document", children: [] };
}

function treeFrom(docs: ContentTreeNode[], folders: ContentTreeNode[] = []): ContentTree {
  const nodes: Record<string, ContentTreeNode> = {};
  for (const node of [...folders, ...docs]) nodes[node.id] = node;
  return {
    root_children: [...folders, ...docs].map((node) => node.id),
    nodes,
    recycle_bin: [],
  };
}

function projectState(
  projectPath: string,
  tree: ContentTree,
): ProjectTreeState {
  return { projectPath, projectName: projectPath, tree };
}

const EDITOR_DOM_IDS = [
  "welcome-page", "new-project-page", "editor-page", "current-project-name",
  "save-status", "btn-save", "btn-back-welcome", "tab-writing", "tab-files",
  "tab-settings", "module-writing", "module-files", "module-settings",
  "editor-textarea", "current-doc-toggle", "current-document-name",
  "document-list", "writing-empty-state", "paragraph-style", "btn-bold",
  "btn-italic", "btn-bullet-list", "btn-ordered-list", "btn-toolbar-underline",
  "btn-toolbar-strike", "btn-undo", "btn-redo", "btn-find", "btn-margin",
  "btn-format-drawer", "format-toolbar", "format-drawer", "btn-format-drawer-close",
  "btn-underline", "btn-strike", "btn-toggle-character-section",
  "btn-toggle-paragraph-section", "select-font-family", "select-font-size",
  "input-text-color", "btn-clear-text-color", "input-highlight",
  "btn-clear-highlight", "btn-clear-character-format", "btn-align-left",
  "btn-align-center", "btn-align-right", "btn-align-justify",
  "select-line-height", "select-spacing-before", "select-spacing-after",
  "select-text-indent", "select-indent-left", "select-indent-right",
  "btn-clear-paragraph-format", "find-bar", "find-input", "find-case-sensitive",
  "btn-find-prev", "btn-find-next", "find-count", "replace-input", "btn-replace",
  "btn-replace-all", "btn-find-close", "context-menu", "ctx-cut", "ctx-copy",
  "ctx-paste", "ctx-paste-plain", "ctx-link-create", "ctx-link-group",
  "ctx-link-open", "ctx-link-edit", "ctx-link-remove", "link-popover", "link-open",
  "link-edit", "link-remove", "leave-dialog", "btn-save-and-leave",
  "btn-discard-and-leave", "btn-cancel-leave",
];

function fakeDom(): { dom: AppDom; elements: Map<string, FakeElement>; restore(): void } {
  const elements = new Map<string, FakeElement>();
  for (const id of EDITOR_DOM_IDS) elements.set(id, new FakeElement());
  const previousDocument = globalThis.document;
  globalThis.document = {
    addEventListener: () => {},
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => new FakeElement(),
  } as unknown as Document;

  return {
    dom: {
      welcomePage: elements.get("welcome-page") as unknown as HTMLElement,
      newProjectPage: elements.get("new-project-page") as unknown as HTMLElement,
      editorPage: elements.get("editor-page") as unknown as HTMLElement,
      currentProjectName: elements.get("current-project-name") as unknown as HTMLElement,
      saveStatus: elements.get("save-status") as unknown as HTMLElement,
      btnSave: elements.get("btn-save") as unknown as HTMLButtonElement,
      btnBackWelcome: elements.get("btn-back-welcome") as unknown as HTMLButtonElement,
      editorTextarea: elements.get("editor-textarea") as unknown as HTMLElement,
      currentDocToggle: elements.get("current-doc-toggle") as unknown as HTMLButtonElement,
      currentDocumentName: elements.get("current-document-name") as unknown as HTMLElement,
      documentList: elements.get("document-list") as unknown as HTMLElement,
      writingEmptyState: elements.get("writing-empty-state") as unknown as HTMLElement,
      paragraphStyle: elements.get("paragraph-style") as unknown as HTMLSelectElement,
      btnBold: elements.get("btn-bold") as unknown as HTMLButtonElement,
      btnItalic: elements.get("btn-italic") as unknown as HTMLButtonElement,
      btnBulletList: elements.get("btn-bullet-list") as unknown as HTMLButtonElement,
      btnOrderedList: elements.get("btn-ordered-list") as unknown as HTMLButtonElement,
      btnToolbarUnderline: elements.get("btn-toolbar-underline") as unknown as HTMLButtonElement,
      btnToolbarStrike: elements.get("btn-toolbar-strike") as unknown as HTMLButtonElement,
      btnUndo: elements.get("btn-undo") as unknown as HTMLButtonElement,
      btnRedo: elements.get("btn-redo") as unknown as HTMLButtonElement,
      btnFind: elements.get("btn-find") as unknown as HTMLButtonElement,
      btnMargin: elements.get("btn-margin") as unknown as HTMLButtonElement,
      btnFormatDrawer: elements.get("btn-format-drawer") as unknown as HTMLButtonElement,
      formatToolbar: elements.get("format-toolbar") as unknown as HTMLElement,
      formatDrawer: elements.get("format-drawer") as unknown as HTMLElement,
      btnFormatDrawerClose: elements.get("btn-format-drawer-close") as unknown as HTMLButtonElement,
      btnUnderline: elements.get("btn-underline") as unknown as HTMLButtonElement,
      btnStrike: elements.get("btn-strike") as unknown as HTMLButtonElement,
      btnToggleCharacterSection: elements.get("btn-toggle-character-section") as unknown as HTMLButtonElement,
      btnToggleParagraphSection: elements.get("btn-toggle-paragraph-section") as unknown as HTMLButtonElement,
      selectFontFamily: elements.get("select-font-family") as unknown as HTMLSelectElement,
      selectFontSize: elements.get("select-font-size") as unknown as HTMLSelectElement,
      inputTextColor: elements.get("input-text-color") as unknown as HTMLInputElement,
      btnClearTextColor: elements.get("btn-clear-text-color") as unknown as HTMLButtonElement,
      inputHighlight: elements.get("input-highlight") as unknown as HTMLInputElement,
      btnClearHighlight: elements.get("btn-clear-highlight") as unknown as HTMLButtonElement,
      btnClearCharacterFormat: elements.get("btn-clear-character-format") as unknown as HTMLButtonElement,
      btnAlignLeft: elements.get("btn-align-left") as unknown as HTMLButtonElement,
      btnAlignCenter: elements.get("btn-align-center") as unknown as HTMLButtonElement,
      btnAlignRight: elements.get("btn-align-right") as unknown as HTMLButtonElement,
      btnAlignJustify: elements.get("btn-align-justify") as unknown as HTMLButtonElement,
      selectLineHeight: elements.get("select-line-height") as unknown as HTMLSelectElement,
      selectSpacingBefore: elements.get("select-spacing-before") as unknown as HTMLSelectElement,
      selectSpacingAfter: elements.get("select-spacing-after") as unknown as HTMLSelectElement,
      selectTextIndent: elements.get("select-text-indent") as unknown as HTMLSelectElement,
      selectIndentLeft: elements.get("select-indent-left") as unknown as HTMLSelectElement,
      selectIndentRight: elements.get("select-indent-right") as unknown as HTMLSelectElement,
      btnClearParagraphFormat: elements.get("btn-clear-paragraph-format") as unknown as HTMLButtonElement,
      findBar: elements.get("find-bar") as unknown as HTMLElement,
      findInput: elements.get("find-input") as unknown as HTMLInputElement,
      findCaseSensitive: elements.get("find-case-sensitive") as unknown as HTMLInputElement,
      btnFindPrev: elements.get("btn-find-prev") as unknown as HTMLButtonElement,
      btnFindNext: elements.get("btn-find-next") as unknown as HTMLButtonElement,
      findCount: elements.get("find-count") as unknown as HTMLElement,
      replaceInput: elements.get("replace-input") as unknown as HTMLInputElement,
      btnReplace: elements.get("btn-replace") as unknown as HTMLButtonElement,
      btnReplaceAll: elements.get("btn-replace-all") as unknown as HTMLButtonElement,
      btnFindClose: elements.get("btn-find-close") as unknown as HTMLButtonElement,
      contextMenu: elements.get("context-menu") as unknown as HTMLElement,
      btnCtxCut: elements.get("ctx-cut") as unknown as HTMLButtonElement,
      btnCtxCopy: elements.get("ctx-copy") as unknown as HTMLButtonElement,
      btnCtxPaste: elements.get("ctx-paste") as unknown as HTMLButtonElement,
      btnCtxPastePlain: elements.get("ctx-paste-plain") as unknown as HTMLButtonElement,
      btnCtxLinkCreate: elements.get("ctx-link-create") as unknown as HTMLButtonElement,
      ctxLinkGroup: elements.get("ctx-link-group") as unknown as HTMLElement,
      btnCtxLinkOpen: elements.get("ctx-link-open") as unknown as HTMLButtonElement,
      btnCtxLinkEdit: elements.get("ctx-link-edit") as unknown as HTMLButtonElement,
      btnCtxLinkRemove: elements.get("ctx-link-remove") as unknown as HTMLButtonElement,
      linkPopover: elements.get("link-popover") as unknown as HTMLElement,
      btnLinkOpen: elements.get("link-open") as unknown as HTMLButtonElement,
      btnLinkEdit: elements.get("link-edit") as unknown as HTMLButtonElement,
      btnLinkRemove: elements.get("link-remove") as unknown as HTMLButtonElement,
      leaveDialog: elements.get("leave-dialog") as unknown as HTMLDialogElement,
      btnSaveAndLeave: elements.get("btn-save-and-leave") as unknown as HTMLButtonElement,
      btnDiscardAndLeave: elements.get("btn-discard-and-leave") as unknown as HTMLButtonElement,
      btnCancelLeave: elements.get("btn-cancel-leave") as unknown as HTMLButtonElement,
    } as unknown as AppDom,
    elements,
    restore: () => { globalThis.document = previousDocument; },
  };
}

function memoryFixture(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

/** 等待可观察状态出现；切换文档的异步链跨越多个微任务，不能靠固定次数的硬等。 */
async function flushUntil(predicate: () => boolean, maxTicks = 60): Promise<void> {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("flushUntil timed out");
}

interface Fixture {
  ui: { dom: AppDom; elements: Map<string, FakeElement>; restore(): void };
  editor: ReturnType<typeof setupEditor>;
  editors: FakeRichTextEditor[];
  contents: Map<string, string>;
  saved: Map<string, string>;
  memory: MemoryStorage;
}

function editorFixture(initialContents: Record<string, string> = {}): Fixture {
  const ui = fakeDom();
  const editors: FakeRichTextEditor[] = [];
  const contents = new Map<string, string>(Object.entries(initialContents));
  const saved = new Map<string, string>();
  const memory = memoryFixture();
  const leaveDialog: LeaveDialogController = { choose: async () => "cancel" };
  const editor = setupEditor(ui.dom, leaveDialog, {
    createEditor: (element: HTMLElement, initialDocument: JSONContent) => {
      const created = new FakeRichTextEditor(element, initialDocument);
      editors.push(created);
      return created;
    },
    readDocument: async (_projectPath, documentId) => {
      const content = contents.get(documentId);
      if (content === undefined) throw new Error(`missing content: ${documentId}`);
      return content;
    },
    saveDocument: async (_projectPath, documentId, content) => {
      saved.set(documentId, content);
      contents.set(documentId, content);
    },
    memoryStorage: memory,
  });
  return { ui, editor, editors, contents, saved, memory };
}

test("showProject begins the AI project and unload ends it", async () => {
  const fixture = editorFixture({ "doc-1": notebookJson("未命名文档") });
  try {
    let begins = 0;
    let ends = 0;
    const ai: AiFeatureController = {
      beginProject: () => { begins += 1; },
      endProject: () => { ends += 1; },
      resetSelectionEntry: () => {},
      submitFollowUp: () => Promise.resolve(false),
      retryFollowUp: () => Promise.resolve(false),
      editFollowUp: () => Promise.resolve(false),
    };
    fixture.editor.attachAi(ai);

    const tree = treeFrom([docNode("doc-1", "未命名文档")]);
    await fixture.editor.showProject(projectState("作品一", tree));
    assert.equal(begins, 1);
    assert.equal(ends, 0);

    fixture.editor.unload();
    assert.equal(ends, 1);
  } finally {
    fixture.ui.restore();
  }
});

test("creates a single editor for the current document without dirtying initialization", async () => {
  const fixture = editorFixture({
    "doc-1": notebookJson("初稿"),
  });
  try {
    const tree = treeFrom([docNode("doc-1", "未命名文档")]);
    await fixture.editor.showProject(projectState("作品一", tree));

    assert.equal(fixture.editors.length, 1);
    assert.equal(fixture.editors[0]?.element, fixture.ui.dom.editorTextarea);
    assert.deepEqual(fixture.editors[0]?.getDocument(), paragraphDoc("初稿"));
    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-1");
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("detects a format-only change as unsaved and a full revert clears it", async () => {
  const fixture = editorFixture({ "doc-1": notebookJson("正文") });
  try {
    const tree = treeFrom([docNode("doc-1", "未命名文档")]);
    await fixture.editor.showProject(projectState("作品", tree));

    const boldDoc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }] },
      ],
    };
    fixture.editors[0]?.edit(boldDoc);
    assert.equal(fixture.editor.hasUnsavedChanges(), true);

    fixture.editors[0]?.edit(paragraphDoc("正文"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("saves exact edits to the current document", async () => {
  const fixture = editorFixture({ "doc-1": notebookJson("旧稿") });
  try {
    const tree = treeFrom([docNode("doc-1", "未命名文档")]);
    await fixture.editor.showProject(projectState("作品", tree));

    fixture.editors[0]?.edit(paragraphDoc("新稿"));
    assert.equal(await fixture.editor.save(), true);
    assert.equal(fixture.saved.get("doc-1"), notebookJsonCurrent("新稿"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("replacing a project destroys the old editor and ignores its late edits", async () => {
  const fixture = editorFixture({
    "doc-a": notebookJson("旧稿"),
    "doc-b": notebookJson("新稿"),
  });
  try {
    await fixture.editor.showProject(projectState("作品一", treeFrom([docNode("doc-a", "旧文档")])));
    const oldEditor = fixture.editors[0];
    const lateEdit = oldEditor?.capturedListeners[0];

    await fixture.editor.showProject(projectState("作品二", treeFrom([docNode("doc-b", "新文档")])));

    assert.equal(oldEditor?.destroyed, true);
    assert.equal(fixture.editors.length, 2);
    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-b");
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("新稿"));

    lateEdit?.(paragraphDoc("迟到的旧稿"));
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("新稿"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("unloading destroys the editor and ignores late edits", async () => {
  const fixture = editorFixture({ "doc-1": notebookJson("稿") });
  try {
    await fixture.editor.showProject(projectState("作品一", treeFrom([docNode("doc-1", "文档")])));
    const editor = fixture.editors[0];
    const lateEdit = editor?.capturedListeners[0];

    fixture.editor.unload();
    assert.equal(editor?.destroyed, true);
    assert.equal(fixture.editor.hasProject(), false);

    lateEdit?.(paragraphDoc("迟到"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("switching documents silently saves the current document then loads the target", async () => {
  const fixture = editorFixture({
    "doc-1": notebookJson("第一篇"),
    "doc-2": notebookJson("第二篇"),
  });
  try {
    const tree = treeFrom([docNode("doc-1", "第一篇"), docNode("doc-2", "第二篇")]);
    await fixture.editor.showProject(projectState("作品", tree));

    fixture.editors[0]?.edit(paragraphDoc("第一篇改"));

    // 通过扁平列表点击切换到 doc-2。
    const listItem = fixture.ui.elements.get("document-list")!.children[1];
    assert.ok(listItem);
    listItem.click();
    await flushUntil(() => fixture.editor.getCurrentDocumentId() === "doc-2");

    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-2");
    assert.equal(fixture.saved.get("doc-1"), notebookJsonCurrent("第一篇改"));
    assert.deepEqual(fixture.editors[1]?.getDocument(), paragraphDoc("第二篇"));
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
  } finally {
    fixture.ui.restore();
  }
});

test("reopening a project returns to the remembered document", async () => {
  const fixture = editorFixture({
    "doc-1": notebookJson("第一篇"),
    "doc-2": notebookJson("第二篇"),
  });
  try {
    const tree = treeFrom([docNode("doc-1", "第一篇"), docNode("doc-2", "第二篇")]);
    await fixture.editor.showProject(projectState("作品", tree));
    // 切到第二篇，记忆应写入 localStorage。
    fixture.ui.elements.get("document-list")!.children[1]!.click();
    await flushUntil(() => fixture.editor.getCurrentDocumentId() === "doc-2");
    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-2");

    // 卸载后重新打开：应回到第二篇。
    fixture.editor.unload();
    await fixture.editor.showProject(projectState("作品", tree));
    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-2");
  } finally {
    fixture.ui.restore();
  }
});

test("falls back to the first document when the remembered document was deleted", async () => {
  const fixture = editorFixture({
    "doc-1": notebookJson("第一篇"),
    "doc-2": notebookJson("第二篇"),
  });
  try {
    const tree = treeFrom([docNode("doc-1", "第一篇"), docNode("doc-2", "第二篇")]);
    await fixture.editor.showProject(projectState("作品", tree));
    fixture.ui.elements.get("document-list")!.children[1]!.click();
    await flushUntil(() => fixture.editor.getCurrentDocumentId() === "doc-2");
    fixture.editor.unload();

    // 记忆指向 doc-2，但 doc-2 已被删除（不在树中）。
    const reduced = treeFrom([docNode("doc-1", "第一篇")]);
    await fixture.editor.showProject(projectState("作品", reduced));
    assert.equal(fixture.editor.getCurrentDocumentId(), "doc-1");
  } finally {
    fixture.ui.restore();
  }
});

test("shows the empty state when the project has no documents", async () => {
  const fixture = editorFixture();
  try {
    await fixture.editor.showProject(projectState("空作品", treeFrom([])));
    assert.equal(fixture.editor.getCurrentDocumentId(), null);
    assert.equal(fixture.editor.hasUnsavedChanges(), false);
    assert.equal(fixture.ui.elements.get("writing-empty-state")!.classList.contains("hidden"), false);
    assert.equal(fixture.ui.elements.get("editor-textarea")!.classList.contains("hidden"), true);
  } finally {
    fixture.ui.restore();
  }
});
