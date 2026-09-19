export interface CloseRequestOptions {
  isDirty(): boolean;
  preventDefault(): void;
  guardLeave(): Promise<boolean>;
  destroy(): Promise<void>;
  reportError?(error: unknown): void;
}

export type CloseRequestResult = "allow-default" | "closed" | "kept-open";

export interface CloseGuard {
  isDirty(): boolean;
  guardLeave(): Promise<boolean>;
}

export interface ApplicationDestroyOptions {
  destroyAi(): void;
  destroyEditor(): void;
  destroyWindow(): Promise<void>;
}

export function createApplicationDestroyer(
  options: ApplicationDestroyOptions,
): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return (): Promise<void> => {
    if (pending) return pending;
    pending = (async () => {
      options.destroyAi();
      options.destroyEditor();
      await options.destroyWindow();
    })();
    return pending;
  };
}

export function composeCloseGuards(guards: readonly CloseGuard[]): CloseGuard {
  return {
    isDirty(): boolean {
      return guards.some((guard) => guard.isDirty());
    },
    async guardLeave(): Promise<boolean> {
      for (const guard of guards) {
        if (guard.isDirty() && !await guard.guardLeave()) {
          return false;
        }
      }
      return true;
    },
  };
}

export async function orchestrateCloseRequest(
  options: CloseRequestOptions,
): Promise<CloseRequestResult> {
  options.preventDefault();
  if (options.isDirty() && !await options.guardLeave()) return "kept-open";

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
    this.pending = result.finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
