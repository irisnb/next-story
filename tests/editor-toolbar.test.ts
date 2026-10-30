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
import { COLUMN_WIDTH_STORAGE_KEY } from "../src/editor-column-width.ts";
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
  title = "";
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

  removeAttribute(name: string): void {
    this.attributes.delete(name);
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

/** 捕获 ns-toolbar-hint 原因提示事件的 window 桩（D3 C 案；detail＝{ text, anchor }）。 */
function installHintWindow(): { hints: Array<{ text: string; anchor?: unknown }>; restore(): void } {
  const hints: Array<{ text: string; anchor?: unknown }> = [];
  const g = globalThis as unknown as { window?: unknown };
  const previous = g.window;
  g.window = {
    dispatchEvent: (event: { type: string; detail?: { text: string; anchor?: unknown } }) => {
      if (event.type === "ns-toolbar-hint") hints.push(event.detail ?? { text: "" });
      return true;
    },
  };
  return { hints, restore: () => { g.window = previous; } };
}

/** 有序列表节点（attrs.type 仅在非缺省样式时出现，与规范形态一致）。 */
function orderedListNode(items: string[], style?: string, start = 1): JSONContent {
  const attrs: { start: number; type?: string } = { start };
  if (style !== undefined && style !== "1") attrs.type = style;
  return {
    type: "orderedList",
    attrs,
    content: items.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  };
}

function orderedListDoc(items: string[], style?: string): JSONContent {
  return { type: "doc", content: [orderedListNode(items, style)] };
}

/** 两个相邻有序列表（样式可各指定）：用于「多种格式」状态。 */
function twoListsDoc(styleA?: string, styleB?: string): JSONContent {
  return {
    type: "doc",
    content: [orderedListNode(["甲"], styleA), orderedListNode(["乙"], styleB)],
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
  /** 编号样式 flyout 的五个样式项（按 data-style 顺序 1/A/a/I/i）。 */
  orderedListStyleItems: FakeElement[];
  editor: FakeToolbarEditor;
  toolbar: ReturnType<typeof createEditorToolbar>;
}

function toolbarFixture(
  extra: {
    marginStorage?: ReturnType<typeof memoryStorageFixture> | null;
    columnWidthStorage?: ReturnType<typeof memoryStorageFixture> | null;
    getEditor?: () => FakeToolbarEditor | null;
  } = {},
): ToolbarFixture {
  const ids = [
    "paragraphStyle", "btnBold", "btnItalic", "btnToolbarUnderline",
    "btnToolbarStrike", "btnBulletList", "btnOrderedList", "btnUndo",
    "btnRedo", "btnMargin", "btnColumnWidth", "editorPage", "btnFormatDrawer",
    "formatDrawer", "btnFormatDrawerClose", "btnToggleCharacterSection",
    "btnToggleParagraphSection", "btnUnderline", "btnStrike",
    "selectFontFamily", "selectFontSize", "inputTextColor",
    "btnClearTextColor", "inputHighlight", "btnClearHighlight",
    "btnClearCharacterFormat", "btnAlignLeft", "btnAlignCenter",
    "btnAlignRight", "btnAlignJustify", "selectLineHeight",
    "selectSpacingBefore", "selectSpacingAfter", "selectTextIndent",
    "selectIndentLeft", "selectIndentRight", "btnClearParagraphFormat",
    // 编号样式 flyout（触发器 / 菜单容器 / 状态行）
    "btnOrderedListStyle", "orderedListStyleMenu", "orderedListStyleCurrent",
  ];
  const elements: Record<string, FakeElement> = {};
  for (const id of ids) {
    elements[id] = new FakeElement();
  }
  // 菜单初始与 index.html 一致：hidden、aria-expanded=false；五个样式项带 data-style。
  elements["orderedListStyleMenu"].classList.add("hidden");
  elements["btnOrderedListStyle"].setAttribute("aria-expanded", "false");
  const orderedListStyleItems = ["1", "A", "a", "I", "i"].map((style) => {
    const item = new FakeElement();
    item.setAttribute("data-style", style);
    item.setAttribute("aria-checked", "false");
    return item;
  });
  const editor = new FakeToolbarEditor();
  const toolbar = createEditorToolbar({
    dom: { ...elements, orderedListStyleItems } as unknown as EditorToolbarDeps["dom"],
    getEditor: extra.getEditor ?? (() => editor),
    marginStorage: extra.marginStorage ?? null,
    columnWidthStorage: extra.columnWidthStorage ?? null,
  });
  return { elements, orderedListStyleItems, editor, toolbar };
}

test("render disables all toolbar controls when there is no editor", () => {
  // 真正的「无编辑器」路径（文档切换过渡态）：全关走原生 disabled；
  // 无选区（有编辑器）的禁用口径见 aria-disabled 专项测试。
  const { elements, toolbar } = toolbarFixture({ getEditor: () => null });
  toolbar.render();
  assert.equal(elements["btnBold"].disabled, true);
  assert.equal(elements["btnBold"].getAttribute("aria-disabled"), null);
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
  // 撤销/重做（D3 C 案 3.5）：历史可用性走 aria-disabled（亮着），不再原生 disabled。
  assert.equal(elements["btnUndo"].getAttribute("aria-disabled"), null, "历史可撤销时应可用");
  assert.equal(elements["btnUndo"].disabled, false);
  assert.equal(elements["btnRedo"].getAttribute("aria-disabled"), "true", "历史无可重做时应 aria-disabled");
  assert.equal(elements["btnRedo"].disabled, false, "不置原生 disabled（亮着）");
});

test("empty history keeps undo/redo lit with aria-disabled and clicking explains why", () => {
  // D3 C 案 3.5：撤销/重做历史空时并入「亮着＋点击给提示」——不再原生 disabled
  // （原生 disabled 悬停无提示，即用户验收所见「有的有、有的没有」）。
  const hintWindow = installHintWindow();
  try {
    const { elements, editor, toolbar } = toolbarFixture();
    editor.document = paragraphDoc("hello");
    editor.selection = { from: 1, to: 6 };
    editor.canUndoValue = false;
    editor.canRedoValue = false;

    toolbar.render();

    for (const id of ["btnUndo", "btnRedo"]) {
      assert.equal(elements[id].getAttribute("aria-disabled"), "true", `${id} 历史空应置 aria-disabled`);
      assert.equal(elements[id].disabled, false, `${id} 不置原生 disabled`);
    }

    // 点击（键盘经 click 同路）：动作被拒绝并给专属原因提示（锚＝各自按钮），禁止静默无响应。
    elements["btnUndo"].dispatch("click");
    elements["btnRedo"].dispatch("click");
    assert.equal(editor.runCommands.length, 0, "历史空点击不产生命令");
    assert.deepEqual(hintWindow.hints, [
      { text: "没有可撤销的内容", anchor: elements["btnUndo"] },
      { text: "没有可重做的内容", anchor: elements["btnRedo"] },
    ]);

    // 历史可用后：标记摘除、动作恢复、不再给原因提示。
    editor.canUndoValue = true;
    toolbar.render();
    assert.equal(elements["btnUndo"].getAttribute("aria-disabled"), null);
    hintWindow.hints.length = 0;
    elements["btnUndo"].dispatch("click");
    assert.deepEqual(editor.runCommands, [{ kind: "undo" }]);
    assert.deepEqual(hintWindow.hints, []);
  } finally {
    hintWindow.restore();
  }
});

test("no-selection disable uses aria-disabled, keeps events flowing, and refuses actions with a reason hint", () => {
  // fix-tooltip-rule-ownership D3 C 案：无选区不可用态亮着（不置原生 disabled，事件
  // 与提示保留），点击/键盘（经 click）由处理器入口守卫拒绝，并给统一原因提示
  // 「先选中文字再用」（锚＝触发按钮）——禁止静默无响应。
  const hintWindow = installHintWindow();
  try {
    const { elements, editor, toolbar } = toolbarFixture();
    editor.document = paragraphDoc("hello");
    editor.selection = { from: 1, to: 1 };

    toolbar.render();

    const unavailable = [
      "btnBold", "btnItalic", "btnToolbarUnderline", "btnToolbarStrike", "btnBulletList", "btnOrderedList",
      // 3.8 补漏：对齐四枚＋清除格式两枚（首版误入抽屉控件清单走原生 disabled＋灰）。
      "btnAlignLeft", "btnAlignCenter", "btnAlignRight", "btnAlignJustify",
      "btnClearCharacterFormat", "btnClearParagraphFormat",
    ];
    for (const id of unavailable) {
      assert.equal(elements[id].getAttribute("aria-disabled"), "true", `${id} 无选区应置 aria-disabled`);
      assert.equal(elements[id].disabled, false, `${id} 不置原生 disabled（亮着）`);
    }

    // 事件照常流动但动作被拒绝：无选区点击不产生任何格式命令，且给原因提示
    // （含 3.8 补漏的对齐与清除格式两枚——锚点应为各自按钮）。
    elements["btnBold"].dispatch("click");
    elements["btnOrderedList"].dispatch("click");
    elements["btnAlignLeft"].dispatch("click");
    elements["btnClearCharacterFormat"].dispatch("click");
    assert.equal(editor.runCommands.length, 0);
    assert.deepEqual(
      hintWindow.hints.map((hint) => hint.text),
      ["先选中文字再用", "先选中文字再用", "先选中文字再用", "先选中文字再用"],
      "不可用点击给统一原因提示",
    );
    assert.equal(hintWindow.hints[0].anchor, elements["btnBold"], "锚点＝触发按钮（3.9）");
    assert.equal(hintWindow.hints[2].anchor, elements["btnAlignLeft"], "对齐按钮锚点＝自身");
    assert.equal(hintWindow.hints[3].anchor, elements["btnClearCharacterFormat"], "清除格式锚点＝自身");

    // 有选区恢复后禁用标记摘除（含六枚补漏）、动作恢复、不再给原因提示。
    editor.selection = { from: 1, to: 6 };
    toolbar.render();
    for (const id of unavailable) assert.equal(elements[id].getAttribute("aria-disabled"), null, `${id} 恢复可用`);
    hintWindow.hints.length = 0;
    elements["btnBold"].dispatch("click");
    assert.deepEqual(editor.runCommands, [{ kind: "bold" }]);
    assert.deepEqual(hintWindow.hints, []);
  } finally {
    hintWindow.restore();
  }
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

test("column width preset is restored from storage and cycles on click", () => {
  const columnWidth = memoryStorageFixture({ [COLUMN_WIDTH_STORAGE_KEY]: "wide" });
  const { elements } = toolbarFixture({ columnWidthStorage: columnWidth });

  assert.equal(elements["editorPage"].getAttribute("data-column-width"), "wide");
  assert.equal(elements["btnColumnWidth"].textContent, "宽 · 860");

  elements["btnColumnWidth"].dispatch("click");
  assert.equal(elements["editorPage"].getAttribute("data-column-width"), "narrow");
  assert.equal(columnWidth.data[COLUMN_WIDTH_STORAGE_KEY], "narrow");
});

test("column width falls back to the default preset without storage", () => {
  const { elements } = toolbarFixture();

  assert.equal(elements["editorPage"].getAttribute("data-column-width"), "standard");
  assert.equal(elements["btnColumnWidth"].textContent, "标准 · 720");

  elements["btnColumnWidth"].dispatch("click");
  assert.equal(elements["editorPage"].getAttribute("data-column-width"), "wide");
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

// ---- 有序列表编号样式 flyout（「有序列表」按钮旁的紧邻子菜单） ----

test("style trigger is disabled without a text selection", () => {
  const { elements, toolbar } = toolbarFixture();

  toolbar.render();

  // D3：无选区禁用态＝aria-disabled（提示可见），非原生 disabled。
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-disabled"), "true");
  assert.equal(elements["btnOrderedListStyle"].disabled, false);
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
  // 禁用态点击（含键盘经 click）不展开 flyout。
  elements["btnOrderedListStyle"].dispatch("click");
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "false");
});

test("style trigger is disabled when the selection is outside ordered lists", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.document = paragraphDoc("hello");
  editor.selection = { from: 1, to: 6 };

  toolbar.render();

  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-disabled"), "true");
  assert.equal(elements["btnOrderedListStyle"].disabled, false);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "false");
});

test("style trigger is enabled inside an ordered list and marks the active item", () => {
  const { elements, orderedListStyleItems, editor, toolbar } = toolbarFixture();
  // 单列表两项：第一项段落范围 [2,9)，文字 3..8。
  editor.document = orderedListDoc(["alpha", "beta"], "A");
  editor.selection = { from: 3, to: 8 };

  toolbar.render();

  assert.equal(elements["btnOrderedListStyle"].disabled, false);
  assert.equal(elements["orderedListStyleCurrent"].textContent, "大写字母");
  assert.equal(elements["btnOrderedListStyle"].title, "编号样式：大写字母");
  assert.equal(orderedListStyleItems[1].getAttribute("aria-checked"), "true");
  assert.equal(orderedListStyleItems[1].classList.contains("active"), true);
  assert.equal(orderedListStyleItems[0].getAttribute("aria-checked"), "false");
});

test("default decimal style marks the numeric item", () => {
  const { elements, orderedListStyleItems, editor, toolbar } = toolbarFixture();
  editor.document = orderedListDoc(["alpha"]);
  editor.selection = { from: 3, to: 8 };

  toolbar.render();

  assert.equal(elements["orderedListStyleCurrent"].textContent, "数字");
  assert.equal(orderedListStyleItems[0].getAttribute("aria-checked"), "true");
  assert.equal(orderedListStyleItems[0].classList.contains("active"), true);
});

test("mixed styles show 多种格式 with no active item", () => {
  const { elements, orderedListStyleItems, editor, toolbar } = toolbarFixture();
  // 两个相邻列表（样式 A 与 a）：段落范围 [2,5) 与 [9,12)，跨选区触及两者。
  editor.document = twoListsDoc("A", "a");
  editor.selection = { from: 3, to: 11 };

  toolbar.render();

  assert.equal(elements["btnOrderedListStyle"].disabled, false);
  assert.equal(elements["orderedListStyleCurrent"].textContent, "多种格式");
  assert.equal(elements["btnOrderedListStyle"].title, "编号样式：多种格式");
  for (const item of orderedListStyleItems) {
    assert.equal(item.getAttribute("aria-checked"), "false");
    assert.equal(item.classList.contains("active"), false);
  }
});

test("trigger toggles the style flyout menu", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.document = orderedListDoc(["alpha"], "I");
  editor.selection = { from: 3, to: 8 };
  toolbar.render();

  elements["btnOrderedListStyle"].dispatch("click");
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), false);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "true");

  elements["btnOrderedListStyle"].dispatch("click");
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "false");
});

