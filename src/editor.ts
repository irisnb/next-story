import type { AppDom } from "./dom.ts";
import { EditorSaveState } from "./editor-save-state.ts";
import { LeaveCoordinator } from "./leave-guard.ts";
import type { LeaveDialogController } from "./leave-dialog.ts";
import {
  createPlainTextEditor,
  type PlainTextEditorAdapter,
} from "./plain-text-editor.ts";
import { saveProject } from "./project-api.ts";
import type { AiFeatureController } from "./ai-feature.ts";
import type { SelectionEntryEditor } from "./selection-entry.ts";
import type { NotebookTab, ProjectState } from "./types.ts";
import { showPage } from "./views.ts";

export interface EditorController {
  showProject(projectState: ProjectState): void;
  hasProject(): boolean;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
  unload(): void;
  destroy(): void;
  getCurrentTab(): NotebookTab;
  getCurrentEditor(): SelectionEntryEditor | null;
  attachAi(ai: AiFeatureController): void;
}

type EditorAdapter = Pick<
  PlainTextEditorAdapter,
  "getText" | "onEdit" | "focus" | "getSelection" | "getHeadCoordinates" | "coordinatesAt" | "destroy"
>;

interface EditorDependencies {
  createEditor(element: HTMLElement, initialText: string): EditorAdapter;
}

interface ProjectEditors {
  draft: EditorAdapter;
  main: EditorAdapter;
  unsubscribeDraft: () => void;
  unsubscribeMain: () => void;
}

const defaultDependencies: EditorDependencies = {
  createEditor: createPlainTextEditor,
};

export function setupEditor(
  dom: AppDom,
  leaveDialog: LeaveDialogController,
  dependencies: EditorDependencies = defaultDependencies,
): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage, dom.llmConfigPage];
  let currentState: ProjectState | null = null;
  let saveState: EditorSaveState | null = null;
  let projectEditors: ProjectEditors | null = null;
  let currentTab: NotebookTab = "draft";
  let aiFeature: AiFeatureController | null = null;

  function disposeProjectEditors(): void {
    const editors = projectEditors;
    projectEditors = null;
    if (!editors) return;
    editors.unsubscribeDraft();
    editors.unsubscribeMain();
    editors.draft.destroy();
    editors.main.destroy();
  }

  function unload(): void {
    disposeProjectEditors();
    currentState = null;
    saveState = null;
    aiFeature?.endProject();
  }

  const leave = new LeaveCoordinator({
    isDirty: () => saveState?.hasUnsavedChanges ?? false,
    choose: leaveDialog.choose,
    save,
  });

  function switchTab(tab: NotebookTab): void {
    const changedTab = currentTab !== tab;
    currentTab = tab;
    dom.tabDraft.classList.toggle("active", tab === "draft");
    dom.tabMain.classList.toggle("active", tab === "main");
    dom.draftTextarea.classList.toggle("hidden", tab !== "draft");
    dom.mainTextarea.classList.toggle("hidden", tab !== "main");
    if (changedTab) aiFeature?.resetSelectionEntry();
  }

  function renderSaveState(): void {
    if (!saveState) return;
    dom.saveStatus.textContent = saveState.statusText;
    dom.saveStatus.className = "save-status";
    if (saveState.isSaving) dom.saveStatus.classList.add("saving");
    else if (saveState.statusText.startsWith("保存失败")) dom.saveStatus.classList.add("error");
    else if (saveState.hasUnsavedChanges) dom.saveStatus.classList.add("unsaved");
    dom.btnSave.disabled = saveState.isSaving || !saveState.hasUnsavedChanges;
  }

  function syncCurrent(): void {
    const editors = projectEditors;
    if (!editors) return;
    saveState?.setCurrent(editors.draft.getText(), editors.main.getText());
    renderSaveState();
  }

  async function save(): Promise<boolean> {
    if (!currentState || !saveState) return true;
    const state = saveState;
    const path = currentState.projectPath;
    const result = state.save((snapshot) => saveProject(path, snapshot.draft, snapshot.main));
    renderSaveState();
    const succeeded = await result;
    renderSaveState();
    return succeeded;
  }

  async function guardCurrentLeave(): Promise<boolean> {
    const dirty = saveState?.hasUnsavedChanges ?? false;
    if (dirty) {
      dom.draftTextarea.inert = true;
      dom.mainTextarea.inert = true;
    }
    try {
      return await leave.run();
    } finally {
      dom.draftTextarea.inert = false;
      dom.mainTextarea.inert = false;
    }
  }

  function showProject(projectState: ProjectState): void {
    disposeProjectEditors();
    currentState = projectState;
    saveState = new EditorSaveState(projectState.draftContent, projectState.mainContent);
    const draft = dependencies.createEditor(dom.draftTextarea, projectState.draftContent);
    const main = dependencies.createEditor(dom.mainTextarea, projectState.mainContent);
    const editors: ProjectEditors = {
      draft,
      main,
      unsubscribeDraft: () => {},
      unsubscribeMain: () => {},
    };
    projectEditors = editors;
    editors.unsubscribeDraft = draft.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    editors.unsubscribeMain = main.onEdit(() => {
      if (projectEditors === editors) syncCurrent();
    });
    aiFeature?.beginProject();
    dom.currentProjectName.textContent = projectState.projectName;
    renderSaveState();
    switchTab("draft");
    showPage(pages, "editor-page");
  }

  dom.tabDraft.addEventListener("click", () => switchTab("draft"));
  dom.tabMain.addEventListener("click", () => switchTab("main"));
  dom.btnSave.addEventListener("click", () => { void save(); });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (saveState?.hasUnsavedChanges) void save();
    }
  });

  return {
    showProject,
    hasProject: () => currentState !== null,
    hasUnsavedChanges: () => saveState?.hasUnsavedChanges ?? false,
    save,
    guardLeave: guardCurrentLeave,
    unload,
    destroy: unload,
    getCurrentTab: () => currentTab,
    getCurrentEditor: () => {
      const editors = projectEditors;
      if (editors === null) return null;
      const editor = editors[currentTab];
      const element = currentTab === "draft" ? dom.draftTextarea : dom.mainTextarea;
      return {
        element,
        getText: () => editor.getText(),
        getSelection: () => editor.getSelection(),
        coordinatesAt: (position) => editor.coordinatesAt(position),
      };
    },
    attachAi: (ai: AiFeatureController) => {
      aiFeature = ai;
    },
  };
}
