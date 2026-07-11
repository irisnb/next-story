export interface ProjectMetadata {
  name: string;
}

export interface ProjectOpenResult {
  metadata: ProjectMetadata;
  draft_content: string;
  main_content: string;
}

export interface LlmConfig {
  api_base_url: string;
  api_key: string;
  model: string;
}

export interface ProjectState {
  projectPath: string;
  projectName: string;
  draftContent: string;
  mainContent: string;
}

export type NotebookTab = "draft" | "main";
