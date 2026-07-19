import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types";

export type PanelVisibility = "open" | "closed";

export type PanelRequestState =
  | { kind: "idle" }
  | {
      kind: "loading";
      snapshot: SelectionSnapshot;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "success";
      snapshot: SelectionSnapshot;
      response: string;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "error";
      snapshot: SelectionSnapshot;
      error: GenerateAiError;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "configuration_required";
      snapshot: SelectionSnapshot;
      conversationId?: number;
      turnId?: number;
    };

export interface PanelStateView {
  visibility: PanelVisibility;
  request: PanelRequestState;
}

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

function frozenSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({ ...snapshot });
}

/**
 * AI 面板的显式状态模型。
 *
 * 两个正交维度：
 * - `visibility`：面板展开 / 收起。收起只改这一个维度，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 *
 * 只维护一个当前临时对话：新召唤替换旧对话，同一对话内线性追加成功轮次，
 * 并最多保存一个待回答或失败的用户轮次。
 */
export class AiPanelState {
  private visibility: PanelVisibility = "closed";
  private request: PanelRequestState = { kind: "idle" };
  private currentConversation: TemporaryConversation | null = null;
  private nextConversationId = 1;
  private nextTurnId = 1;
  private pendingFirstConversationId: number | null = null;
  private readonly onChange: () => void;
  private readonly listeners: Array<() => void> = [];

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
  }

  /** 注册状态变化监听器（面板渲染订阅用）。 */
  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    this.onChange();
    for (const listener of this.listeners) {
      listener();
    }
  }

  get view(): PanelStateView {
    return { visibility: this.visibility, request: this.request };
  }

  get conversation(): ReadonlyTemporaryConversation | null {
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

  get isOpen(): boolean {
    return this.visibility === "open";
  }

  /** 用户点击“召唤 AI”：展开面板并以本次冻结快照进入 loading。 */
  beginRequest(snapshot: SelectionSnapshot): void {
    this.visibility = "open";
    this.currentConversation = null;
    const anchor = frozenSnapshot(snapshot);
    const conversationId = this.nextConversationId++;
    this.request = { kind: "loading", snapshot: anchor, conversationId, phase: "first" };
    this.pendingFirstConversationId = conversationId;
    this.emit();
  }

  /** 生成成功：更新回复，保持当前 visibility（收起期间完成也不自动展开）。 */
  succeed(snapshot: SelectionSnapshot, response: string): void {
    const anchor = frozenSnapshot(snapshot);
    const conversationId = this.pendingFirstConversationId ?? this.nextConversationId++;
    this.request = { kind: "success", snapshot: anchor, response, conversationId, phase: "first" };
    this.currentConversation = {
      id: conversationId,
      anchor,
      firstResponse: response,
      turns: [],
      pending: null,
    };
    this.emit();
  }

  /** 生成失败：保留原冻结快照，保持当前 visibility。 */
  fail(snapshot: SelectionSnapshot, error: GenerateAiError): void {
    const identity = this.request.kind === "loading" ? this.request : null;
    this.request = identity?.conversationId === undefined
      ? { kind: "error", snapshot: frozenSnapshot(snapshot), error }
      : {
          kind: "error",
          snapshot: frozenSnapshot(snapshot),
          error,
          conversationId: identity.conversationId,
          phase: identity.phase,
        };
    this.emit();
  }

  /** 缺少 LLM 配置：保留快照并进入配置引导状态，保持当前 visibility。 */
  requireConfiguration(snapshot: SelectionSnapshot): void {
    const identity = this.request.kind === "loading" ? this.request : null;
    this.request = identity?.conversationId === undefined
      ? { kind: "configuration_required", snapshot: frozenSnapshot(snapshot) }
      : {
          kind: "configuration_required",
          snapshot: frozenSnapshot(snapshot),
          conversationId: identity.conversationId,
        };
    this.emit();
  }

  beginFollowUp(question: string): number | null {
    if (!this.currentConversation || this.currentConversation.pending || !question.trim()) return null;
    const id = this.nextTurnId++;
    this.currentConversation.pending = { id, question };
    this.request = {
      kind: "loading",
      snapshot: this.currentConversation.anchor,
      conversationId: this.currentConversation.id,
      phase: "follow_up",
      turnId: id,
    };
    this.emit();
    return id;
  }

  succeedFollowUp(turnId: number, response: string): boolean {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return false;
    const pending = conversation.pending;
    conversation.turns.push({ id: pending.id, question: pending.question, response });
    conversation.pending = null;
    this.request = {
      kind: "success",
      snapshot: conversation.anchor,
      response,
      conversationId: conversation.id,
      phase: "follow_up",
      turnId,
    };
    this.emit();
    return true;
  }

  failFollowUp(turnId: number, error: GenerateAiError): boolean {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return false;
    conversation.pending.error = error;
    this.request = {
      kind: "error",
      snapshot: conversation.anchor,
      error,
      conversationId: conversation.id,
      phase: "follow_up",
      turnId,
    };
    this.emit();
    return true;
  }

  requireFollowUpConfiguration(turnId: number): boolean {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return false;
    conversation.pending.error = {
      code: "configuration_required",
      message: "请先配置 LLM 后再重试",
    };
    this.request = {
      kind: "configuration_required",
      snapshot: conversation.anchor,
      conversationId: conversation.id,
      turnId,
    };
    this.emit();
    return true;
  }

  retryFollowUpQuestion(): string | null {
    return this.currentConversation?.pending?.error ? this.currentConversation.pending.question : null;
  }

  followUpRequestForQuestion(question: string): GenerateAiRequest | null {
    const conversation = this.currentConversation;
    if (!conversation?.pending || !conversation.pending.error || !question.trim()) return null;
    return this.buildFollowUpRequest(conversation, question);
  }

  acceptEditedFollowUp(question: string): boolean {
    const conversation = this.currentConversation;
    const pending = conversation?.pending;
    if (!conversation || !pending?.error || !question.trim()) return false;
    pending.question = question;
    delete pending.error;
    this.request = {
      kind: "loading",
      snapshot: conversation.anchor,
      conversationId: conversation.id,
      phase: "follow_up",
      turnId: pending.id,
    };
    this.emit();
    return true;
  }

  cancelFollowUp(turnId: number): boolean {
    const conversation = this.currentConversation;
    if (!conversation || conversation.pending?.id !== turnId) return false;
    conversation.pending = null;
    this.request = {
      kind: "success",
      snapshot: conversation.anchor,
      response: conversation.turns.length > 0
        ? conversation.turns[conversation.turns.length - 1].response
        : conversation.firstResponse,
    };
    this.emit();
    return true;
  }

  retryFollowUpRequest(): GenerateAiRequest | null {
    const pending = this.currentConversation?.pending;
    if (!pending?.error) return null;
    return this.followUpRequest();
  }

  acceptFollowUpRetry(): boolean {
    const conversation = this.currentConversation;
    const pending = conversation?.pending;
    if (!conversation || !pending?.error) return false;
    delete pending.error;
    this.request = {
      kind: "loading",
      snapshot: conversation.anchor,
      conversationId: conversation.id,
      phase: "follow_up",
      turnId: pending.id,
    };
    this.emit();
    return true;
  }

  acceptFirstRetry(): boolean {
    if (this.request.kind !== "error" && this.request.kind !== "configuration_required") {
      return false;
    }
    if (this.request.conversationId === undefined) return false;
    this.request = {
      kind: "loading",
      snapshot: this.request.snapshot,
      conversationId: this.request.conversationId,
      phase: "first",
    };
    this.emit();
    return true;
  }

  followUpRequest(): GenerateAiRequest | null {
    const conversation = this.currentConversation;
    if (!conversation?.pending) return null;
    return this.buildFollowUpRequest(conversation, conversation.pending.question);
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
    return { kind: "follow_up", selected_text: conversation.anchor.selectedText, messages };
  }

  /** 收起面板：只改 visibility，不清除当前请求/回复。 */
  close(): void {
    if (this.visibility === "closed") return;
    this.visibility = "closed";
    this.emit();
  }

  /** 展开面板：只改 visibility，恢复显示当前请求/回复。 */
  open(): void {
    if (this.visibility === "open") return;
    this.visibility = "open";
    this.emit();
  }

  /**
   * 返回重新发起请求所用的快照。仅当处于 error / configuration_required 时有效，
   * 始终来自原冻结快照，不读取当前编辑器选区。需要用户明确点击“重新请求”。
   */
  retrySnapshot(): SelectionSnapshot | null {
    if (this.request.kind === "error") return this.request.snapshot;
    if (this.request.kind === "configuration_required") return this.request.snapshot;
    return null;
  }

  /** 作品卸载或替换后清空面板状态，避免旧内容污染新作品。 */
  reset(): void {
    this.visibility = "closed";
    this.request = { kind: "idle" };
    this.currentConversation = null;
    this.pendingFirstConversationId = null;
    this.emit();
  }
}
