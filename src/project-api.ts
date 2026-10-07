import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { ConversationIdentity } from "./ai-conversation-identity.ts";
import type {
  ContentTree,
  GenerateAiResult,
  LlmConfig,
  LlmConfigSummary,
  ProjectOpenResult,
} from "./types";

/** 与 Tauri `invoke` 同形的窄类型，便于在测试中注入假实现。 */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: InvokeFn = tauriInvoke as InvokeFn;

/**
 * 单个文档 JSON 字符串的字节上限（与后端 `MAX_NOTEBOOK_BYTES` 一致，UTF-8 字节数）。
 * 前端在调用保存前先做同一上限检查，作为纵深防御。
 */
export const MAX_NOTEBOOK_BYTES = 10 * 1024 * 1024;

/** 与 Rust `str::len()` 一致的 UTF-8 字节长度。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 校验文档 JSON 是否超过保存字节上限，超限返回中文说明；未超限返回 null。 */
export function notebookSizeError(content: string): string | null {
  const bytes = utf8ByteLength(content);
  if (bytes <= MAX_NOTEBOOK_BYTES) return null;
  return `${bytes} 字节超过 ${MAX_NOTEBOOK_BYTES} 字节上限，无法保存`;
}

/**
 * 弹出文件夹选择对话框，返回选中路径（取消返回 null）。
 * 可选 `defaultPath` 作为对话框初始位置（如最近一条最近作品）；缺省不传，
 * 对话框保持系统默认位置。
 */
export async function selectDirectory(
  title: string,
  defaultPath?: string,
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
    ...(defaultPath === undefined ? {} : { defaultPath }),
  });

  return typeof selected === "string" ? selected : null;
}

// ========== 文档导入（add-word-import 建立管线，add-markdown-import 泛化） ==========

/** 与 Tauri `open` 文件选择对话框同形的窄类型，便于在测试中注入假实现。 */
export type OpenDialogFn = (options: {
  title?: string;
  multiple?: boolean;
  filters?: ReadonlyArray<{ name: string; extensions: readonly string[] }>;
}) => Promise<string | null>;

const defaultOpenDialog: OpenDialogFn = open as unknown as OpenDialogFn;

/**
 * 弹出文件选择对话框选择单个要导入的文档（`.docx` / `.md` / `.fdx`）：按扩展名
 * 过滤，不依赖系统 MIME（WPS 保存的 `.docx` 报告非标准 MIME，add-word-import
 * design D5.1）；取消返回 null。
 */
