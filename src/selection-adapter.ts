import type { NotebookTab, SelectionSnapshot } from "./types";

/** textarea 的最小可读接口，便于在不依赖真实 DOM 的情况下测试适配器。 */
export interface TextareaLike {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
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
  textarea: TextareaLike,
): SelectionSnapshot | null {
  const rawStart = textarea.selectionStart ?? 0;
  const rawEnd = textarea.selectionEnd ?? 0;
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);

  if (start === end) {
    return null;
  }

  const selectedText = textarea.value.slice(start, end);
  return { notebook, selectedText, start, end };
}

/**
 * 有效选区：已捕获且至少包含一个非空白字符。
 * 该判断只决定浮动入口是否出现，不会改变快照中保留的原始文字。
 */
export function isMeaningfulSelection(snapshot: SelectionSnapshot | null): snapshot is SelectionSnapshot {
  return snapshot !== null && snapshot.selectedText.trim().length > 0;
}
