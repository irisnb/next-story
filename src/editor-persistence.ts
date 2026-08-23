import type { JSONContent } from "@tiptap/core";

import { EditorSaveState } from "./editor-save-state.ts";
import { notebookSizeError, saveDocument } from "./project-api.ts";
import {
  canonicalNotebookJson,
  serializeNotebookDocument,
  validateNotebookDocument,
} from "./structured-notebook.ts";

export interface EditorPersistenceEditor {
  getDocument(): JSONContent;
}

export interface EditorPersistenceProject {
  projectPath: string;
  documentId: string;
}

export interface EditorPersistenceOptions {
  saveStatus: HTMLElement;
  saveButton: HTMLButtonElement;
  getEditor: () => EditorPersistenceEditor | null;
  getProject: () => EditorPersistenceProject | null;
  write?: (projectPath: string, documentId: string, content: string) => Promise<void>;
  onStateChange?: () => void;
}

export interface EditorPersistence {
  setBaseline(document: JSONContent): void;
  clear(): void;
  setCurrent(document: JSONContent): void;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  render(): void;
}

export function createEditorPersistence(options: EditorPersistenceOptions): EditorPersistence {
  let saveState: EditorSaveState | null = null;

  function render(): void {
    if (!saveState) {
      options.saveStatus.textContent = "已保存";
      options.saveStatus.className = "save-status";
      options.saveButton.disabled = true;
      return;
    }
    options.saveStatus.textContent = saveState.statusText;
    options.saveStatus.className = "save-status";
    if (saveState.isSaving) options.saveStatus.classList.add("saving");
    else if (saveState.statusText.startsWith("保存失败")) options.saveStatus.classList.add("error");
    else if (saveState.hasUnsavedChanges) options.saveStatus.classList.add("unsaved");
    options.saveButton.disabled = saveState.isSaving || !saveState.hasUnsavedChanges;
  }

  function setBaseline(document: JSONContent): void {
    saveState = new EditorSaveState(canonicalNotebookJson(document));
    render();
  }

  function clear(): void {
    saveState = null;
    render();
  }

  function setCurrent(document: JSONContent): void {
    saveState?.setCurrent(canonicalNotebookJson(document));
    render();
    options.onStateChange?.();
  }

  async function save(): Promise<boolean> {
    const state = saveState;
    const project = options.getProject();
    const editor = options.getEditor();
    if (!state || !project || !editor) return true;

    const document = serializeNotebookDocument(editor.getDocument());
    const validation = validateNotebookDocument(document);
    if (!validation.ok) return rejectSave(`文档无法保存：${validation.error}`);
    const sizeError = notebookSizeError(JSON.stringify(document));
    if (sizeError) return rejectSave(`文档内容过大：${sizeError}`);

    const writer = options.write ?? saveDocument;
    const result = state.save((content) => writer(project.projectPath, project.documentId, content));
    render();
    const succeeded = await result;
    render();
    return succeeded;
  }

  async function rejectSave(message: string): Promise<boolean> {
    const state = saveState;
    if (!state) return true;
    const result = state.save(async () => { throw new Error(message); });
    render();
    const succeeded = await result;
    render();
    return succeeded;
  }

  return {
    setBaseline,
    clear,
    setCurrent,
    hasUnsavedChanges: () => saveState?.hasUnsavedChanges ?? false,
    save,
    render,
  };
}
