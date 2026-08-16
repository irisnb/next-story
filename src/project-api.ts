import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfig,
  LlmConfigSummary,
  ProjectOpenResult,
} from "./types";

/** 与 Tauri `invoke` 同形的窄类型，便于在测试中注入假实现。 */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: InvokeFn = tauriInvoke as InvokeFn;

/**
 * 单个本子 JSON 字符串的字节上限（与后端 `MAX_NOTEBOOK_BYTES` 一致，UTF-8 字节数）。
 * 前端在调用保存前先做同一上限检查，作为纵深防御。
 */
export const MAX_NOTEBOOK_BYTES = 10 * 1024 * 1024;

/** 与 Rust `str::len()` 一致的 UTF-8 字节长度。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 校验本子 JSON 是否超过保存字节上限，超限返回中文说明；未超限返回 null。 */
export function notebookSizeError(content: string): string | null {
  const bytes = utf8ByteLength(content);
  if (bytes <= MAX_NOTEBOOK_BYTES) return null;
  return `${bytes} 字节超过 ${MAX_NOTEBOOK_BYTES} 字节上限，无法保存`;
}

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
  // 与后端一致的字节上限检查：超限不调用写盘（纵深防御，正常路径在编辑器已检查）。
  const draftError = notebookSizeError(draftContent);
  if (draftError) {
    throw new Error(`草稿本内容过大：${draftError}`);
  }
  const mainError = notebookSizeError(mainContent);
  if (mainError) {
    throw new Error(`正文本内容过大：${mainError}`);
  }
  await tauriInvoke("save_project", {
    projectPath,
    draftContent,
    mainContent,
  });
}

/** 在系统默认浏览器中打开 http/https 链接（后端会再次校验协议）。 */
export async function openUrl(url: string): Promise<void> {
  await tauriInvoke("open_url", { url });
}

/** 加载已保存配置：后端不回传明文密钥，只给非敏感字段与 `has_api_key`。 */
export async function loadLlmConfig(): Promise<LlmConfigSummary | null> {
  return tauriInvoke<LlmConfigSummary | null>("load_llm_config");
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  await tauriInvoke("save_llm_config", { config });
}

export async function testLlmConnection(config: LlmConfig): Promise<void> {
  await tauriInvoke("test_llm_connection", { config });
}

/**
 * 发起一次真实 AI 思考生成。前端提交冻结选区和受限的临时对话轮次，
 * 由后端加载唯一保存配置、校验请求并集中组装固定 Prompt。前端不传入 API Key，
 * 也不持有任何写入草稿本或正文本的入口（见零写回边界）。
 *
 * 接受可选的 `call` 以便测试注入假 `invoke`，不依赖 Tauri 运行时。
 */
export async function generateAiThinking(
  request: GenerateAiRequest,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("generate_ai_thinking", { request });
}
