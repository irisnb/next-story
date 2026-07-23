import type { AppDom } from "./dom.ts";
import { captureSelection, isMeaningfulSelection } from "./selection-adapter.ts";
import { getCaretCoordinates } from "./caret-coordinates.ts";
import type { NotebookTab, SelectionSnapshot } from "./types.ts";

/** Outer circle diameter for the selection entry trigger (CSS px). */
export const SELECTION_ENTRY_TRIGGER_SIZE_PX = 18;

/** Gap between the focus-end character and the trigger, and clamp inset. */
export const SELECTION_ENTRY_GAP_PX = 4;

export interface EntryVisibilityInput {
  /** 当前选区是否至少包含一个非空白字符。 */
  hasMeaningfulSelection: boolean;
  /** 选区焦点端（selectionEnd）是否位于 textarea 内容视口内。 */
  focusEndVisible: boolean;
}

/**
 * 浮动入口是否应当显示。纯函数，便于在不依赖真实 DOM 几何的情况下测试显示/隐藏规则。
 */
export function decideSummonVisibility(input: EntryVisibilityInput): boolean {
  return input.hasMeaningfulSelection && input.focusEndVisible;
}

export type SelectionEntryActionKind = "summon" | "thinking_expansion";

export interface SelectionEntryAction {
  kind: SelectionEntryActionKind;
  label: string;
}

export function decideSelectionEntryActions(input: EntryVisibilityInput): readonly SelectionEntryAction[] {
  if (!decideSummonVisibility(input)) {
    return [];
  }

  return [
    { kind: "summon", label: "及时召唤" },
    { kind: "thinking_expansion", label: "思维扩展" },
  ];
}

export function isSameSummonedSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return (
    a.notebook === b.notebook &&
    a.start === b.start &&
    a.end === b.end &&
    a.selectedText === b.selectedText
  );
}

export type TriggerPlacementMode = "right-of-focus" | "below-line";

export interface TriggerPlacementInput {
  editorLeft: number;
  editorTop: number;
  editorRight: number;
  editorBottom: number;
  /** Caret left relative to the textarea content box (scroll-adjusted). */
  caretLeft: number;
  /** Caret top relative to the textarea content box (scroll-adjusted). */
  caretTop: number;
  caretHeight: number;
  triggerSize: number;
  gap: number;
}

export interface TriggerPlacement {
  left: number;
  top: number;
  mode: TriggerPlacementMode;
}

/**
 * Decide fixed-viewport coordinates for the selection-entry trigger.
 * Prefer right of the focus end; fall back below the line near the right edge when space is tight.
 */
export function decideTriggerPlacement(input: TriggerPlacementInput): TriggerPlacement {
  const {
    editorLeft,
    editorTop,
    editorRight,
    editorBottom,
    caretLeft,
    caretTop,
    caretHeight,
    triggerSize,
    gap,
  } = input;

  const minLeft = editorLeft + gap;
  const maxLeft = editorRight - triggerSize - gap;
  const minTop = editorTop + gap;
  const maxTop = editorBottom - triggerSize - gap;

  const clamp = (value: number, min: number, max: number): number => {
    if (max < min) {
      return min;
    }
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  };

  const rightLeft = editorLeft + caretLeft + gap;
  const rightTop = editorTop + caretTop + (caretHeight - triggerSize) / 2;
  const fitsRight =
    rightLeft + triggerSize + gap <= editorRight &&
    rightTop >= editorTop &&
    rightTop + triggerSize <= editorBottom;

  if (fitsRight) {
    return {
      left: rightLeft,
      top: clamp(rightTop, minTop, maxTop),
      mode: "right-of-focus",
    };
  }

  // Below the selected line, horizontally near the focus-end right edge (clamped to bounds).
  const belowLeft = clamp(editorLeft + caretLeft - triggerSize, minLeft, maxLeft);
  const belowTop = editorTop + caretTop + caretHeight + gap;

  return {
    left: belowLeft,
    top: clamp(belowTop, minTop, maxTop),
    mode: "below-line",
  };
}

export interface SelectionEntryController {
  reset(): void;
  destroy(): void;
}

export interface SelectionEntryOptions {
  dom: AppDom;
  getCurrentNotebook: () => NotebookTab;
  isRequestInFlight: () => boolean;
  onSummon: (snapshot: SelectionSnapshot) => void;
  onThinkingExpansion: (snapshot: SelectionSnapshot) => void;
}

/**
 * 浮动“召唤 AI”入口控制器。
 *
 * 以 selectionEnd 焦点端为锚点：选区至少含一个非空白字符且焦点端在内容视口内时显示；
 * 默认放在焦点端字符右侧，右侧空间不足时避让到该行下方靠右。点击触发器展开小菜单时
 * 锁定触发器锚点，不因菜单展开跳位。空白/空选区、点击别处、切换本子、焦点端滚出视区时隐藏。
 */
