import type { PlainTextEditorSelection } from "./plain-text-editor.ts";
import type { NotebookTab, SelectionSnapshot } from "./types";

export interface SelectionEditor {
  readonly getText: () => string;
  readonly getSelection: () => PlainTextEditorSelection;
}

export interface TextareaLike {
  readonly value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection?: "forward" | "backward" | "none";
}

export function resolveFocusOffset(textarea: TextareaLike): number {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  return textarea.selectionDirection === "backward"
    ? Math.min(start, end)
    : Math.max(start, end);
}

function toPlainTextOffset(text: string, editorPosition: number): number {
  const lines = text.split("\n");
  let contentStart = 1;
  let textOffset = 0;

  for (const [index, line] of lines.entries()) {
    const contentEnd = contentStart + line.length;
    if (editorPosition <= contentEnd) {
      return textOffset + Math.max(0, editorPosition - contentStart);
    }

    textOffset += line.length;
    if (index < lines.length - 1) {
      textOffset += 1;
      contentStart = contentEnd + 2;
    }
  }

  return text.length;
}

/**
 * 把当前活选区转换为与具体编辑器控件解耦的不可变快照。
 * 点击“召唤 AI”时调用一次，之后 AI 链路只依赖返回的快照，不再读取编辑器 DOM。
 *
 * 快照保留用户选中的原始文字（含前后空格、标点、换行），不主动裁剪、改写或静默截断。
 * `start/end` 取选区两端的归一化位置，仅用于快照身份校验，不会发送给模型。
 * `notebook` 直接使用当前标签页代码值（`draft` | `main`），不再翻译。
 */
export function captureSelection(
  notebook: NotebookTab,
  source: SelectionEditor | TextareaLike,
): SelectionSnapshot | null {
  const text = "getText" in source ? source.getText() : source.value;
  let start: number;
  let end: number;

  if ("getSelection" in source) {
    const selection = source.getSelection();
    start = toPlainTextOffset(text, selection.from);
    end = toPlainTextOffset(text, selection.to);
  } else {
    const rawStart = source.selectionStart ?? 0;
    const rawEnd = source.selectionEnd ?? 0;
    start = Math.min(rawStart, rawEnd);
    end = Math.max(rawStart, rawEnd);
  }

  if (start === end) {
    return null;
  }

  const selectedText = text.slice(start, end);
  return { notebook, selectedText, start, end };
}

/**
 * 有效选区：已捕获且至少包含一个非空白字符。
 * 该判断只决定浮动入口是否出现，不会改变快照中保留的原始文字。
 */
export function isMeaningfulSelection(snapshot: SelectionSnapshot | null): snapshot is SelectionSnapshot {
  return snapshot !== null && snapshot.selectedText.trim().length > 0;
}
