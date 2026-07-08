import type { AppDom } from "./dom";
import { saveProject } from "./project-api";
import type { NotebookTab, ProjectState } from "./types";
import { showPage } from "./views";

export interface EditorController {
  showProject(projectState: ProjectState): void;
}

export function setupEditor(dom: AppDom): EditorController {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];
  let currentState: ProjectState | null = null;
  let saveInProgress = false;

  function switchTab(tab: NotebookTab): void {
    if (tab === "draft") {
      dom.tabDraft.classList.add("active");
      dom.tabMain.classList.remove("active");
      dom.draftTextarea.classList.remove("hidden");
      dom.mainTextarea.classList.add("hidden");
      return;
    }

    dom.tabDraft.classList.remove("active");
    dom.tabMain.classList.add("active");
    dom.draftTextarea.classList.add("hidden");
    dom.mainTextarea.classList.remove("hidden");
  }

  function updateSaveStatus(hasChanges: boolean): void {
    if (saveInProgress) {
      dom.saveStatus.textContent = "正在保存...";
      dom.saveStatus.className = "save-status saving";
      dom.btnSave.disabled = true;
      return;
    }

    if (hasChanges) {
      dom.saveStatus.textContent = "有未保存更改";
      dom.saveStatus.className = "save-status unsaved";
      dom.btnSave.disabled = false;
      return;
    }

    dom.saveStatus.textContent = "已保存";
    dom.saveStatus.className = "save-status";
    dom.btnSave.disabled = true;
  }

  function markUnsaved(): void {
    if (!currentState) {
      return;
    }

    currentState.draftContent = dom.draftTextarea.value;
    currentState.mainContent = dom.mainTextarea.value;
    currentState.hasUnsavedChanges = true;
    updateSaveStatus(true);
  }

  async function handleSave(): Promise<void> {
    if (!currentState || saveInProgress) {
      return;
    }

    saveInProgress = true;
    updateSaveStatus(true);

    try {
      const draftContent = dom.draftTextarea.value;
      const mainContent = dom.mainTextarea.value;

      await saveProject(currentState.projectPath, draftContent, mainContent);

      currentState.draftContent = draftContent;
      currentState.mainContent = mainContent;
      currentState.hasUnsavedChanges = false;
      saveInProgress = false;
      updateSaveStatus(false);
    } catch (error) {
      saveInProgress = false;
      dom.saveStatus.textContent = `保存失败: ${String(error)}`;
      dom.saveStatus.className = "save-status error";
      dom.btnSave.disabled = false;
    }
  }

  function showProject(projectState: ProjectState): void {
    currentState = projectState;
    dom.currentProjectName.textContent = currentState.projectName;
    dom.draftTextarea.value = currentState.draftContent;
    dom.mainTextarea.value = currentState.mainContent;
    updateSaveStatus(false);
    switchTab("draft");
    showPage(pages, "editor-page");
  }

  dom.tabDraft.addEventListener("click", () => switchTab("draft"));
  dom.tabMain.addEventListener("click", () => switchTab("main"));
  dom.draftTextarea.addEventListener("input", markUnsaved);
  dom.mainTextarea.addEventListener("input", markUnsaved);
  dom.btnSave.addEventListener("click", handleSave);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      if (currentState?.hasUnsavedChanges) {
        handleSave();
      }
    }
  });

  return { showProject };
}
