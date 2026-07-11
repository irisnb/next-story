import type { ProjectOpenResult, ProjectState } from "./types";

export interface AuthorizedOpenOptions {
  authorize(): Promise<boolean>;
  selectDirectory(): Promise<string | null>;
  openProject(projectPath: string): Promise<ProjectOpenResult>;
  replaceProject(projectState: ProjectState): void;
  reportError?(error: unknown): void;
}

export async function openProjectAfterAuthorization(
  options: AuthorizedOpenOptions,
): Promise<void> {
  if (!await options.authorize()) return;

  try {
    const selected = await options.selectDirectory();
    if (!selected) return;

    const result = await options.openProject(selected);
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
