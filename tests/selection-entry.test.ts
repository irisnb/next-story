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
} from "../src/selection-entry.ts";
import type { AppDom } from "../src/dom.ts";
import type { SelectionSnapshot } from "../src/types.ts";

type Listener = (event: FakeEvent) => void;

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
  readonly listeners = new Map<string, Listener[]>();
  readonly style = new FakeStyle();
  id = "";
  textContent = "";
  type = "";
  /** Mirror-div geometry used by getCaretCoordinates in Node fakes. */
  offsetTop = 0;
  offsetLeft = 0;

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

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((current) => current !== listener));
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  contains(target: FakeElement | null): boolean {
    if (!target) return false;
    return target === this || this.children.some((child) => child.contains(target));
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }

  remove(): void {}

  dispatch(type: string, options: { relatedTarget?: FakeElement | null } = {}): FakeEvent {
    const event = new FakeEvent(options);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

class FakeTextarea extends FakeElement {
  value = "";
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  selectionDirection: "forward" | "backward" | "none" = "forward";
  scrollTop = 0;
  scrollLeft = 0;
  offsetTop = 0;
  offsetLeft = 0;
  clientWidth = 400;
  clientHeight = 100;

  getBoundingClientRect(): Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height"> {
    return {
      top: 0,
      bottom: this.clientHeight,
      left: 0,
      right: this.clientWidth,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
}

function installSelectionEntryDom(): {
  dom: AppDom;
  editorPage: FakeElement;
  dispatchDocument: (type: string) => void;
  restore: () => void;
} {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const editorPage = new FakeElement();
  const draftTextarea = new FakeTextarea();
  const mainTextarea = new FakeTextarea(["hidden"]);
  const body = new FakeElement();
  const documentListeners = new Map<string, Listener[]>();

  globalThis.document = {
    body,
    createElement: (tag: string) => tag === "textarea" ? new FakeTextarea() : new FakeElement(),
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
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: (property: string) => property === "line-height" || property === "font-size" ? "16" : "0",
  })) as unknown as typeof getComputedStyle;

  return {
    dom: { editorPage, draftTextarea, mainTextarea } as unknown as AppDom,
    editorPage,
    dispatchDocument: (type: string) => {
      const event = new FakeEvent();
      for (const listener of documentListeners.get(type) ?? []) listener(event);
    },
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.getComputedStyle = previousGetComputedStyle;
    },
  };
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
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
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

test("selection entry opens an AI pill-triggered menu and freezes each action selection", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "开头冻结选区结尾";
    draft.selectionStart = 2;
    draft.selectionEnd = 6;
    const summons: SelectionSnapshot[] = [];
    const expansions: SelectionSnapshot[] = [];

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: (snap) => { summons.push(snap); },
      onThinkingExpansion: (snap) => { expansions.push(snap); },
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
    const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
    const menu = entry.children.find((child) => child.id === "ai-selection-entry-menu");
    assert.ok(trigger);
    assert.ok(menu);
    assert.equal(trigger.type, "button");
    assert.equal(trigger.textContent, "AI");
    assert.equal(menu.classList.contains("hidden"), true);

    trigger.dispatch("click");

    assert.equal(entry.classList.contains("menu-open"), true);
    assert.equal(menu.classList.contains("hidden"), false);
    const buttons = menu.children.filter((child) => child.type === "button");
    assert.deepEqual(buttons.map((button) => button.textContent), ["及时召唤", "思维扩展"]);

    const summonButton = buttons.find((button) => button.id === "ai-summon-btn");
    const thinkingButton = buttons.find((button) => button.id === "ai-thinking-expansion-btn");
    assert.ok(summonButton);
    assert.ok(thinkingButton);

    summonButton.dispatch("click");

    assert.deepEqual(summons, [{ notebook: "draft", selectedText: "冻结选区", start: 2, end: 6 }]);
    assert.deepEqual(expansions, []);
    assert.equal(entry.classList.contains("hidden"), true);
    assert.equal(menu.classList.contains("hidden"), true);
    assert.equal(entry.classList.contains("menu-open"), false);

    draft.value = "后来扩展选区结尾";
    draft.selectionStart = 2;
    draft.selectionEnd = 6;
    draft.dispatch("select");
    trigger.dispatch("click");
    thinkingButton.dispatch("click");

    assert.deepEqual(expansions, [{ notebook: "draft", selectedText: "扩展选区", start: 2, end: 6 }]);
  } finally {
    ui.restore();
  }
});

test("selection entry pointer presses preserve textarea focus before opening actions", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "点击入口仍保留原生选区高亮";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
    const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
    const menu = entry.children.find((child) => child.id === "ai-selection-entry-menu");
    assert.ok(trigger);
    assert.ok(menu);

    const triggerMouseDown = trigger.dispatch("mousedown");
    trigger.dispatch("click");
    const actionMouseDowns = menu.children
      .filter((child) => child.type === "button")
      .map((button) => button.dispatch("mousedown"));

    assert.equal(triggerMouseDown.defaultPrevented, true);
    assert.deepEqual(actionMouseDowns.map((event) => event.defaultPrevented), [true, true]);
  } finally {
    ui.restore();
  }
});

