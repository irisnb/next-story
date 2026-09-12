import type { JSONContent } from "@tiptap/core";

import type { RichTextEditorSelection } from "./rich-text-editor.ts";
import {
  canonicalDoc,
  canonicalNotebookJson,
  serializeSelectionToPlainText,
} from "./structured-notebook.ts";
import type {
  ContentTree,
  SelectionSnapshot,
  SelectionVisibilityCheck,
} from "./types.ts";
import { isDocumentAiVisible } from "./types.ts";

export interface SelectionEditor {
  readonly getDocument: () => JSONContent;
  readonly getSelection: () => RichTextEditorSelection;
}

/**
 * 选区快照的来源身份：作品路径（作品身份）与文档版本身份。
 * 捕获时从作品上下文注入，供后端统一授权校验；缺省不附带。
 */
export interface SelectionIdentityContext {
  projectPath?: string;
  documentVersion?: string;
}

export interface SelectionAuthorizationContext {
  projectPath: string | null;
  documentVersion: string | null;
  hiddenDocumentIds: ReadonlySet<string>;
}

/** 隐藏文档选区被拒绝时的统一中文提示（不含隐藏文档名称、ID 或路径）。 */
export const HIDDEN_DOCUMENT_MESSAGE = "该文档当前不允许 AI 查看，本次请求未发送。";

/**
 * 把当前活选区转换为与具体编辑器控件解耦的不可变快照。
 * 点击“召唤 AI”时调用一次，之后 AI 链路只依赖返回的快照，不再读取编辑器 DOM。
 *
 * 快照保留由结构化切片唯一序列化规则生成的纯文本 `selectedText`，并冻结
 * Tiptap 有序选区位置 `from/to`。位置仅用于本次应用周期内的来源标识与界面
 * 锚定，不持久化，也不用于请求时重新读取当前编辑器。同时捕获当前文档的
 * 规范化正文快照 `bodySnapshot`（`canonicalNotebookJson` 输出），与 `documentVersion`
 * 同源。传入 `identity` 时，快照额外携带作品与版本身份，供后端统一授权校验。
 */
export function captureSelection(
  documentId: string,
  source: SelectionEditor,
  identity?: SelectionIdentityContext,
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
  // 冻结时同步捕获当前文档的规范化正文快照：AI 链路只依赖快照，不再回读编辑器。
  // 快照内容与 `identity.documentVersion` 同源（版本散列即该内容的派生值）。
  const bodySnapshot = canonicalNotebookJson(source.getDocument());

  return {
    documentId,
    selectedText,
    from,
    to,
    bodySnapshot,
    ...(identity?.projectPath !== undefined ? { projectPath: identity.projectPath } : {}),
    ...(identity?.documentVersion !== undefined ? { documentVersion: identity.documentVersion } : {}),
  };
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

/**
 * 依据作品树复核选区材料的可见性：来源文档不存在、不是文档、或不允许 AI 查看
 * 时拒绝，且提示不含隐藏文档名称、ID 或路径。裸选区文本不能绕过该复核。
 */
export function checkSelectionVisibility(
  tree: ContentTree | null,
  snapshot: SelectionSnapshot,
): SelectionVisibilityCheck {
  const node = tree?.nodes[snapshot.documentId];
  if (!node || node.kind !== "Document" || !isDocumentAiVisible(node)) {
    return { allowed: false, deniedMessage: HIDDEN_DOCUMENT_MESSAGE };
  }
  return { allowed: true };
}

/**
 * 在发送前校验冻结选区仍属于当前作品、当前文档版本且未被隐藏。
 * 缺失的快照身份表示旧调用方未携带该校验维度，因此不因缺失身份拒绝。
 */
export function authorizeSelection(
  snapshot: SelectionSnapshot,
  context: SelectionAuthorizationContext,
  tree: ContentTree | null = null,
): SelectionVisibilityCheck {
  const visibility = checkSelectionVisibility(tree, snapshot);
  if (tree !== null && !visibility.allowed) return visibility;
  if (snapshot.projectPath !== undefined &&
      context.projectPath !== null &&
      snapshot.projectPath !== context.projectPath) {
    return { allowed: false, deniedMessage: HIDDEN_DOCUMENT_MESSAGE };
  }
  if (snapshot.documentVersion !== undefined &&
      context.documentVersion !== null &&
      snapshot.documentVersion !== context.documentVersion) {
    return { allowed: false, deniedMessage: HIDDEN_DOCUMENT_MESSAGE };
  }
  if (context.hiddenDocumentIds.has(snapshot.documentId)) {
    return { allowed: false, deniedMessage: HIDDEN_DOCUMENT_MESSAGE };
  }
  return { allowed: true };
}
