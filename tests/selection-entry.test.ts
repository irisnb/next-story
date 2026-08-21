import assert from "node:assert/strict";
import test from "node:test";

import {
  decideSelectionEntryActions,
  decideSummonVisibility,
  decideTriggerPlacement,
  isSameSummonedSelection,
  renderSelectionEntryActions,
  setupSelectionEntry,
  SELECTION_ENTRY_GAP_PX,
  SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
  SELECTION_ENTRY_TRIGGER_WIDTH_PX,
  type SelectionEntryEditor,
} from "../src/selection-entry.ts";
import type { AppDom } from "../src/dom.ts";
import type { JSONContent } from "@tiptap/core";
import type {
  RichTextEditorCoordinates,
  RichTextEditorSelection,
} from "../src/rich-text-editor.ts";
import type { SelectionSnapshot } from "../src/types.ts";

type Listener = (event: FakeEvent) => void;

type RegisteredListener = Readonly<{
  listener: Listener;
  capture: boolean;
}>;

class FakeEvent {
  defaultPrevented = false;
  readonly relatedTarget: FakeElement | null;

  constructor(options: { relatedTarget?: FakeElement | null } = {}) {
    this.relatedTarget = options.relatedTarget ?? null;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: readonly string[] = []) {
    for (const value of initial) this.values.add(value);
  }

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  clear(): void { this.values.clear(); }
  toTokenString(): string { return [...this.values].join(" "); }
}

class FakeStyle {
  position = "";
  left = "";
  top = "";

  setProperty(_name: string, _value: string): void {}
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList: FakeClassList;
  readonly listeners = new Map<string, RegisteredListener[]>();
  readonly style = new FakeStyle();
  parent: FakeElement | null = null;
  id = "";
  textContent = "";
  type = "";

  constructor(classes: readonly string[] = []) {
    this.classList = new FakeClassList(classes);
  }

  /** Keep className in sync with classList like a real Element. */
  get className(): string {
    return this.classList.toTokenString();
  }

  set className(value: string) {
    this.classList.clear();
    for (const token of value.split(/\s+/).filter(Boolean)) {
      this.classList.add(token);
    }
  }

  addEventListener(
    type: string,
    listener: Listener,
    options: boolean | AddEventListenerOptions = false,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({
      listener,
      capture: typeof options === "boolean" ? options : options.capture ?? false,
    });
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: Listener,
    options: boolean | EventListenerOptions = false,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    const capture = typeof options === "boolean" ? options : options.capture ?? false;
    this.listeners.set(
      type,
      listeners.filter((current) => current.listener !== listener || current.capture !== capture),
    );
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  contains(target: FakeElement | null): boolean {
    if (!target) return false;
    return target === this || this.children.some((child) => child.contains(target));
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parent = null;
    }
    return child;
  }

  remove(): void {}

  dispatch(type: string, options: { relatedTarget?: FakeElement | null } = {}): FakeEvent {
    const event = new FakeEvent(options);
    const ancestors: FakeElement[] = [];
    let ancestor = this.parent;
    while (ancestor !== null) {
      ancestors.unshift(ancestor);
      ancestor = ancestor.parent;
    }
    for (const current of ancestors) {
      for (const registered of current.listeners.get(type) ?? []) {
        if (registered.capture) registered.listener(event);
      }
    }
    for (const registered of this.listeners.get(type) ?? []) registered.listener(event);
    return event;
  }
}

class FakeEditorElement extends FakeElement {
  rect = { top: 0, bottom: 100, left: 0, right: 400, width: 400, height: 100 };

  getBoundingClientRect(): Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height"> {
    return this.rect;
  }
}

class FakeSelectionEditor {
  text = "";
  selection: RichTextEditorSelection = { from: 1, to: 1, head: 1 };
  readonly coordinateReads: number[] = [];
  readonly coordinates = new Map<number, RichTextEditorCoordinates>();
  readonly element: FakeEditorElement;

  constructor(element: FakeEditorElement) {
    this.element = element;
  }

  getDocument(): JSONContent {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: this.text }] }],
    };
  }

  getSelection(): RichTextEditorSelection {
    return this.selection;
  }

  coordinatesAt(position: number): RichTextEditorCoordinates {
    this.coordinateReads.push(position);
    return this.coordinates.get(position) ?? {
      left: position * 10,
      right: position * 10 + 1,
      top: 20,
      bottom: 36,
    };
  }

  dispatch(type: string): FakeEvent {
    return this.element.dispatch(type);
  }
}

