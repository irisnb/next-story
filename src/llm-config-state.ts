export type LlmConfigReturnPage = "welcome-page" | "editor-page";

export interface RefreshCompletion {
  isCurrent: boolean;
  shouldApply: boolean;
}

export class LlmConfigUiState {
  returnPage: LlmConfigReturnPage = "welcome-page";

  private refreshGeneration = 0;
  private loading = false;
  private busy = false;
  private dirty = false;

  beginOpen(returnPage: LlmConfigReturnPage): number {
    this.returnPage = returnPage;
    this.refreshGeneration += 1;
    this.loading = true;
    this.dirty = false;
    return this.refreshGeneration;
  }

  completeRefresh(generation: number): RefreshCompletion {
    if (generation !== this.refreshGeneration) {
      return { isCurrent: false, shouldApply: false };
    }

    this.loading = false;
    return { isCurrent: true, shouldApply: !this.dirty };
  }

  markDirty(): void {
    this.dirty = true;
  }

  beginOperation(isValid: boolean): boolean {
    if (!isValid || this.loading || this.busy) {
      return false;
    }

    this.busy = true;
    return true;
  }

  endOperation(): void {
    this.busy = false;
  }

  controlsDisabled(isValid: boolean): boolean {
    return this.loading || this.busy || !isValid;
  }

  fieldsDisabled(): boolean {
    return this.loading || this.busy;
  }
}
