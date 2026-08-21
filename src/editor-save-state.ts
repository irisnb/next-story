export type SaveWriter = (content: string) => Promise<void>;

/**
 * 单个当前文档的保存状态：跟踪「当前规范化内容」与「已保存基线」，
 * 未保存判定只针对当前正在编辑的文档。保存中冻结快照，保存失败保留失败提示。
 */
export class EditorSaveState {
  private current: string;
  private baseline: string;
  private savePromise: Promise<boolean> | null = null;
  private failureMessage: string | null = null;

  constructor(content: string) {
    this.current = content;
    this.baseline = content;
  }

  get hasUnsavedChanges(): boolean {
    return this.current !== this.baseline;
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

  setCurrent(content: string): void {
    this.current = content;
    this.failureMessage = null;
  }

  save(writer: SaveWriter): Promise<boolean> {
    if (this.savePromise) {
      return this.savePromise;
    }

    const snapshot = this.current;
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
