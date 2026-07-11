import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { GenerateAiResult, LlmConfig, ProjectOpenResult } from "./types";

/** 与 Tauri `invoke` 同形的窄类型，便于在测试中注入假实现。 */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: InvokeFn = tauriInvoke as InvokeFn;

export async function selectDirectory(title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });

  return typeof selected === "string" ? selected : null;
}

export async function createProject(name: string, saveLocation: string): Promise<string> {
  return tauriInvoke<string>("create_project", {
    params: {
      name,
      save_location: saveLocation,
    },
  });
}

export async function openProject(projectPath: string): Promise<ProjectOpenResult> {
  return tauriInvoke<ProjectOpenResult>("open_project", {
    projectPath,
  });
}

export async function saveProject(
  projectPath: string,
  draftContent: string,
  mainContent: string,
): Promise<void> {
  await tauriInvoke("save_project", {
    projectPath,
    draftContent,
    mainContent,
  });
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  return tauriInvoke<LlmConfig | null>("load_llm_config");
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  await tauriInvoke("save_llm_config", { config });
}

export async function testLlmConnection(config: LlmConfig): Promise<void> {
  await tauriInvoke("test_llm_connection", { config });
}

/**
 * 发起一次真实 AI 思考生成。首版只把用户选中的原文交给后端，
 * 由后端加载唯一保存配置并集中组装固定 Prompt。前端不传入 API Key，
 * 也不持有任何写入草稿本或正文本的入口（见零写回边界）。
 *
 * 接受可选的 `call` 以便测试注入假 `invoke`，不依赖 Tauri 运行时。
 */
export async function generateAiThinking(
  selectedText: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("generate_ai_thinking", { selectedText });
}
