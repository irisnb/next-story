import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * 讨论档案层（change: add-conversation-persistence-and-isolation）。
 *
 * 本模块只做三件事，不接触面板状态与 DOM：
 * 1. 生成全局唯一的 `conversation_id`（时间戳 + 随机段）；
 * 2. 声明与 Rust 车道共享的命令契约类型（讨论档案的保存 / 列表 / 删除）；
 * 3. 封装对 `conversation_list` / `conversation_save` / `conversation_delete` 的 Tauri 调用。
 *
 * 讨论档案是 AI 输出临时材料的记录，与作品正文分开存放，不是作品事实源。
 * 前端唯一落盘路径是这些受控命令；它们绝不注册为 AI 可调用工具（零写回）。
 */

/** 与 Tauri `invoke` 同形的窄类型，便于在测试中注入假实现。 */
export type ConversationInvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** 一条讨论轮次的生成终态。 */
export type ConversationTurnStatus = "pending" | "done" | "failed" | "cancelled";

/** 讨论档案中的一轮对话。 */
export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  status: ConversationTurnStatus;
}

/**
 * 首轮材料来源的持久化形态。`direct_question` 的首轮问题与 `summon` 的冻结选区
 * 都归一化为 `question`（召唤为空串）+ `selection_text`（无选区为 null）。
 */
export type FirstRoundMaterial =
  | { kind: "direct_question"; question: string; selection_text: string | null }
  | { kind: "summon"; question: string; selection_text: string | null };

/** 讨论档案的保存契约（version 1）。 */
export interface ConversationRecord {
  version: 1;
  conversation_id: string;
  created_at: string;
  updated_at: string;
  focus_document_id: string | null;
  focus_document_title: string | null;
  first_round_material: FirstRoundMaterial;
  turns: ConversationTurn[];
  /** 可选自定义标题；缺失/空白表示未重命名。 */
  title?: string;
  /** 置顶标记；缺失表示未置顶。 */
  pinned?: boolean;
}

/**
 * 会话列表条目。除列表展示所需的身份 / 标题 / 时间 / 终态外，还携带重开所需的
 * 完整轮次与首轮材料（本车道只有 list/save/delete 三个命令，无单独“读取一条”
 * 命令，故列表必须一次带回重开所需全部内容）。
 */
export interface ConversationSummary {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_status: ConversationTurnStatus;
  focus_document_id: string | null;
  focus_document_title: string | null;
  first_round_material: FirstRoundMaterial;
  turns: ConversationTurn[];
  /** 用户自定义标题原值；null 表示未重命名。 */
  custom_title?: string | null;
  /** 置顶标记；false 表示未置顶。 */
  pinned?: boolean;
}

/** `conversation_list` 的稳定返回：当前作品的讨论列表 + 被跳过（损坏/超限）的档案。 */
export interface ConversationListResult {
  conversations: ConversationSummary[];
  skipped: string[];
}

/**
 * 每讨论的「已删除」守卫：`conversationDelete` 落盘前先标记，`conversationSave` 对已标记 id 直接跳过。
 *
 * 竞态兜底：删除前已发起的在途保存 promise 若晚于删除落盘，会把已删除的档案文件复活。
 * 这里用两个模块级状态兜底：
 * 1. `deletedConversationIds` —— 删除后同 id 的保存一律 no-op，不发起 invoke；
 * 2. `inFlightSaves` —— 删除前先等待该 id 的在途保存落盘，保证删除最后落地（不会被迟到保存覆盖）。
 */
const deletedConversationIds = new Set<string>();
const inFlightSaves = new Map<string, Promise<unknown>>();

/** 生成全局唯一 `conversation_id`（时间戳 + 随机段）。测试可注入随机段以保持确定。 */
export function generateConversationId(randomSegment: () => string = defaultRandomSegment): string {
  const timestamp = Date.now().toString(36);
  return `${timestamp}-${randomSegment()}`;
}

function defaultRandomSegment(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** 列表标题：优先首轮问题 / 召唤选区文本截断，空则回退到创建时间。 */
export function deriveConversationTitle(
  material: FirstRoundMaterial,
  createdAt: string,
): string {
  const source = material.kind === "direct_question" ? material.question : material.selection_text ?? "";
  const trimmed = source.trim();
  if (trimmed) {
    const TITLE_LIMIT = 40;
    return trimmed.length > TITLE_LIMIT ? `${trimmed.slice(0, TITLE_LIMIT)}…` : trimmed;
  }
  return createdAt;
}

export async function conversationList(
  projectPath: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<ConversationListResult> {
  return call<ConversationListResult>("conversation_list", { projectPath });
}

export async function conversationSave(
  projectPath: string,
  record: ConversationRecord,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  const conversationId = record.conversation_id;
  // 已删除讨论的迟到保存：直接跳过，不发起 invoke，防止复活已删除档案。
  if (deletedConversationIds.has(conversationId)) {
    return;
  }
  const pending = call("conversation_save", { projectPath, record });
  inFlightSaves.set(conversationId, pending);
  try {
    await pending;
  } finally {
    if (inFlightSaves.get(conversationId) === pending) {
      inFlightSaves.delete(conversationId);
    }
  }
}

export async function conversationDelete(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  // 先标记已删除：阻断后续保存；再等待在途保存落盘，保证删除最后落地。
  deletedConversationIds.add(conversationId);
  const inFlight = inFlightSaves.get(conversationId);
  if (inFlight !== undefined) {
    try {
      await inFlight;
    } catch {
      // 在途保存失败不阻断删除。
    }
  }
  await call("conversation_delete", { projectPath, conversationId });
}

/**
 * 撤销删除：清除前端的「已删除」守卫与后端的删除墓碑，使该讨论可被再次保存。
 * 调用后需重新 `conversationSave` 把内存副本写回档案。仅用于删除撤销路径。
 */
export async function conversationRestore(
  projectPath: string,
  conversationId: string,
  call: ConversationInvokeFn = tauriInvoke,
): Promise<void> {
  deletedConversationIds.delete(conversationId);
  await call("conversation_restore", { projectPath, conversationId });
}