type SelectionEntryFixture = Readonly<{
  dom: AppDom;
  editorPage: FakeElement;
  btnToggleAi: FakeElement;
  draft: FakeSelectionEditor;
  dispatchDocument: (type: string) => void;
  setActiveElement: (element: FakeElement | null) => void;
  getCurrentDocumentId: () => string | null;
  setCurrentDocumentId: (documentId: string) => void;
  restore: () => void;
}>;

function installSelectionEntryDom(): SelectionEntryFixture {
  const previousDocument = globalThis.document;
  const editorPage = new FakeElement();
  const btnToggleAi = new FakeElement();
  const draftElement = new FakeEditorElement();
  const draft = new FakeSelectionEditor(draftElement);
  const documentListeners = new Map<string, Listener[]>();
  let activeElement: FakeElement | null = draftElement;
  let currentDocumentId: string | null = "doc-1";

  globalThis.document = {
    activeElement,
    createElement: () => new FakeElement(),
    addEventListener: (type: string, listener: Listener) => {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: Listener) => {
      const listeners = documentListeners.get(type) ?? [];
      documentListeners.set(type, listeners.filter((current) => current !== listener));
    },
  } as unknown as Document;

  return {
    dom: {
      editorPage,
      btnToggleAi,
      editorTextarea: draftElement,
    } as unknown as AppDom,
    editorPage,
    btnToggleAi,
    draft,
    dispatchDocument: (type: string) => {
      const event = new FakeEvent();
      for (const listener of documentListeners.get(type) ?? []) listener(event);
    },
    setActiveElement: (element: FakeElement | null) => {
      activeElement = element;
      Object.defineProperty(globalThis.document, "activeElement", {
        configurable: true,
        value: activeElement,
      });
    },
    getCurrentDocumentId: () => currentDocumentId,
    setCurrentDocumentId: (documentId) => { currentDocumentId = documentId; },
    restore: () => {
      globalThis.document = previousDocument;
    },
  };
}

function setupEditorSelectionEntry(
  ui: SelectionEntryFixture,
  callbacks: Readonly<{
    onSummon?: (snapshot: SelectionSnapshot) => void;
    onThinkingExpansion?: (snapshot: SelectionSnapshot) => void;
    isRequestInFlight?: () => boolean;
  }> = {},
) {
  const options = {
    dom: ui.dom,
    getCurrentDocumentId: ui.getCurrentDocumentId,
    getCurrentEditor: () => asEditor(ui.draft),
    isRequestInFlight: callbacks.isRequestInFlight ?? (() => false),
    onSummon: callbacks.onSummon ?? (() => {}),
    onThinkingExpansion: callbacks.onThinkingExpansion ?? (() => {}),
  };
  return setupSelectionEntry(options);
}

/** 夹具编辑器与真实 `SelectionEntryEditor` 结构一致，仅 element 是假元素，这里显式对齐类型。 */
function asEditor(editor: FakeSelectionEditor): SelectionEntryEditor {
  return editor as unknown as SelectionEntryEditor;
}

function setEditorRect(
  editor: FakeSelectionEditor,
  rect: Readonly<{ top: number; bottom: number; left: number; right: number }>,
): void {
  editor.element.rect = {
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

function visibleEntry(ui: SelectionEntryFixture): FakeElement {
  const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
  assert.ok(entry);
  return entry;
}

function entryTrigger(entry: FakeElement): FakeElement {
  const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
  assert.ok(trigger);
  return trigger;
}

function entryMenu(entry: FakeElement): FakeElement {
  const menu = entry.children.find((child) => child.id === "ai-selection-entry-menu");
  assert.ok(menu);
  return menu;
}

function editorCoordinates(
  left: number,
  top: number,
  height = 16,
): RichTextEditorCoordinates {
  return { left, right: left + 1, top, bottom: top + height };
}

function installAnimationFrameQueue(): { flush: () => void; restore: () => void } {
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = (handle: number): void => {
    callbacks.splice(handle - 1, 1);
  };

  return {
    flush: () => {
      const pending = callbacks.splice(0, callbacks.length);
      for (const callback of pending) callback(0);
    },
    restore: () => {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    },
  };
}

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

test("shows the entry for a meaningful selection whose focus end is visible", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: true, focusEndVisible: true }),
    true,
  );
});

