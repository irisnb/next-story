import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";
import type {
  ConversationRecord,
  ConversationSummary,
  ConversationTurn,
  FirstRoundMaterial as ArchivedFirstRoundMaterial,
} from "./conversation-archive.ts";
import { deriveConversationTitle } from "./conversation-archive.ts";

export interface SuccessfulFollowUpTurn {
  id: number;
  question: string;
  response: string;
}

export interface PendingFollowUpTurn {
  id: number;
  question: string;
  /** 流式增量草稿（begin 时初始 ""，逐字追加；done 全文到达后整体替换）。 */
  streamedText?: string;
  error?: GenerateAiError;
  /** 重开时未完成轮被打上「中断」标记：显示为中断终态，不自动重发。 */
  interrupted?: boolean;
}

/**
 * 选区召唤和直接提问统一进入同一讨论。
 */
export type FirstRoundMaterial =
  | Extract<GenerateAiRequest, { kind: "summon" }>
  | Extract<GenerateAiRequest, { kind: "direct_question" }>;

/**
 * 一个讨论的完整显示数据（首轮冻结材料、首轮回应与后续问答轮次），
 * 是显示与崩溃恢复重放的运行期事实源。`id` 是全局唯一 `conversation_id`。
 */
export interface TemporaryConversation {
  id: string;
  createdAt: string;
  /** 首轮冻结选区锚点；直接提问无选区时为 null。 */
  anchor: SelectionSnapshot | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  /** 首轮回应是否在生成途中被打断（重开档案时标记）；false/undefined 表示首轮已完成。 */
  firstRoundInterrupted?: boolean;
  turns: SuccessfulFollowUpTurn[];
  pending: PendingFollowUpTurn | null;
}

export type ReadonlyTemporaryConversation = Readonly<{
  id: string;
  createdAt: string;
  anchor: Readonly<SelectionSnapshot> | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  /** 首轮回应是否在生成途中被打断（重开档案时标记）；false/undefined 表示首轮已完成。 */
  firstRoundInterrupted?: boolean;
  turns: ReadonlyArray<Readonly<SuccessfulFollowUpTurn>>;
  pending: Readonly<PendingFollowUpTurn> | null;
}>;

/**
 * 讨论集合中的单个条目：讨论自身的显示请求状态（首轮在途或已建立对话的追问态）、
 * 已建立对话本体（首轮成功前为 null）与首轮材料。讨论的迟到结果按其 `id` 隔离。
 */
export interface Discussion {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly focusDocumentId: string | null;
  readonly focusDocumentTitle: string | null;
  readonly request: import("./ai-panel-request-state.ts").PanelRequestState;
  readonly conversation: TemporaryConversation | null;
  readonly pendingFirstRequest: FirstRoundMaterial | null;
  /** 首轮冻结选区锚点；直接提问无选区时为 null。 */
  readonly anchor: SelectionSnapshot | null;
}

export function frozenSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({ ...snapshot });
}

/** 把请求形态的首轮材料转成档案形态（召唤归一为空问题 + 选区）。 */
export function firstRoundMaterialToArchive(
  material: FirstRoundMaterial,
): ArchivedFirstRoundMaterial {
  if (material.kind === "summon") {
    return { kind: "summon", question: "", selection_text: material.selected_text };
  }
  return {
    kind: "direct_question",
    question: material.question,
    selection_text: material.selected_text ?? null,
  };
}

/** 把档案形态的首轮材料还原为请求形态（供重开与重放使用）。 */
export function firstRoundMaterialFromArchive(
  material: ArchivedFirstRoundMaterial,
): FirstRoundMaterial {
  if (material.kind === "summon") {
    return { kind: "summon", selected_text: material.selection_text ?? "" };
  }
  return {
    kind: "direct_question",
    question: material.question,
    ...(material.selection_text !== null ? { selected_text: material.selection_text } : {}),
  };
}

