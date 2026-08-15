import type { ProjectOpenResult, ProjectState } from "./types";

export interface AuthorizedOpenOptions {
  authorize(): Promise<boolean>;
  selectDirectory(): Promise<string | null>;
  openProject(projectPath: string): Promise<ProjectOpenResult>;
  replaceProject(projectState: ProjectState): void;
  reportError?(error: unknown): void;
}

/**
 * 打开候选作品的流程：先选并读候选作品，真正替换前才确认（授权），随后立即替换。
 *
 * 授权放在「读取候选作品之后、替换之前」，消除授权过期丢新编辑的窗口：
 * 选择目录与读取期间用户的新编辑，都会被紧接着的授权确认覆盖；授权取消则不替换，
 * 当前作品与未保存内容原样保留。
 */
export async function openProjectAfterAuthorization(
  options: AuthorizedOpenOptions,
): Promise<void> {
  try {
    const selected = await options.selectDirectory();
    if (!selected) return;

    const result = await options.openProject(selected);
    if (!await options.authorize()) return;

    options.replaceProject({
      projectPath: selected,
      projectName: result.metadata.name,
      draftContent: result.draft_content,
      mainContent: result.main_content,
    });
  } catch (error: unknown) {
    options.reportError?.(error);
  }
}
