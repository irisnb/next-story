import type { AppDom } from "./dom.ts";
import { captureSelection, isMeaningfulSelection, resolveFocusOffset } from "./selection-adapter.ts";
import { getCaretCoordinates } from "./caret-coordinates.ts";
import type { CaretCoordinates } from "./caret-coordinates.ts";
import type { NotebookTab, SelectionSnapshot } from "./types.ts";

/** Selection entry trigger width (CSS px). */
export const SELECTION_ENTRY_TRIGGER_WIDTH_PX = 44;

/** Selection entry trigger height (CSS px). */
export const SELECTION_ENTRY_TRIGGER_HEIGHT_PX = 32;

/** Gap between the focus-end character and the trigger, and clamp inset. */
export const SELECTION_ENTRY_GAP_PX = 4;

const SELECTION_ENTRY_MENU_WIDTH_PX = 160;
const SELECTION_ENTRY_MENU_HEIGHT_PX = 96;

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

export type TriggerPlacementMode = "right-of-focus" | "left-of-focus" | "below-line" | "above-line" | "clamped";

export interface PlacementRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PlacementSize {
  readonly width: number;
  readonly height: number;
}

export interface TriggerPlacementInput {
  readonly editorLeft: number;
  readonly editorTop: number;
  readonly editorRight: number;
  readonly editorBottom: number;
  readonly focusRect: PlacementRect;
  readonly selectionRect: PlacementRect;
  readonly triggerSize: PlacementSize;
  readonly menuSize: PlacementSize;
  readonly gap: number;
}

export interface TriggerPlacement {
  readonly left: number;
  readonly top: number;
  readonly mode: TriggerPlacementMode;
}

/**
 * Decide fixed-viewport coordinates for the selection-entry trigger.
 * Prefer the focus end, then choose an adjacent side that fits the trigger and future menu footprint.
 */
