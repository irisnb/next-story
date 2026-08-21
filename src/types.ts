export interface ProjectMetadata {
  name: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ProjectOpenResult {
  metadata: ProjectMetadata;
  tree: ContentTree;
}

export interface LlmConfig {
  api_base_url: string;
  /**
   * 仅当用户主动输入新密钥时携带；省略时后端复用钥匙串中的旧密钥。
   * 前端从不回填明文密钥。
   */
  api_key?: string;
  model: string;
}

/**
 * `load_llm_config` 的非敏感返回契约：不含明文 `api_key`，
 * 只回传服务地址、模型名与「是否已有已保存密钥」布尔值。
 */
export interface LlmConfigSummary {
  api_base_url: string;
  model: string;
  has_api_key: boolean;
}

/** 作品打开后就绪的前端状态：路径、名称与整棵内容树。正文按需用 `read_document` 读取。 */
export interface ProjectTreeState {
  projectPath: string;
  projectName: string;
  tree: ContentTree;
}

/** 内容树节点类型：文件夹只负责组织，文档只负责写作。 */
export type NodeKind = "Folder" | "Document";

/** 内容树中的单个节点（后端 `ContentTreeNode` 的 serde 序列化契约）。 */
export interface ContentTreeNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** 子节点 ID 列表（文档恒为空）。 */
  children: string[];
}

/** 回收站中被删除的子树条目。 */
export interface RecycleBinEntry {
  root_id: string;
  original_parent: string | null;
  original_index: number;
  nodes: Record<string, ContentTreeNode>;
}

/** 整棵内容树结构（后端 `ContentTree` 的 serde 序列化契约）。 */
export interface ContentTree {
  root_children: string[];
  nodes: Record<string, ContentTreeNode>;
  recycle_bin: RecycleBinEntry[];
}

/**
 * 与具体编辑器控件解耦的选区快照。
 * 点击“召唤 AI”时冻结；`from/to` 为 Tiptap 有序选区位置，仅用于本次来源
 * 标识与界面锚定，不发送给模型、不持久化。`documentId` 是选区来源的文档 ID。
 */
export interface SelectionSnapshot {
  documentId: string;
  selectedText: string;
  from: number;
  to: number;
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

export interface GenerateAiMessage {
  role: "user" | "assistant";
  content: string;
}

export type GenerateAiRequest =
  | {
      kind: "first";
      selected_text: string;
      /** 思维扩展可选方向；空方向开始时省略，不附加到请求。 */
      thinking_direction?: string;
    }
  | {
      kind: "follow_up";
      selected_text: string;
      /** 追问复用首次思维扩展方向；普通召唤或空方向开始时省略。 */
      thinking_direction?: string;
      messages: GenerateAiMessage[];
    };

/**
 * `generate_ai_thinking` 命令的窄返回。命令始终成功返回该枚举，
 * 便于前端在不依赖 Tauri 错误序列化细节的情况下区分成功与失败。
 */
export type GenerateAiResult =
  | { ok: true; content: string }
  | { ok: false; error: GenerateAiError };
