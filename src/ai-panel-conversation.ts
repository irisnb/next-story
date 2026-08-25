import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";

export interface SuccessfulFollowUpTurn {
  id: number;
  question: string;
  response: string;
}

export interface PendingFollowUpTurn {
  id: number;
  question: string;
  error?: GenerateAiError;
}

/**
 * 三个首轮入口（AI 及时召唤 / 思维扩展 / 直接提问）统一进入同一临时对话，
 * 因此首轮材料是 `first` 与 `direct_question` 请求的联合。
 */
export type FirstRoundMaterial =
  | Extract<GenerateAiRequest, { kind: "first" }>
  | Extract<GenerateAiRequest, { kind: "direct_question" }>;

export interface TemporaryConversation {
  id: number;
  /** 首轮冻结选区锚点；直接提问无选区时为 null。 */
  anchor: SelectionSnapshot | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  turns: SuccessfulFollowUpTurn[];
  pending: PendingFollowUpTurn | null;
}

export type ReadonlyTemporaryConversation = Readonly<{
  id: number;
  anchor: Readonly<SelectionSnapshot> | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  turns: ReadonlyArray<Readonly<SuccessfulFollowUpTurn>>;
  pending: Readonly<PendingFollowUpTurn> | null;
}>;

export function frozenSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({ ...snapshot });
}

/**
 * 临时对话子系统的全部可变数据，是纯函数迁移的载体。
 *
 * `TemporaryConversationState`（命令式外观）与 AI 面板 reducer 共用下面的纯函数，
 * 保证两处迁移逻辑是单一事实源，行为永远一致。
 */
export interface TemporaryConversationContext {
  readonly conversation: TemporaryConversation | null;
  readonly nextConversationId: number;
  readonly nextTurnId: number;
}

export function emptyConversationContext(): TemporaryConversationContext {
  return { conversation: null, nextConversationId: 1, nextTurnId: 1 };
}

/** 清空当前对话；保留 id 计数器（与旧 `clear()` 语义一致）。 */
export function clearConversationContext(
  context: TemporaryConversationContext,
): TemporaryConversationContext {
  if (context.conversation === null) return context;
  return { ...context, conversation: null };
}

export function allocateConversationId(
  context: TemporaryConversationContext,
): { context: TemporaryConversationContext; conversationId: number } {
  return {
    context: { ...context, nextConversationId: context.nextConversationId + 1 },
    conversationId: context.nextConversationId,
  };
}

export function createConversationFromFirstSuccess(
  context: TemporaryConversationContext,
  conversationId: number,
  snapshot: SelectionSnapshot | null,
  firstRequest: FirstRoundMaterial,
  response: string,
): { context: TemporaryConversationContext; conversation: TemporaryConversation } {
  const anchor = snapshot ? frozenSnapshot(snapshot) : null;
  const conversation: TemporaryConversation = {
    id: conversationId,
    anchor,
    initialUserMaterial: Object.freeze({ ...firstRequest }),
    firstResponse: response,
    turns: [],
    pending: null,
  };
  return { context: { ...context, conversation }, conversation };
}

export function beginConversationFollowUp(
  context: TemporaryConversationContext,
  question: string,
): { context: TemporaryConversationContext; turnId: number | null } {
  const conversation = context.conversation;
  if (!conversation || conversation.pending || !question.trim()) {
    return { context, turnId: null };
  }
  const id = context.nextTurnId;
  return {
    context: {
      ...context,
      conversation: { ...conversation, pending: { id, question } },
      nextTurnId: context.nextTurnId + 1,
    },
    turnId: id,
  };
}

export function succeedConversationFollowUp(
  context: TemporaryConversationContext,
  turnId: number,
  response: string,
): { context: TemporaryConversationContext; turn: SuccessfulFollowUpTurn | null } {
  const conversation = context.conversation;
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { context, turn: null };
  }
  const turn: SuccessfulFollowUpTurn = {
    id: pending.id,
    question: pending.question,
    response,
  };
  return {
    context: {
      ...context,
      conversation: {
        ...conversation,
        turns: [...conversation.turns, turn],
        pending: null,
      },
    },
    turn,
  };
}

export function failConversationFollowUp(
  context: TemporaryConversationContext,
  turnId: number,
  error: GenerateAiError,
): { context: TemporaryConversationContext; ok: boolean } {
  const conversation = context.conversation;
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { context, ok: false };
  }
  return {
    context: {
      ...context,
      conversation: { ...conversation, pending: { ...pending, error } },
    },
    ok: true,
  };
}

export function acceptEditedConversationFollowUp(
  context: TemporaryConversationContext,
  question: string,
): { context: TemporaryConversationContext; turnId: number | null } {
  const conversation = context.conversation;
  const pending = conversation?.pending;
  if (!conversation || !pending?.error || !question.trim()) {
    return { context, turnId: null };
  }
  return {
    context: {
      ...context,
      conversation: { ...conversation, pending: { id: pending.id, question } },
    },
    turnId: pending.id,
  };
}