export function setupSelectionEntry(options: SelectionEntryOptions): SelectionEntryController {
  const { dom, getCurrentNotebook, isRequestInFlight, onSummon, onThinkingExpansion } = options;
  const textareas = [dom.draftTextarea, dom.mainTextarea];
  const textareaEventTypes = ["mouseup", "keyup", "select", "focus", "click", "scroll", "input"] as const;

  const entry = document.createElement("div");
  entry.id = "ai-selection-entry";
  entry.className = "ai-selection-entry hidden";
  dom.editorPage.appendChild(entry);

  const trigger = document.createElement("button");
  trigger.id = "ai-selection-entry-trigger";
  trigger.type = "button";
  trigger.textContent = "";
  entry.appendChild(trigger);

  const menu = document.createElement("div");
  menu.id = "ai-selection-entry-menu";
  menu.className = "hidden";
  entry.appendChild(menu);

  const summonButton = document.createElement("button");
  summonButton.id = "ai-summon-btn";
  summonButton.type = "button";
  summonButton.textContent = "及时召唤";
  menu.appendChild(summonButton);

  const thinkingButton = document.createElement("button");
  thinkingButton.id = "ai-thinking-expansion-btn";
  thinkingButton.type = "button";
  thinkingButton.textContent = "思维扩展";
  menu.appendChild(thinkingButton);

  // 最近一次召唤冻结的快照；在其存在期间抑制入口重现，直到用户形成新的不同选区。
  let frozen: SelectionSnapshot | null = null;
  /** When true, skip repositioning so opening the menu cannot move the trigger anchor. */
  let menuOpen = false;

  function closeMenu(): void {
    menu.classList.add("hidden");
    entry.classList.remove("menu-open");
    menuOpen = false;
  }

  function hideEntry(): void {
    entry.classList.add("hidden");
    closeMenu();
  }

  function activeTextarea(): HTMLTextAreaElement {
    return textareas.find((t) => !t.classList.contains("hidden")) ?? textareas[0];
  }

  function focusEndVisible(textarea: HTMLTextAreaElement, position: number): boolean {
    const rect = textarea.getBoundingClientRect();
    const caret = getCaretCoordinates(textarea, position);
    const caretTop = rect.top + caret.top;
    const caretBottom = caretTop + caret.height;
    return caretTop >= rect.top && caretBottom <= rect.bottom;
  }

  function positionEntry(textarea: HTMLTextAreaElement, position: number): void {
    const rect = textarea.getBoundingClientRect();
    const caret = getCaretCoordinates(textarea, position);
    const placement = decideTriggerPlacement({
      editorLeft: rect.left,
      editorTop: rect.top,
      editorRight: rect.right,
      editorBottom: rect.bottom,
      caretLeft: caret.left,
      caretTop: caret.top,
      caretHeight: caret.height,
      triggerSize: SELECTION_ENTRY_TRIGGER_SIZE_PX,
      gap: SELECTION_ENTRY_GAP_PX,
    });
    entry.style.position = "fixed";
    entry.style.left = `${placement.left}px`;
    entry.style.top = `${placement.top}px`;
  }

  function update(): void {
    const textarea = activeTextarea();
    const snapshot = captureSelection(getCurrentNotebook(), textarea);

    // 召唤后抑制旧入口；只有形成与冻结快照不同的新选区才重新允许显示。
    if (frozen && snapshot && isSameSummonedSelection(snapshot, frozen)) {
      hideEntry();
      return;
    }
    frozen = null;

    if (isRequestInFlight()) {
      hideEntry();
      return;
    }

    const focusVisible = snapshot !== null && focusEndVisible(textarea, snapshot.end);
    const shouldShow = decideSummonVisibility({
      hasMeaningfulSelection: isMeaningfulSelection(snapshot),
      focusEndVisible: focusVisible,
    });
    if (shouldShow && snapshot !== null) {
      // Keep the locked anchor while the secondary menu is open (click may blur/focus and re-fire update).
      if (!menuOpen) {
        positionEntry(textarea, snapshot.end);
      }
      entry.classList.remove("hidden");
    } else {
      hideEntry();
    }
  }

  function freezeAndRun(callback: (snapshot: SelectionSnapshot) => void): void {
    const textarea = activeTextarea();
    const snapshot = captureSelection(getCurrentNotebook(), textarea);
    if (!isMeaningfulSelection(snapshot)) return;
    frozen = snapshot;
    hideEntry();
    callback(snapshot);
  }

  trigger.addEventListener("click", () => {
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      entry.classList.add("menu-open");
      menuOpen = true;
    } else {
      closeMenu();
    }
  });
  summonButton.addEventListener("click", () => { freezeAndRun(onSummon); });
  thinkingButton.addEventListener("click", () => { freezeAndRun(onThinkingExpansion); });

  for (const textarea of textareas) {
    for (const eventType of textareaEventTypes) {
      textarea.addEventListener(eventType, update);
    }
  }
  document.addEventListener("selectionchange", update);

  return {
    reset(): void {
      frozen = null;
      hideEntry();
    },
    destroy(): void {
      for (const textarea of textareas) {
        for (const eventType of textareaEventTypes) {
          textarea.removeEventListener(eventType, update);
        }
      }
      document.removeEventListener("selectionchange", update);
      entry.remove();
    },
  };
}
