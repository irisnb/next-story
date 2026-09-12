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
  /**
   * 文档级 AI 可见性（仅文档节点有意义；文件夹不保存该字段）。
   * 缺省按「允许 AI 查看」处理（旧作品迁移前 / 旧树无该字段）。
   */
  ai_visible?: boolean;
}

/**
 * 文档是否允许 AI 查看。字段缺省（旧树 / 迁移前）按允许处理；
 * 文件夹不拥有该语义，此判断只对文档节点有意义。
 */
export function isDocumentAiVisible(node: ContentTreeNode | null | undefined): boolean {
  return node === null || node === undefined || node.ai_visible !== false;
}

/**
 * 从内容树派生「不允许 AI 查看」的文档 ID 集合（controlled-story-read-visibility 集成点）。
 * 供讨论/会话层判定受限讨论与派发前复核使用；只统计文档节点（文件夹无该语义）。
 * 树为空 / 缺失时返回空集（不引入任何受限）。
 */
export function hiddenDocumentIdsFromTree(tree: ContentTree | null | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!tree) return ids;
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (node.kind === "Document" && !isDocumentAiVisible(node)) ids.add(id);
  }
  return ids;
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
 * `projectPath` / `documentVersion` 为可选来源身份（作品 / 版本身份），由捕获时
 * 从作品上下文注入，供后端统一授权校验使用；缺省表示未附带身份。
 */
export interface SelectionSnapshot {
  documentId: string;
  selectedText: string;
  from: number;
  to: number;
  /** 来源作品身份（作品根路径），供后端统一授权校验。 */
  projectPath?: string;
  /** 来源文档的版本身份（内容派生），供后端版本校验。 */
  documentVersion?: string;
  /**
   * 冻结时捕获的当前文档规范化正文快照（`canonicalNotebookJson` 输出的合法 Tiptap JSON
   * 字符串）。与 `documentVersion` 同源：版本身份正是该快照的内容派生散列。
   * 无选区（直接提问不带选区）时缺省，后端不得把缺省当作必须项要求补齐。
   */
  bodySnapshot?: string;
}

/**
 * 选区材料可见性复核结果：前端在发送前用作品树的文档 `ai_visible` 事实复核。
 */
export interface SelectionVisibilityCheck {
  /** 是否允许发送该选区材料。 */
  allowed: boolean;
  /** 拒绝时的中文提示；不得包含隐藏文档名称、ID 或路径。 */
  deniedMessage?: string;
}

export type GenerateAiErrorCode =
  | "configuration_required"
  | "authentication"
  | "timeout"
  | "network"
  | "request_too_large"
  | "service"
  | "invalid_response"
  | "document_not_visible";

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
      kind: "summon";
      /** 冻结的选区材料；召唤没有用户输入的问题文本，前端不伪造默认问题。 */
      selected_text: string;
      document_id?: string;
      project_path?: string;
      document_version?: string;
      /** 未保存正文快照（`canonicalNotebookJson` 输出）；与 `document_version` 同源。 */
      snapshot?: string;
    }
  | {
      kind: "follow_up";
      selected_text: string;
      /**
       * 追问来源：`direct_question`（直接提问首轮成功后进入统一对话）；
       * 召唤来源默认省略。
       */
      origin?: "direct_question";
      /** 来源文档身份（与首轮一致，从冻结锚点/首轮材料透传）。 */
      document_id?: string;
      /** 来源作品身份（作品根路径，从冻结锚点/首轮材料透传）。 */
      project_path?: string;
      /** 来源文档的版本身份（内容派生，从冻结锚点/首轮材料透传）。 */
      document_version?: string;
      messages: GenerateAiMessage[];
      /** 首轮冻结时捕获的未保存正文快照（追问增量发送时随请求保留）。 */
      snapshot?: string;
    }
  | {
      kind: "direct_question";
      /** 必填的直接提问。 */
      question: string;
      /** 可选选区重点材料；无选区时省略。 */
      selected_text?: string;
      document_id?: string;
      project_path?: string;
      document_version?: string;
      /** 未保存正文快照（`canonicalNotebookJson` 输出）；无选区直接提问时缺省。 */
      snapshot?: string;
    };

/**
 * AI 生成命令的窄返回。命令始终成功返回该枚举，
 * 便于前端在不依赖 Tauri 错误序列化细节的情况下区分成功与失败。
 */
export type GenerateAiResult =
  | { ok: true; content: string }
  | { ok: false; error: GenerateAiError };
