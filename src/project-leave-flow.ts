import type { ProjectOpenResult, ProjectTreeState } from "./types";

export interface AuthorizedOpenOptions {
  authorize(): Promise<boolean>;
  selectDirectory(): Promise<string | null>;
  openProject(projectPath: string): Promise<ProjectOpenResult>;
  replaceProject(projectState: ProjectTreeState): Promise<void> | void;
  reportError?(error: unknown): void;
  protect?(projectPath: string): Promise<void>;
  isCurrent?(): boolean;
}

/**
 * 选择后保护旧实例，校验候选元数据，再授权保存，最后等待真实共同提交。
 * protect/release 的所有者是调用方；本函数不会在授权后提前解除保护。
 */
export async function openProjectAfterAuthorization(
  options: AuthorizedOpenOptions,
): Promise<"committed" | "cancelled" | "stale"> {
  const current = () => options.isCurrent?.() ?? true;
  try {
    const selected = await options.selectDirectory();
    if (!current()) return "stale";
    if (!selected) return "cancelled";
    await options.protect?.(selected);
    if (!current()) return "stale";

    const result = await options.openProject(selected);
    if (!current()) return "stale";
    if (!await options.authorize()) return "cancelled";
    if (!current()) return "stale";

    await options.replaceProject({
      projectPath: selected,
      projectName: result.metadata.name,
      tree: result.tree,
    });
    return current() ? "committed" : "stale";
  } catch (error: unknown) {
    options.reportError?.(error);
    if (options.reportError) return "cancelled";
    throw error;
  }
}
