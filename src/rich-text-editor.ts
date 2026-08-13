import { Editor, type JSONContent } from "@tiptap/core";
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
  destroy(): void;
}

class TiptapRichTextEditorEngine implements RichTextEditorEngine {
  private readonly editor: Editor;

  constructor(element: HTMLElement, initialDocument: JSONContent) {
    this.editor = new Editor({
      element,
      extensions: buildRichTextExtensions(),
      content: initialDocument,
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

  destroy(): void {
    this.editor.destroy();
  }
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
