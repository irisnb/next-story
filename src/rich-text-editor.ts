import { Editor, findParentNode, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";

import type { FormatCommand } from "./format-commands.ts";
import { fixSplitOrderedListStart } from "./list-numbering.ts";
import { decidePasteAction, parseHtmlToBlocks } from "./controlled-paste.ts";
import { canonicalDoc, serializeSelectionToPlainText } from "./structured-notebook.ts";

export type RichTextEditorSelection = Readonly<{
  from: number;
  to: number;
  head: number;
}>;

export type RichTextEditorCoordinates = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

/**
 * 构建本轮基础富文本内核扩展集合。只注册格式版本 1 正式支持的节点与标记，
 * 且 mark 注册顺序决定 bold 先于 italic，保证序列化时 marks 按固定顺序排列。
 */
export function buildRichTextExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2] }),
    Bold,
    Italic,
    BulletList,
    OrderedList,
    ListItem,
    History,
  ];
}

export interface RichTextEditorEngine {
  getDocument(): JSONContent;
  onUpdate(listener: () => void): void;
  offUpdate(listener: () => void): void;
  focus(): void;
  getSelection(): RichTextEditorSelection;
  coordinatesAt(position: number): RichTextEditorCoordinates;
  runCommand(command: FormatCommand): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  destroy(): void;
}

class TiptapRichTextEditorEngine implements RichTextEditorEngine {
  private readonly editor: Editor;

  constructor(element: HTMLElement, initialDocument: JSONContent) {
    this.editor = new Editor({
      element,
      extensions: buildRichTextExtensions(),
      content: initialDocument,
      editorProps: {
        clipboardTextSerializer: (slice) => sliceToPlainText(slice),
        handlePaste: (_view, event) => this.handlePaste(event),
      },
    });
  }

  getDocument(): JSONContent {
    return this.editor.getJSON();
  }

  onUpdate(listener: () => void): void {
    this.editor.on("update", listener);
  }

  offUpdate(listener: () => void): void {
    this.editor.off("update", listener);
  }

  focus(): void {
    this.editor.commands.focus();
  }

  getSelection(): RichTextEditorSelection {
    const { from, to, head } = this.editor.state.selection;
    return { from, to, head };
  }

  coordinatesAt(position: number): RichTextEditorCoordinates {
    return this.editor.view.coordsAtPos(position);
  }

  runCommand(command: FormatCommand): boolean {
    const chain = this.editor.chain().focus();
    switch (command.kind) {
      case "paragraph":
        return chain.setParagraph().run();
      case "heading":
        return chain.toggleHeading({ level: command.level }).run();
      case "bold":
        return chain.toggleBold().run();
      case "italic":
        return chain.toggleItalic().run();
      case "bulletList":
        return chain.toggleBulletList().run();
      case "orderedList":
        return this.toggleOrderedList();

      case "clearFormatting":
        return chain.clearNodes().unsetAllMarks().run();
      case "undo":
        return this.editor.commands.undo();
      case "redo":
        return this.editor.commands.redo();
    }
  }

  /** 切换有序列表，并在部分抬出时保留未触及片段的实际编号。 */
  private toggleOrderedList(): boolean {
    const { editor } = this;
    const { state } = editor;
    const { selection } = state;
    const parent = findParentNode((node) => node.type.name === "orderedList")(selection);

    let originalStart = 1;
    let trailingStart: number | null = null;
    if (parent) {
      const listNode = parent.node;
      originalStart = listNode.attrs.start as number;
      const listPos = parent.pos;
      const listEnd = listPos + listNode.nodeSize;
      const inside = selection.from >= listPos && selection.to <= listEnd;
      if (inside) {
        let itemsBefore = 0;
        let itemsLifted = 0;
        listNode.forEach((child, offset) => {
          const itemPos = listPos + 1 + offset;
          const itemEnd = itemPos + child.nodeSize;
          if (itemEnd <= selection.from) itemsBefore += 1;
          else if (itemPos < selection.to) itemsLifted += 1;
        });
        const hasTrailing = itemsBefore + itemsLifted < listNode.childCount;
        if (hasTrailing && itemsLifted > 0) {
          trailingStart = originalStart + itemsBefore + itemsLifted;
        }
      }
    }

    return editor
      .chain()
      .focus()
      .toggleOrderedList()
      .command(({ tr }) => {
        if (trailingStart !== null) {
          fixSplitOrderedListStart(tr.doc, tr, originalStart, trailingStart);
        }
        return true;
      })
      .run();
  }

  canUndo(): boolean {
    return this.editor.can().undo();
  }

  canRedo(): boolean {
    return this.editor.can().redo();
  }

  private handlePaste(event: ClipboardEvent): boolean {
    const data = event.clipboardData;
    if (!data) return false;
    const plain = data.getData("text/plain");
    const html = data.getData("text/html");
    const parsed = html
      ? parseHtmlToBlocks(html)
      : { blocks: [], hasImage: false, hasUnknownVisibleEmbed: false };
    const action = decidePasteAction(plain, html !== "", parsed);

    if (action.kind === "insert") {
      this.editor.commands.insertContent(action.document.content);
      if (parsed.hasImage) alert("图片未被加入");
    } else if (action.kind === "reject") {
      alert(action.reason);
    } else {
      alert("无法将图片加入本子");
    }
    return true;
  }

  destroy(): void {
    this.editor.destroy();
  }
}

/** 把复制的选区切片序列化为带列表符号的纯文本。 */
function sliceToPlainText(slice: { content: { toJSON(): unknown[] } }): string {
  const doc = { type: "doc", content: slice.content.toJSON() };
  return serializeSelectionToPlainText(canonicalDoc(doc), 0, Number.MAX_SAFE_INTEGER);
}

export class RichTextEditorAdapter {
  private readonly engine: RichTextEditorEngine;

  constructor(engine: RichTextEditorEngine) {
    this.engine = engine;
  }

  getDocument(): JSONContent {
    return this.engine.getDocument();
  }

  onEdit(listener: (document: JSONContent) => void): () => void {
    const handleUpdate = (): void => listener(this.getDocument());
    this.engine.onUpdate(handleUpdate);
    return () => this.engine.offUpdate(handleUpdate);
  }

  focus(): void {
    this.engine.focus();
  }

  getSelection(): RichTextEditorSelection {
    const { from, to, head } = this.engine.getSelection();
    return { from: Math.min(from, to), to: Math.max(from, to), head };
  }

  coordinatesAt(position: number): RichTextEditorCoordinates {
    return this.engine.coordinatesAt(position);
  }

  runCommand(command: FormatCommand): boolean {
    return this.engine.runCommand(command);
  }

  canUndo(): boolean {
    return this.engine.canUndo();
  }

  canRedo(): boolean {
    return this.engine.canRedo();
  }

  destroy(): void {
    this.engine.destroy();
  }
}

export function createRichTextEditor(
  element: HTMLElement,
  initialDocument: JSONContent,
): RichTextEditorAdapter {
  return new RichTextEditorAdapter(
    new TiptapRichTextEditorEngine(element, initialDocument),
  );
}
