import type { AppDom } from "./dom";
import { EditorSaveState } from "./editor-save-state";
import { LeaveCoordinator } from "./leave-guard";
import type { LeaveDialogController } from "./leave-dialog";
import { saveProject } from "./project-api";
import type { AiFeatureController } from "./ai-feature";
import type { NotebookTab, ProjectState } from "./types";
import { showPage } from "./views";

export interface EditorController {
  showProject(projectState: ProjectState): void;
  hasProject(): boolean;
  hasUnsavedChanges(): boolean;
  save(): Promise<boolean>;
  guardLeave(): Promise<boolean>;
  unload(): void;
  getCurrentTab(): NotebookTab;
  attachAi(ai: AiFeatureController): void;
}

export function setupEditor(dom: AppDom, leaveDialog: LeaveDialogController): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage, dom.llmConfigPage];
  let currentState: ProjectState | null = null;
  let saveState: EditorSaveState | null = null;
  let currentTab: NotebookTab = "draft";
  let aiFeature: AiFeatureController | null = null;

  function unload(): void {
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
    currentTab = tab;
    dom.tabDraft.classList.toggle("active", tab === "draft");
    dom.tabMain.classList.toggle("active", tab === "main");
    dom.draftTextarea.classList.toggle("hidden", tab !== "draft");
    dom.mainTextarea.classList.toggle("hidden", tab !== "main");
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
    saveState?.setCurrent(dom.draftTextarea.value, dom.mainTextarea.value);
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
      dom.draftTextarea.disabled = true;
      dom.mainTextarea.disabled = true;
    }
    try {
      return await leave.run();
    } finally {
      dom.draftTextarea.disabled = false;
      dom.mainTextarea.disabled = false;
    }
  }

  function showProject(projectState: ProjectState): void {
    currentState = projectState;
    saveState = new EditorSaveState(projectState.draftContent, projectState.mainContent);
    aiFeature?.beginProject();
    dom.currentProjectName.textContent = projectState.projectName;
    dom.draftTextarea.value = projectState.draftContent;
    dom.mainTextarea.value = projectState.mainContent;
    renderSaveState();
    switchTab("draft");
    showPage(pages, "editor-page");
  }

  dom.tabDraft.addEventListener("click", () => switchTab("draft"));
  dom.tabMain.addEventListener("click", () => switchTab("main"));
  dom.draftTextarea.addEventListener("input", syncCurrent);
  dom.mainTextarea.addEventListener("input", syncCurrent);
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
    getCurrentTab: () => currentTab,
    attachAi: (ai: AiFeatureController) => {
      aiFeature = ai;
    },
  };
}