export function createConversationFromFirstSuccess(
  conversationId: string,
  createdAt: string,
  snapshot: SelectionSnapshot | null,
  firstRequest: FirstRoundMaterial,
  response: string,
): TemporaryConversation {
  const anchor = snapshot ? frozenSnapshot(snapshot) : null;
  return {
    id: conversationId,
    createdAt,
    anchor,
    initialUserMaterial: Object.freeze({ ...firstRequest }),
    firstResponse: response,
    firstRoundInterrupted: false,
    turns: [],
    pending: null,
  };
}

export function beginConversationFollowUp(
  conversation: TemporaryConversation,
  question: string,
  turnId: number,
): { conversation: TemporaryConversation; turnId: number } | { conversation: null; turnId: null } {
  if (!question.trim()) return { conversation: null, turnId: null };
  // 已有进行中的待答轮次时拒绝；已中断（重开）的待答轮可被新问题替换。
  if (conversation.pending && !conversation.pending.interrupted) {
    return { conversation: null, turnId: null };
  }
  return {
    conversation: { ...conversation, pending: { id: turnId, question, streamedText: "" } },
    turnId,
  };
}

export function succeedConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
  response: string,
): { conversation: TemporaryConversation | null; turn: SuccessfulFollowUpTurn | null } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, turn: null };
  }
  const turn: SuccessfulFollowUpTurn = {
    id: pending.id,
    question: pending.question,
    response,
  };
  return {
    conversation: {
      ...conversation,
      turns: [...conversation.turns, turn],
      pending: null,
    },
    turn,
  };
}

export function failConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
  error: GenerateAiError,
): { conversation: TemporaryConversation | null; ok: boolean } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, ok: false };
  }
  return {
    conversation: { ...conversation, pending: { ...pending, error } },
    ok: true,
  };
}

export function acceptEditedConversationFollowUp(
  conversation: TemporaryConversation | null,
  question: string,
): { conversation: TemporaryConversation | null; turnId: number | null } {
  const pending = conversation?.pending;
  if (!conversation || !pending?.error || !question.trim()) {
    return { conversation, turnId: null };
  }
  return {
    conversation: {
      ...conversation,
      pending: { id: pending.id, question, streamedText: "" },
    },
    turnId: pending.id,
  };
}

export function cancelConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
): { conversation: TemporaryConversation | null; response: string | null } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, response: null };
  }
  const response =
    conversation.turns.length > 0
      ? conversation.turns[conversation.turns.length - 1].response
      : conversation.firstResponse;
  return {
    conversation: { ...conversation, pending: null },
    response,
  };
}

export function acceptConversationFollowUpRetry(
  conversation: TemporaryConversation | null,
): { conversation: TemporaryConversation | null; turnId: number | null } {
  const pending = conversation?.pending;
  if (!conversation || !pending?.error) {
    return { conversation, turnId: null };
  }
  return {
    conversation: {
      ...conversation,
      pending: { id: pending.id, question: pending.question, streamedText: "" },
    },
    turnId: pending.id,
  };
}

/** 只有成功轮次进入追问 payload；待回答轮次只取 question 本身。 */
export function buildFollowUpRequest(
  conversation: TemporaryConversation,
  question: string,
): Extract<GenerateAiRequest, { kind: "follow_up" }> {
  const material = conversation.initialUserMaterial;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (material.kind === "direct_question") {
    messages.push({ role: "user", content: material.question });
  }
  messages.push({ role: "assistant", content: conversation.firstResponse });
  for (const turn of conversation.turns) {
    messages.push({ role: "user" as const, content: turn.question });
    messages.push({ role: "assistant" as const, content: turn.response });
  }
  messages.push({ role: "user", content: question });
  return {
    kind: "follow_up",
    selected_text: material.selected_text ?? "",
    ...(material.kind === "direct_question"
      ? { origin: "direct_question" as const }
      : {}),
    messages,
  };
}

export function followUpRequestOf(
  conversation: TemporaryConversation | null,
): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
  if (!conversation?.pending) return null;
  return buildFollowUpRequest(conversation, conversation.pending.question);
}

export function followUpRequestForQuestionOf(
  conversation: TemporaryConversation | null,
  question: string,
): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
  if (!conversation?.pending || !conversation.pending.error || !question.trim()) return null;
  return buildFollowUpRequest(conversation, question);
}

