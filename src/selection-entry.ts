import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { captureSelection, isMeaningfulSelection } from "./selection-adapter.ts";
import { sameSelectionSnapshot } from "./shared-storage-and-selection-identity.ts";
import type {
  RichTextEditorCoordinates,
  RichTextEditorSelection,
} from "./rich-text-editor.ts";
import type { SelectionSnapshot } from "./types.ts";

/** Selection entry trigger width (CSS px). */
export const SELECTION_ENTRY_TRIGGER_WIDTH_PX = 44;

/** Selection entry trigger height (CSS px). */
export const SELECTION_ENTRY_TRIGGER_HEIGHT_PX = 32;

/** Gap between the focus-end character and the trigger, and clamp inset. */
export const SELECTION_ENTRY_GAP_PX = 4;


export interface EntryVisibilityInput {
  /** 当前选区是否至少包含一个非空白字符。 */
  hasMeaningfulSelection: boolean;
  /** 编辑器选区焦点端是否位于当前内容视口内。 */
  focusEndVisible: boolean;
}

/**
 * 浮动入口是否应当显示。纯函数，便于在不依赖真实 DOM 几何的情况下测试显示/隐藏规则。
 */
export function decideSummonVisibility(input: EntryVisibilityInput): boolean {
  return input.hasMeaningfulSelection && input.focusEndVisible;
}

export type SelectionEntryActionKind = "summon";

export interface SelectionEntryAction {
  kind: SelectionEntryActionKind;
  label: string;
}

export interface SelectionEntryActionNode {
  id: string;
  textContent: string | null;
  type?: string;
}

export function decideSelectionEntryActions(input: EntryVisibilityInput): readonly SelectionEntryAction[] {
  if (!decideSummonVisibility(input)) {
    return [];
  }

  return [{ kind: "summon", label: "AI" }];
}