test("offers timely summon and thinking expansion actions for a visible selection", () => {
  const actions = decideSelectionEntryActions({
    hasMeaningfulSelection: true,
    focusEndVisible: true,
  });

  assert.deepEqual(actions, [
    { kind: "summon", label: "及时召唤" },
    { kind: "thinking_expansion", label: "思维扩展" },
  ]);
});

test("offers no selection entry actions when the entry is hidden", () => {
  const actions = decideSelectionEntryActions({
    hasMeaningfulSelection: true,
    focusEndVisible: false,
  });

  assert.deepEqual(actions, []);
});

test("renders only the actions returned by the selection entry decision", () => {
  const menu = new FakeElement();
  const actions = [{ kind: "summon", label: "及时召唤" }] as const;

  renderSelectionEntryActions(menu, actions, () => new FakeElement());

  assert.deepEqual(
    menu.children.map((button) => ({ id: button.id, text: button.textContent })),
    [{ id: "ai-summon-btn", text: "及时召唤" }],
  );
});

test("selection entry opens an AI pill-triggered menu and freezes the editor selection", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "开头冻结选区结尾";
    ui.draft.selection = { from: 3, to: 7, head: 7 };
    const summons: SelectionSnapshot[] = [];

    setupEditorSelectionEntry(ui, { onSummon: (snap) => summons.push(snap) });
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    const trigger = entryTrigger(entry);
    const menu = entryMenu(entry);
    assert.equal(trigger.textContent, "AI");
    assert.equal(menu.classList.contains("hidden"), true);

    trigger.dispatch("click");
    const buttons = menu.children.filter((child) => child.type === "button");
    assert.deepEqual(buttons.map((button) => button.textContent), ["及时召唤", "思维扩展"]);
    const summonButton = buttons.find((button) => button.id === "ai-summon-btn");
    assert.ok(summonButton);
    summonButton.dispatch("click");

    assert.deepEqual(summons, [{ documentId: "doc-1", selectedText: "冻结选区", from: 3, to: 7 }]);
    assert.equal(entry.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("submitted summon snapshot survives later edits, selection changes, and document switches", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "开头冻结选区结尾";
    ui.draft.selection = { from: 3, to: 7, head: 7 };
    let submitted: SelectionSnapshot | null = null;

    setupEditorSelectionEntry(ui, { onSummon: (snap) => { submitted = snap; } });
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    entryTrigger(entry).dispatch("click");
    const summonButton = entryMenu(entry).children.find((child) => child.id === "ai-summon-btn");
    assert.ok(summonButton);
    summonButton.dispatch("click");

    ui.draft.text = "文档内容已经被用户改写";
    ui.draft.selection = { from: 1, to: 4, head: 4 };
    ui.setCurrentDocumentId("doc-2");
    ui.draft.dispatch("select");

    assert.deepEqual(submitted, {
      documentId: "doc-1",
      selectedText: "冻结选区",
      from: 3,
      to: 7,
    });
  } finally {
    ui.restore();
  }
});

test("thinking expansion submits the click-time snapshot before later editor changes", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.setCurrentDocumentId("doc-2");
    ui.draft.text = "正文本原始片段";
    ui.draft.selection = { from: 4, to: 8, head: 8 };
    let submitted: SelectionSnapshot | null = null;

    setupEditorSelectionEntry(ui, { onThinkingExpansion: (snap) => { submitted = snap; } });
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    entryTrigger(entry).dispatch("click");
    const thinkingButton = entryMenu(entry).children.find(
      (child) => child.id === "ai-thinking-expansion-btn",
    );
    assert.ok(thinkingButton);
    thinkingButton.dispatch("click");

    ui.draft.text = "正文本已改变";
    ui.draft.selection = { from: 1, to: 3, head: 3 };
    ui.setCurrentDocumentId("doc-1");
    ui.draft.dispatch("select");

    assert.deepEqual(submitted, {
      documentId: "doc-2",
      selectedText: "原始片段",
      from: 4,
      to: 8,
    });
  } finally {
    ui.restore();
  }
});

test("selection entry supports forward and backward editor selections", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "abcdef";
    const summons: SelectionSnapshot[] = [];
    setupEditorSelectionEntry(ui, { onSummon: (snap) => summons.push(snap) });

    ui.draft.selection = { from: 2, to: 5, head: 5 };
    ui.draft.dispatch("select");
    ui.draft.selection = { from: 2, to: 5, head: 2 };
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    entryTrigger(entry).dispatch("click");
    const summonButton = entryMenu(entry).children.find((child) => child.id === "ai-summon-btn");
    assert.ok(summonButton);
    summonButton.dispatch("click");
    assert.deepEqual(ui.draft.coordinateReads, [5, 2, 2, 5]);
    assert.deepEqual(summons, [
      { documentId: "doc-1", selectedText: "bcd", from: 2, to: 5 },
    ]);
  } finally {
    ui.restore();
  }
});

