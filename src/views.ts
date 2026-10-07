export type PageId = "welcome-page" | "new-project-page" | "editor-page";

/** 编辑器页内的四个模块视图（制作模块为第四页，add-making-module-core 任务 7.1）。 */
export type ModuleId = "writing" | "files" | "settings" | "making";

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
  making: HTMLElement;
}

/** 切换到编辑器页内的指定模块视图（写作 / 文件管理 / 设置 / 制作模块）。 */
export function showModule(views: ModuleViews, moduleId: ModuleId): void {
  views.writing.classList.add("hidden");
  views.files.classList.add("hidden");
  views.settings.classList.add("hidden");
  views.making.classList.add("hidden");
  views[moduleId].classList.remove("hidden");
}
