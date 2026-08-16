import { Editor, findParentNode, getHTMLFromFragment, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";

import type { FormatCommand } from "./format-commands.ts";
import { FontSize, ParagraphStyle } from "./editor-extensions.ts";
import { fixSplitOrderedListStart } from "./list-numbering.ts";
import { decidePasteAction, parseHtmlToBlocks, plainTextToDocument } from "./controlled-paste.ts";
import { canonicalDoc, serializeSelectionToPlainText } from "./structured-notebook.ts";
import {
  FindReplace,
  findMatchesInDoc,
  findPluginKey,
} from "./find-replace.ts";

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
 * 构建本轮富文本内核扩展集合。只注册格式版本 2 正式支持的节点与标记，
 * 且 mark 注册顺序决定 bold 先于 italic，保证序列化时 marks 按固定顺序排列。
 */
export function buildRichTextExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Bold,
    Italic,
    Underline,
    Strike,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false }),
    TextAlign.configure({ types: ["paragraph", "heading"] }),
    ParagraphStyle,
    BulletList,
    OrderedList,
    ListItem,
    History,
    FindReplace,
  ];
}

export interface RichTextEditorEngine {
  getDocument(): JSONContent;
  onUpdate(listener: () => void): void;
  offUpdate(listener: () => void): void;
  onSelectionUpdate(listener: () => void): void;
  offSelectionUpdate(listener: () => void): void;
  focus(): void;
  getSelection(): RichTextEditorSelection;
  coordinatesAt(position: number): RichTextEditorCoordinates;
  runCommand(command: FormatCommand): boolean;
  setFind(query: string, caseSensitive: boolean): number;
  activateMatch(index: number): void;
  replaceCurrent(replacement: string): boolean;
  replaceAll(replacement: string): number;
  pastePlainText(): Promise<boolean>;
  copySelection(): Promise<boolean>;
  cutSelection(): Promise<void>;
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
        handleDrop: (_view, event) => this.handleDrop(event),
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

  onSelectionUpdate(listener: () => void): void {
    this.editor.on("selectionUpdate", listener);
  }

