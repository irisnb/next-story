import type { LlmConfig } from "./types.ts";

export interface RefreshCompletion {
  isCurrent: boolean;
  shouldApply: boolean;
}

/**
 * 干净基线只记录非敏感字段与「是否已有已保存密钥」，绝不记录明文密钥。
 * 密钥输入区在加载后只显示掩码；用户主动输入的新密钥视为未保存修改。
 */
export interface LlmConfigBaseline {
  api_base_url: string;
  model: string;
  hasApiKey: boolean;
}

export class LlmConfigUiState {
  private refreshGeneration = 0;
  private loading = false;
  private busy = false;
  private dirty = false;
  private discardAuthorized = false;
  private baseline: LlmConfigBaseline | null = null;

  beginOpen(): number {
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

  /**
   * 提交干净基线。`hasApiKey` 未显式给出时：本次提交携带了新密钥 → 有密钥；
   * 否则沿用旧基线（保存/测试省略密钥时后端复用钥匙串旧密钥）。
   */
  commitBaseline(config: LlmConfig, hasApiKey?: boolean): void {
    const keySaved =
      hasApiKey ?? (config.api_key !== undefined || (this.baseline?.hasApiKey ?? false));
    this.baseline = {
      api_base_url: config.api_base_url,
      model: config.model,
      hasApiKey: keySaved,
    };
    this.dirty = false;
    this.discardAuthorized = false;
  }

  /** 是否已存在可被后端复用的已保存密钥（决定空输入是否合法）。 */
  hasSavedKey(): boolean {
    return this.baseline?.hasApiKey ?? false;
  }

  discardChanges(): void {
    this.dirty = false;
    this.discardAuthorized = true;
  }

  /**
   * 是否有未保存修改。密钥部分：`config` 携带 `api_key` 说明用户主动输入了新密钥，
   * 相对任何基线都是修改；省略 `api_key` 说明复用已保存密钥，不构成修改。
   */
  hasUnsavedChanges(config: LlmConfig): boolean {
    if (this.discardAuthorized) return false;
    if (!this.baseline) {
      return config.api_base_url !== "" || config.model !== "" || config.api_key !== undefined;
    }
    const typedNewKey = config.api_key !== undefined;
    return (
      config.api_base_url !== this.baseline.api_base_url ||
      config.model !== this.baseline.model ||
      typedNewKey
    );
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
