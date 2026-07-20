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

export interface TemporaryConversation {
  id: number;
  anchor: SelectionSnapshot;
  firstResponse: string;
  turns: SuccessfulFollowUpTurn[];
  pending: PendingFollowUpTurn | null;
}

export type ReadonlyTemporaryConversation = Readonly<{
  id: number;
  anchor: Readonly<SelectionSnapshot>;
  firstResponse: string;
  turns: ReadonlyArray<Readonly<SuccessfulFollowUpTurn>>;
  pending: Readonly<PendingFollowUpTurn> | null;
}>;

export function frozenSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({ ...snapshot });
}

/**
 * 当前临时对话的内部状态。
 *
 * 只维护一个内存中的线性对话：冻结选区锚点、首轮回应、成功追问轮次，
 * 以及最多一个待回答或失败的用户轮次。不负责面板可见性或订阅通知。
 */
export class TemporaryConversationState {
  private currentConversation: TemporaryConversation | null = null;
  private nextConversationId = 1;
  private nextTurnId = 1;

  get current(): TemporaryConversation | null {
    return this.currentConversation;
  }

  get followUpAvailable(): boolean {
    return this.currentConversation !== null && this.currentConversation.pending === null;
  }

  get conversationIdentity(): { conversationId: number; turnId?: number } | null {
    const conversation = this.currentConversation;
    if (!conversation) return null;
    return conversation.pending
      ? { conversationId: conversation.id, turnId: conversation.pending.id }
      : { conversationId: conversation.id };
  }

  allocateConversationId(): number {
    return this.nextConversationId++;
  }

  clear(): void {
    this.currentConversation = null;
  }

  readonlyView(): ReadonlyTemporaryConversation | null {
    const conversation = this.currentConversation;
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
      anchor: Object.freeze({ ...conversation.anchor }),
      firstResponse: conversation.firstResponse,
      turns: Object.freeze(turns),
      pending,
    });
  }

  createFromFirstSuccess(
    conversationId: number,
    snapshot: SelectionSnapshot,
    response: string,
  ): TemporaryConversation {
    const anchor = frozenSnapshot(snapshot);
    this.currentConversation = {
      id: conversationId,
      anchor,
      firstResponse: response,
      turns: [],
      pending: null,
    };
    return this.currentConversation;
  }

  beginFollowUp(question: string): number | null {
    if (!this.currentConversation || this.currentConversation.pending || !question.trim()) {
      return null;
    }
    const id = this.nextTurnId++;
    this.currentConversation.pending = { id, question };
    return id;
  }

  succeedFollowUp(turnId: number, response: string): SuccessfulFollowUpTurn | null {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return null;
    const pending = conversation.pending;
    const turn = { id: pending.id, question: pending.question, response };
    conversation.turns.push(turn);
    conversation.pending = null;
    return turn;
  }

  failFollowUp(turnId: number, error: GenerateAiError): boolean {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return false;
    conversation.pending.error = error;
    return true;
  }

  requireFollowUpConfiguration(turnId: number): boolean {
    return this.failFollowUp(turnId, {
      code: "configuration_required",
      message: "请先配置 LLM 后再重试",
    });
  }

  retryFollowUpQuestion(): string | null {
    return this.currentConversation?.pending?.error
      ? this.currentConversation.pending.question
      : null;
  }

  acceptEditedFollowUp(question: string): number | null {
    const conversation = this.currentConversation;
    const pending = conversation?.pending;
    if (!conversation || !pending?.error || !question.trim()) return null;
    pending.question = question;
    delete pending.error;
    return pending.id;
  }

  cancelFollowUp(turnId: number): string | null {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return null;
    conversation.pending = null;
    return conversation.turns.length > 0
      ? conversation.turns[conversation.turns.length - 1].response
      : conversation.firstResponse;
  }

  acceptFollowUpRetry(): number | null {
    const conversation = this.currentConversation;
    const pending = conversation?.pending;
    if (!conversation || !pending?.error) return null;
    delete pending.error;
    return pending.id;
  }

  followUpRequest(): GenerateAiRequest | null {
    const conversation = this.currentConversation;
    if (!conversation?.pending) return null;
    return this.buildFollowUpRequest(conversation, conversation.pending.question);
  }

  followUpRequestForQuestion(question: string): GenerateAiRequest | null {
    const conversation = this.currentConversation;
    if (!conversation?.pending || !conversation.pending.error || !question.trim()) {
      return null;
    }
    return this.buildFollowUpRequest(conversation, question);
  }

  private buildFollowUpRequest(
    conversation: TemporaryConversation,
    question: string,
  ): GenerateAiRequest {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "assistant", content: conversation.firstResponse },
    ];
    for (const turn of conversation.turns) {
      messages.push({ role: "user" as const, content: turn.question });
      messages.push({ role: "assistant" as const, content: turn.response });
    }
    messages.push({ role: "user", content: question });
    return {
      kind: "follow_up",
      selected_text: conversation.anchor.selectedText,
      messages,
    };
  }
}
