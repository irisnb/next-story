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
  drainSaves?(): void | Promise<void>;
  destroyAi(): void | Promise<void>;
  destroyEditor(): void | Promise<void>;
  destroyWindow(): void | Promise<void>;
}

/**
 * 按序排空保存并销毁；失败由关闭流程报告，窗口保留。
 * 已完成阶段保持完成（部分界面可能已失效），重试仅完成剩余阶段。
 */
export function createApplicationDestroyer(
  options: ApplicationDestroyOptions,
): () => Promise<void> {
  const stages: Array<() => void | Promise<void>> = [
    ...(options.drainSaves ? [() => options.drainSaves!()] : []),
    () => options.destroyAi(),
    () => options.destroyEditor(),
    () => options.destroyWindow(),
  ];
  let completedStages = 0;
  let pending: Promise<void> | null = null;
  return (): Promise<void> => {
    if (pending) return pending;
    if (completedStages === stages.length) return Promise.resolve();
    pending = Promise.resolve().then(async () => {
      while (completedStages < stages.length) {
        await stages[completedStages]();
        completedStages += 1;
      }
    }).finally(() => { pending = null; });
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

/**
 * 仅执行离开守卫判定（脏检查＋三选一对话框），不进入销毁阶段。
 * 正常退出（`orchestrateCloseRequest`）与更新安装前准备（update-dialog，design D6）
 * 共用同一段判定；返回 false 表示用户取消，调用方必须中止后续动作。
 */
export async function runLeaveGuard(
  guard: Pick<CloseRequestOptions, "isDirty" | "guardLeave">,
): Promise<boolean> {
  return !guard.isDirty() || (await guard.guardLeave());
}

export async function orchestrateCloseRequest(
  options: CloseRequestOptions,
): Promise<CloseRequestResult> {
  options.preventDefault();
  if (!(await runLeaveGuard(options))) return "kept-open";

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
