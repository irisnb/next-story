import type { AppDom } from "./dom.ts";
import { flattenDocuments } from "./content-tree.ts";
import type { ContentTree } from "./types.ts";

export interface EditorDocumentViewOptions {
  dom: Pick<
    AppDom,
    "currentDocumentName" | "documentList" | "writingEmptyState" | "editorTextarea" | "currentDocToggle"
  >;
  getTree: () => ContentTree | null;
  getCurrentDocumentId: () => string | null;
  onSwitchDocument: (documentId: string) => void;
  emptyStateText: string;
}

export interface EditorDocumentView {
  render(): void;
  closeList(): void;
  toggleList(): void;
}

export function createEditorDocumentView(options: EditorDocumentViewOptions): EditorDocumentView {
  function renderDocumentList(): void {
    const tree = options.getTree();
    if (!tree) return;
    const currentDocumentId = options.getCurrentDocumentId();
    options.dom.documentList.replaceChildren();
    for (const documentNode of flattenDocuments(tree)) {
      const item = globalThis.document.createElement("button");
      item.type = "button";
      item.className = "document-list-item";
      if (documentNode.id === currentDocumentId) item.classList.add("active");
      item.textContent = documentNode.name;
      item.addEventListener("click", () => options.onSwitchDocument(documentNode.id));
      options.dom.documentList.appendChild(item);
    }
  }

  function render(): void {
    const tree = options.getTree();
    if (!tree) return;
    const currentDocumentId = options.getCurrentDocumentId();
    const current = currentDocumentId !== null ? tree.nodes[currentDocumentId] : null;
    options.dom.currentDocumentName.textContent = current?.name ?? "";
    options.dom.editorTextarea.classList.toggle("hidden", currentDocumentId === null);
    options.dom.writingEmptyState.classList.toggle("hidden", currentDocumentId !== null);
    if (currentDocumentId === null) options.dom.writingEmptyState.textContent = options.emptyStateText;
    renderDocumentList();
  }

  function closeList(): void {
    options.dom.documentList.classList.add("hidden");
    options.dom.currentDocToggle.setAttribute("aria-expanded", "false");
  }

  function toggleList(): void {
    const open = options.dom.documentList.classList.contains("hidden");
    options.dom.documentList.classList.toggle("hidden", !open);
    options.dom.currentDocToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderDocumentList();
  }

  return { render, closeList, toggleList };
}
