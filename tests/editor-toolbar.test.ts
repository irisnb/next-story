import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import {
  createEditorToolbar,
  type EditorToolbarDeps,
  type ToolbarEditorCapabilities,
} from "../src/editor-toolbar.ts";
import type { FormatCommand } from "../src/format-commands.ts";
import { MARGIN_STORAGE_KEY } from "../src/editor-margin.ts";
import { memoryStorageFixture } from "./memory-storage-fixture.ts";

type Listener = () => void;

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
  value = "";
  disabled = false;
  textContent = "";
  /** closest(".drawer-group") 的返回值；未设置时返回 null。 */
  closestGroup: FakeElement | null = null;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  closest(selector: string): FakeElement | null {
    return selector === ".drawer-group" ? this.closestGroup : null;
  }
}

function paragraphDoc(text: string, marks?: Array<{ type: string }>): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }],
  };
}

class FakeToolbarEditor implements ToolbarEditorCapabilities {
  selection = { from: 1, to: 1 };
  document: JSONContent = paragraphDoc("");
  canUndoValue = false;
  canRedoValue = false;
  runCommandResult = true;
  runCommands: FormatCommand[] = [];

  getSelection(): { from: number; to: number } {
    return this.selection;
  }

  getDocument(): JSONContent {
    return this.document;
  }

  runCommand(command: FormatCommand): boolean {
    this.runCommands.push(command);
    return this.runCommandResult;
  }

  canUndo(): boolean {
    return this.canUndoValue;
  }

  canRedo(): boolean {
    return this.canRedoValue;
  }
}

interface ToolbarFixture {
  elements: Record<string, FakeElement>;
  editor: FakeToolbarEditor;
  toolbar: ReturnType<typeof createEditorToolbar>;
}

function toolbarFixture(
  extra: { marginStorage?: ReturnType<typeof memoryStorageFixture> | null } = {},
): ToolbarFixture {
  const ids = [
    "paragraphStyle", "btnBold", "btnItalic", "btnToolbarUnderline",
    "btnToolbarStrike", "btnBulletList", "btnOrderedList", "btnUndo",
    "btnRedo", "btnMargin", "editorPage", "btnFormatDrawer",
    "formatDrawer", "btnFormatDrawerClose", "btnToggleCharacterSection",
    "btnToggleParagraphSection", "btnUnderline", "btnStrike",
    "selectFontFamily", "selectFontSize", "inputTextColor",
    "btnClearTextColor", "inputHighlight", "btnClearHighlight",
    "btnClearCharacterFormat", "btnAlignLeft", "btnAlignCenter",
    "btnAlignRight", "btnAlignJustify", "selectLineHeight",
    "selectSpacingBefore", "selectSpacingAfter", "selectTextIndent",
    "selectIndentLeft", "selectIndentRight", "btnClearParagraphFormat",
  ];
  const elements: Record<string, FakeElement> = {};
  for (const id of ids) elements[id] = new FakeElement();
  const editor = new FakeToolbarEditor();
  const toolbar = createEditorToolbar({
    dom: elements as unknown as EditorToolbarDeps["dom"],
    getEditor: () => editor,
    marginStorage: extra.marginStorage ?? null,
  });
  return { elements, editor, toolbar };
}

test("render disables all toolbar controls when there is no editor", () => {
  const { elements, toolbar } = toolbarFixture();
  toolbar.render();
  assert.equal(elements["btnBold"].disabled, true);
  assert.equal(elements["btnUndo"].disabled, true);
  assert.equal(elements["paragraphStyle"].disabled, true);
  assert.equal(elements["btnUnderline"].disabled, true);
  assert.equal(elements["selectFontFamily"].disabled, true);
  assert.equal(elements["btnAlignLeft"].disabled, true);
});