export function cancelConversationFollowUp(
  context: TemporaryConversationContext,
  turnId: number,
): { context: TemporaryConversationContext; response: string | null } {
  const conversation = context.conversation;
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { context, response: null };
  }
  const response =
    conversation.turns.length > 0
      ? conversation.turns[conversation.turns.length - 1].response
      : conversation.firstResponse;
  return {
    context: { ...context, conversation: { ...conversation, pending: null } },
    response,
  };
}

export function acceptConversationFollowUpRetry(
  context: TemporaryConversationContext,
): { context: TemporaryConversationContext; turnId: number | null } {
  const conversation = context.conversation;
  const pending = conversation?.pending;
  if (!conversation || !pending?.error) {
    return { context, turnId: null };
  }
  return {
    context: {
      ...context,
      conversation: {
        ...conversation,
        pending: { id: pending.id, question: pending.question },
      },
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
    // 直接提问来源：messages 以用户原问题开头，再接 assistant 首轮回应与后续轮次。
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
    ...(material.kind === "first" && material.thinking_direction
      ? { thinking_direction: material.thinking_direction }
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
  return conversation !== null && conversation.pending === null;
}

export function conversationIdentityOf(
  conversation: TemporaryConversation | null,
): { conversationId: number; turnId?: number } | null {
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
    anchor: conversation.anchor ? Object.freeze({ ...conversation.anchor }) : null,
    initialUserMaterial: Object.freeze({ ...conversation.initialUserMaterial }),
    firstResponse: conversation.firstResponse,
    turns: Object.freeze(turns),
    pending,
  });
}

/**
 * 当前临时对话的命令式外观（公开 API 与旧实现完全一致）。
 *
 * 内部不再原地 mutate：每次操作把 `TemporaryConversationContext` 交给同模块的纯函数
 * 迁移，用返回的新上下文整体替换内部状态。它不负责面板可见性或订阅通知。
 */
export class TemporaryConversationState {
  private context: TemporaryConversationContext = emptyConversationContext();

  get current(): TemporaryConversation | null {
    return this.context.conversation;
  }

  get followUpAvailable(): boolean {
    return followUpAvailableOf(this.context.conversation);
  }

  get conversationIdentity(): { conversationId: number; turnId?: number } | null {
    return conversationIdentityOf(this.context.conversation);
  }

  allocateConversationId(): number {
    const allocation = allocateConversationId(this.context);
    this.context = allocation.context;
    return allocation.conversationId;
  }

  clear(): void {
    this.context = clearConversationContext(this.context);
  }

  readonlyView(): ReadonlyTemporaryConversation | null {
    return readonlyConversationView(this.context.conversation);
  }

  createFromFirstSuccess(
    conversationId: number,
    snapshot: SelectionSnapshot | null,
    firstRequest: FirstRoundMaterial,
    response: string,
  ): TemporaryConversation {
    const created = createConversationFromFirstSuccess(
      this.context,
      conversationId,
      snapshot,
      firstRequest,
      response,
    );
    this.context = created.context;
    return created.conversation;
  }

  beginFollowUp(question: string): number | null {
    const outcome = beginConversationFollowUp(this.context, question);
    this.context = outcome.context;
    return outcome.turnId;
  }

  succeedFollowUp(turnId: number, response: string): SuccessfulFollowUpTurn | null {
    const outcome = succeedConversationFollowUp(this.context, turnId, response);
    this.context = outcome.context;
    return outcome.turn;
  }

  failFollowUp(turnId: number, error: GenerateAiError): boolean {
    const outcome = failConversationFollowUp(this.context, turnId, error);
    this.context = outcome.context;
    return outcome.ok;
  }

  requireFollowUpConfiguration(turnId: number): boolean {
    return this.failFollowUp(turnId, {
      code: "configuration_required",
      message: "请先配置 LLM 后再重试",
    });
  }

  retryFollowUpQuestion(): string | null {
    return retryFollowUpQuestionOf(this.context.conversation);
  }

  acceptEditedFollowUp(question: string): number | null {
    const outcome = acceptEditedConversationFollowUp(this.context, question);
    this.context = outcome.context;
    return outcome.turnId;
  }

  cancelFollowUp(turnId: number): string | null {
    const outcome = cancelConversationFollowUp(this.context, turnId);
    this.context = outcome.context;
    return outcome.response;
  }

  acceptFollowUpRetry(): number | null {
    const outcome = acceptConversationFollowUpRetry(this.context);
    this.context = outcome.context;
    return outcome.turnId;
  }

  followUpRequest(): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
    return followUpRequestOf(this.context.conversation);
  }

  followUpRequestForQuestion(question: string): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
    return followUpRequestForQuestionOf(this.context.conversation, question);
  }
}
