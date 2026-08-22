import type { JSONContent } from "@tiptap/core";
import type { AppDom } from "./dom.ts";
import { linkHrefAt, type LinkActions } from "./editor-link-actions.ts";

export interface ContextMenuEditor {
  getSelection(): { from: number; to: number };
  getDocument(): JSONContent;
  focus(): void;
  cutSelection(): Promise<void>;
  copySelection(): Promise<boolean>;
  pastePlainText(): Promise<boolean>;
}

export interface EditorContextMenu {
  close(): void;
  dispose(): void;
}

export function createEditorContextMenu(deps: {
  dom: Pick<AppDom, "editorTextarea" | "contextMenu" | "ctxLinkGroup" | "btnCtxCut" | "btnCtxCopy" | "btnCtxPaste" | "btnCtxPastePlain" | "btnCtxLinkCreate" | "btnCtxLinkOpen" | "btnCtxLinkEdit" | "btnCtxLinkRemove">;
  getEditor(): ContextMenuEditor | null;
  linkActions: LinkActions;
}): EditorContextMenu {
  let contextHref: string | null = null;
  const cleanup: Array<() => void> = [];
  const bind = (element: HTMLElement, event: string, listener: EventListener) => {
    element.addEventListener(event, listener);
    cleanup.push(() => element.removeEventListener(event, listener));
  };
  function close(): void {
    contextHref = null;
    deps.dom.contextMenu.classList.add("hidden");
  }
  function open(event: Event): void {
    const mouse = event as MouseEvent;
    mouse.preventDefault();
    const current = deps.getEditor();
    if (!current) return;
    const selection = current.getSelection();
    const hasSelection = selection.from < selection.to;
    contextHref = linkHrefAt(current.getDocument(), selection.from, selection.to);
    deps.dom.btnCtxCut.disabled = !hasSelection;
    deps.dom.btnCtxCopy.disabled = !hasSelection;
    deps.dom.btnCtxLinkCreate.classList.toggle("hidden", !hasSelection || contextHref !== null);
    deps.dom.ctxLinkGroup.classList.toggle("hidden", contextHref === null);
    deps.dom.contextMenu.classList.remove("hidden");
    const width = deps.dom.contextMenu.offsetWidth || 180;
    const height = deps.dom.contextMenu.offsetHeight || 240;
    deps.dom.contextMenu.style.left = `${Math.max(4, Math.min(mouse.clientX, (window.innerWidth || 1024) - width - 4))}px`;
    deps.dom.contextMenu.style.top = `${Math.max(4, Math.min(mouse.clientY, (window.innerHeight || 768) - height - 4))}px`;
  }
  bind(deps.dom.editorTextarea, "contextmenu", open);
  bind(deps.dom.btnCtxCut, "click", () => { close(); const e = deps.getEditor(); if (e) { e.focus(); void e.cutSelection(); } });
  bind(deps.dom.btnCtxCopy, "click", () => { close(); const e = deps.getEditor(); if (e) { e.focus(); void e.copySelection().then(ok => { if (!ok) alert("复制失败，请使用 Ctrl+C。"); }); } });
  bind(deps.dom.btnCtxPaste, "click", () => { close(); const e = deps.getEditor(); if (e) { e.focus(); if (!document.execCommand("paste")) alert("无法直接读取剪贴板内容，请使用 Ctrl+V 粘贴。"); } });
  bind(deps.dom.btnCtxPastePlain, "click", () => { close(); const e = deps.getEditor(); if (e) { e.focus(); void e.pastePlainText(); } });
  bind(deps.dom.btnCtxLinkCreate, "click", () => { close(); deps.linkActions.createLinkHref(); });
  bind(deps.dom.btnCtxLinkOpen, "click", () => { const href = contextHref; close(); if (href) deps.linkActions.openLinkHref(href); });
  bind(deps.dom.btnCtxLinkEdit, "click", () => { const href = contextHref; close(); if (href) deps.linkActions.editLinkHref(href); });
  bind(deps.dom.btnCtxLinkRemove, "click", () => { close(); deps.linkActions.removeLinkHref(); });
  const dismiss = (event: Event) => {
    if (!deps.dom.contextMenu.classList.contains("hidden") && !deps.dom.contextMenu.contains(event.target as Node)) close();
  };
  const scroll = () => close();
  document.addEventListener("mousedown", dismiss);
  document.addEventListener("scroll", scroll, true);
  cleanup.push(() => document.removeEventListener?.("mousedown", dismiss));
  cleanup.push(() => document.removeEventListener?.("scroll", scroll, true));
  return { close, dispose: () => { close(); for (const remove of cleanup) remove(); } };
}
