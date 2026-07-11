import type { NotebookTab } from "./types";

export class NotebookMemory {
  active: NotebookTab = "draft";
  private contents: Record<NotebookTab, string>;

  constructor(draft: string, main: string) {
    this.contents = { draft, main };
  }

  switchTo(tab: NotebookTab): void {
    this.active = tab;
  }

  update(tab: NotebookTab, value: string): void {
    this.contents[tab] = value;
  }

  value(tab: NotebookTab): string {
    return this.contents[tab];
  }
}