export function decideTriggerPlacement(input: TriggerPlacementInput): TriggerPlacement {
  const {
    editorLeft,
    editorTop,
    editorRight,
    editorBottom,
    focusRect,
    selectionRect,
    triggerSize,
    menuSize,
    gap,
  } = input;

  const triggerWidth = triggerSize.width;
  const triggerHeight = triggerSize.height;
  const minLeft = editorLeft + gap;
  const maxLeft = editorRight - triggerWidth - gap;
  const minTop = editorTop + gap;
  const maxTop = editorBottom - triggerHeight - gap;

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

  const centerTop = focusRect.top + ((focusRect.bottom - focusRect.top) - triggerHeight) / 2;
  const menuWidth = Math.max(menuSize.width, triggerWidth);
  const menuHeight = Math.max(menuSize.height, 0);
  const sideFitsVertically = centerTop >= editorTop && centerTop + triggerHeight <= editorBottom;
  const overlapsSelectionVertically = centerTop < selectionRect.bottom && centerTop + triggerHeight > selectionRect.top;

  const rightLeft = focusRect.right + gap;
  const rightFitsTrigger = rightLeft + triggerWidth + gap <= editorRight;
  const rightReservesMenu = rightLeft + menuWidth + gap <= editorRight;
  const rightAvoidsSelection = rightLeft >= selectionRect.right + gap || !overlapsSelectionVertically;

  if (rightFitsTrigger && rightReservesMenu && sideFitsVertically && rightAvoidsSelection) {
    return {
      left: rightLeft,
      top: clamp(centerTop, minTop, maxTop),
      mode: "right-of-focus",
    };
  }

  const leftLeft = focusRect.left - gap - triggerWidth;
  const leftFitsTrigger = leftLeft >= minLeft;
  const leftReservesMenu = leftLeft + triggerWidth - menuWidth >= minLeft;
  const leftAvoidsSelection = leftLeft + triggerWidth <= selectionRect.left - gap || !overlapsSelectionVertically;

  if (leftFitsTrigger && leftReservesMenu && sideFitsVertically && leftAvoidsSelection) {
    return {
      left: leftLeft,
      top: clamp(centerTop, minTop, maxTop),
      mode: "left-of-focus",
    };
  }

  const belowLeft = clamp(focusRect.left - triggerWidth, minLeft, maxLeft);
  const belowTop = selectionRect.bottom + gap;
  const belowFitsTrigger = belowTop + triggerHeight + gap <= editorBottom;
  const belowReservesMenu = belowTop + triggerHeight + menuHeight + gap <= editorBottom;

  if (belowFitsTrigger && belowReservesMenu) {
    return {
      left: clamp(Math.min(belowLeft, editorRight - menuWidth - gap), minLeft, maxLeft),
      top: belowTop,
      mode: "below-line",
    };
  }

  const aboveTop = selectionRect.top - gap - triggerHeight;
  const aboveFitsTrigger = aboveTop >= minTop;

  if (aboveFitsTrigger) {
    return {
      left: clamp(Math.min(focusRect.left - triggerWidth, editorRight - menuWidth - gap), minLeft, maxLeft),
      top: aboveTop,
      mode: "above-line",
    };
  }

  return {
    left: clamp(focusRect.left, minLeft, maxLeft),
    top: clamp(focusRect.bottom + gap, minTop, maxTop),
    mode: "clamped",
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
  measureCaret?: (textarea: HTMLTextAreaElement, position: number) => CaretCoordinates;
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
  const measureCaret = options.measureCaret ?? getCaretCoordinates;
  const textareas = [dom.draftTextarea, dom.mainTextarea];
  const textareaEventTypes = ["mouseup", "keyup", "select", "focus", "click", "scroll", "input"] as const;

  const entry = document.createElement("div");
  entry.id = "ai-selection-entry";
  entry.className = "ai-selection-entry hidden";
  dom.editorPage.appendChild(entry);

  const trigger = document.createElement("button");
  trigger.id = "ai-selection-entry-trigger";
  trigger.type = "button";
  trigger.textContent = "AI";
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
  let actionSnapshot: SelectionSnapshot | null = null;
  /** When true, skip repositioning so opening the menu cannot move the trigger anchor. */
  let menuOpen = false;
  let pendingUpdateFrame: number | null = null;

  function closeMenu(): void {
    menu.classList.add("hidden");
    entry.classList.remove("menu-open");
    menuOpen = false;
  }

  function hideEntry(): void {
    entry.classList.add("hidden");
    closeMenu();
    actionSnapshot = null;
  }

  function activeTextarea(): HTMLTextAreaElement {
    return textareas.find((t) => !t.classList.contains("hidden")) ?? textareas[0];
  }

  function focusEndVisible(
    textarea: HTMLTextAreaElement,
    caret: CaretCoordinates,
  ): boolean {
    const rect = textarea.getBoundingClientRect();
    const caretTop = rect.top + caret.top;
    const caretBottom = caretTop + caret.height;
    return caretTop >= rect.top && caretBottom <= rect.bottom;
  }

  function toViewportCaretRect(
    textareaRect: Pick<DOMRect, "left" | "top">,
    caret: CaretCoordinates,
  ): PlacementRect {
    const left = textareaRect.left + caret.left;
    const top = textareaRect.top + caret.top;
    return {
      left,
      top,
      right: left + 1,
      bottom: top + caret.height,
    };
  }

  function selectionRectFromCarets(
    startRect: PlacementRect,
    endRect: PlacementRect,
  ): PlacementRect {
    return {
      left: Math.min(startRect.left, endRect.left),
      top: Math.min(startRect.top, endRect.top),
      right: Math.max(startRect.right, endRect.right),
      bottom: Math.max(startRect.bottom, endRect.bottom),
    };
  }

  function positionEntry(
    textarea: HTMLTextAreaElement,
    snapshot: SelectionSnapshot,
    focusOffset: number,
    focusCaret: CaretCoordinates,
  ): void {
    const rect = textarea.getBoundingClientRect();
    const carets = new Map<number, CaretCoordinates>([[focusOffset, focusCaret]]);
    const caretAt = (offset: number): CaretCoordinates => {
      const cached = carets.get(offset);
      if (cached) return cached;
      const measured = measureCaret(textarea, offset);
      carets.set(offset, measured);
      return measured;
    };
    const startRect = toViewportCaretRect(rect, caretAt(snapshot.start));
    const endRect = toViewportCaretRect(rect, caretAt(snapshot.end));
    const placement = decideTriggerPlacement({
      editorLeft: rect.left,
      editorTop: rect.top,
      editorRight: rect.right,
      editorBottom: rect.bottom,
      focusRect: toViewportCaretRect(rect, focusCaret),
      selectionRect: selectionRectFromCarets(startRect, endRect),
      triggerSize: {
        width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
        height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
      },
      menuSize: {
        width: SELECTION_ENTRY_MENU_WIDTH_PX,
        height: SELECTION_ENTRY_MENU_HEIGHT_PX,
      },
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

    const focusOffset = resolveFocusOffset(textarea);
    const focusCaret = snapshot !== null ? measureCaret(textarea, focusOffset) : null;
    const focusVisible = focusCaret !== null && focusEndVisible(textarea, focusCaret);
    const shouldShow = decideSummonVisibility({
      hasMeaningfulSelection: isMeaningfulSelection(snapshot),
      focusEndVisible: focusVisible,
    });
    if (shouldShow && snapshot !== null && focusCaret !== null) {
      // Keep the locked anchor while the secondary menu is open (click may blur/focus and re-fire update).
      if (!menuOpen) {
        positionEntry(textarea, snapshot, focusOffset, focusCaret);
      }
      actionSnapshot = snapshot;
      entry.classList.remove("hidden");
    } else {
      hideEntry();
    }
  }

  function cancelScheduledUpdate(): void {
    if (pendingUpdateFrame === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(pendingUpdateFrame);
    }
    pendingUpdateFrame = null;
  }

  function runScheduledUpdate(): void {
    pendingUpdateFrame = null;
    update();
  }

  function scheduleUpdate(): void {
    if (pendingUpdateFrame !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      update();
      return;
    }
    pendingUpdateFrame = requestAnimationFrame(runScheduledUpdate);
  }

  function handleDocumentSelectionChange(): void {
    if (document.activeElement !== activeTextarea()) return;
    scheduleUpdate();
  }

  function freezeAndRun(callback: (snapshot: SelectionSnapshot) => void): void {
    const snapshot = actionSnapshot;
    if (!isMeaningfulSelection(snapshot)) return;
    frozen = snapshot;
    hideEntry();
    callback(snapshot);
  }

  function handleTextareaBlur(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget === entry ||
      nextTarget === trigger ||
      nextTarget === menu ||
      nextTarget === summonButton ||
      nextTarget === thinkingButton
    ) {
      return;
    }
    hideEntry();
  }

  function keepTextareaSelectionVisible(event: MouseEvent): void {
    event.preventDefault();
  }

  trigger.addEventListener("mousedown", keepTextareaSelectionVisible);
  trigger.addEventListener("click", () => {
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      entry.classList.add("menu-open");
      menuOpen = true;
    } else {
      closeMenu();
    }
  });
  summonButton.addEventListener("mousedown", keepTextareaSelectionVisible);
  thinkingButton.addEventListener("mousedown", keepTextareaSelectionVisible);
  summonButton.addEventListener("click", () => { freezeAndRun(onSummon); });
  thinkingButton.addEventListener("click", () => { freezeAndRun(onThinkingExpansion); });

  for (const textarea of textareas) {
    for (const eventType of textareaEventTypes) {
      textarea.addEventListener(eventType, scheduleUpdate);
    }
    textarea.addEventListener("blur", handleTextareaBlur);
  }
  document.addEventListener("selectionchange", handleDocumentSelectionChange);

 	return {
    reset(): void {
      frozen = null;
      cancelScheduledUpdate();
      hideEntry();
    },
    destroy(): void {
      cancelScheduledUpdate();
      for (const textarea of textareas) {
        for (const eventType of textareaEventTypes) {
          textarea.removeEventListener(eventType, scheduleUpdate);
        }
        textarea.removeEventListener("blur", handleTextareaBlur);
      }
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
      entry.remove();
    },
  };
}
