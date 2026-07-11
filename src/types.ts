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

/**
 * 代码层本子标识。
 * - `draft` 对应草稿本（UI 的 `draft` 标签页）。
 * - `manuscript` 只作为明确对应“正文本”的代码层标识，不作为第二个产品名称。
 */
export type NotebookKind = "draft" | "manuscript";

/**
 * 与具体编辑器控件解耦的选区快照。
 * 点击“召唤 AI”时冻结；`start/end` 仅用于快照身份校验，不发送给模型。
 */
export interface SelectionSnapshot {
  notebook: NotebookKind;
  selectedText: string;
  start: number;
  end: number;
}

export type GenerateAiErrorCode =
  | "configuration_required"
  | "authentication"
  | "timeout"
  | "network"
  | "request_too_large"
  | "service"
  | "invalid_response";

/**
 * 生成错误的稳定契约。前端只依据 `code` 切换状态，不解析 `message`。
 * `message` 是经过安全清洗、不含 API Key / Authorization / 请求正文 / 完整远端响应的中文说明。
 */
export interface GenerateAiError {
  code: GenerateAiErrorCode;
  message: string;
}

/**
 * `generate_ai_thinking` 命令的窄返回。命令始终成功返回该枚举，
 * 便于前端在不依赖 Tauri 错误序列化细节的情况下区分成功与失败。
 */
export type GenerateAiResult =
  | { ok: true; content: string }
  | { ok: false; error: GenerateAiError };
