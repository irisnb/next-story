import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  ContentTree,
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

/**
 * 导出命令的稳定返回契约（后端 `ExportWordResult` 的 serde 序列化）。
 * `cancelled` 仅由前端在用户关闭保存对话框时设置，后端不返回该字段。
 */
export interface ExportWordResult {
  ok: boolean;
  cancelled?: boolean;
  path: string | null;
  message: string | null;
}

/**
 * 导出当前作品为 Word 文档：先弹出保存对话框（默认建议作品名称 `.docx`），
 * 用户取消时返回 `{ ok: false, cancelled: true }` 且不产生文件；确认后调用
 * 后端只读导出命令，返回稳定成功/失败结果（中文说明）。
 */
export async function exportProjectToWord(
  projectPath: string,
  projectName: string,
): Promise<ExportWordResult> {
  const target = await save({
    defaultPath: `${projectName}.docx`,
    filters: [{ name: "Word 文档", extensions: ["docx"] }],
  });
  if (target === null) {
    return { ok: false, cancelled: true, path: null, message: null };
  }
  return tauriInvoke<ExportWordResult>("export_project_to_word", {
    projectPath,
    targetPath: target,
  });
}

export async function createProject(name: string, saveLocation: string): Promise<string> {
  return tauriInvoke<string>("create_project", {
    params: {
      name,
      save_location: saveLocation,
    },
  });
}

/** 打开作品：返回元信息与整棵内容树（正文随后按文档 ID 用 `readDocument` 按需读取）。 */
export async function openProject(projectPath: string): Promise<ProjectOpenResult> {
  return tauriInvoke<ProjectOpenResult>("open_project", {
    projectPath,
  });
}

// ========== 内容树命令（前端文件管理） ==========

/** 读取整棵内容树结构（含回收站）。 */
export async function openContentTree(projectPath: string): Promise<ContentTree> {
  return tauriInvoke<ContentTree>("open_content_tree", { projectPath });
}

/** 按文档 ID 读取单篇文档正文。 */
export async function readDocument(projectPath: string, documentId: string): Promise<string> {
  return tauriInvoke<string>("read_document", { projectPath, documentId });
}

/** 按文档 ID 保存单篇文档正文（与后端一致的字节上限纵深防御）。 */
export async function saveDocument(
  projectPath: string,
  documentId: string,
  content: string,
): Promise<void> {
  const sizeError = notebookSizeError(content);
  if (sizeError) {
    throw new Error(`文档内容过大：${sizeError}`);
  }
  await tauriInvoke("save_document", { projectPath, documentId, content });
}

/** 在指定父级（null 表示根级）下创建文件夹，返回新节点 ID。 */
export async function createFolder(
  projectPath: string,
  parent: string | null,
): Promise<string> {
  return tauriInvoke<string>("create_folder", { projectPath, parent });
}

/** 在指定父级（null 表示根级）下创建文档，返回新节点 ID。 */
export async function createDocument(
  projectPath: string,
  parent: string | null,
): Promise<string> {
  return tauriInvoke<string>("create_document", { projectPath, parent });
}

/** 重命名节点，失败保持原名。 */
export async function renameNode(
  projectPath: string,
  id: string,
  name: string,
): Promise<void> {
  await tauriInvoke("rename_node", { projectPath, id, name });
}

/** 移动节点到另一父级（null 表示根级）。 */
export async function moveNode(
  projectPath: string,
  id: string,
  newParent: string | null,
): Promise<void> {
  await tauriInvoke("move_node", { projectPath, id, newParent });
}

/** 重排父级内子节点顺序。 */
export async function reorderChildren(
  projectPath: string,
  parent: string | null,
  order: string[],
): Promise<void> {
  await tauriInvoke("reorder_children", { projectPath, parent, order });
}

/** 删除节点（含完整子树）进回收站。 */
export async function deleteNode(projectPath: string, id: string): Promise<void> {
  await tauriInvoke("delete_node", { projectPath, id });
}

/** 从回收站恢复被删除的子树。 */
export async function restoreNode(projectPath: string, id: string): Promise<void> {
  await tauriInvoke("restore_node", { projectPath, id });
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