test("selection entry measures the browser focus end for forward and backward selections", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea as unknown as FakeTextarea;
    draft.value = "abcdef";
    const measuredOffsets: number[] = [];

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
      measureCaret: (_textarea, offset) => {
        measuredOffsets.push(offset);
        return { left: 0, top: 0, height: 16 };
      },
    });

    draft.selectionStart = 1;
    draft.selectionEnd = 4;
    draft.selectionDirection = "forward";
    draft.dispatch("select");

    draft.selectionStart = 1;
    draft.selectionEnd = 4;
    draft.selectionDirection = "backward";
    draft.dispatch("select");

    assert.deepEqual(measuredOffsets, [4, 1, 1, 4]);
  } finally {
    ui.restore();
  }
});

test("coalesces repeated textarea updates into one geometry measurement frame", () => {
  const ui = installSelectionEntryDom();
  const frame = installAnimationFrameQueue();
  try {
    const draft = ui.dom.draftTextarea as unknown as FakeTextarea;
    draft.value = "abcdef";
    draft.selectionStart = 1;
    draft.selectionEnd = 4;
    draft.selectionDirection = "forward";
    const measuredOffsets: number[] = [];

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
      measureCaret: (_textarea, offset) => {
        measuredOffsets.push(offset);
        return { left: offset * 10, top: 0, height: 16 };
      },
    });

    draft.dispatch("select");
    draft.dispatch("keyup");
    draft.dispatch("mouseup");

    assert.deepEqual(measuredOffsets, []);

    frame.flush();

    assert.deepEqual(measuredOffsets, [4, 1]);
  } finally {
    frame.restore();
    ui.restore();
  }
});

test("ignores document selectionchange outside the active writing textarea", () => {
  const ui = installSelectionEntryDom();
  const frame = installAnimationFrameQueue();
  try {
    const draft = ui.dom.draftTextarea as unknown as FakeTextarea;
    draft.value = "abcdef";
    draft.selectionStart = 1;
    draft.selectionEnd = 4;
    const measuredOffsets: number[] = [];

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
      measureCaret: (_textarea, offset) => {
        measuredOffsets.push(offset);
        return { left: offset * 10, top: 0, height: 16 };
      },
    });

    ui.dispatchDocument("selectionchange");
    frame.flush();

    assert.deepEqual(measuredOffsets, []);
  } finally {
    frame.restore();
    ui.restore();
  }
});

test("destroy removes textarea listeners so stale selection events do not update", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "销毁后不应继续响应选区";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;
    let selectionReads = 0;

    const controller = setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => {
        selectionReads += 1;
        return "draft";
      },
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });

    controller.destroy();
    draft.dispatch("select");

    assert.equal(selectionReads, 0);
  } finally {
    ui.restore();
  }
});

test("hides the entry when the active textarea blurs outside the entry and menu", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "失焦后入口应消失";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
    assert.equal(entry.classList.contains("hidden"), false);

    draft.dispatch("blur", { relatedTarget: null });

    assert.equal(entry.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("keeps the entry visible when textarea blur moves into the controlled entry menu", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "点击入口不破坏选区";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
    const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
    assert.ok(trigger);

    draft.dispatch("blur", { relatedTarget: trigger });

    assert.equal(entry.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("reset invalidates an open menu so stale action buttons cannot submit old context", () => {
  const ui = installSelectionEntryDom();
  try {
    const draft = ui.dom.draftTextarea;
    draft.value = "旧菜单不能继续提交";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;
    const summons: SelectionSnapshot[] = [];

    const controller = setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: (snap) => { summons.push(snap); },
      onThinkingExpansion: () => {},
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
    const trigger = entry.children.find((child) => child.id === "ai-selection-entry-trigger");
    const menu = entry.children.find((child) => child.id === "ai-selection-entry-menu");
    assert.ok(trigger);
    assert.ok(menu);
    trigger.dispatch("click");
    const summonButton = menu.children.find((child) => child.id === "ai-summon-btn");
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
    const draft = ui.dom.draftTextarea as unknown as FakeTextarea;
    draft.value = "选区右侧有空间显示入口";
    draft.selectionStart = 0;
    draft.selectionEnd = 4;
    draft.clientWidth = 400;
    draft.clientHeight = 200;

    setupSelectionEntry({
      dom: ui.dom,
      getCurrentNotebook: () => "draft",
      isRequestInFlight: () => false,
      onSummon: () => {},
      onThinkingExpansion: () => {},
    });
    draft.dispatch("select");

    const entry = ui.editorPage.children.find((child) => child.id === "ai-selection-entry");
    assert.ok(entry);
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
    draft.dispatch("select");
    assert.equal(entry.classList.contains("menu-open"), true);
    assert.equal(entry.style.left, leftBefore);
    assert.equal(entry.style.top, topBefore);
  } finally {
    ui.restore();
  }
});
