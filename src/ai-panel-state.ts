import {
  TemporaryConversationState,
  frozenSnapshot,
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
import {
  cancelFollowUpSuccessRequest,
  configurationRequiredRequest,
  firstErrorRequest,
  firstLoadingRequest,
  firstRetryLoadingRequest,
  firstSuccessRequest,
  followUpErrorRequest,
  followUpLoadingRequest,
  followUpSuccessRequest,
  idleRequest,
  type PanelRequestState,
  type PanelStateView,
  type PanelVisibility,
} from "./ai-panel-request-state.ts";
import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";

export type {
  PanelRequestState,
  PanelStateView,
  PanelVisibility,
} from "./ai-panel-request-state.ts";
export type {
  PendingFollowUpTurn,
  ReadonlyTemporaryConversation,
  SuccessfulFollowUpTurn,
  TemporaryConversation,
} from "./ai-panel-conversation.ts";

/**
 * AI 面板的显式状态模型。
 *
 * 两个正交维度：
 * - `visibility`：面板展开 / 收起。收起只改这一个维度，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 *
 * 只维护一个当前临时对话：新召唤替换旧对话，同一对话内线性追加成功轮次，
 * 并最多保存一个待回答或失败的用户轮次。
 *
 * 内部把临时对话与请求状态构造拆到独立模块；本类仍是对外 facade。
 */
export class AiPanelState {
  private visibility: PanelVisibility = "closed";
  private request: PanelRequestState = idleRequest();
  private readonly conversationState = new TemporaryConversationState();
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
    return this.conversationState.readonlyView();
  }

  get followUpAvailable(): boolean {
    return this.conversationState.followUpAvailable;
  }

  get conversationIdentity(): { conversationId: number; turnId?: number } | null {
    return this.conversationState.conversationIdentity;
  }

  get isOpen(): boolean {
    return this.visibility === "open";
  }

  /** 用户点击“召唤 AI”：展开面板并以本次冻结快照进入 loading。 */
  beginRequest(snapshot: SelectionSnapshot): void {
    this.visibility = "open";
    this.conversationState.clear();
    const anchor = frozenSnapshot(snapshot);
    const conversationId = this.conversationState.allocateConversationId();
    this.request = firstLoadingRequest(anchor, conversationId);
    this.pendingFirstConversationId = conversationId;
    this.emit();
  }

  /** 生成成功：更新回复，保持当前 visibility（收起期间完成也不自动展开）。 */
  succeed(snapshot: SelectionSnapshot, response: string): void {
    const conversationId =
      this.pendingFirstConversationId ?? this.conversationState.allocateConversationId();
    const conversation = this.conversationState.createFromFirstSuccess(
      conversationId,
      snapshot,
      response,
    );
    this.request = firstSuccessRequest(conversation.anchor, response, conversationId);
    this.emit();
  }

  /** 生成失败：保留原冻结快照，保持当前 visibility。 */
  fail(snapshot: SelectionSnapshot, error: GenerateAiError): void {
    const identity = this.request.kind === "loading" ? this.request : null;
    this.request = firstErrorRequest(frozenSnapshot(snapshot), error, identity);
    this.emit();
  }

  /** 缺少 LLM 配置：保留快照并进入配置引导状态，保持当前 visibility。 */
  requireConfiguration(snapshot: SelectionSnapshot): void {
    const identity = this.request.kind === "loading" ? this.request : null;
    this.request = configurationRequiredRequest(
      frozenSnapshot(snapshot),
      identity?.conversationId,
    );
    this.emit();
  }

  beginFollowUp(question: string): number | null {
    const conversation = this.conversationState.current;
    const id = this.conversationState.beginFollowUp(question);
    if (id === null || !conversation) return null;
    this.request = followUpLoadingRequest(conversation.anchor, conversation.id, id);
    this.emit();
    return id;
  }

  succeedFollowUp(turnId: number, response: string): boolean {
    const conversation = this.conversationState.current;
    if (!conversation) return false;
    const turn = this.conversationState.succeedFollowUp(turnId, response);
    if (!turn) return false;
    this.request = followUpSuccessRequest(
      conversation.anchor,
      response,
      conversation.id,
      turnId,
    );
    this.emit();
    return true;
  }

  failFollowUp(turnId: number, error: GenerateAiError): boolean {
    const conversation = this.conversationState.current;
    if (!conversation) return false;
    if (!this.conversationState.failFollowUp(turnId, error)) return false;
    this.request = followUpErrorRequest(
      conversation.anchor,
      error,
      conversation.id,
      turnId,
    );
    this.emit();
    return true;
  }

  requireFollowUpConfiguration(turnId: number): boolean {
    const conversation = this.conversationState.current;
    if (!conversation) return false;
    if (!this.conversationState.requireFollowUpConfiguration(turnId)) return false;
    this.request = configurationRequiredRequest(conversation.anchor, conversation.id, turnId);
    this.emit();
    return true;
  }

  retryFollowUpQuestion(): string | null {
    return this.conversationState.retryFollowUpQuestion();
  }

  followUpRequestForQuestion(question: string): GenerateAiRequest | null {
    return this.conversationState.followUpRequestForQuestion(question);
  }

  acceptEditedFollowUp(question: string): boolean {
    const conversation = this.conversationState.current;
    const turnId = this.conversationState.acceptEditedFollowUp(question);
    if (turnId === null || !conversation) return false;
    this.request = followUpLoadingRequest(conversation.anchor, conversation.id, turnId);
    this.emit();
    return true;
  }

  cancelFollowUp(turnId: number): boolean {
    const conversation = this.conversationState.current;
    const response = this.conversationState.cancelFollowUp(turnId);
    if (response === null || !conversation) return false;
    this.request = cancelFollowUpSuccessRequest(conversation.anchor, response);
    this.emit();
    return true;
  }

  retryFollowUpRequest(): GenerateAiRequest | null {
    const pending = this.conversationState.current?.pending;
    if (!pending?.error) return null;
    return this.followUpRequest();
  }

  acceptFollowUpRetry(): boolean {
    const conversation = this.conversationState.current;
    const turnId = this.conversationState.acceptFollowUpRetry();
    if (turnId === null || !conversation) return false;
    this.request = followUpLoadingRequest(conversation.anchor, conversation.id, turnId);
    this.emit();
    return true;
  }

  acceptFirstRetry(): boolean {
    if (this.request.kind !== "error" && this.request.kind !== "configuration_required") {
      return false;
    }
    if (this.request.conversationId === undefined) return false;
    this.request = firstRetryLoadingRequest(this.request.snapshot, this.request.conversationId);
    this.emit();
    return true;
  }

  followUpRequest(): GenerateAiRequest | null {
    return this.conversationState.followUpRequest();
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
    this.request = idleRequest();
    this.conversationState.clear();
    this.pendingFirstConversationId = null;
    this.emit();
  }
}