export function followUpAvailableOf(conversation: TemporaryConversation | null): boolean {
  return conversation !== null && (conversation.pending === null || conversation.pending.interrupted === true);
}

export function conversationIdentityOf(
  conversation: TemporaryConversation | null,
): { conversationId: string; turnId?: number } | null {
  if (!conversation) return null;
  return conversation.pending
    ? { conversationId: conversation.id, turnId: conversation.pending.id }
    : { conversationId: conversation.id };
}

export function retryFollowUpQuestionOf(conversation: TemporaryConversation | null): string | null {
  return conversation?.pending?.error ? conversation.pending.question : null;
}

/** 深冻结的防御性只读视图；外部拿到后无法反向改写内部状态。 */
export function readonlyConversationView(
  conversation: TemporaryConversation | null,
): ReadonlyTemporaryConversation | null {
  if (!conversation) return null;
  const turns = conversation.turns.map((turn) => Object.freeze({ ...turn }));
  const pending = conversation.pending
    ? Object.freeze({
        ...conversation.pending,
        error: conversation.pending.error
          ? Object.freeze({ ...conversation.pending.error })
          : undefined,
      })
    : null;
  return Object.freeze({
    id: conversation.id,
    createdAt: conversation.createdAt,
    anchor: conversation.anchor ? Object.freeze({ ...conversation.anchor }) : null,
    initialUserMaterial: Object.freeze({ ...conversation.initialUserMaterial }),
    firstResponse: conversation.firstResponse,
    firstRoundInterrupted: conversation.firstRoundInterrupted,
    turns: Object.freeze(turns),
    pending,
  });
}

/** 把讨论投影为档案保存契约（首轮材料 + 线性轮次）。 */
export function buildConversationRecord(
  conversation: TemporaryConversation,
  focusDocumentId: string | null,
  focusDocumentTitle: string | null,
): ConversationRecord {
  const material = firstRoundMaterialToArchive(conversation.initialUserMaterial);
  const turns: ConversationTurn[] = [];
  // 首轮从未产出回应且带中断标记时，档案保留 pending（重开可再次识别为中断）；
  // 一旦有真实回应或已完成，仍为 done。
  const firstStatus: ConversationTurn["status"] =
    conversation.firstRoundInterrupted && conversation.firstResponse === ""
      ? "pending"
      : "done";
  turns.push({ role: "assistant", text: conversation.firstResponse, status: firstStatus });
  for (const turn of conversation.turns) {
    turns.push({ role: "user", text: turn.question, status: "done" });
    turns.push({ role: "assistant", text: turn.response, status: "done" });
  }
  if (conversation.pending) {
    const pending = conversation.pending;
    turns.push({ role: "user", text: pending.question, status: "done" });
    const status: ConversationTurn["status"] = pending.error
      ? "failed"
      : pending.interrupted
        ? "cancelled"
        : "pending";
    turns.push({ role: "assistant", text: pending.streamedText ?? "", status });
  }
  return {
    version: 1,
    conversation_id: conversation.id,
    created_at: conversation.createdAt,
    updated_at: conversation.createdAt,
    focus_document_id: focusDocumentId,
    focus_document_title: focusDocumentTitle,
    first_round_material: material,
    turns,
  };
}

/**
 * 从档案重建讨论显示数据（重开用）。未完成轮（status 为 pending）转为「中断」，
 * 不自动重发；失败轮保留错误供查看。首轮 assistant 回应在召唤时为 turns[0]，
 * 直接提问时首轮 user 轮在前，assistant 回应为 turns[1]。
 */
