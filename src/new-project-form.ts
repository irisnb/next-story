import type { AppDom } from "./dom.ts";
import { createProject, openProject, selectDirectory } from "./project-api.ts";
import { openProjectAfterAuthorization } from "./project-leave-flow.ts";
import { emptyNotebookDocument } from "./structured-notebook.ts";
import type { ProjectState } from "./types.ts";
import { showPage } from "./views.ts";

interface ProjectFlowOptions {
  onProjectReady(projectState: ProjectState): void;
  guardLeave(): Promise<boolean>;
}

export function setupProjectFlow(dom: AppDom, options: ProjectFlowOptions): void {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];

  // 操作序号：新建/打开共用一条序列，只允许最新一次操作提交结果，
  // 防止迟到的异步结果（如慢速目录读取）覆盖更新操作产生的作品。
  let projectOperation = 0;
  // 打开作品忙碌锁：一次只允许一个打开流程，防止双击或并发点击交错。
  let openBusy = false;

  function beginOperation(): number {
    projectOperation += 1;
    return projectOperation;
  }

  function isLatest(operation: number): boolean {
    return operation === projectOperation;
  }

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
    const operation = beginOperation();

    try {
      dom.btnCreateProject.disabled = true;
      const projectPath = await createProject(name, saveLocation);
      if (!isLatest(operation)) return;
      const blank = JSON.stringify(emptyNotebookDocument());

      options.onProjectReady({
        projectPath,
        projectName: name,
        draftContent: blank,
        mainContent: blank,
      });
    } catch (error) {
      if (!isLatest(operation)) return;
      showError(dom.nameError, String(error));
      dom.btnCreateProject.disabled = false;
    }
  }

  async function handleOpenProject(): Promise<void> {
    if (openBusy) return;
    openBusy = true;
    const operation = beginOperation();
    try {
      await openProjectAfterAuthorization({
        authorize: options.guardLeave,
        selectDirectory: () => selectDirectory("选择作品文件夹"),
        openProject,
        replaceProject: (projectState) => {
          // 只允许最新一次打开操作提交，避免迟到的旧结果覆盖更新的作品。
          if (!isLatest(operation)) return;
          options.onProjectReady(projectState);
        },
        reportError: (error) => {
          if (!isLatest(operation)) return;
          console.error("打开作品失败:", error);
          alert(`打开作品失败: ${String(error)}`);
        },
      });
    } finally {
      openBusy = false;
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
