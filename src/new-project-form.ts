import type { AppDom } from "./dom";
import { createProject, openProject, selectDirectory } from "./project-api";
import type { ProjectState } from "./types";
import { showPage } from "./views";

interface ProjectFlowOptions {
  onProjectReady(projectState: ProjectState): void;
}

export function setupProjectFlow(dom: AppDom, options: ProjectFlowOptions): void {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];

  function hideError(element: HTMLElement): void {
    element.classList.add("hidden");
    element.textContent = "";
  }

  function showError(element: HTMLElement, message: string): void {
    element.textContent = message;
    element.classList.remove("hidden");
  }

  function validateForm(): boolean {
    const name = dom.projectNameInput.value.trim();
    const location = dom.saveLocationInput.value.trim();
    let isValid = true;

    if (!name) {
      showError(dom.nameError, "请输入作品名称");
      isValid = false;
    } else {
      hideError(dom.nameError);
    }

    if (!location) {
      showError(dom.locationError, "请选择保存位置");
      isValid = false;
    } else {
      hideError(dom.locationError);
    }

    dom.btnCreateProject.disabled = !isValid;
    return isValid;
  }

  function resetNewProjectForm(): void {
    dom.projectNameInput.value = "";
    dom.saveLocationInput.value = "";
    hideError(dom.nameError);
    hideError(dom.locationError);
    dom.btnCreateProject.disabled = true;
  }

  async function chooseSaveLocation(): Promise<void> {
    try {
      const selected = await selectDirectory("选择保存位置");
      if (selected) {
        dom.saveLocationInput.value = selected;
        validateForm();
      }
    } catch (error) {
      console.error("选择文件夹失败:", error);
    }
  }

  async function handleCreateProject(): Promise<void> {
    if (!validateForm()) {
      return;
    }

    const name = dom.projectNameInput.value.trim();
    const saveLocation = dom.saveLocationInput.value.trim();

    try {
      dom.btnCreateProject.disabled = true;
      const projectPath = await createProject(name, saveLocation);

      options.onProjectReady({
        projectPath,
        projectName: name,
        draftContent: "",
        mainContent: "",
        hasUnsavedChanges: false,
      });
    } catch (error) {
      showError(dom.nameError, String(error));
      dom.btnCreateProject.disabled = false;
    }
  }

  async function handleOpenProject(): Promise<void> {
    try {
      const selected = await selectDirectory("选择作品文件夹");
      if (!selected) {
        return;
      }

      const result = await openProject(selected);
      options.onProjectReady({
        projectPath: selected,
        projectName: result.metadata.name,
        draftContent: result.draft_content,
        mainContent: result.main_content,
        hasUnsavedChanges: false,
      });
    } catch (error) {
      console.error("打开作品失败:", error);
      alert(`打开作品失败: ${String(error)}`);
    }
  }

  dom.btnNewProject.addEventListener("click", () => {
    resetNewProjectForm();
    showPage(pages, "new-project-page");
  });
  dom.btnOpenProject.addEventListener("click", handleOpenProject);
  dom.btnBrowse.addEventListener("click", chooseSaveLocation);
  dom.btnCancelNew.addEventListener("click", () => showPage(pages, "welcome-page"));
  dom.btnCreateProject.addEventListener("click", handleCreateProject);
  dom.projectNameInput.addEventListener("input", validateForm);
}
