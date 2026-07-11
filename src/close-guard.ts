export interface CloseRequestOptions {
  isDirty(): boolean;
  preventDefault(): void;
  guardLeave(): Promise<boolean>;
  destroy(): Promise<void>;
  reportError?(error: unknown): void;
}

export type CloseRequestResult = "allow-default" | "closed" | "kept-open";

export async function orchestrateCloseRequest(
  options: CloseRequestOptions,
): Promise<CloseRequestResult> {
  if (!options.isDirty()) return "allow-default";

  options.preventDefault();
  if (!await options.guardLeave()) return "kept-open";

  try {
    await options.destroy();
  } catch (error: unknown) {
    options.reportError?.(error);
    return "kept-open";
  }
  return "closed";
}

export interface CloseCoordinatorOptions {
  isDirty(): boolean;
  guardLeave(): Promise<boolean>;
  destroy(): Promise<void>;
  reportError?(error: unknown): void;
}

export class CloseCoordinator {
  private pending: Promise<CloseRequestResult> | null = null;
  private readonly options: CloseCoordinatorOptions;

  constructor(options: CloseCoordinatorOptions) {
    this.options = options;
  }

  run(preventDefault: () => void): Promise<CloseRequestResult> {
    if (this.pending) {
      preventDefault();
      return this.pending;
    }

    const result = orchestrateCloseRequest({ ...this.options, preventDefault });
    if (this.options.isDirty()) {
      this.pending = result.finally(() => {
        this.pending = null;
      });
      return this.pending;
    }
    return result;
  }
}