test("render reflects bold, undo, and redo state from the current selection", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.document = paragraphDoc("hello", [{ type: "bold" }]);
  editor.selection = { from: 1, to: 6 };
  editor.canUndoValue = true;

  toolbar.render();

  assert.equal(elements["btnBold"].getAttribute("aria-pressed"), "true");
  assert.equal(elements["btnBold"].disabled, false);
  assert.equal(elements["btnUnderline"].getAttribute("aria-pressed"), "false");
  assert.equal(elements["btnUndo"].disabled, false);
  assert.equal(elements["btnRedo"].disabled, true);
});

test("runFormatCommand runs the command and re-renders the toolbar", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.document = paragraphDoc("hello");
  editor.selection = { from: 1, to: 6 };

  const result = toolbar.runFormatCommand({ kind: "bold" });

  assert.equal(result, true);
  assert.deepEqual(editor.runCommands, [{ kind: "bold" }]);
  // 渲染被再次调用：按钮状态仍反映当前（未变化的）文档。
  assert.equal(elements["btnBold"].getAttribute("aria-pressed"), "false");
});

test("runSelectionCommand does nothing without a selection", () => {
  const { editor, toolbar } = toolbarFixture();
  editor.selection = { from: 1, to: 1 };

  toolbar.runSelectionCommand({ kind: "bold" });

  assert.equal(editor.runCommands.length, 0);
});

test("runSelectionCommand runs the command when there is a selection", () => {
  const { editor, toolbar } = toolbarFixture();
  editor.selection = { from: 1, to: 6 };

  toolbar.runSelectionCommand({ kind: "bold" });

  assert.deepEqual(editor.runCommands, [{ kind: "bold" }]);
});

test("format drawer toggles open and closes", () => {
  const { elements } = toolbarFixture();

  elements["btnFormatDrawer"].dispatch("click");
  assert.equal(elements["formatDrawer"].classList.contains("open"), true);
  assert.equal(elements["formatDrawer"].getAttribute("aria-hidden"), "false");
  assert.equal(elements["btnFormatDrawer"].getAttribute("aria-expanded"), "true");

  elements["btnFormatDrawerClose"].dispatch("click");
  assert.equal(elements["formatDrawer"].classList.contains("open"), false);
  assert.equal(elements["formatDrawer"].getAttribute("aria-hidden"), "true");
  assert.equal(elements["btnFormatDrawer"].getAttribute("aria-expanded"), "false");
});

test("drawer section toggle collapses its group", () => {
  const { elements } = toolbarFixture();
  const group = new FakeElement();
  elements["btnToggleCharacterSection"].closestGroup = group;

  elements["btnToggleCharacterSection"].dispatch("click");

  assert.equal(group.classList.contains("collapsed"), true);
  assert.equal(elements["btnToggleCharacterSection"].getAttribute("aria-expanded"), "false");
});

test("margin preset is restored from storage and cycles on click", () => {
  const margin = memoryStorageFixture({ [MARGIN_STORAGE_KEY]: "loose" });
  const { elements } = toolbarFixture({ marginStorage: margin });

  assert.equal(elements["editorPage"].getAttribute("data-margin"), "loose");
  assert.equal(elements["btnMargin"].textContent, "宽松");

  elements["btnMargin"].dispatch("click");
  assert.equal(elements["editorPage"].getAttribute("data-margin"), "compact");
  assert.equal(margin.data[MARGIN_STORAGE_KEY], "compact");
});

test("margin falls back to the default preset without storage", () => {
  const { elements } = toolbarFixture();

  assert.equal(elements["editorPage"].getAttribute("data-margin"), "standard");
  assert.equal(elements["btnMargin"].textContent, "标准");

  elements["btnMargin"].dispatch("click");
  assert.equal(elements["editorPage"].getAttribute("data-margin"), "loose");
});

test("dispose removes listeners so buttons no longer run commands", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.selection = { from: 1, to: 6 };

  toolbar.dispose();
  elements["btnBold"].dispatch("click");
  elements["btnFormatDrawer"].dispatch("click");

  assert.equal(editor.runCommands.length, 0);
  assert.equal(elements["formatDrawer"].classList.contains("open"), false);
});