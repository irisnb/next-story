import type { AppDom } from "./dom.ts";
import { showMessage } from "./app-dialog.ts";
import {
  createProject,
  loadRecentWorks,
  openContentTree,
  openProject,
  selectDirectory,
} from "./project-api.ts";
import { openProjectAfterAuthorization } from "./project-leave-flow.ts";
import type { ProjectTreeState, ProjectOpenResult, ContentTree } from "./types.ts";
import type { RecentWorkEntry } from "./project-api.ts";
import { showPage } from "./views.ts";

interface ProjectFlowOptions {
  onProjectReady(projectState: ProjectTreeState): Promise<void> | void;
  guardLeave(): Promise<boolean>;
  isBusy?(): boolean;
  protect?(target: string): Promise<void>;
  release?(): void;
  isCurrent?(): boolean;
  services?: {
    createProject(name: string, location: string): Promise<string>;
    openContentTree(path: string): Promise<ContentTree>;
    openProject(path: string): Promise<ProjectOpenResult>;
    loadRecentWorks(): Promise<RecentWorkEntry[]>;
  };
}

export type ProjectFlowResult = { status: "committed" | "cancelled" | "busy" | "stale" }
  | { status: "failed"; error: unknown };

/** setupProjectFlow 返回的句柄：供编排层在返回欢迎页时刷新最近作品列表。 */
export interface ProjectFlowHandle {
  refreshRecentWorks(): Promise<void>;
  open(): Promise<ProjectFlowResult>;
  openPath(path: string): Promise<ProjectFlowResult>;
  create(): Promise<ProjectFlowResult>;
  isBusy(): boolean;
  destroy(): void;
}