test("coalesces repeated editor updates into one geometry measurement frame", () => {
  const ui = installSelectionEntryDom();
  const frame = installAnimationFrameQueue();
  try {
    ui.draft.text = "abcdef";
    ui.draft.selection = { from: 1, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    ui.draft.dispatch("keyup");
    ui.draft.dispatch("mouseup");
    assert.deepEqual(ui.draft.coordinateReads, []);
    frame.flush();
    assert.deepEqual(ui.draft.coordinateReads, [4, 1]);
  } finally {
    frame.restore();
    ui.restore();
  }
});

test("reads the editor head coordinate once for repeated same-position updates", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "abcdef";
    ui.draft.selection = { from: 1, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    assert.deepEqual(ui.draft.coordinateReads, [4, 1]);
  } finally {
    ui.restore();
  }
});

test("ignores document selectionchange outside the active editor", () => {
  const ui = installSelectionEntryDom();
  const frame = installAnimationFrameQueue();
  try {
    ui.draft.text = "abcdef";
    ui.draft.selection = { from: 1, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.setActiveElement(new FakeElement());
    ui.dispatchDocument("selectionchange");
    frame.flush();
    assert.deepEqual(ui.draft.coordinateReads, []);
  } finally {
    frame.restore();
    ui.restore();
  }
});

test("responds to document selectionchange when focus is inside the editor mount", () => {
  const ui = installSelectionEntryDom();
  const frame = installAnimationFrameQueue();
  try {
    ui.draft.text = "编辑器内部焦点";
    ui.draft.selection = { from: 1, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    const contentEditable = new FakeElement();
    ui.draft.element.appendChild(contentEditable);
    ui.setActiveElement(contentEditable);

    ui.dispatchDocument("selectionchange");
    frame.flush();

    assert.deepEqual(ui.draft.coordinateReads, [4, 1]);
  } finally {
    frame.restore();
    ui.restore();
  }
});

test("destroy removes editor listeners so stale selection events do not update", () => {
  const ui = installSelectionEntryDom();
  try {
    let notebookReads = 0;
    const controller = setupSelectionEntry({
      dom: ui.dom,
      getCurrentDocumentId: () => { notebookReads += 1; return "draft"; },
      getCurrentEditor: () => asEditor(ui.draft),
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });
    controller.destroy();
    ui.draft.dispatch("select");
    assert.equal(notebookReads, 0);
  } finally {
    ui.restore();
  }
});

test("hides the entry when the active editor blurs outside the entry", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "失焦后入口应消失";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    const entry = visibleEntry(ui);
    ui.draft.element.dispatch("blur", { relatedTarget: null });
    assert.equal(entry.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("hides the entry when the internal editor surface scrolls the selection out of view", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "内部编辑节点滚动后入口应消失";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    const editorSurface = new FakeElement(["ProseMirror"]);
    ui.draft.element.appendChild(editorSurface);
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    const entry = visibleEntry(ui);
    ui.draft.coordinates.set(4, editorCoordinates(40, 120));

    editorSurface.dispatch("scroll");

    assert.equal(entry.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("hides the entry when the internal editor surface blurs outside the entry", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "内部编辑节点失焦后入口应消失";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    const editorSurface = new FakeElement(["ProseMirror"]);
    ui.draft.element.appendChild(editorSurface);
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    const entry = visibleEntry(ui);

    editorSurface.dispatch("blur", { relatedTarget: null });

    assert.equal(entry.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("keeps the entry visible when editor blur moves into the controlled menu", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "点击入口不破坏选区";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");
    const entry = visibleEntry(ui);
    const trigger = entryTrigger(entry);
    ui.draft.element.dispatch("blur", { relatedTarget: trigger });
    assert.equal(entry.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("keeps an open menu anchored when editor blur moves to the AI panel toggle", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "切换面板时保留已打开的选区菜单";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    const menu = entryMenu(entry);
    entryTrigger(entry).dispatch("click");
    const leftBefore = entry.style.left;
    const topBefore = entry.style.top;

    ui.draft.element.dispatch("blur", {
      relatedTarget: ui.btnToggleAi,
    });

    assert.equal(entry.classList.contains("hidden"), false);
    assert.equal(entry.classList.contains("menu-open"), true);
    assert.equal(menu.classList.contains("hidden"), false);
    assert.equal(entry.style.left, leftBefore);
    assert.equal(entry.style.top, topBefore);
  } finally {
    ui.restore();
  }
});

test("reset invalidates an open menu so stale action buttons cannot submit old context", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "旧菜单不能继续提交";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    const summons: SelectionSnapshot[] = [];
    const controller = setupEditorSelectionEntry(ui, { onSummon: (snap) => summons.push(snap) });
    ui.draft.dispatch("select");
    const entry = visibleEntry(ui);
    entryTrigger(entry).dispatch("click");
    const summonButton = entryMenu(entry).children.find((child) => child.id === "ai-summon-btn");
    assert.ok(summonButton);
    controller.reset();
    summonButton.dispatch("click");
    assert.deepEqual(summons, []);
  } finally {
    ui.restore();
  }
});

test("hides the entry for whitespace-only selection", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: true }),
    false,
  );
});

test("hides the entry when the selection is collapsed (click elsewhere)", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: true }),
    false,
  );
});

