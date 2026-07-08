export interface ProjectMetadata {
  name: string;
}

export interface ProjectOpenResult {
  metadata: ProjectMetadata;
  draft_content: string;
  main_content: string;
}

export interface ProjectState {
  projectPath: string;
  projectName: string;
  draftContent: string;
  mainContent: string;
  hasUnsavedChanges: boolean;
}

export type NotebookTab = "draft" | "main";