/**
 * 渲染欢迎页最近作品列表：每个条目是「文档图标＋作品名＋路径副文本」的紧凑
 * 列表行（视觉上次级于主操作按钮）；列表为空时显示空态文案。条目点击经
 * `onOpenEntry` 回调交给宿主走与「打开作品」相同的打开流程。失效条目由后端
 * 读取命令过滤，前端只渲染收到的条目。
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
    item.className = "recent-work-item";
    item.title = entry.path;
    // 图标复用 index.html 顶部 SVG 精灵里的文档符号（与内容树文档同款）。
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "recent-work-ic");
    icon.setAttribute("aria-hidden", "true");
    const iconUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    iconUse.setAttribute("href", "#i-doc");
    icon.append(iconUse);
    const name = document.createElement("span");
    name.className = "recent-work-name";
    name.textContent = entry.name;
    const path = document.createElement("span");
    path.className = "recent-work-path";
    path.textContent = entry.path;
    item.append(icon, name, path);
    item.addEventListener("click", () => onOpenEntry(entry));
    container.append(item);
  }
}

export function setupProjectFlow(dom: AppDom, options: ProjectFlowOptions): ProjectFlowHandle {
  const services = { createProject, openContentTree, openProject, loadRecentWorks, ...options.services };
  const pages = [dom.welcomePage, dom.newProjectPage, dom.editorPage];

  // 操作序号：新建/打开共用一条序列，只允许最新一次操作提交结果，
  // 防止迟到的异步结果（如慢速目录读取）覆盖更新操作产生的作品。
  let projectOperation = 0;
  // 打开作品忙碌锁：一次只允许一个打开流程，防止双击或并发点击交错。
  let openBusy = false;
  let createBusy = false;
  let destroyed = false;
  let createdPath: string | null = null;
  let formGeneration = 0;
  // 最近作品列表：欢迎页加载一次，列表展示与「打开作品」对话框初始位置复用同一份数据。
  let recentWorks: RecentWorkEntry[] = [];

  function beginOperation(): number {
    projectOperation += 1;
    return projectOperation;
  }

  function isLatest(operation: number): boolean {
    return !destroyed && operation === projectOperation;
  }

  function busy(): boolean { return destroyed || openBusy || createBusy || (options.isBusy?.() ?? false); }
  function renderBusy(): void {
    const locked = openBusy || createBusy;
    dom.btnOpenProject.disabled = locked;
    dom.btnNewProject.disabled = locked;
    dom.btnCancelNew.disabled = locked;
    dom.btnBrowse.disabled = locked || createdPath !== null;
    dom.projectNameInput.disabled = locked || createdPath !== null;
    dom.saveLocationInput.disabled = locked || createdPath !== null;
    dom.btnCreateProject.disabled = locked || createdPath !== null ||
      !dom.projectNameInput.value.trim() || !dom.saveLocationInput.value.trim();
    for (const item of Array.from(dom.recentWorksList.children)) (item as HTMLButtonElement).disabled = locked;
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

    dom.btnCreateProject.disabled = !isValid || openBusy || createBusy || createdPath !== null;
    return isValid;
  }

  function resetNewProjectForm(): void {
    formGeneration += 1;
    createdPath = null;
    dom.projectNameInput.value = "";
    dom.saveLocationInput.value = "";
    hideError(dom.nameError);
    hideError(dom.locationError);
    dom.btnCreateProject.disabled = true;
    renderBusy();
  }

  async function chooseSaveLocation(): Promise<void> {
    if (busy() || createdPath) return;
    const generation = formGeneration;
    try {
      // 「新建作品」的浏览按钮不传初始位置（Non-Goal），保持现状。
      const selected = await selectDirectory("选择保存位置");
      if (selected && generation === formGeneration && !busy() && !createdPath) {
        dom.saveLocationInput.value = selected;
        validateForm();
      }
    } catch (error) {
      console.error("选择文件夹失败:", error);
    }
  }

  async function handleCreateProject(): Promise<ProjectFlowResult> {
    if (busy()) return { status: "busy" };
    if (createdPath || !validateForm()) return { status: "cancelled" };

    const name = dom.projectNameInput.value.trim();
    const saveLocation = dom.saveLocationInput.value.trim();
    const operation = beginOperation();
    createBusy = true;
    renderBusy();

    try {
      await options.protect?.(name);
      if (!isLatest(operation)) return { status: "stale" };
      if (!await options.guardLeave()) return { status: "cancelled" };
      if (!isLatest(operation) || options.isCurrent?.() === false) return { status: "stale" };
      const projectPath = await services.createProject(name, saveLocation);
      if (!isLatest(operation)) return { status: "stale" };
      createdPath = projectPath;
      // 新建作品默认一篇文档；读取整棵内容树供前端确定当前文档。
      const tree = await services.openContentTree(projectPath);
      if (!isLatest(operation) || options.isCurrent?.() === false) return { status: "stale" };

      await options.onProjectReady({
        projectPath,
        projectName: name,
        tree,
      });
      return { status: "committed" };
    } catch (error) {
      if (!isLatest(operation) || options.isCurrent?.() === false) return { status: "stale" };
      showError(dom.nameError, createdPath
        ? `作品已创建，但未能打开：${String(error)}。文件夹：${createdPath}。可使用“打开作品”重试。`
        : `未能创建作品：${String(error)}`);
      return { status: "failed", error };
    } finally {
      if (isLatest(operation)) {
        createBusy = false;
        try { renderBusy(); }
        finally { options.release?.(); }
      }
    }
  }

  // 「打开作品」与最近作品条目共用的打开流程：忙碌锁 + 操作序号 + 授权打开链。
  // `selectDirectory` 由调用方提供——对话框选择或最近作品条目路径都走这一条链。
  async function runOpenProjectFlow(
    chooseDirectory: () => Promise<string | null>,
  ): Promise<ProjectFlowResult> {
    if (busy()) return { status: "busy" };
    openBusy = true;
    const operation = beginOperation();
    renderBusy();
    try {
      const status = await openProjectAfterAuthorization({
        authorize: options.guardLeave,
        protect: options.protect,
        isCurrent: () => isLatest(operation) && options.isCurrent?.() !== false,
        selectDirectory: chooseDirectory,
        openProject: services.openProject,
        replaceProject: options.onProjectReady,
      });
      return { status };
    } catch (error) {
      if (!isLatest(operation) || options.isCurrent?.() === false) return { status: "stale" };
      showMessage(`打开作品失败：${String(error)}`);
      return { status: "failed", error };
    } finally {
      if (isLatest(operation)) {
        openBusy = false;
        try { renderBusy(); }
        finally { options.release?.(); }
      }
    }
  }

  async function handleOpenProject(): Promise<ProjectFlowResult> {
    // 最近作品非空时，以最近一条路径为文件夹对话框初始位置；空列表不传。
    const initialPath = recentWorks[0]?.path;
    return runOpenProjectFlow(() => selectDirectory("选择作品文件夹", initialPath));
  }

  /** 读取并渲染最近作品列表：读取失败按空列表处理（失败开放），不打断欢迎页。 */
  async function refreshRecentWorks(): Promise<void> {
    try {
      recentWorks = await services.loadRecentWorks();
    } catch (error) {
      console.error("读取最近作品失败:", error);
      recentWorks = [];
    }
    if (destroyed) return;
    renderRecentWorkEntries(
      dom.recentWorksList,
      dom.recentWorksEmpty,
      recentWorks,
      (entry) => {
        // 点击条目走与「打开作品」完全相同的打开流程（含离开当前作品的确认）。
        void runOpenProjectFlow(async () => entry.path);
      },
    );
    renderBusy();
  }

  dom.btnNewProject.addEventListener("click", () => {
    if (busy()) return;
    resetNewProjectForm();
    showPage(pages, "new-project-page");
  });
  dom.btnOpenProject.addEventListener("click", () => { void handleOpenProject(); });
  dom.btnBrowse.addEventListener("click", chooseSaveLocation);
  dom.btnCancelNew.addEventListener("click", () => {
    if (!busy()) { formGeneration += 1; showPage(pages, "welcome-page"); }
  });
  dom.btnCreateProject.addEventListener("click", () => { void handleCreateProject(); });
  dom.projectNameInput.addEventListener("input", validateForm);

  // 欢迎页启动即加载最近作品（供列表展示与「打开作品」初始位置复用）。
  void refreshRecentWorks();

  return { refreshRecentWorks, open: handleOpenProject, openPath: (path) => runOpenProjectFlow(async () => path),
    create: handleCreateProject, isBusy: busy,
    destroy() { destroyed = true; projectOperation += 1; formGeneration += 1; options.release?.(); } };
}