test("clicking a style item runs the style command and closes the menu", () => {
  const { elements, orderedListStyleItems, editor, toolbar } = toolbarFixture();
  editor.document = orderedListDoc(["alpha", "beta"], "A");
  editor.selection = { from: 3, to: 17 };
  toolbar.render();

  elements["btnOrderedListStyle"].dispatch("click");
  orderedListStyleItems[3].dispatch("click"); // 大写罗马 I

  assert.deepEqual(editor.runCommands, [{ kind: "orderedListStyle", style: "I" }]);
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "false");
});

test("clicking a style item without a selection runs nothing", () => {
  const { orderedListStyleItems, editor, toolbar } = toolbarFixture();
  editor.selection = { from: 1, to: 1 };
  toolbar.render();

  orderedListStyleItems[3].dispatch("click");

  assert.equal(editor.runCommands.length, 0);
});

test("render closes an open menu once the trigger becomes disabled", () => {
  const { elements, editor, toolbar } = toolbarFixture();
  editor.document = orderedListDoc(["alpha"]);
  editor.selection = { from: 3, to: 8 };
  toolbar.render();
  elements["btnOrderedListStyle"].dispatch("click");
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), false);

  // 选区收回到光标：触发器禁用（aria-disabled），菜单随之收起。
  editor.selection = { from: 3, to: 3 };
  toolbar.render();

  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-disabled"), "true");
  assert.equal(elements["btnOrderedListStyle"].disabled, false);
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
});

test("no editor disables the style trigger and closes its menu", () => {
  const { elements, toolbar } = toolbarFixture({ getEditor: () => null });
  elements["orderedListStyleMenu"].classList.remove("hidden");

  toolbar.render();

  assert.equal(elements["btnOrderedListStyle"].disabled, true);
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
  assert.equal(elements["btnOrderedListStyle"].getAttribute("aria-expanded"), "false");
});

test("dispose stops the style flyout from opening and running commands", () => {
  const { elements, orderedListStyleItems, editor, toolbar } = toolbarFixture();
  editor.document = orderedListDoc(["alpha"]);
  editor.selection = { from: 3, to: 8 };
  toolbar.render();

  toolbar.dispose();
  elements["btnOrderedListStyle"].dispatch("click");
  orderedListStyleItems[3].dispatch("click");

  assert.equal(editor.runCommands.length, 0);
  assert.equal(elements["orderedListStyleMenu"].classList.contains("hidden"), true);
});
