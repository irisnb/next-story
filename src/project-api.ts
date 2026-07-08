import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { ProjectOpenResult } from "./types";

export async function selectDirectory(title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });

  return typeof selected === "string" ? selected : null;
}

export async function createProject(name: string, saveLocation: string): Promise<string> {
  return invoke<string>("create_project", {
    params: {
      name,
      save_location: saveLocation,
    },
  });
}

export async function openProject(projectPath: string): Promise<ProjectOpenResult> {
  return invoke<ProjectOpenResult>("open_project", {
    projectPath,
  });
}

export async function saveProject(
  projectPath: string,
  draftContent: string,
  mainContent: string,
): Promise<void> {
  await invoke("save_project", {
    projectPath,
    draftContent,
    mainContent,
  });
}
