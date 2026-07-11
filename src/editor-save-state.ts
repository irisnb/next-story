export interface NotebookContents {
  draft: string;
  main: string;
}

export type SaveWriter = (snapshot: NotebookContents) => Promise<void>;

export class EditorSaveState {
  private current: NotebookContents;
  private baseline: NotebookContents;
  private savePromise: Promise<boolean> | null = null;
  private failureMessage: string | null = null;

  constructor(draft: string, main: string) {
    this.current = { draft, main };
    this.baseline = { draft, main };
  }

  get hasUnsavedChanges(): boolean {
    return (
      this.current.draft !== this.baseline.draft ||
      this.current.main !== this.baseline.main
    );
  }

  get isSaving(): boolean {
    return this.savePromise !== null;
  }

  get statusText(): string {
    if (this.isSaving) {
      return "正在保存…";
    }
    if (this.failureMessage) {
      return `保存失败：${this.failureMessage}`;
    }
    return this.hasUnsavedChanges ? "有未保存修改" : "已保存";
  }

  setCurrent(draft: string, main: string): void {
    this.current = { draft, main };
    this.failureMessage = null;
  }

  save(writer: SaveWriter): Promise<boolean> {
    if (this.savePromise) {
      return this.savePromise;
    }

    const snapshot = { ...this.current };
    this.failureMessage = null;
    this.savePromise = writer(snapshot).then(
      () => {
        this.baseline = snapshot;
        return true;
      },
      (error: unknown) => {
        this.failureMessage = error instanceof Error ? error.message : String(error);
        return false;
      },
    ).finally(() => {
      this.savePromise = null;
    });
    return this.savePromise;
  }
}
