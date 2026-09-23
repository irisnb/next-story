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
 * 崩溃恢复：把显示历史重放进一个新会话。宿主会把系统提示词组装到首个
 * user 轮文本前面，前端只提交投影后的 `{role, text}` 轮次；`origin` 携带
 * 当前对话的发起方式，重放时按来源组装对应的入口层提示词。
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
