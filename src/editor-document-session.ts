import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { emptyNotebookDocument, parseNotebookDocumentJson } from "./structured-notebook.ts";
import type { ProjectTreeState } from "./types.ts";
import type { ContentTree } from "./types.ts";

export interface EditorDocumentSessionEditor {
  onEdit(listener: () => void): () => void;
  onSelectionChange(listener: () => void): () => void;
}

export interface EditorDocumentSessionOptions {
  dom: Pick<AppDom, "editorTextarea">;
  readDocument: (projectPath: string, documentId: string) => Promise<string>;
  createEditor: (element: HTMLElement, document: JSONContent) => EditorDocumentSessionEditor;
  getProject: () => ProjectTreeState | null;
  getDocumentId: () => string | null;
  setProject: (project: ProjectTreeState | null) => void;
  setDocumentId: (documentId: string | null) => void;
  setEditor: (editor: EditorDocumentSessionEditor | null) => void;
  disposeEditor: () => void;
  setBaseline: (document: JSONContent) => void;
  clearBaseline: () => void;
  onEdit: (editor: EditorDocumentSessionEditor) => () => void;
  onSelectionChange: (editor: EditorDocumentSessionEditor) => () => void;
  onLoaded: (project: ProjectTreeState, documentId: string | null) => void;
  beforeLoadProject: (project: ProjectTreeState) => void;
  resolveDocumentId: (project: ProjectTreeState) => string | null;
  isDocumentInTree: (tree: ContentTree, documentId: string) => boolean;
  firstDocument: (tree: ContentTree) => { id: string } | null;
  hasUnsavedChanges: () => boolean;
  confirmDiscard: () => boolean;
  clearRememberedDocument: (projectPath: string) => void;
}

export interface EditorDocumentSession {
  loadDocument(documentId: string): Promise<void>;
  showProject(project: ProjectTreeState): Promise<void>;
  applyTree(tree: ContentTree): void;
  invalidate(): void;
}

export function createEditorDocumentSession(options: EditorDocumentSessionOptions): EditorDocumentSession {
  let generation = 0;

  function invalidate(): void {
    generation += 1;
  }

  async function read(projectPath: string, documentId: string, token: number): Promise<JSONContent | null> {
    let content: string;
    try {
      content = await options.readDocument(projectPath, documentId);
    } catch (error) {
      if (token === generation) alert(`读取文档失败：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (token !== generation) return null;
    try {
      return parseNotebookDocumentJson(content).document;
    } catch (error) {
      if (token === generation) alert(`解析文档失败：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function loadDocument(documentId: string): Promise<void> {
    const project = options.getProject();
    if (!project) return;
    const token = ++generation;
    const document = await read(project.projectPath, documentId, token);
    if (!document || token !== generation || !options.getProject()) return;
    const next = options.createEditor(options.dom.editorTextarea, document);
    options.disposeEditor();
    options.setEditor(next);
    options.setDocumentId(documentId);
    options.setBaseline(document);
    options.onEdit(next);
    options.onSelectionChange(next);
    options.onLoaded(project, documentId);
  }

  async function showProject(project: ProjectTreeState): Promise<void> {
    const token = ++generation;
    options.beforeLoadProject(project);
    const documentId = options.resolveDocumentId(project);
    const document = documentId === null
      ? emptyNotebookDocument().document
      : await read(project.projectPath, documentId, token);
    if (!document || token !== generation) return;
    const next = documentId === null ? null : options.createEditor(options.dom.editorTextarea, document);
    options.disposeEditor();
    options.setProject(project);
    options.setDocumentId(documentId);
    options.setEditor(next);
    if (documentId === null) options.clearBaseline();
    else options.setBaseline(document);
    if (next) {
      options.onEdit(next);
      options.onSelectionChange(next);
    }
    options.onLoaded(project, documentId);
  }

  function applyTree(tree: ContentTree): void {
    const project = options.getProject();
    const currentDocumentId = options.getDocumentId();
    if (!project) return;
    if (currentDocumentId !== null && !options.isDocumentInTree(tree, currentDocumentId)) {
      if (options.hasUnsavedChanges() && !options.confirmDiscard()) return;
      project.tree = tree;
      options.clearRememberedDocument(project.projectPath);
      const first = options.firstDocument(tree);
      if (first) {
        void loadDocument(first.id);
      } else {
        invalidate();
        options.disposeEditor();
        options.setDocumentId(null);
        options.setEditor(null);
        options.clearBaseline();
        options.onLoaded(project, null);
      }
      return;
    }
    project.tree = tree;
    options.onLoaded(project, currentDocumentId);
  }

  return { loadDocument, showProject, applyTree, invalidate };
}
