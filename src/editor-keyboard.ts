import type { JSONContent } from "@tiptap/core";
import type { FormatCommand } from "./format-commands.ts";
import { linkHrefAt } from "./editor-link-actions.ts";

function isTextInputTarget(target: EventTarget | null, editorRoot: Element): boolean {
  let element = target as (Element & { isContentEditable?: boolean; parentElement?: Element | null }) | null;
  let input = false;
  while (element) {
    if (element === editorRoot) return false;
    const tag = element.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable || element.getAttribute?.("contenteditable") === "true") input = true;
    element = element.parentElement as typeof element;
  }
  return input;
}

export function createEditorKeyboard(deps: {
  editorRoot: Element;
  getEditor(): { getSelection(): { from: number; to: number }; getDocument(): JSONContent; focus(): void; pastePlainText(): Promise<boolean> } | null;
  closeOverlays(): void;
  closeFind(): void;
  openFind(mode: "find" | "replace"): void;
  save(): void;
  hasUnsavedChanges(): boolean;
  format(command: FormatCommand): void;
  linkActions: { editLinkHref(href: string): void; createLinkHref(): void };
}): () => void {
  const listener = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    if (isTextInputTarget(keyEvent.target, deps.editorRoot)) return;
    const mod = keyEvent.ctrlKey || keyEvent.metaKey;
    const key = keyEvent.key.toLowerCase();
    if (key === "escape") { deps.closeOverlays(); deps.closeFind(); return; }
    if (mod && key === "f") { keyEvent.preventDefault(); deps.openFind("find"); return; }
    if (mod && key === "h") { keyEvent.preventDefault(); deps.openFind("replace"); return; }
    if (mod && key === "s") { keyEvent.preventDefault(); if (deps.hasUnsavedChanges()) deps.save(); return; }
    if (mod && key === "v" && keyEvent.shiftKey) { keyEvent.preventDefault(); const e = deps.getEditor(); if (e) { e.focus(); void e.pastePlainText(); } return; }
    if (mod && key === "k") {
      const e = deps.getEditor();
      if (!e) return;
      const s = e.getSelection();
      const href = linkHrefAt(e.getDocument(), s.from, s.to);
      if (href || s.from < s.to) {
        keyEvent.preventDefault();
        if (href) deps.linkActions.editLinkHref(href);
        else deps.linkActions.createLinkHref();
      }
      return;
    }
    const command = mod && key === "b" ? { kind: "bold" } : mod && key === "i" ? { kind: "italic" } : mod && key === "u" ? { kind: "underline" } : mod && key === "z" ? { kind: keyEvent.shiftKey ? "redo" : "undo" } : mod && key === "y" ? { kind: "redo" } : null;
    if (command) { keyEvent.preventDefault(); keyEvent.stopPropagation(); deps.format(command as FormatCommand); }
  };
  document.addEventListener("keydown", listener, { capture: true });
  return () => document.removeEventListener?.("keydown", listener, { capture: true });
}
