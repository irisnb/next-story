import type { JSONContent } from "@tiptap/core";

import type { AppDom } from "./dom.ts";
import { emptyNotebookDocument, parseNotebookDocumentJson } from "./structured-notebook.ts";
import type { ProjectTreeState } from "./types.ts";
import type { ContentTree } from "./types.ts";

export interface EditorDocumentSessionEditor {
  destroy(): void;
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
  /** 文档加载完成（同作品内切换文档、内容树回落换绑）：仅更新视图与文档记忆，MUST NOT 触发作品级 AI 生命周期。 */
  onDocumentLoaded: (project: ProjectTreeState, documentId: string | null) => void;
  /** 作品加载完成（打开/重开作品）：触发作品级 AI 生命周期初始化并更新视图。 */
  onProjectLoaded: (project: ProjectTreeState, documentId: string | null) => void;
  /** 树刷新（当前作品与文档身份未变化）时调用，用于更新视图而不触发完整生命周期。 */
  onTreeRefreshed: (project: ProjectTreeState, documentId: string | null) => void;
  beforeLoadProject: (project: ProjectTreeState) => void;
  resolveDocumentId: (project: ProjectTreeState) => string | null;
  isDocumentInTree: (tree: ContentTree, documentId: string) => boolean;
  firstDocument: (tree: ContentTree) => { id: string } | null;
  hasUnsavedChanges: () => boolean;
  confirmDiscard: () => boolean | Promise<boolean>;
  clearRememberedDocument: (projectPath: string) => void;
}

export interface EditorDocumentSession {
  prepareDocument(documentId: string | null, tree?: ContentTree): Promise<PreparationResult>;
  prepareProject(project: ProjectTreeState): Promise<PreparationResult>;
  loadDocument(documentId: string): Promise<SessionResult>;
  showProject(project: ProjectTreeState): Promise<SessionResult>;
  applyTree(tree: ContentTree, canCommit?: () => boolean, installPeer?: () => void): Promise<SessionResult>;
  invalidate(): void;
}

export type SessionResult = { status: "committed" } | { status: "cancelled" } | { status: "stale" } | { status: "busy" }
  | { status: "failed"; error: Error };
export type PreparationResult = Exclude<SessionResult, { status: "committed" }>
  | { status: "prepared"; commit(installPeer?: () => void): SessionResult; dispose(): void };

export function createEditorDocumentSession(options: EditorDocumentSessionOptions): EditorDocumentSession {
  let generation = 0;

  function invalidate(): void {
    generation += 1;
  }

  async function read(projectPath: string, documentId: string): Promise<JSONContent> {
    let content: string;
    try {
      content = await options.readDocument(projectPath, documentId);
    } catch (error) {
      throw Object.assign(new Error(`读取文档失败：${error instanceof Error ? error.message : String(error)}`), { cause: error });
    }
    try {
      return parseNotebookDocumentJson(content).document;
    } catch (error) {
      throw Object.assign(new Error(`解析文档失败：${error instanceof Error ? error.message : String(error)}`), { cause: error });
    }
  }

  async function prepare(project: ProjectTreeState, documentId: string | null, projectLoad: boolean): Promise<PreparationResult> {
    const token = ++generation;
    const original = options.getProject();
    const originalId = options.getDocumentId();
    const valid = () => token === generation && options.getProject() === original && options.getDocumentId() === originalId;
    let next: EditorDocumentSessionEditor | null = null;
    try {
      const document = documentId === null ? emptyNotebookDocument().document : await read(project.projectPath, documentId);
      if (!valid()) return { status: "stale" };
      const container = options.dom.editorTextarea.ownerDocument.createElement("div");
      // No visible DOM, identity, baseline, memory or interaction subscriptions change here.
      next = documentId === null ? null : options.createEditor(container, document);
      let consumed = false;
      const dispose = () => {
        if (consumed) return;
        consumed = true;
        next?.destroy();
      };
      return {
        status: "prepared", dispose,
        commit: (installPeer) => {
          if (consumed || !valid()) { dispose(); return { status: "stale" }; }
          // All fallible reads, parsing and construction have finished. No await in installation.
          if (projectLoad) options.beforeLoadProject(project);
          options.disposeEditor();
          options.dom.editorTextarea.replaceChildren(...Array.from(container.childNodes));
          consumed = true;
          options.setProject(project);
          options.setDocumentId(documentId);
          options.setEditor(next);
          installPeer?.();
          if (documentId === null) options.clearBaseline();
          else options.setBaseline(document);
          if (next) { options.onEdit(next); options.onSelectionChange(next); }
          if (documentId === null) options.clearRememberedDocument(project.projectPath);
          if (projectLoad) options.onProjectLoaded(project, documentId);
          else options.onDocumentLoaded(project, documentId);
          return { status: "committed" };
        },
      };
    } catch (error) {
      next?.destroy();
      return valid() ? { status: "failed", error: error instanceof Error ? error : new Error(String(error)) } : { status: "stale" };
    }
  }

  async function prepareDocument(documentId: string | null, tree?: ContentTree): Promise<PreparationResult> {
    const project = options.getProject();
    if (!project) return { status: "stale" };
    return prepare(tree ? { ...project, tree } : project, documentId, false);
  }

  function prepareProject(project: ProjectTreeState): Promise<PreparationResult> {
    return prepare(project, options.resolveDocumentId(project), true);
  }

  async function loadDocument(documentId: string): Promise<SessionResult> {
    const candidate = await prepareDocument(documentId);
    return candidate.status === "prepared" ? candidate.commit() : candidate;
  }

  async function showProject(project: ProjectTreeState): Promise<SessionResult> {
    const candidate = await prepareProject(project);
    return candidate.status === "prepared" ? candidate.commit() : candidate;
  }

  async function applyTree(tree: ContentTree, canCommit = () => true, installPeer?: () => void): Promise<SessionResult> {
    const project = options.getProject();
    const currentDocumentId = options.getDocumentId();
    if (!project) return { status: "stale" };
    if (currentDocumentId === null || !options.isDocumentInTree(tree, currentDocumentId)) {
      if (options.hasUnsavedChanges() && !(await options.confirmDiscard())) return { status: "cancelled" };
      const first = options.firstDocument(tree);
      const candidate = await prepareDocument(first?.id ?? null, tree);
      if (candidate.status !== "prepared") return candidate;
      if (!canCommit()) { candidate.dispose(); return { status: "cancelled" }; }
      return candidate.commit(installPeer);
    }
    if (!canCommit()) return { status: "cancelled" };
    const next = { ...project, tree };
    options.setProject(next);
    installPeer?.();
    options.onTreeRefreshed(next, currentDocumentId);
    return { status: "committed" };
  }

  return { prepareDocument, prepareProject, loadDocument, showProject, applyTree, invalidate };
}
