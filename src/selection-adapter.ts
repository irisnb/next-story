import type { JSONContent } from "@tiptap/core";

import type { RichTextEditorSelection } from "./rich-text-editor.ts";
import { canonicalDoc, serializeSelectionToPlainText } from "./structured-notebook.ts";
import type { NotebookTab, SelectionSnapshot } from "./types";

export interface SelectionEditor {
  readonly getDocument: () => JSONContent;
  readonly getSelection: () => RichTextEditorSelection;
}

/**
 * 把当前活选区转换为与具体编辑器控件解耦的不可变快照。
 * 点击“召唤 AI”时调用一次，之后 AI 链路只依赖返回的快照，不再读取编辑器 DOM。
 *
 * 快照保留由结构化切片唯一序列化规则生成的纯文本 `selectedText`，并冻结
 * Tiptap 有序选区位置 `from/to`。位置仅用于本次应用周期内的来源标识与界面
 * 锚定，不持久化，也不用于请求时重新读取当前编辑器。
 */
export function captureSelection(
  notebook: NotebookTab,
  source: SelectionEditor,
): SelectionSnapshot | null {
  const selection = source.getSelection();
  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);

  if (from === to) {
    return null;
  }

  const selectedText = serializeSelectionToPlainText(
    canonicalDoc(source.getDocument()),
    from,
    to,
  );

  return { notebook, selectedText, from, to };
}

/**
 * 有效选区：已捕获且至少包含一个非空白字符。
 * 该判断只决定浮动入口是否出现，不会改变快照中保留的原始文字。
 */
export function isMeaningfulSelection(
  snapshot: SelectionSnapshot | null,
): snapshot is SelectionSnapshot {
  return snapshot !== null && snapshot.selectedText.trim().length > 0;
}