  offSelectionUpdate(listener: () => void): void {
    this.editor.off("selectionUpdate", listener);
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
      case "underline":
        return chain.toggleUnderline().run();
      case "strike":
        return chain.toggleStrike().run();
      case "bulletList":
        return chain.toggleBulletList().run();
      case "orderedList":
        return this.toggleOrderedList();
      case "sinkListItem":
        return chain.sinkListItem("listItem").run();
      case "liftListItem":
        return chain.liftListItem("listItem").run();

      case "clearFormatting":
        return chain.clearNodes().unsetAllMarks().run();
      case "clearCharacterFormat":
        return chain.unsetAllMarks().run();
      case "clearParagraphFormat":
        return chain.clearNodes().run();

      case "textColor":
        return command.color === null
          ? chain.unsetColor().run()
          : chain.setColor(command.color).run();
      case "highlight":
        return command.color === null
          ? chain.unsetHighlight().run()
          : chain.setHighlight({ color: command.color }).run();
      case "fontFamily":
        return command.font === null
          ? chain.unsetFontFamily().run()
          : chain.setFontFamily(command.font).run();
      case "fontSize":
        return command.size === null
          ? chain.setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run()
          : chain.setMark("textStyle", { fontSize: command.size }).run();
      case "textAlign":
        return chain.setTextAlign(command.align).run();
      case "lineHeight":
        return this.applyParagraphAttr("lineHeight", command.value);
      case "spacingBefore":
        return this.applyParagraphAttr("spacingBefore", command.value);
      case "spacingAfter":
        return this.applyParagraphAttr("spacingAfter", command.value);
      case "textIndent":
        return this.applyParagraphAttr("textIndent", command.value);
      case "indentLeft":
        return this.applyParagraphAttr("indentLeft", command.value);
      case "indentRight":
        return this.applyParagraphAttr("indentRight", command.value);

      case "setLink":
        return chain.extendMarkRange("link").setLink({ href: command.href }).run();
      case "unsetLink":
        return chain.extendMarkRange("link").unsetLink().run();

      case "undo":
        return this.editor.commands.undo();
      case "redo":
        return this.editor.commands.redo();
    }
  }

  /** 把某个段落属性应用到选区触及的完整段落与标题。 */
  private applyParagraphAttr(attr: string, value: string | null): boolean {
    return this.editor
      .chain()
      .focus()
      .updateAttributes("paragraph", { [attr]: value })
      .updateAttributes("heading", { [attr]: value })
      .run();
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

  setFind(query: string, caseSensitive: boolean): number {
    const matches = findMatchesInDoc(this.editor.state.doc, query, caseSensitive);
    const state = { query, caseSensitive, matches, activeIndex: matches.length > 0 ? 0 : -1 };
    this.editor.view.dispatch(this.editor.state.tr.setMeta(findPluginKey, state));
    return matches.length;
  }

  activateMatch(index: number): void {
    const findState = findPluginKey.getState(this.editor.state);
    if (!findState) return;
    const match = findState.matches[index];
    if (!match) return;
    const tr = this.editor.state.tr
      .setMeta(findPluginKey, { ...findState, activeIndex: index })
      .setSelection(TextSelection.create(this.editor.state.doc, match.from, match.to));
    this.editor.view.dispatch(tr);
    this.editor.view.focus();
  }

  replaceCurrent(replacement: string): boolean {
    const findState = findPluginKey.getState(this.editor.state);
    if (!findState || findState.activeIndex < 0) return false;
    const match = findState.matches[findState.activeIndex];
    const tr = this.editor.state.tr.insertText(replacement, match.from, match.to);
    const matches = findMatchesInDoc(tr.doc, findState.query, findState.caseSensitive);
    tr.setMeta(findPluginKey, {
      ...findState,
      matches,
      activeIndex: matches.length > 0 ? Math.min(findState.activeIndex, matches.length - 1) : -1,
    });
    this.editor.view.dispatch(tr);
    return true;
  }

  replaceAll(replacement: string): number {
    const findState = findPluginKey.getState(this.editor.state);
    if (!findState || findState.matches.length === 0) return 0;
    const { matches } = findState;
    const tr = this.editor.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      tr.insertText(replacement, matches[i].from, matches[i].to);
    }
    const remaining = findMatchesInDoc(tr.doc, findState.query, findState.caseSensitive);
    tr.setMeta(findPluginKey, { ...findState, matches: remaining, activeIndex: -1 });
    this.editor.view.dispatch(tr);
    return matches.length;
  }

  async pastePlainText(): Promise<boolean> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return false;
      this.editor.commands.insertContent(plainTextToDocument(text).content);
      return true;
    } catch {
      return false;
    }
  }

  async copySelection(): Promise<boolean> {
    const { state } = this.editor;
    const { from, to } = state.selection;
    if (from === to) return false;
    const slice = state.selection.content();
    const text = sliceToPlainText(slice);
    const html = getHTMLFromFragment(slice.content, state.schema);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  async cutSelection(): Promise<void> {
    const copied = await this.copySelection();
    if (copied) {
      this.editor.commands.deleteSelection();
    }
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
    const files = Array.from(data.files ?? []);
    const hasImageFile = files.some((file) => file.type.startsWith("image/"));

    // 纯图片粘贴（截图后 Ctrl+V）：既无文字也无 HTML，只有图片文件
    if (hasImageFile && plain.trim() === "" && html.trim() === "") {
      alert("无法将图片加入本子");
      return true;
    }

    const parsed = html
      ? parseHtmlToBlocks(html)
      : { content: [], hasImage: false, hasUnknownVisibleEmbed: false };
    const action = decidePasteAction(plain, html !== "", parsed);

    if (action.kind === "insert") {
      this.editor.commands.insertContent(action.document.content);
      if (parsed.hasImage || hasImageFile) alert("图片未被加入");
    } else if (action.kind === "reject") {
      alert(action.reason);
    } else {
      alert("无法将图片加入本子");
    }
    return true;
  }

  private handleDrop(event: DragEvent): boolean {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.some((file) => file.type.startsWith("image/"))) {
      alert("无法将图片加入本子");
      return true;
    }
    return false;
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

  /** 订阅选区变化（Tiptap selectionUpdate 事件，比 DOM 事件可靠）。 */
  onSelectionChange(listener: () => void): () => void {
    this.engine.onSelectionUpdate(listener);
    return () => this.engine.offSelectionUpdate(listener);
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

  setFind(query: string, caseSensitive: boolean): number {
    return this.engine.setFind(query, caseSensitive);
  }

  activateMatch(index: number): void {
    this.engine.activateMatch(index);
  }

  replaceCurrent(replacement: string): boolean {
    return this.engine.replaceCurrent(replacement);
  }

  replaceAll(replacement: string): number {
    return this.engine.replaceAll(replacement);
  }

  pastePlainText(): Promise<boolean> {
    return this.engine.pastePlainText();
  }

  copySelection(): Promise<boolean> {
    return this.engine.copySelection();
  }

  cutSelection(): Promise<void> {
    return this.engine.cutSelection();
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
