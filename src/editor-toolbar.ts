// 工具栏与格式抽屉：格式命令按钮、段落样式、格式抽屉开关/折叠/自动隐藏、
// 留白预设档位与持久化。只依赖工具栏/抽屉 DOM 节点与编辑器窄能力
// （getSelection/getDocument/runCommand/canUndo/canRedo），不依赖完整编辑器控制器。

import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { analyzeSelection, type FormatCommand, type TriState } from "./format-commands.ts";
import { canonicalDoc } from "./structured-notebook.ts";
import {
  DEFAULT_MARGIN_PRESET,
  nextMarginPreset,
  readMarginPreset,
  writeMarginPreset,
  type MarginPreset,
} from "./editor-margin.ts";
import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

const MARGIN_LABELS: Record<MarginPreset, string> = {
  compact: "紧凑",
  standard: "标准",
  loose: "宽松",
};

const DRAWER_CLOSE_DELAY_MS = 350;

/** 工具栏模块所需的编辑器窄能力。 */
export interface ToolbarEditorCapabilities {
  getSelection(): { from: number; to: number };
  getDocument(): JSONContent;
  runCommand(command: FormatCommand): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface EditorToolbarDeps {
  dom: Pick<
    AppDom,
    | "paragraphStyle"
    | "btnBold"
    | "btnItalic"
    | "btnToolbarUnderline"
    | "btnToolbarStrike"
    | "btnBulletList"
    | "btnOrderedList"
    | "btnUndo"
    | "btnRedo"
    | "btnMargin"
    | "editorPage"
    | "btnFormatDrawer"
    | "formatDrawer"
    | "btnFormatDrawerClose"
    | "btnToggleCharacterSection"
    | "btnToggleParagraphSection"
    | "btnUnderline"
    | "btnStrike"
    | "selectFontFamily"
    | "selectFontSize"
    | "inputTextColor"
    | "btnClearTextColor"
    | "inputHighlight"
    | "btnClearHighlight"
    | "btnClearCharacterFormat"
    | "btnAlignLeft"
    | "btnAlignCenter"
    | "btnAlignRight"
    | "btnAlignJustify"
    | "selectLineHeight"
    | "selectSpacingBefore"
    | "selectSpacingAfter"
    | "selectTextIndent"
    | "selectIndentLeft"
    | "selectIndentRight"
    | "btnClearParagraphFormat"
  >;
  /** 返回当前编辑器窄能力；无编辑器时为 null。 */
  getEditor(): ToolbarEditorCapabilities | null;
  /** 留白偏好存储；null 时回退默认档位且不持久化。 */
  marginStorage: StorageLike | null;
}

export interface EditorToolbar {
  /** 根据当前选区与文档刷新全部工具栏/抽屉控件状态。 */
  render(): void;
  /** 执行格式命令并刷新工具栏；无编辑器时返回 false。 */
  runFormatCommand(command: FormatCommand): boolean;
  /** 仅当存在文字选区时执行格式命令。 */
  runSelectionCommand(command: FormatCommand): void;
  /** 移除全部监听并清理抽屉自动隐藏定时器。 */
  dispose(): void;
}

export function createEditorToolbar(deps: EditorToolbarDeps): EditorToolbar {
  const { dom } = deps;
  let marginPreset: MarginPreset = DEFAULT_MARGIN_PRESET;
  let drawerCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup: Array<() => void> = [];

  function bind(element: HTMLElement, type: string, listener: () => void): void {
    element.addEventListener(type, listener);
    cleanup.push(() => element.removeEventListener(type, listener));
  }

  function pressedValue(state: TriState): string {
    return state === "on" ? "true" : state === "off" ? "false" : "mixed";
  }

  /** 抽屉下拉的显示值：多种→"mixed" 占位项（禁用、仅程序选中），无→""（默认/无），统一值→原值。 */
  function drawerSelectValue(state: string | null | "mixed"): string {
    return state === "mixed" ? "mixed" : state ?? "";
  }

  // 抽屉内所有格式控件：无文字选区时整体禁用。
  const drawerControls: Array<HTMLButtonElement | HTMLSelectElement | HTMLInputElement> = [
    dom.btnUnderline,
    dom.btnStrike,
    dom.selectFontFamily,
    dom.selectFontSize,
    dom.inputTextColor,
    dom.btnClearTextColor,
    dom.inputHighlight,
    dom.btnClearHighlight,
    dom.btnClearCharacterFormat,
    dom.btnAlignLeft,
    dom.btnAlignCenter,
    dom.btnAlignRight,
    dom.btnAlignJustify,
    dom.selectLineHeight,
    dom.selectSpacingBefore,
    dom.selectSpacingAfter,
    dom.selectTextIndent,
    dom.selectIndentLeft,
    dom.selectIndentRight,
    dom.btnClearParagraphFormat,
  ];

  function disableToolbarControls(): void {
    dom.paragraphStyle.disabled = true;
    dom.btnBold.disabled = true;
    dom.btnItalic.disabled = true;
    dom.btnToolbarUnderline.disabled = true;
    dom.btnToolbarStrike.disabled = true;
    dom.btnBulletList.disabled = true;
    dom.btnOrderedList.disabled = true;
    dom.btnUndo.disabled = true;
    dom.btnRedo.disabled = true;
    for (const control of drawerControls) control.disabled = true;
  }

  function render(): void {
    const current = deps.getEditor();
    if (!current) {
      disableToolbarControls();
      return;
    }
    const selection = current.getSelection();
    const hasSelection = selection.from < selection.to;
    const format = analyzeSelection(
      canonicalDoc(current.getDocument()),
      selection.from,
      selection.to,
    );
    const canUndo = current.canUndo();
    const canRedo = current.canRedo();

    dom.paragraphStyle.value =
      format.paragraphStyle === "mixed" ? "" : format.paragraphStyle;
    dom.btnBold.setAttribute("aria-pressed", pressedValue(format.bold));
    dom.btnItalic.setAttribute("aria-pressed", pressedValue(format.italic));
    dom.btnToolbarUnderline.setAttribute("aria-pressed", pressedValue(format.underline));
    dom.btnToolbarStrike.setAttribute("aria-pressed", pressedValue(format.strike));
    dom.btnBulletList.setAttribute("aria-pressed", format.list === "bullet" ? "true" : "false");
    dom.btnOrderedList.setAttribute("aria-pressed", format.list === "ordered" ? "true" : "false");

    // 格式抽屉：字符格式
    dom.btnUnderline.setAttribute("aria-pressed", pressedValue(format.underline));
    dom.btnStrike.setAttribute("aria-pressed", pressedValue(format.strike));
    dom.selectFontFamily.value = drawerSelectValue(format.fontFamily);
    dom.selectFontSize.value = drawerSelectValue(format.fontSize);
    dom.inputTextColor.value =
      format.textColor !== null && format.textColor !== "mixed" ? format.textColor : "#000000";
    dom.inputHighlight.value =
      format.highlight !== null && format.highlight !== "mixed" ? format.highlight : "#ffffff";

    // 格式抽屉：段落格式（对齐无属性时按左对齐，与 analyzeSelection 一致）
    dom.btnAlignLeft.setAttribute("aria-pressed", format.textAlign === "left" ? "true" : "false");
    dom.btnAlignCenter.setAttribute("aria-pressed", format.textAlign === "center" ? "true" : "false");
    dom.btnAlignRight.setAttribute("aria-pressed", format.textAlign === "right" ? "true" : "false");
    dom.btnAlignJustify.setAttribute("aria-pressed", format.textAlign === "justify" ? "true" : "false");
    dom.selectLineHeight.value = drawerSelectValue(format.lineHeight);
    dom.selectSpacingBefore.value = drawerSelectValue(format.spacingBefore);
    dom.selectSpacingAfter.value = drawerSelectValue(format.spacingAfter);
    dom.selectTextIndent.value = drawerSelectValue(format.textIndent);
    dom.selectIndentLeft.value = drawerSelectValue(format.indentLeft);
    dom.selectIndentRight.value = drawerSelectValue(format.indentRight);

    dom.paragraphStyle.disabled = !hasSelection;
    dom.btnBold.disabled = !hasSelection;
    dom.btnItalic.disabled = !hasSelection;
    dom.btnToolbarUnderline.disabled = !hasSelection;
    dom.btnToolbarStrike.disabled = !hasSelection;
    dom.btnBulletList.disabled = !hasSelection;
    dom.btnOrderedList.disabled = !hasSelection;
    dom.btnUndo.disabled = !canUndo;
    dom.btnRedo.disabled = !canRedo;
    for (const control of drawerControls) control.disabled = !hasSelection;
  }

  function runFormatCommand(command: FormatCommand): boolean {
    const current = deps.getEditor();
    if (!current) return false;
    const result = current.runCommand(command);
    render();
    return result;
  }

  function hasSelection(): boolean {
    const current = deps.getEditor();
    if (!current) return false;
    const selection = current.getSelection();
    return selection.from < selection.to;
  }

  function runSelectionCommand(command: FormatCommand): void {
    if (hasSelection()) runFormatCommand(command);
  }

  function setFormatDrawerOpen(open: boolean): void {
    dom.formatDrawer.classList.toggle("open", open);
    dom.formatDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    dom.btnFormatDrawer.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---- 工具栏命令 ----

  bind(dom.btnBold, "click", () => runSelectionCommand({ kind: "bold" }));
  bind(dom.btnItalic, "click", () => runSelectionCommand({ kind: "italic" }));
  bind(dom.btnToolbarUnderline, "click", () => runSelectionCommand({ kind: "underline" }));
  bind(dom.btnToolbarStrike, "click", () => runSelectionCommand({ kind: "strike" }));
  bind(dom.btnBulletList, "click", () => runSelectionCommand({ kind: "bulletList" }));
  bind(dom.btnOrderedList, "click", () => runSelectionCommand({ kind: "orderedList" }));
  bind(dom.btnUndo, "click", () => runFormatCommand({ kind: "undo" }));
  bind(dom.btnRedo, "click", () => runFormatCommand({ kind: "redo" }));
  bind(dom.paragraphStyle, "change", () => {
    if (!hasSelection()) return;
    const value = dom.paragraphStyle.value;
    if (value.startsWith("heading")) {
      const level = Number(value.slice("heading".length));
      if (level >= 1 && level <= 6) {
        runFormatCommand({ kind: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6 });
      }
    } else {
      runFormatCommand({ kind: "paragraph" });
    }
  });

  // ---- 格式抽屉 ----

  bind(dom.btnFormatDrawer, "click", () => {
    setFormatDrawerOpen(!dom.formatDrawer.classList.contains("open"));
  });
  bind(dom.btnFormatDrawerClose, "click", () => setFormatDrawerOpen(false));

  // 抽屉折叠（disclosure）
  function setupDrawerToggle(button: HTMLButtonElement): void {
    bind(button, "click", () => {
      const group = button.closest(".drawer-group");
      if (!group) return;
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }
  setupDrawerToggle(dom.btnToggleCharacterSection);
  setupDrawerToggle(dom.btnToggleParagraphSection);

  // 抽屉自动隐藏
  bind(dom.formatDrawer, "mouseleave", () => {
    if (typeof window === "undefined") return;
    if (drawerCloseTimer !== null) clearTimeout(drawerCloseTimer);
    drawerCloseTimer = setTimeout(() => {
      drawerCloseTimer = null;
      setFormatDrawerOpen(false);
    }, DRAWER_CLOSE_DELAY_MS);
  });
  bind(dom.formatDrawer, "mouseenter", () => {
    if (drawerCloseTimer !== null) {
      clearTimeout(drawerCloseTimer);
      drawerCloseTimer = null;
    }
  });

  // ---- 留白（显示偏好，持久化到共享存储适配，缺失回退默认档） ----

  function applyMarginPreset(preset: MarginPreset): void {
    marginPreset = preset;
    dom.editorPage.setAttribute("data-margin", preset);
    dom.btnMargin.textContent = MARGIN_LABELS[preset];
  }

  applyMarginPreset(deps.marginStorage ? readMarginPreset(deps.marginStorage) : DEFAULT_MARGIN_PRESET);

  bind(dom.btnMargin, "click", () => {
    const next = nextMarginPreset(marginPreset);
    applyMarginPreset(next);
    if (deps.marginStorage) writeMarginPreset(deps.marginStorage, next);
  });

  // ---- 抽屉：字符格式 ----

  bind(dom.btnUnderline, "click", () => runSelectionCommand({ kind: "underline" }));
  bind(dom.btnStrike, "click", () => runSelectionCommand({ kind: "strike" }));
  bind(dom.selectFontFamily, "change", () => {
    runSelectionCommand({ kind: "fontFamily", font: dom.selectFontFamily.value || null });
  });
  bind(dom.selectFontSize, "change", () => {
    runSelectionCommand({ kind: "fontSize", size: dom.selectFontSize.value || null });
  });
  bind(dom.inputTextColor, "change", () => {
    runSelectionCommand({ kind: "textColor", color: dom.inputTextColor.value });
  });
  bind(dom.btnClearTextColor, "click", () => {
    runSelectionCommand({ kind: "textColor", color: null });
  });
  bind(dom.inputHighlight, "change", () => {
    runSelectionCommand({ kind: "highlight", color: dom.inputHighlight.value });
  });
  bind(dom.btnClearHighlight, "click", () => {
    runSelectionCommand({ kind: "highlight", color: null });
  });
  bind(dom.btnClearCharacterFormat, "click", () => {
    runSelectionCommand({ kind: "clearCharacterFormat" });
  });

  // ---- 抽屉：段落格式 ----

  bind(dom.btnAlignLeft, "click", () => runSelectionCommand({ kind: "textAlign", align: "left" }));
  bind(dom.btnAlignCenter, "click", () => runSelectionCommand({ kind: "textAlign", align: "center" }));
  bind(dom.btnAlignRight, "click", () => runSelectionCommand({ kind: "textAlign", align: "right" }));
  bind(dom.btnAlignJustify, "click", () => runSelectionCommand({ kind: "textAlign", align: "justify" }));
  bind(dom.selectLineHeight, "change", () => {
    runSelectionCommand({ kind: "lineHeight", value: dom.selectLineHeight.value || null });
  });
  bind(dom.selectSpacingBefore, "change", () => {
    runSelectionCommand({ kind: "spacingBefore", value: dom.selectSpacingBefore.value || null });
  });
  bind(dom.selectSpacingAfter, "change", () => {
    runSelectionCommand({ kind: "spacingAfter", value: dom.selectSpacingAfter.value || null });
  });
  bind(dom.selectTextIndent, "change", () => {
    runSelectionCommand({ kind: "textIndent", value: dom.selectTextIndent.value || null });
  });
  bind(dom.selectIndentLeft, "change", () => {
    runSelectionCommand({ kind: "indentLeft", value: dom.selectIndentLeft.value || null });
  });
  bind(dom.selectIndentRight, "change", () => {
    runSelectionCommand({ kind: "indentRight", value: dom.selectIndentRight.value || null });
  });
  bind(dom.btnClearParagraphFormat, "click", () => {
    runSelectionCommand({ kind: "clearParagraphFormat" });
  });

  return {
    render,
    runFormatCommand,
    runSelectionCommand,
    dispose: () => {
      for (const remove of cleanup) remove();
      if (drawerCloseTimer !== null) {
        clearTimeout(drawerCloseTimer);
        drawerCloseTimer = null;
      }
    },
  };
}