test("hides the entry when the focus end scrolls out of the viewport", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: true, focusEndVisible: false }),
    false,
  );
});

test("hides when both selection is empty and focus end is out of view", () => {
  assert.equal(
    decideSummonVisibility({ hasMeaningfulSelection: false, focusEndVisible: false }),
    false,
  );
});

test("same coordinates with different text are a new selection", () => {
  const previous = snapshot("旧字");
  const current = snapshot("新字");
  assert.equal(isSameSummonedSelection(previous, current), false);
});

test("same notebook range and text remain the summoned selection", () => {
  const previous = snapshot("相同");
  assert.equal(isSameSummonedSelection(previous, { ...previous }), true);
});

test("places the trigger to the right of the focus end when right-side space is enough", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 100,
    editorTop: 50,
    editorRight: 500,
    editorBottom: 250,
    focusRect: { left: 180, top: 70, right: 180, bottom: 86 },
    selectionRect: { left: 120, top: 70, right: 180, bottom: 86 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 72 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "right-of-focus");
  assert.equal(placement.left, 100 + 80 + SELECTION_ENTRY_GAP_PX);
  assert.equal(
    placement.top,
    50 + 20 + (16 - SELECTION_ENTRY_TRIGGER_HEIGHT_PX) / 2,
  );
});

test("selection entry trigger keeps the required AI pill hit area", () => {
  assert.equal(SELECTION_ENTRY_TRIGGER_WIDTH_PX, 44);
  assert.equal(SELECTION_ENTRY_TRIGGER_HEIGHT_PX, 32);
});

test("falls back below the selected line near the right side when the line is full", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 200,
    editorBottom: 300,
    focusRect: { left: 190, top: 40, right: 190, bottom: 56 },
    selectionRect: { left: 130, top: 40, right: 190, bottom: 56 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 44, height: 0 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  // Near the focus-end right edge (caretLeft - triggerWidth), clamped into editor bounds.
  assert.equal(
    placement.left,
    Math.max(
      SELECTION_ENTRY_GAP_PX,
      Math.min(
        190 - SELECTION_ENTRY_TRIGGER_WIDTH_PX,
        200 - SELECTION_ENTRY_TRIGGER_WIDTH_PX - SELECTION_ENTRY_GAP_PX,
      ),
    ),
  );
  assert.equal(placement.top, 40 + 16 + SELECTION_ENTRY_GAP_PX);
});

test("clamps below-line placement so the trigger stays inside the editor bounds", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 10,
    editorTop: 10,
    editorRight: 80,
    editorBottom: 80,
    focusRect: { left: 60, top: 22, right: 60, bottom: 38 },
    selectionRect: { left: 38, top: 22, right: 60, bottom: 38 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 44, height: 0 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  assert.ok(placement.left >= 10 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.left + SELECTION_ENTRY_TRIGGER_WIDTH_PX <= 80 - SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top >= 10 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top + SELECTION_ENTRY_TRIGGER_HEIGHT_PX <= 80 - SELECTION_ENTRY_GAP_PX);
});

