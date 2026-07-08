export type PageId = "welcome-page" | "new-project-page" | "editor-page";

export function showPage(pages: HTMLElement[], pageId: PageId): void {
  for (const page of pages) {
    page.classList.add("hidden");
  }

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.remove("hidden");
  }
}
