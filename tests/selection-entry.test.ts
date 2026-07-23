import assert from "node:assert/strict";
import test from "node:test";

import {
  decideSelectionEntryActions,
  decideSummonVisibility,
  decideTriggerPlacement,
  isSameSummonedSelection,
  setupSelectionEntry,
  SELECTION_ENTRY_GAP_PX,
  SELECTION_ENTRY_TRIGGER_SIZE_PX,
} from "../src/selection-entry.ts";
import type { AppDom } from "../src/dom.ts";
import type { SelectionSnapshot } from "../src/types.ts";

type Listener = () => void;

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

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }

  remove(): void {}

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeTextarea extends FakeElement {
  value = "";
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
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

function installSelectionEntryDom(): { dom: AppDom; editorPage: FakeElement; restore: () => void } {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const editorPage = new FakeElement();
  const draftTextarea = new FakeTextarea();
  const mainTextarea = new FakeTextarea(["hidden"]);
  const body = new FakeElement();

  globalThis.document = {
    body,
    createElement: (tag: string) => tag === "textarea" ? new FakeTextarea() : new FakeElement(),
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as Document;
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: (property: string) => property === "line-height" || property === "font-size" ? "16" : "0",
  })) as unknown as typeof getComputedStyle;

  return {
    dom: { editorPage, draftTextarea, mainTextarea } as unknown as AppDom,
    editorPage,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.getComputedStyle = previousGetComputedStyle;
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

test("selection entry opens a dot-triggered menu and freezes each action selection", () => {
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
    assert.equal(trigger.textContent, "");
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
    caretLeft: 80,
    caretTop: 20,
    caretHeight: 16,
    triggerSize: SELECTION_ENTRY_TRIGGER_SIZE_PX,
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "right-of-focus");
  assert.equal(placement.left, 100 + 80 + SELECTION_ENTRY_GAP_PX);
  assert.equal(
    placement.top,
    50 + 20 + (16 - SELECTION_ENTRY_TRIGGER_SIZE_PX) / 2,
  );
});

test("falls back below the selected line near the right side when the line is full", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 0,
    editorTop: 0,
    editorRight: 200,
    editorBottom: 300,
    caretLeft: 190,
    caretTop: 40,
    caretHeight: 16,
    triggerSize: SELECTION_ENTRY_TRIGGER_SIZE_PX,
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  // Near the focus-end right edge (caretLeft - triggerSize), clamped into editor bounds.
  assert.equal(
    placement.left,
    Math.max(
      SELECTION_ENTRY_GAP_PX,
      Math.min(
        190 - SELECTION_ENTRY_TRIGGER_SIZE_PX,
        200 - SELECTION_ENTRY_TRIGGER_SIZE_PX - SELECTION_ENTRY_GAP_PX,
      ),
    ),
  );
  assert.equal(placement.top, 40 + 16 + SELECTION_ENTRY_GAP_PX);
});

test("clamps below-line placement so the trigger stays inside the editor bounds", () => {
  const placement = decideTriggerPlacement({
    editorLeft: 10,
    editorTop: 10,
    editorRight: 40,
    editorBottom: 80,
    caretLeft: 50,
    caretTop: 12,
    caretHeight: 16,
    triggerSize: SELECTION_ENTRY_TRIGGER_SIZE_PX,
    gap: SELECTION_ENTRY_GAP_PX,
  });

  assert.equal(placement.mode, "below-line");
  assert.ok(placement.left >= 10 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.left + SELECTION_ENTRY_TRIGGER_SIZE_PX <= 40 - SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top >= 10 + SELECTION_ENTRY_GAP_PX);
  assert.ok(placement.top + SELECTION_ENTRY_TRIGGER_SIZE_PX <= 80 - SELECTION_ENTRY_GAP_PX);
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