test("places the trigger left of the focus end at the right edge when that avoids the selected text", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 260,
    editorBottom: 180,
    focusRect: { left: 236, top: 48, right: 238, bottom: 64 },
    selectionRect: { left: 236, top: 48, right: 252, bottom: 64 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 0 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "left-of-focus");
  assert.equal(placement.left, 236 - SELECTION_ENTRY_GAP_PX - SELECTION_ENTRY_TRIGGER_WIDTH_PX);
  assert.ok(placement.left + SELECTION_ENTRY_TRIGGER_WIDTH_PX <= 236 - SELECTION_ENTRY_GAP_PX);
});

test("places the trigger above the selected line near the bottom edge", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 280,
    editorBottom: 100,
    focusRect: { left: 140, top: 78, right: 142, bottom: 94 },
    selectionRect: { left: 96, top: 78, right: 142, bottom: 94 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 72 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "above-line");
  assert.equal(placement.top, 78 - SELECTION_ENTRY_GAP_PX - SELECTION_ENTRY_TRIGGER_HEIGHT_PX);
  assert.ok(placement.top + SELECTION_ENTRY_TRIGGER_HEIGHT_PX <= 78 - SELECTION_ENTRY_GAP_PX);
});

test("keeps the trigger inside a narrow editor when no preferred side has room", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 10,
    editorTop: 20,
    editorRight: 48,
    editorBottom: 70,
    focusRect: { left: 26, top: 36, right: 28, bottom: 52 },
    selectionRect: { left: 18, top: 36, right: 38, bottom: 52 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 72 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "clamped");
  assert.ok(placement.left >= 10 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top >= 20 + SELECTION_ENTRY_GAP_PX);
});

test("clamps four-corner placement inside the editor bounds", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 100,
    editorTop: 100,
    editorRight: 160,
    editorBottom: 148,
    focusRect: { left: 154, top: 138, right: 156, bottom: 146 },
    selectionRect: { left: 104, top: 104, right: 156, bottom: 146 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 72 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.ok(placement.left >= 100 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top >= 100 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.left + SELECTION_ENTRY_TRIGGER_WIDTH_PX <= 160 - SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top + SELECTION_ENTRY_TRIGGER_HEIGHT_PX <= 148 - SELECTION_ENTRY_GAP_PX);
});

test("moves below the selected text when side placement would overlap the selection", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 320,
    editorBottom: 180,
    focusRect: { left: 120, top: 50, right: 122, bottom: 66 },
    selectionRect: { left: 74, top: 50, right: 176, bottom: 66 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 120, height: 72 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  assert.ok(placement.top >= 66 + SELECTION_ENTRY_GAP_PX);
});

test("reserves menu footprint when choosing a trigger placement near the window edge", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 360,
    editorBottom: 244,
    focusRect: { left: 260, top: 80, right: 262, bottom: 96 },
    selectionRect: { left: 216, top: 80, right: 262, bottom: 96 },
    triggerSize: {
      width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
      height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
    },
    menuSize: { width: 160, height: 96 },
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  assert.ok(placement.left + 160 <= 360 - SELECTION_ENTRY_GAP_PX);
});

test("keeps the trigger anchor fixed when the secondary menu opens", () => {
  const ui = installSelectionEntryDom();
  try {
    ui.draft.text = "选区右侧有空间显示入口";
    ui.draft.selection = { from: 0, to: 4, head: 4 };
    setEditorRect(ui.draft, { top: 0, bottom: 200, left: 0, right: 400 });
    ui.draft.coordinates.set(4, editorCoordinates(40, 20));
    ui.draft.coordinates.set(0, editorCoordinates(0, 20));

    setupEditorSelectionEntry(ui);
    ui.draft.dispatch("select");

    const entry = visibleEntry(ui);
    assert.equal(entry.classList.contains("hidden"), false);

    const leftBefore = entry.style.left;
    const topBefore = entry.style.top;
    assert.notEqual(leftBefore, "");
    assert.notEqual(topBefore, "");

    const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
    assert.ok(trigger);
    trigger.dispatch("click");

    assert.equal(entry.classList.contains("menu-open"), true);
    assert.equal(entry.style.left, leftBefore);
    assert.equal(entry.style.top, topBefore);

    // Re-fire selection update while the menu is open; anchor must stay locked.
    ui.draft.dispatch("select");
    assert.equal(entry.classList.contains("menu-open"), true);
    assert.equal(entry.style.left, leftBefore);
    assert.equal(entry.style.top, topBefore);
  } finally {
    ui.restore();
  }
});
