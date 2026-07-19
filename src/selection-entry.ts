import type { AppDom } from "./dom.ts";
import { captureSelection, isMeaningfulSelection, tabToNotebookKind } from "./selection-adapter.ts";
import { getCaretCoordinates } from "./caret-coordinates.ts";
import type { NotebookTab, SelectionSnapshot } from "./types.ts";

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

export function isSameSummonedSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  return (
    a.notebook === b.notebook &&
    a.start === b.start &&
    a.end === b.end &&
    a.selectedText === b.selectedText
  );
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
}

/**
 * 浮动“召唤 AI”入口控制器。
 *
 * 以 selectionEnd 焦点端为锚点：选区至少含一个非空白字符且焦点端在内容视口内时显示；
 * 空白/空选区、点击别处、切换本子、焦点端滚出视区时隐藏。点击后冻结快照、隐藏入口，
 * 旧入口不会因面板展开/收起自动重现，必须形成新的有效选区才会再次触发。
 */
export function setupSelectionEntry(options: SelectionEntryOptions): SelectionEntryController {
  const { dom, getCurrentNotebook, isRequestInFlight, onSummon } = options;
  const textareas = [dom.draftTextarea, dom.mainTextarea];

  const button = document.createElement("button");
  button.id = "ai-summon-btn";
  button.type = "button";
  button.className = "ai-summon-btn hidden";
  button.textContent = "召唤 AI";
  dom.editorPage.appendChild(button);

  // 最近一次召唤冻结的快照；在其存在期间抑制入口重现，直到用户形成新的不同选区。
  let frozen: SelectionSnapshot | null = null;

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

  function positionButton(textarea: HTMLTextAreaElement, position: number): void {
    const rect = textarea.getBoundingClientRect();
    const caret = getCaretCoordinates(textarea, position);
    button.style.position = "fixed";
    button.style.left = `${rect.left + caret.left}px`;
    button.style.top = `${rect.top + caret.top + caret.height + 4}px`;
  }

  function update(): void {
    const textarea = activeTextarea();
    const snapshot = captureSelection(tabToNotebookKind(getCurrentNotebook()), textarea);

    // 召唤后抑制旧入口；只有形成与冻结快照不同的新选区才重新允许显示。
    if (frozen && snapshot && isSameSummonedSelection(snapshot, frozen)) {
      button.classList.add("hidden");
      return;
    }
    frozen = null;

    if (isRequestInFlight()) {
      button.classList.add("hidden");
      return;
    }

    const visible = snapshot !== null && focusEndVisible(textarea, snapshot.end);
    if (decideSummonVisibility({ hasMeaningfulSelection: isMeaningfulSelection(snapshot), focusEndVisible: visible })) {
      positionButton(textarea, snapshot!.end);
      button.classList.remove("hidden");
    } else {
      button.classList.add("hidden");
    }
  }

  function handleSummonClick(): void {
    const textarea = activeTextarea();
    const snapshot = captureSelection(tabToNotebookKind(getCurrentNotebook()), textarea);
    if (!isMeaningfulSelection(snapshot)) return;
    frozen = snapshot;
    button.classList.add("hidden");
    onSummon(snapshot);
  }

  button.addEventListener("click", handleSummonClick);

  for (const textarea of textareas) {
    textarea.addEventListener("mouseup", update);
    textarea.addEventListener("keyup", update);
    textarea.addEventListener("select", update);
    textarea.addEventListener("focus", update);
    textarea.addEventListener("click", update);
    textarea.addEventListener("scroll", update);
    textarea.addEventListener("input", update);
  }
  document.addEventListener("selectionchange", update);

  return {
    reset(): void {
      frozen = null;
      button.classList.add("hidden");
    },
    destroy(): void {
      document.removeEventListener("selectionchange", update);
      button.remove();
    },
  };
}
