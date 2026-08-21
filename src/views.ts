export type PageId = "welcome-page" | "new-project-page" | "editor-page";

/** 编辑器页内的三个模块视图。 */
export type ModuleId = "writing" | "files" | "settings";

export function showPage(pages: HTMLElement[], pageId: PageId): void {
  for (const page of pages) {
    page.classList.add("hidden");
  }

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.remove("hidden");
  }
}

export interface ModuleViews {
  writing: HTMLElement;
  files: HTMLElement;
  settings: HTMLElement;
}

/** 切换到编辑器页内的指定模块视图（写作 / 文件管理 / 设置）。 */
export function showModule(views: ModuleViews, moduleId: ModuleId): void {
  views.writing.classList.add("hidden");
  views.files.classList.add("hidden");
  views.settings.classList.add("hidden");
  views[moduleId].classList.remove("hidden");
}