export function conversationFromRecord(
  record: ConversationRecord | ConversationSummary,
): TemporaryConversation {
  const material = firstRoundMaterialFromArchive(record.first_round_material);
  const turns = record.turns;
  const first = turns[0];

  // 首轮 assistant 轮：召唤时即 turns[0]；直接提问时首轮 user 轮在前，assistant 轮在 turns[1]。
  const firstAssistantIndex = first && first.role === "user" ? 1 : 0;
  const firstAssistant = turns[firstAssistantIndex];
  const hasFirstAssistant = firstAssistant !== undefined && firstAssistant.role === "assistant";
  const firstResponse = hasFirstAssistant ? firstAssistant.text : "";
  // 首轮 assistant 轮未完成（pending / cancelled / failed）视为生成途中被打断；done 表示已完成。
  const firstRoundInterrupted = hasFirstAssistant && firstAssistant.status !== "done";

  const followUps: SuccessfulFollowUpTurn[] = [];
  let pending: PendingFollowUpTurn | null = null;
  let nextTurnId = 1;

  // 从首轮 assistant 回应之后，按 user/assistant 交替重建成功轮次与未完成轮。
  let index = firstAssistantIndex + 1;
  while (index < turns.length) {
    const user = turns[index];
    if (user.role !== "user") {
      index += 1;
      continue;
    }
    const assistant = turns[index + 1];
    if (assistant && assistant.role === "assistant" && user.status === "done") {
      if (assistant.status === "done") {
        followUps.push({ id: nextTurnId, question: user.text, response: assistant.text });
        nextTurnId += 1;
      } else {
        // 未完成轮：pending / cancelled → 中断；failed → 显示中断错误。
        pending = assistant.status === "failed"
          ? { id: nextTurnId, question: user.text, streamedText: assistant.text, error: { code: "service" as const, message: "中断" } }
          : { id: nextTurnId, question: user.text, streamedText: assistant.text, interrupted: true };
      }
      index += 2;
      continue;
    }
    // 孤立的 user 轮（生成中途崩溃）：显示中断。
    pending = { id: nextTurnId, question: user.text, streamedText: "", interrupted: true };
    index += 1;
  }

  return {
    id: record.conversation_id,
    createdAt: record.created_at,
    anchor: null,
    initialUserMaterial: Object.freeze({ ...material }),
    firstResponse,
    firstRoundInterrupted,
    turns: followUps,
    pending,
  };
}

/**
 * 由讨论构建档案保存契约，兼容首轮在途（尚无首轮回应）与已建立对话两种状态。
 * 首轮在途时写入一条 pending 的 assistant 轮；终态由后续 `conversationSave` 原子更新。
 */
export function buildDiscussionRecord(discussion: Discussion): ConversationRecord {
  if (discussion.conversation) {
    return buildConversationRecord(
      discussion.conversation,
      discussion.focusDocumentId,
      discussion.focusDocumentTitle,
    );
  }
  const material = firstRoundMaterialToArchive(
    discussion.pendingFirstRequest ?? {
      kind: "summon" as const,
      selected_text: discussion.anchor?.selectedText ?? "",
    },
  );
  const turns: ConversationTurn[] = [];
  if (material.kind === "direct_question") {
    turns.push({ role: "user", text: material.question, status: "done" });
  }
  turns.push({ role: "assistant", text: "", status: "pending" });
  return {
    version: 1,
    conversation_id: discussion.id,
    created_at: discussion.createdAt,
    updated_at: discussion.updatedAt,
    focus_document_id: discussion.focusDocumentId,
    focus_document_title: discussion.focusDocumentTitle,
    first_round_material: material,
    turns,
  };
}

/** 由讨论生成会话列表条目（标题取首轮问题/召唤文本截断，空则时间）。 */
export function summaryOf(  conversation: TemporaryConversation,
  focusDocumentId: string | null,
  focusDocumentTitle: string | null,
): ConversationSummary {
  const material = firstRoundMaterialToArchive(conversation.initialUserMaterial);
  const lastStatus: ConversationSummary["last_status"] = conversation.pending
    ? conversation.pending.error
      ? "failed"
      : "pending"
    : conversation.firstRoundInterrupted && conversation.firstResponse === ""
      ? "pending"
      : "done";
  return {
    conversation_id: conversation.id,
    title: deriveConversationTitle(material, conversation.createdAt),
    created_at: conversation.createdAt,
    updated_at: conversation.createdAt,
    last_status: lastStatus,
    focus_document_id: focusDocumentId,
    focus_document_title: focusDocumentTitle,
    first_round_material: material,
    turns: buildConversationRecord(conversation, focusDocumentId, focusDocumentTitle).turns,
  };
}
