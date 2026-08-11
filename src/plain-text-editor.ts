import { Editor, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";

export type PlainTextEditorSelection = Readonly<{
  from: number;
  to: number;
  head: number;
}>;

export type PlainTextEditorCoordinates = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export interface PlainTextEditorEngine {
  getDocument(): JSONContent;
  onUpdate(listener: () => void): void;
  offUpdate(listener: () => void): void;
  focus(): void;
  getSelection(): PlainTextEditorSelection;
  coordinatesAt(position: number): PlainTextEditorCoordinates;
  destroy(): void;
}

type PlainTextClipboardData = Readonly<{
  getData(type: string): string;
}>;

type PlainTextPasteEvent = Readonly<{
  clipboardData: PlainTextClipboardData | null;
}>;

export function createPlainTextPasteHandler(
  insertText: (text: string) => void,
): (event: PlainTextPasteEvent) => boolean {
  return (event) => {
    if (event.clipboardData === null) {
      return false;
    }

    insertText(event.clipboardData.getData("text/plain"));
    return true;
  };
}

class TiptapPlainTextEditorEngine implements PlainTextEditorEngine {
  private readonly editor: Editor;

  constructor(element: HTMLElement, initialText: string) {
    this.editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, History],
      content: importPlainText(initialText),
      editorProps: {
        clipboardTextSerializer: (slice) => serializePlainTextClipboard({
          type: "doc",
          content: slice.content.toJSON(),
        }),
        handlePaste: (_view, event) => createPlainTextPasteHandler((text) => {
          this.editor.commands.insertContent(importPlainText(text).content ?? []);
        })(event),
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

  getSelection(): PlainTextEditorSelection {
    const { from, to, head } = this.editor.state.selection;
    return { from, to, head };
  }

  coordinatesAt(position: number): PlainTextEditorCoordinates {
    return this.editor.view.coordsAtPos(position);
  }

  destroy(): void {
    this.editor.destroy();
  }
}

export class PlainTextEditorAdapter {
  private readonly engine: PlainTextEditorEngine;

  constructor(engine: PlainTextEditorEngine) {
    this.engine = engine;
  }

  getText(): string {
    return exportPlainText(this.engine.getDocument());
  }

  onEdit(listener: (text: string) => void): () => void {
    const handleUpdate = (): void => listener(this.getText());
    this.engine.onUpdate(handleUpdate);
    return () => this.engine.offUpdate(handleUpdate);
  }

  focus(): void {
    this.engine.focus();
  }

  getSelection(): PlainTextEditorSelection {
    const { from, to, head } = this.engine.getSelection();
    return { from: Math.min(from, to), to: Math.max(from, to), head };
  }

  getHeadCoordinates(): PlainTextEditorCoordinates {
    return this.engine.coordinatesAt(this.engine.getSelection().head);
  }

  coordinatesAt(position: number): PlainTextEditorCoordinates {
    return this.engine.coordinatesAt(position);
  }

  destroy(): void {
    this.engine.destroy();
  }
}

export function createPlainTextEditor(
  element: HTMLElement,
  initialText: string,
): PlainTextEditorAdapter {
  return new PlainTextEditorAdapter(new TiptapPlainTextEditorEngine(element, initialText));
}

export function importPlainText(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line.length > 0 ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function exportPlainText(document: JSONContent): string {
  return (document.content ?? [])
    .map((paragraph) => (paragraph.content ?? []).map((node) => node.text ?? "").join(""))
    .join("\n");
}

export function serializePlainTextClipboard(document: JSONContent): string {
  return exportPlainText(document);
}