export function renderSelectionEntryActions<TNode extends SelectionEntryActionNode>(
  menu: { readonly children: ArrayLike<TNode> },
  actions: readonly SelectionEntryAction[],
  createButton: () => TNode,
): void {
  const domMenu = menu as unknown as {
    appendChild(child: TNode): unknown;
    removeChild(child: TNode): unknown;
  };

  for (const child of Array.from(menu.children)) {
    domMenu.removeChild(child);
  }

  for (const action of actions) {
    const button = createButton();
    button.id = "ai-summon-btn";
    button.type = "button";
    button.textContent = action.label;
    domMenu.appendChild(button);
  }
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
  const sideFitsVertically = centerTop >= editorTop && centerTop + triggerHeight <= editorBottom;
  const overlapsSelectionVertically = centerTop < selectionRect.bottom && centerTop + triggerHeight > selectionRect.top;

  const rightLeft = focusRect.right + gap;
  const rightFitsTrigger = rightLeft + triggerWidth + gap <= editorRight;
  const rightAvoidsSelection = rightLeft >= selectionRect.right + gap || !overlapsSelectionVertically;

  if (rightFitsTrigger && sideFitsVertically && rightAvoidsSelection) {
    return {
      left: rightLeft,
      top: clamp(centerTop, minTop, maxTop),
      mode: "right-of-focus",
    };
  }

  const leftLeft = focusRect.left - gap - triggerWidth;
  const leftFitsTrigger = leftLeft >= minLeft;
  const leftAvoidsSelection = leftLeft + triggerWidth <= selectionRect.left - gap || !overlapsSelectionVertically;

  if (leftFitsTrigger && sideFitsVertically && leftAvoidsSelection) {
    return {
      left: leftLeft,
      top: clamp(centerTop, minTop, maxTop),
      mode: "left-of-focus",
    };
  }

  const belowLeft = clamp(focusRect.left - triggerWidth, minLeft, maxLeft);
  const belowTop = selectionRect.bottom + gap;
  const belowFitsTrigger = belowTop + triggerHeight + gap <= editorBottom;

  if (belowFitsTrigger) {
    return {
      left: belowLeft,
      top: belowTop,
      mode: "below-line",
    };
  }

  const aboveTop = selectionRect.top - gap - triggerHeight;
  const aboveFitsTrigger = aboveTop >= minTop;

  if (aboveFitsTrigger) {
    return {
      left: clamp(focusRect.left - triggerWidth, minLeft, maxLeft),
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

export interface SelectionEntryEditor {
  readonly element: HTMLElement;
  getDocument(): JSONContent;
  getSelection(): RichTextEditorSelection;
  coordinatesAt(position: number): RichTextEditorCoordinates;
}

export interface SelectionEntryOptions {
  dom: AppDom;
  getCurrentDocumentId: () => string | null;
  getCurrentEditor: () => SelectionEntryEditor | null;
  isRequestInFlight: () => boolean;
  onSummon: (snapshot: SelectionSnapshot) => void;
}

/**
 * 浮动“召唤 AI”入口控制器。
 *
 * 以 selectionEnd 焦点端为锚点：选区至少含一个非空白字符且焦点端在内容视口内时显示；
 * 默认放在焦点端字符右侧，右侧空间不足时避让到该行下方靠右。点击触发器展开小菜单时
 * 锁定触发器锚点，不因菜单展开跳位。空白/空选区、点击别处、切换本子、焦点端滚出视区时隐藏。
 */
export function setupSelectionEntry(options: SelectionEntryOptions): SelectionEntryController {
  const {
    dom,
    getCurrentDocumentId,
    getCurrentEditor,
    isRequestInFlight,
    onSummon,
  } = options;
  const editorElements = [dom.editorTextarea];
  const editorEventTypes = ["mouseup", "keyup", "select", "focus", "click", "scroll", "input"] as const;
  const captureEditorEvents = true;

  // Some headless consumers construct only the panel DOM. In that mode the
  // optional floating entry has no mount point and remains inert.
  if (!dom.editorPage) {
    return { reset(): void {}, destroy(): void {} };
  }

  const entry = document.createElement("div");
  entry.id = "ai-selection-entry";
  entry.className = "ai-selection-entry hidden";
  dom.editorPage.appendChild(entry);

  const trigger = document.createElement("button");
  trigger.id = "ai-selection-entry-trigger";
  trigger.type = "button";
  trigger.textContent = "AI";
  entry.appendChild(trigger);

  // 最近一次召唤冻结的快照；在其存在期间抑制入口重现，直到用户形成新的不同选区。
  let frozen: SelectionSnapshot | null = null;
  let actionSnapshot: SelectionSnapshot | null = null;
  /** When true, skip repositioning so opening the menu cannot move the trigger anchor. */
  let pendingUpdateFrame: number | null = null;

  function hideEntry(): void {
    entry.classList.add("hidden");
    actionSnapshot = null;
  }

  function focusEndVisible(
    editor: SelectionEntryEditor,
    coordinates: RichTextEditorCoordinates,
  ): boolean {
    const rect = editor.element.getBoundingClientRect();
    // 坐标异常（NaN/Infinity）时兜底视为可见，避免误隐藏。
    if (!Number.isFinite(coordinates.top) || !Number.isFinite(coordinates.bottom)) {
      return true;
    }
    // 小容差：处理坐标亚像素偏差，避免边界字符被误判为不可见。
    const tolerance = 4;
    return (
      coordinates.top >= rect.top - tolerance &&
      coordinates.bottom <= rect.bottom + tolerance
    );
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
    editor: SelectionEntryEditor,
    selection: RichTextEditorSelection,
    focusCoordinates: RichTextEditorCoordinates,
  ): void {
    const rect = editor.element.getBoundingClientRect();
    const coordinates = new Map<number, RichTextEditorCoordinates>([
      [selection.head, focusCoordinates],
    ]);
    const coordinatesAt = (position: number): RichTextEditorCoordinates => {
      const cached = coordinates.get(position);
      if (cached) return cached;
      const measured = editor.coordinatesAt(position);
      coordinates.set(position, measured);
      return measured;
    };
    const startRect = coordinatesAt(selection.from);
    const endRect = coordinatesAt(selection.to);
    const placement = decideTriggerPlacement({
      editorLeft: rect.left,
      editorTop: rect.top,
      editorRight: rect.right,
      editorBottom: rect.bottom,
      focusRect: focusCoordinates,
      selectionRect: selectionRectFromCarets(startRect, endRect),
      triggerSize: {
        width: SELECTION_ENTRY_TRIGGER_WIDTH_PX,
        height: SELECTION_ENTRY_TRIGGER_HEIGHT_PX,
      },
      gap: SELECTION_ENTRY_GAP_PX,
    });
    entry.style.position = "fixed";
    entry.style.left = `${placement.left}px`;
    entry.style.top = `${placement.top}px`;
  }

  function update(): void {
    const editor = getCurrentEditor();
    if (editor === null) {
      hideEntry();
      return;
    }
    const selection = editor.getSelection();
    const documentId = getCurrentDocumentId();
    if (documentId === null) {
      hideEntry();
      return;
    }
    const snapshot = captureSelection(documentId, editor);

    // 召唤后抑制旧入口；只有形成与冻结快照不同的新选区才重新允许显示。
    if (frozen && snapshot && sameSelectionSnapshot(snapshot, frozen)) {
      hideEntry();
      return;
    }
    frozen = null;

    if (isRequestInFlight()) {
      hideEntry();
      return;
    }

    const focusCoordinates = snapshot !== null ? editor.coordinatesAt(selection.head) : null;
    const focusVisible = focusCoordinates !== null && focusEndVisible(editor, focusCoordinates);
    const actions = decideSelectionEntryActions({
      hasMeaningfulSelection: isMeaningfulSelection(snapshot),
      focusEndVisible: focusVisible,
    });
    if (actions.length > 0 && snapshot !== null && focusCoordinates !== null) {
      positionEntry(editor, selection, focusCoordinates);
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
    const editor = getCurrentEditor();
    if (editor === null || !editor.element.contains(document.activeElement)) return;
    scheduleUpdate();
  }

  function freezeAndRun(callback: (snapshot: SelectionSnapshot) => void): void {
    const snapshot = actionSnapshot;
    if (!isMeaningfulSelection(snapshot)) return;
    frozen = snapshot;
    hideEntry();
    callback(snapshot);
  }

  function handleEditorBlur(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget === entry ||
      nextTarget === trigger ||
      nextTarget === dom.btnToggleAi
    ) {
      return;
    }
    hideEntry();
  }

  function keepEditorSelectionVisible(event: MouseEvent): void {
    event.preventDefault();
  }

  trigger.addEventListener("mousedown", keepEditorSelectionVisible);
  trigger.addEventListener("click", () => freezeAndRun(onSummon));

  for (const element of editorElements) {
    for (const eventType of editorEventTypes) {
      element.addEventListener(eventType, scheduleUpdate, captureEditorEvents);
    }
    element.addEventListener("blur", handleEditorBlur, captureEditorEvents);
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
      for (const element of editorElements) {
        for (const eventType of editorEventTypes) {
          element.removeEventListener(eventType, scheduleUpdate, captureEditorEvents);
        }
        element.removeEventListener("blur", handleEditorBlur, captureEditorEvents);
      }
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
      entry.remove();
    },
  };
}
