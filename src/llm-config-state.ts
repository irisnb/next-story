import type { LlmConfig } from "./types.ts";

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
  private discardAuthorized = false;
  private baseline: LlmConfig | null = null;

  beginOpen(returnPage: LlmConfigReturnPage): number {
    this.returnPage = returnPage;
    this.refreshGeneration += 1;
    this.loading = true;
    this.dirty = false;
    this.discardAuthorized = false;
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
    this.discardAuthorized = false;
  }

  commitBaseline(config: LlmConfig): void {
    this.baseline = { ...config };
    this.dirty = false;
    this.discardAuthorized = false;
  }

  discardChanges(): void {
    this.dirty = false;
    this.discardAuthorized = true;
  }

  hasUnsavedChanges(config: LlmConfig): boolean {
    return !this.discardAuthorized && !sameConfig(config, this.baseline);
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

function sameConfig(left: LlmConfig, right: LlmConfig | null): boolean {
  if (!right) {
    return left.api_base_url === "" && left.api_key === "" && left.model === "";
  }

  return left.api_base_url === right.api_base_url
    && left.api_key === right.api_key
    && left.model === right.model;
}