export async function selectDocumentFile(
  openDialog: OpenDialogFn = defaultOpenDialog,
): Promise<string | null> {
  const selected = await openDialog({
    title: "选择要导入的文档",
    multiple: false,
    filters: [{ name: "Word / Markdown / Final Draft 文档", extensions: ["docx", "md", "fdx"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * 单项损耗（后端 `ImportLoss` 的 serde 序列化，字段与 add-word-import design
 * 「Spike 补记」契约逐字对齐；kind 集合随 add-markdown-import、add-fdx-import 扩充）。
 */
export interface ImportLoss {
  kind:
    | "table_flattened"
    | "image_dropped"
    | "footnote_dropped"
    | "comment_dropped"
    | "revision_finalized"
    | "numbering_degraded"
    | "code_degraded"
    | "quote_degraded"
    | "tasklist_degraded"
    | "hr_dropped"
    | "html_stripped"
    | "frontmatter_dropped"
    | "dual_dialogue_degraded"
    | "titlepage_inlined"
    | "scene_metadata_dropped"
    | "scriptnote_dropped"
    | "revision_marks_ignored"
    | "unknown_element_skipped"
    | "list_overflow_degraded"
    | "symbol_dropped"
    | "style_degraded"
    | "numbering_format_degraded"
    | "block_skipped";
  count: number;
  note: string;
}

/** 拆分建议（后端 `SplitSuggestion`）。 */
export interface SplitSuggestion {
  /** 标记样例（如「第X集」）。 */
  marker_sample: string;
  count: number;
  doc_names: string[];
}

/** 预检结果（后端 `ImportPreview`）。 */
export interface ImportPreview {
  char_count: number;
  paragraph_count: number;
  /** 默认文档名（文件名去扩展名）。 */
  default_doc_name: string;
  losses: ImportLoss[];
  split_suggestion: SplitSuggestion | null;
  /** 文件字节 sha256；commit 时回传校验，不一致后端以 `hash_mismatch:` 前缀拒绝。 */
  content_hash: string;
  /** docProps 生成器印记（样本归因用，可空）。 */
  generator: string | null;
}

/** 提交结果（后端 `ImportCommitResult`）。 */
export interface ImportCommitResult {
  created_doc_ids: string[];
  created_folder_id: string | null;
}

/** 预检：只读解析选定文档（`.docx` / `.md` 按扩展名分发），返回字数、拟创建结构、损耗清单与拆分建议；零副作用。 */
export async function importDocumentPreview(
  projectPath: string,
  filePath: string,
  call: InvokeFn = defaultInvoke,
): Promise<ImportPreview> {
  return call<ImportPreview>("import_document_preview", { projectPath, filePath });
}

/**
 * 提交导入：后端重新解析并落盘，只创建新文档（`parentId` 为 null 表示根级）。
 * 预览与提交之间文件内容变化时后端拒绝，错误信息以 `hash_mismatch:` 为前缀，
 * 调用方应引导用户重新预检。
 */
export async function importDocumentCommit(
  projectPath: string,
  filePath: string,
  parentId: string | null,
  split: boolean,
  expectedHash: string,
  call: InvokeFn = defaultInvoke,
): Promise<ImportCommitResult> {
  return call<ImportCommitResult>("import_document_commit", {
    projectPath,
    filePath,
    parentId,
    split,
    expectedHash,
  });
}

/**
 * 统一导出命令的稳定返回契约（后端 `ExportFileResult` 的 serde 序列化，三种格式
 * 同形）。`cancelled` 仅由前端在用户关闭保存对话框时设置，后端不返回该字段。
 */
export interface ExportFileResult {
  ok: boolean;
  cancelled?: boolean;
  path: string | null;
  message: string | null;
}

/** 导出格式：Word / PDF / Markdown（统一导出对话框三选一，默认 Word）。 */
export type ExportFormat = "word" | "pdf" | "markdown";

/**
 * 导出范围（后端 `ExportScope` 的 serde 契约，内部标签 `type`）：
 * - `{ type: "work" }` 整个作品；
 * - `{ type: "document", id }` 单篇文档；
 * - `{ type: "folder", id }` 文件夹子树（含嵌套）。
 */
export type ExportScope =
  | { type: "work" }
  | { type: "document"; id: string }
  | { type: "folder"; id: string };

/** 各格式的保存对话框过滤器与后端命令名（唯一事实源）。 */
const EXPORT_FORMATS: Record<
  ExportFormat,
  { filterName: string; extension: string; command: string }
> = {
  word: { filterName: "Word 文档", extension: "docx", command: "export_project_to_word" },
  pdf: { filterName: "PDF 文档", extension: "pdf", command: "export_project_to_pdf" },
  markdown: { filterName: "Markdown 文档", extension: "md", command: "export_project_to_markdown" },
};

/**
 * 统一导出：先弹出保存对话框（默认文件名按导出范围根生成、过滤器随格式），
 * 用户取消时返回 `{ ok: false, cancelled: true }` 且不产生文件；确认后按格式调用
 * 对应后端只读导出命令（带范围参数），返回稳定成功/失败结果（中文说明）。
 */
export async function exportProject(
  format: ExportFormat,
  projectPath: string,
  scope: ExportScope,
  defaultFileName: string,
  saveDialog: SaveDialogFn = defaultSaveDialog,
  call: InvokeFn = defaultInvoke,
): Promise<ExportFileResult> {
  const spec = EXPORT_FORMATS[format];
  const target = await saveDialog({
    defaultPath: `${defaultFileName}.${spec.extension}`,
    filters: [{ name: spec.filterName, extensions: [spec.extension] }],
  });
  if (target === null) {
    return { ok: false, cancelled: true, path: null, message: null };
  }
  return call<ExportFileResult>(spec.command, {
    projectPath,
    targetPath: target,
    scope,
  });
}

// ========== 等待计时导出（app-real-chain-validation 任务 1.4 / design D2） ==========

/** 与 Tauri `save` 对话框同形的窄类型，便于在测试中注入假保存对话框。 */
export type SaveDialogFn = (options: {
  defaultPath?: string;
  filters?: ReadonlyArray<{ name: string; extensions: readonly string[] }>;
}) => Promise<string | null>;

const defaultSaveDialog: SaveDialogFn = save as SaveDialogFn;

/** 导出等待计时 JSON 的稳定返回契约（与后端 `ExportTimingResult` 同形）。 */
export interface ExportWaitTimingResult {
  ok: boolean;
  /** 仅由前端在用户关闭保存对话框时设置，后端不返回该字段。 */
  cancelled?: boolean;
  path: string | null;
  message: string | null;
}

/** 导出默认文件名：`wait-timing-YYYYMMDD-HHmm.json`（本机时区）。 */
export function waitTimingFileName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `wait-timing-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.json`
  );
}

/**
 * 导出等待计时数据：先弹出保存对话框（默认文件名含日期时间），用户取消时返回
 * `{ ok: false, cancelled: true }` 且不产生文件；确认后调用后端命令把字符串写入
 * 用户选择的目标路径。只写该目标，不触碰作品目录。
 */
export async function exportWaitTimingJson(
  content: string,
  defaultFileName: string,
  saveDialog: SaveDialogFn = defaultSaveDialog,
  call: InvokeFn = defaultInvoke,
): Promise<ExportWaitTimingResult> {
  const target = await saveDialog({
    defaultPath: defaultFileName,
    filters: [{ name: "JSON 文件", extensions: ["json"] }],
  });
  if (target === null) {
    return { ok: false, cancelled: true, path: null, message: null };
  }
  return call<ExportWaitTimingResult>("export_wait_timing_json", {
    targetPath: target,
    content,
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
export async function openContentTree(projectPath: string, call: InvokeFn = defaultInvoke): Promise<ContentTree> {
  return call<ContentTree>("open_content_tree", { projectPath });
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

/**
 * 设置单篇文档的 AI 可见性（文档级二元开关，文件夹不拥有该语义）。
 * 后端是唯一授权事实源；失败抛错，前端据以回滚开关状态并显示中文提示。
 */
export async function setDocumentAiVisibility(
  projectPath: string,
  documentId: string,
  visible: boolean,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call("set_document_ai_visibility", { projectPath, documentId, aiVisible: visible });
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

// ========== 最近作品命令（change: batch-improvement-candidates 任务组 3④） ==========

/** 最近作品条目（后端 `RecentWorkEntry` 的 serde 序列化，snake_case 对齐）。 */
export interface RecentWorkEntry {
  /** 作品名称（记录成功打开/新建时点的名称）。 */
  name: string;
  /** 作品根目录路径（去重键）。 */
  path: string;
  /** 最后打开时间（RFC3339 字符串）。 */
  last_opened_at: string;
}

/**
 * 读取最近作品列表：后端已完成有效性检查与自愈（失效条目不返回且顺手从存储
 * 移除），文件缺失/损坏失败开放为空列表；命令本身失败时抛错，由调用方失败开放。
 */
export async function loadRecentWorks(call: InvokeFn = defaultInvoke): Promise<RecentWorkEntry[]> {
  return call<RecentWorkEntry[]>("load_recent_works");
}

/** 记录一次成功的打开/新建：后端按路径去重移顶、上限 8 条、原子写回。 */
export async function recordRecentWork(
  name: string,
  path: string,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call("record_recent_work", { name, path });
}

// ========== 常驻 AI 会话命令（change: resident-ai-session） ==========

/** 与 Tauri `listen` 同形的窄类型，便于在测试中注入假事件监听。 */
export type ListenFn = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<UnlistenFn>;

/** 事件退订函数。 */
export type UnlistenFn = () => void;

const defaultListen: ListenFn = tauriListen as unknown as ListenFn;

/** `"ai-delta"` 事件载荷：一条流式增量文本。 */
export interface AiDeltaPayload {
  session_id: string;
  message_id: string;
  seq: number;
  text: string;
}

/** 会话历史重放中的一轮对话。 */
export interface AiReplayTurn {
  role: "user" | "assistant";
  text: string;
}

/** 当前对话的发起方式：重放时后端按来源组装对应的入口层提示词。 */
export type AiReplayOrigin = "direct_question" | "summon";

/** 开始一个常驻会话（幂等；驱动进程内创建会话记忆）。 */
export async function aiStartSession(
  sessionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("ai_start_session", { sessionId });
}

/**
 * 向常驻会话发送一条消息。命令阻塞到终态才 resolve；流式增量经 `"ai-delta"`
 * 事件先行转发，`done`（本命令返回的全文）是最终事实。
 * `kind: "first"` 为直接提问首轮（后端组装系统提示词 + 问题 + 可选选区材料），
 * `kind: "summon_first"` 为及时召唤首轮（空问题、只带选区材料，后端按召唤
 * 语义组装首轮任务），`kind: "follow_up"` 为追问（只发新增问题）。
 */
export async function aiSendMessage(
  sessionId: string,
  messageId: string,
  kind: "first" | "follow_up" | "summon_first",
  question: string,
  selectedText?: string,
  identityOrCall: {
    documentId?: string;
    projectPath?: string;
    documentVersion?: string;
    /** 未保存正文快照（`canonicalNotebookJson` 输出的合法 Tiptap JSON 字符串）。 */
    snapshot?: string;
    /** 关注文档身份（阶段五 A：后端据此组装关注文档现场材料 + 目录投影 + 检索）。 */
    focusDocumentId?: string;
    focusProjectPath?: string;
    focusDocumentVersion?: string;
    focusSnapshot?: string;
    /**
     * 讨论身份（design D7）：映射为线上 `conversationId`／`conversationProjectPath`
     * （Tauri 自动转 snake_case 对齐后端参数），供后端注册本轮按需补读工具路由。
     */
    conversation?: ConversationIdentity;
  } | InvokeFn = defaultInvoke,
  maybeCall: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  const call = typeof identityOrCall === "function" ? identityOrCall : maybeCall;
  const args: Record<string, unknown> = { sessionId, messageId, kind, question };
  if (selectedText !== undefined) {
    args.selectedText = selectedText;
  }
  if (typeof identityOrCall !== "function") {
    if (identityOrCall.documentId !== undefined) args.documentId = identityOrCall.documentId;
    if (identityOrCall.projectPath !== undefined) args.projectPath = identityOrCall.projectPath;
    if (identityOrCall.documentVersion !== undefined) args.documentVersion = identityOrCall.documentVersion;
    if (identityOrCall.snapshot !== undefined) args.snapshot = identityOrCall.snapshot;
    if (identityOrCall.focusDocumentId !== undefined) args.focusDocumentId = identityOrCall.focusDocumentId;
    if (identityOrCall.focusProjectPath !== undefined) args.focusProjectPath = identityOrCall.focusProjectPath;
    if (identityOrCall.focusDocumentVersion !== undefined) args.focusDocumentVersion = identityOrCall.focusDocumentVersion;
    if (identityOrCall.focusSnapshot !== undefined) args.focusSnapshot = identityOrCall.focusSnapshot;
    if (identityOrCall.conversation !== undefined) {
      args.conversationId = identityOrCall.conversation.conversationId;
      args.conversationProjectPath = identityOrCall.conversation.conversationProjectPath;
    }
  }
  return call<GenerateAiResult>("ai_send_message", args);
}

/** 取消一条在途消息（幂等）。 */
export async function aiCancelMessage(
  sessionId: string,
  messageId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("ai_cancel_message", { sessionId, messageId });
}

/** 结束常驻会话（幂等；驱动进程内会话记忆随之释放）。 */
export async function aiEndSession(
  sessionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("ai_end_session", { sessionId });
}

/**
 * 崩溃恢复：把显示历史重放进一个新会话。前端只提交投影后的 `{role, text}`
 * 轮次（标签与后端首轮 user 组装一致）；制度性提示由 start_session 携带的
 * system_prompt 信封提供，重放首轮不再拼提示词前缀；`origin` 为历史兼容
 * 参数（后端不再按来源组装入口层提示词）。
 */
export async function aiReplayHistory(
  sessionId: string,
  turns: readonly AiReplayTurn[],
  originOrCall: AiReplayOrigin | InvokeFn = "direct_question",
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  const origin = typeof originOrCall === "function" ? "direct_question" : originOrCall;
  if (typeof originOrCall === "function") call = originOrCall;
  return call<GenerateAiResult>("ai_replay_history", { sessionId, turns, origin });
}

/** 历史重放结束标记（幂等）。 */
export async function aiReplayDone(
  sessionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("ai_replay_done", { sessionId });
}

/** 订阅 `"ai-delta"` 流式增量事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenAiDelta(
  handler: (payload: AiDeltaPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<AiDeltaPayload>("ai-delta", (event) => handler(event.payload));
}

// ========== 按需补读事件与命令（change: add-agent-on-demand-reading 任务 7） ==========

/** `"ai-tool-call"` 事件载荷：一次工具调用的轻量过程信息（不含作品数据）。 */
export interface AiToolCallPayload {
  session_id: string;
  message_id: string;
  call_id: string;
  /** 工具名（story-list / story-read / story-search / story-request-reading）。 */
  tool: string;
  /** 工具参数（结构因工具而异；只含模型请求的参数，不含执行结果）。 */
  args: Record<string, unknown>;
}

/** `"ai-reading-request"` 事件载荷：面向用户的按需补读授权请求（设计 D1）。 */
export interface AiReadingRequestPayload {
  session_id: string;
  message_id: string;
  call_id: string;
  conversation_id: string;
  /** 模型提供的请求原因（透传，不携带作品数据）。 */
  reason: string;
}

/** 订阅 `"ai-tool-call"` 轻量过程事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenAiToolCall(
  handler: (payload: AiToolCallPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<AiToolCallPayload>("ai-tool-call", (event) => handler(event.payload));
}

/** 订阅 `"ai-reading-request"` 授权请求事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenAiReadingRequest(
  handler: (payload: AiReadingRequestPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<AiReadingRequestPayload>("ai-reading-request", (event) => handler(event.payload));
}

/**
 * 用户对按需补读授权请求的决定：允许（`granted: true`）→ 授权写入讨论档案并回填
 * `{granted:true}`，被暂停的轮次自动继续原问题；拒绝 → 回填 `{granted:false}`，
 * 模型基于既有材料有限回答。
 */
export async function aiResolveReadingRequest(
  sessionId: string,
  callId: string,
  granted: boolean,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("ai_resolve_reading_request", { sessionId, callId, granted });
}

/** 订阅 `"ai-driver-lost"` 事件（驱动进程丢失，无载荷），返回退订函数。 */
export function listenAiDriverLost(
  handler: () => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<null>("ai-driver-lost", () => handler());
}

// ========== 制作模块·链路库命令（change: add-making-module-core 任务组 1 命令面） ==========

/** 当前链路引用（全局一条，所有作品共用）；`null`＝未启用（日常陪想）。 */
export interface ActiveRef {
  chain_id: string;
  version_id: string;
}

/** 试问证据引用（全文在全局侧 `trials/<id>.json`，跟链路走、不进作品文件夹）。 */
export interface TrialRef {
  trial_id: string;
  created_at: string;
  /** 是否带卡试跑（对照试跑为 false）。 */
  with_card: boolean;
}

/** 要求卡：触发描述（含负例）＋正文两段构成。 */
export interface RequirementCard {
  id: string;
  title: string;
  trigger_desc: string;
  body: string;
}

/** 链路的一个不可变版本（旧版本只读保留；改卡＝追加新版本）。 */
export interface ChainVersion {
  id: string;
  /** 链内递增序号（第 1 版起）。 */
  index: number;
  created_at: string;
  cards: RequirementCard[];
  change_note: string;
  trials: TrialRef[];
}

/** 一条思维链路：名称＋只增不减的版本序列。 */
export interface Chain {
  id: string;
  name: string;
  created_at: string;
  versions: ChainVersion[];
}

/** 链路库主文件数据（`making-module/chains.json` 的 serde 契约，snake_case 对齐）。 */
export interface ChainLibrary {
  format_version?: number;
  chains: Chain[];
  active: ActiveRef | null;
}

/** 保存新版本的入参卡（id 由后端生成，不接受外部指定）。 */
export interface CardInput {
  title: string;
  trigger_desc: string;
  body: string;
}

/** 读取链路库（链路列表＋版本＋启用指针；缺主文件时后端返回空库）。 */
export async function chainLibraryLoad(call: InvokeFn = defaultInvoke): Promise<ChainLibrary> {
  return call<ChainLibrary>("chain_library_load");
}

/** 新建链路（只有名称，尚无版本；不改变当前启用状态）。 */
export async function chainCreate(
  name: string,
  call: InvokeFn = defaultInvoke,
): Promise<Chain> {
  return call<Chain>("chain_create", { name });
}

/**
 * 保存新版本（用户确认保存的入口）：追加不可变新版本，不改 `active` 指针
 * （存草稿不等于生效）。校验失败（超限/缺触发描述）后端明确报错。
 */
export async function chainSaveVersion(
  chainId: string,
  cards: CardInput[],
  changeNote: string | null,
  call: InvokeFn = defaultInvoke,
): Promise<ChainVersion> {
  return call<ChainVersion>("chain_save_version", {
    chainId,
    cards,
    changeNote,
  });
}

/** 显式启用/切换当前链路（全局一条，所有作品共用；从下一轮开始生效）。 */
export async function chainSetActive(
  chainId: string,
  versionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call<void>("chain_set_active", { chainId, versionId });
}

/** 回退：启用指针指向旧版本；较新版本及其试问证据保留。 */
export async function chainRollback(
  chainId: string,
  versionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call<void>("chain_rollback", { chainId, versionId });
}

/** 停用当前链路：下一轮起回到日常陪想；链路、版本与试问档案全部保留。 */
export async function chainDeactivate(call: InvokeFn = defaultInvoke): Promise<void> {
  await call<void>("chain_deactivate");
}

/** 删除链路（独立动作，调用方负责确认）：删除该链路全部数据；不触碰作品与讨论档案。 */
export async function chainDelete(chainId: string, call: InvokeFn = defaultInvoke): Promise<void> {
  await call<void>("chain_delete", { chainId });
}

/** 重命名链路：只改名称，不动版本与启用指针。 */
export async function chainRename(
  chainId: string,
  name: string,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call<void>("chain_rename", { chainId, name });
}

// ========== 制作模块·制作对话命令与事件（change: add-making-module-core 任务 5 命令面） ==========

/** 制作对话一轮的生成终态（与后端锁定契约一致；注意成功态是 `success`，非日常的 `done`）。 */
export type MakingTurnStatus = "pending" | "success" | "failed" | "cancelled";

/** 制作对话轮次（后端 `MakingTurn` 的 serde 契约）。 */
export interface MakingConversationTurn {
  role: "user" | "assistant";
  text: string;
  status: MakingTurnStatus;
}

/**
 * 制作会话档案（后端 `MakingConversationRecord`；全局侧
 * `making-module/conversations/<id>.json`，绝不写入作品文件夹）。
 * `id` 由前端生成（`mc-` 前缀）；`updated_at` 由前端维护，列表按其倒序。
 */
export interface MakingConversationRecord {
  id: string;
  chain_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: MakingConversationTurn[];
}

/** 制作会话列表摘要（不含 turns 全文）。 */
export interface MakingConversationSummary {
  id: string;
  chain_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
}

/** `making_conversation_list` 的稳定返回：正常条目＋被跳过（损坏/超限）档案的如实提示。 */
export interface MakingConversationListResult {
  conversations: MakingConversationSummary[];
  skipped: string[];
}

/** `"making-message-event"` 事件载荷（与 `ai-delta` 同构；`session_id` 为制作会话 id）。 */
export interface MakingMessageEventPayload {
  session_id: string;
  message_id: string;
  seq: number;
  text: string;
}

/**
 * 启动制作会话（幂等；懒建：会话已存在时复用，档案有历史则自动重放 seed——
 * 重开会话的恢复入口）。收到 `ai-driver-lost` 后应先 `makingEndSession` 复位。
 */
export async function makingStartSession(
  conversationId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("making_start_session", { conversationId });
}

/**
 * 向制作会话发送一条消息并等待终态。命令阻塞到终态才 resolve；流式增量经
 * `"making-message-event"` 事件先行转发，命令返回的 `content` 是最终事实。
 * 后端自动确保会话存在（含从档案重放），无需先显式 start。
 */
export async function makingSendMessage(
  conversationId: string,
  messageId: string,
  text: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("making_send_message", { conversationId, messageId, text });
}

/** 取消一条在途的制作消息生成（幂等）。 */
export async function makingCancelMessage(
  conversationId: string,
  messageId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("making_cancel_message", { conversationId, messageId });
}

/**
 * 结束制作会话（幂等）：清除后端注册表条目，随后的 start / send 自动走恢复
 * 路径。收到 `ai-driver-lost` 后对打开的制作会话调用以复位。
 */
export async function makingEndSession(
  conversationId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("making_end_session", { conversationId });
}

/** 按链路列出制作会话（`updated_at` 倒序）；损坏/超限档案跳过并如实提示。 */
export async function makingConversationList(
  chainId: string,
  call: InvokeFn = defaultInvoke,
): Promise<MakingConversationListResult> {
  return call<MakingConversationListResult>("making_conversation_list", { chainId });
}

/** 读取一份完整制作会话档案（重开会话用）；缺失/损坏/超限明确报错。 */
export async function makingConversationLoad(
  id: string,
  call: InvokeFn = defaultInvoke,
): Promise<MakingConversationRecord> {
  return call<MakingConversationRecord>("making_conversation_load", { conversationId: id });
}

/**
 * 保存一份制作会话档案（前端驱动的整档保存，原子写入）。失败明确报错，
 * 调用方据此呈现「保存失败」，不显示已保存状态。
 */
export async function makingConversationSave(
  record: MakingConversationRecord,
  call: InvokeFn = defaultInvoke,
): Promise<null> {
  return call<null>("making_conversation_save", { record });
}

/** 删除一份制作会话档案（幂等：不存在视为成功；独立动作，调用方负责确认）。 */
export async function makingConversationDelete(
  id: string,
  call: InvokeFn = defaultInvoke,
): Promise<null> {
  return call<null>("making_conversation_delete", { conversationId: id });
}

/** 订阅 `"making-message-event"` 流式增量事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenMakingMessage(
  handler: (payload: MakingMessageEventPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<MakingMessageEventPayload>("making-message-event", (event) => handler(event.payload));
}

// ========== 制作模块·试问命令与事件（change: add-making-module-core 任务 6，车道 F2b） ==========

/** 试问证据终态（后端 `TrialStatus` 的 serde snake_case；与制作对话轮次同口径）。 */
export type TrialStatus = "pending" | "success" | "failed" | "cancelled";

/**
 * 一份试问证据（后端 `TrialRecord` 的 serde 契约；全局侧
 * `making-module/trials/<id>.json`，跟链路走、不进任何作品文件夹）。
 * 问答全文只存本文件——试问轮不产生讨论档案，这里是唯一真相源。
 */
export interface TrialRecord {
  id: string;
  chain_id: string;
  chain_name: string;
  version_id: string;
  /** 版本序号（「第 N 版」显示用）。 */
  version_index: number;
  /** 是否带卡试跑（对照试跑为 `false`）。 */
  with_card: boolean;
  question: string;
  /** 回复全文；未收束（pending）或失败 / 取消轮为空串。 */
  reply_text: string;
  status: TrialStatus;
  created_at: string;
  /** 试用作品名称快照（换作品、删作品不影响证据完整）。 */
  work_title: string;
  focus_document_id: string | null;
  focus_document_title: string | null;
  /** 用户反馈（可后补；缺失＝未填写）。 */
  feedback?: string | null;
}

/** `trial_list_for_version` 的返回形状（`created_at` 倒序的完整证据列表）。 */
export interface TrialListResult {
  trials: TrialRecord[];
}

/** `"trial-message-event"` 载荷（与 `ai-delta` 同构；`trial_id` 为前端生成的试问编号）。 */
export interface TrialMessageEventPayload {
  trial_id: string;
  message_id: string;
  seq: number;
  text: string;
}

/** `"trial-authorization-request"` 载荷（试问的按需补读授权请求，不携带任何作品数据）。 */
export interface TrialAuthorizationEventPayload {
  trial_id: string;
  reason: string;
}

/**
 * 发起一轮试问（阻塞至轮次终态；`content`＝回复全文）。卡文本用所试版本（不走
 * active 指针、不切全局链路）；`withCard=false` 为对照轮。`trialId` 由前端生成且
 * **必须带 `trial-` 前缀**（后端校验拒绝无前缀 id）；`workPath` 为当前打开作品路径
 * （必填）；`focusDocumentId` 为 null 表示本次不指定关注文档。
 */
export async function trialSendMessage(
  trialId: string,
  chainId: string,
  versionId: string,
  withCard: boolean,
  question: string,
  focusDocumentId: string | null,
  workPath: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("trial_send_message", {
    trialId,
    chainId,
    versionId,
    withCard,
    question,
    focusDocumentId,
    workPath,
  });
}

/** 取消进行中的试问轮（幂等；取消终态如实记入证据；按 trialId 路由）。 */
export async function trialCancelMessage(
  trialId: string,
  messageId: string,
  call: InvokeFn = defaultInvoke,
): Promise<GenerateAiResult> {
  return call<GenerateAiResult>("trial_cancel_message", { trialId, messageId });
}

/** 应答试问的按需补读授权请求（`trial-authorization-request` 事件的回执）；决定只存内存。 */
export async function trialAuthorizationRespond(
  trialId: string,
  grant: boolean,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call<void>("trial_authorization_respond", { trialId, grant });
}

/** 读取一份试问证据（只读查看；试问单轮，不可继续追问）。 */
export async function trialGet(
  trialId: string,
  call: InvokeFn = defaultInvoke,
): Promise<TrialRecord> {
  return call<TrialRecord>("trial_get", { trialId });
}

/** 按版本列出试问证据（`created_at` 倒序；完整记录，供检视面板只读查看）。 */
export async function trialListForVersion(
  chainId: string,
  versionId: string,
  call: InvokeFn = defaultInvoke,
): Promise<TrialListResult> {
  return call<TrialListResult>("trial_list_for_version", { chainId, versionId });
}

/** 补写 / 清除试问反馈（可后补；空白提交＝清除）。 */
export async function trialSetFeedback(
  trialId: string,
  feedback: string,
  call: InvokeFn = defaultInvoke,
): Promise<void> {
  await call<void>("trial_set_feedback", { trialId, feedback });
}

/** 订阅 `"trial-message-event"` 流式增量事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenTrialMessage(
  handler: (payload: TrialMessageEventPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<TrialMessageEventPayload>("trial-message-event", (event) => handler(event.payload));
}

/** 订阅 `"trial-authorization-request"` 授权请求事件，返回退订函数。接受注入的 `listen` 便于测试。 */
export function listenTrialAuthorization(
  handler: (payload: TrialAuthorizationEventPayload) => void,
  listen: ListenFn = defaultListen,
): Promise<UnlistenFn> {
  return listen<TrialAuthorizationEventPayload>("trial-authorization-request", (event) => handler(event.payload));
}
