import type { AppDom } from "./dom.ts";
import {
  createProject,
  loadRecentWorks,
  openContentTree,
  openProject,
  selectDirectory,
  type RecentWorkEntry,
} from "./project-api.ts";
import { openProjectAfterAuthorization } from "./project-leave-flow.ts";
import type { ProjectTreeState } from "./types.ts";
import { showPage } from "./views.ts";

interface ProjectFlowOptions {
  onProjectReady(projectState: ProjectTreeState): Promise<void> | void;
  guardLeave(): Promise<boolean>;
}

/** setupProjectFlow 返回的句柄：供编排层在返回欢迎页时刷新最近作品列表。 */
export interface ProjectFlowHandle {
  refreshRecentWorks(): Promise<void>;
}

/**
 * 渲染欢迎页最近作品列表：每个条目是「作品名＋路径副文本」的按钮；列表为空时
 * 显示空态文案。条目点击经 `onOpenEntry` 回调交给宿主走与「打开作品」相同的
 * 打开流程。失效条目由后端读取命令过滤，前端只渲染收到的条目。
 */
export function renderRecentWorkEntries(
  container: HTMLElement,
  emptyState: HTMLElement,
  entries: readonly RecentWorkEntry[],
  onOpenEntry: (entry: RecentWorkEntry) => void,
): void {
  container.replaceChildren();
  emptyState.classList.toggle("hidden", entries.length > 0);
  for (const entry of entries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "action-btn recent-work-item";
    item.title = entry.path;
    const name = document.createElement("span");
    name.className = "recent-work-name";
    name.textContent = entry.name;
    const lineBreak = document.createElement("br");
    const path = document.createElement("span");
    path.className = "recent-work-path";
    path.textContent = entry.path;
    // 路径常含长串无空格字符，允许在任意字符处换行，避免溢出按钮。
    path.style.wordBreak = "break-all";
    item.append(name, lineBreak, path);
    item.addEventListener("click", () => onOpenEntry(entry));
    container.append(item);
  }
}

export function setupProjectFlow(dom: AppDom, options: ProjectFlowOptions): ProjectFlowHandle {
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];

  // 操作序号：新建/打开共用一条序列，只允许最新一次操作提交结果，
  // 防止迟到的异步结果（如慢速目录读取）覆盖更新操作产生的作品。
  let projectOperation = 0;
  // 打开作品忙碌锁：一次只允许一个打开流程，防止双击或并发点击交错。
  let openBusy = false;
  // 最近作品列表：欢迎页加载一次，列表展示与「打开作品」对话框初始位置复用同一份数据。
  let recentWorks: RecentWorkEntry[] = [];

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
      // 「新建作品」的浏览按钮不传初始位置（Non-Goal），保持现状。
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
      // 新建作品默认一篇文档；读取整棵内容树供前端确定当前文档。
      const tree = await openContentTree(projectPath);
      if (!isLatest(operation)) return;

      await options.onProjectReady({
        projectPath,
        projectName: name,
        tree,
      });
    } catch (error) {
      if (!isLatest(operation)) return;
      showError(dom.nameError, String(error));
      dom.btnCreateProject.disabled = false;
    }
  }

  // 「打开作品」与最近作品条目共用的打开流程：忙碌锁 + 操作序号 + 授权打开链。
  // `selectDirectory` 由调用方提供——对话框选择或最近作品条目路径都走这一条链。
  async function runOpenProjectFlow(
    chooseDirectory: () => Promise<string | null>,
  ): Promise<void> {
    if (openBusy) return;
    openBusy = true;
    const operation = beginOperation();
    try {
      await openProjectAfterAuthorization({
        authorize: options.guardLeave,
        selectDirectory: chooseDirectory,
        openProject,
        replaceProject: (projectState) => {
          // 只允许最新一次打开操作提交，避免迟到的旧结果覆盖更新的作品。
          if (!isLatest(operation)) return;
          return options.onProjectReady(projectState);
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

  async function handleOpenProject(): Promise<void> {
    // 最近作品非空时，以最近一条路径为文件夹对话框初始位置；空列表不传。
    const initialPath = recentWorks[0]?.path;
    await runOpenProjectFlow(() => selectDirectory("选择作品文件夹", initialPath));
  }

  /** 读取并渲染最近作品列表：读取失败按空列表处理（失败开放），不打断欢迎页。 */
  async function refreshRecentWorks(): Promise<void> {
    try {
      recentWorks = await loadRecentWorks();
    } catch (error) {
      console.error("读取最近作品失败:", error);
      recentWorks = [];
    }
    renderRecentWorkEntries(
      dom.recentWorksList,
      dom.recentWorksEmpty,
      recentWorks,
      (entry) => {
        // 点击条目走与「打开作品」完全相同的打开流程（含离开当前作品的确认）。
        void runOpenProjectFlow(async () => entry.path);
      },
    );
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

  // 欢迎页启动即加载最近作品（供列表展示与「打开作品」初始位置复用）。
  void refreshRecentWorks();

  return { refreshRecentWorks };
}
