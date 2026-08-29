import {
  conversationIdentityOf,
  followUpAvailableOf,
  followUpRequestForQuestionOf,
  followUpRequestOf,
  readonlyConversationView,
  retryFollowUpQuestionOf,
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
import {
  initialAiPanelCoreState,
  reduceAiPanelState,
  type AiPanelCoreState,
  type AiPanelEvent,
} from "./ai-panel-reducer.ts";
import type { PanelStateView } from "./ai-panel-request-state.ts";
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
 * AI 面板的显式状态机外观（公开 API 与旧命令式实现完全一致）。
 *
 * 状态迁移全部收敛到纯函数 `reduceAiPanelState`：公开方法只负责构造事件并 dispatch，
 * 由 reducer 决定迁移是否合法（非法迁移原样返回，不触发通知）。因此非法操作的结构性
 * 约束（visibility 与 request 正交、对话身份生命周期、过期结果拒绝等）在 reducer 里
 * 是可见的分支，而不是散落在各方法里的隐式布尔判断。
 *
 * 两个正交维度：
 * - `visibility`：面板展开 / 收起。收起只改这一个维度，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 */
export class AiPanelState {
  private state: AiPanelCoreState = initialAiPanelCoreState();
  private readonly onChange: () => void;
  private readonly listeners: Array<() => void> = [];

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
  }

  /** 注册状态变化监听器（面板渲染订阅用），返回退订函数供销毁时释放。 */
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private emit(): void {
    this.onChange();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** 纯 reducer + 通知：只有状态真的改变（reducer 返回新引用）才 emit。 */
  private dispatch(event: AiPanelEvent): boolean {
    const next = reduceAiPanelState(this.state, event);
    if (next === this.state) return false;
    this.state = next;
    this.emit();
    return true;
  }

  get view(): PanelStateView {
    return {
      visibility: this.state.visibility,
      request: this.state.request,
      directQuestionDraft: this.state.directQuestionDraft,
      pendingSelection: this.state.pendingSelection,
    };
  }

  get conversation(): ReadonlyTemporaryConversation | null {
    return readonlyConversationView(this.state.conversationContext.conversation);
  }

  get followUpAvailable(): boolean {
    return followUpAvailableOf(this.state.conversationContext.conversation);
  }

  get conversationIdentity(): { conversationId: number; turnId?: number } | null {
    return conversationIdentityOf(this.state.conversationContext.conversation);
  }

  /**
   * 单调递增的对话身份代次（对话 ID 计数器）。
   *
   * 只增不减：`newConversation` 与每次首轮请求分配都会推进它，`reset` 保留它。
   * 供在途预检在每次 `await` 之后校验自身是否已被作废（ABA 安全：代次不会回退）。
   */
  get conversationGeneration(): number {
    return this.state.conversationContext.nextConversationId;
  }

  get isOpen(): boolean {
    return this.state.visibility === "open";
  }

  /** 用户点击“召唤 AI”：展开面板并以本次冻结快照进入预览。 */
  previewFirstRequest(
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ): void {
    this.dispatch({ type: "preview_first_request", snapshot, firstRequest });
  }

  blockFirstRequest(snapshot: SelectionSnapshot): void {
    this.dispatch({ type: "block_first_request", snapshot });
  }

  /** 用户点击“召唤 AI”且请求被接受：展开面板并以本次冻结快照进入 loading。 */
  beginRequest(
    snapshot: SelectionSnapshot,
    firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>,
  ): void {
    this.dispatch({ type: "begin_request", snapshot, firstRequest });
  }

  beginThinkingExpansion(snapshot: SelectionSnapshot): void {
    this.dispatch({ type: "begin_thinking_expansion", snapshot });
  }

  updateThinkingExpansionDirection(direction: string): void {
    this.dispatch({ type: "update_thinking_expansion_direction", direction });
  }

  /** 生成成功：更新回复，保持当前 visibility（收起期间完成也不自动展开）。 */
  succeed(snapshot: SelectionSnapshot, response: string): void {
    this.dispatch({ type: "succeed", snapshot, response });
  }

  /** 生成失败：保留原冻结快照，保持当前 visibility。 */
  fail(snapshot: SelectionSnapshot, error: GenerateAiError): void {
    this.dispatch({ type: "fail", snapshot, error });
  }

  /** 缺少 LLM 配置：保留快照并进入配置引导状态，保持当前 visibility。 */
  requireConfiguration(snapshot: SelectionSnapshot): void {
    this.dispatch({ type: "require_configuration", snapshot });
  }

  beginFollowUp(question: string): number | null {
    const next = reduceAiPanelState(this.state, { type: "begin_follow_up", question });
    if (next === this.state) return null;
    this.state = next;
    this.emit();
    return next.conversationContext.conversation?.pending?.id ?? null;
  }

  succeedFollowUp(turnId: number, response: string): boolean {
    return this.dispatch({ type: "succeed_follow_up", turnId, response });
  }

  failFollowUp(turnId: number, error: GenerateAiError): boolean {
    return this.dispatch({ type: "fail_follow_up", turnId, error });
  }

  requireFollowUpConfiguration(turnId: number): boolean {
    return this.dispatch({ type: "require_follow_up_configuration", turnId });
  }

  retryFollowUpQuestion(): string | null {
    return retryFollowUpQuestionOf(this.state.conversationContext.conversation);
  }

  followUpRequestForQuestion(question: string): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
    return followUpRequestForQuestionOf(this.state.conversationContext.conversation, question);
  }

  acceptEditedFollowUp(question: string): boolean {
    return this.dispatch({ type: "accept_edited_follow_up", question });
  }

  cancelFollowUp(turnId: number): boolean {
    return this.dispatch({ type: "cancel_follow_up", turnId });
  }

  retryFollowUpRequest(): GenerateAiRequest | null {
    const pending = this.state.conversationContext.conversation?.pending;
    if (!pending?.error) return null;
    return this.followUpRequest();
  }

  acceptFollowUpRetry(): boolean {
    return this.dispatch({ type: "accept_follow_up_retry" });
  }

  acceptFirstRetry(): boolean {
    return this.dispatch({ type: "accept_first_retry" });
  }

  followUpRequest(): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
    return followUpRequestOf(this.state.conversationContext.conversation);
  }

  /** 收起面板：只改 visibility，不清除当前请求/回复。 */
  close(): void {
    this.dispatch({ type: "close" });
  }

  /** 展开面板：只改 visibility，恢复显示当前请求/回复。 */
  open(): void {
    this.dispatch({ type: "open" });
  }

  /**
   * 用户主动“新建对话”：结束当前唯一的临时对话并回到空白直接提问状态。
   *
   * 清除请求显示、临时对话、追问与直接提问草稿、待附带选区；面板保持展开。
   * 仅当存在可结束的内容（临时对话或进行中的首轮/追问请求）时有效；
   * 纯空 idle 状态原样返回 false，不触发通知。与项目生命周期 `reset`（关闭面板）
   * 语义分离，保留单调递增的对话身份计数器。
   */
  newConversation(): boolean {
    return this.dispatch({ type: "new_conversation" });
  }

  /**
   * 返回重新发起请求所用的快照。仅当处于 error / configuration_required 时有效，
   * 始终来自原冻结快照，不读取当前编辑器选区。需要用户明确点击“重新请求”。
   */
  retrySnapshot(): SelectionSnapshot | null {
    if (this.state.request.kind === "error") return this.state.request.snapshot;
    if (this.state.request.kind === "configuration_required") return this.state.request.snapshot;
    return null;
  }

  retryFirstRequest(): Extract<GenerateAiRequest, { kind: "first" }> | null {
    if (this.state.request.kind !== "error" && this.state.request.kind !== "configuration_required") {
      return null;
    }
    return this.state.pendingFirstRequest;
  }

  /** 作品卸载或替换后清空面板状态，避免旧内容污染新作品。 */
  reset(): void {
    this.dispatch({ type: "reset" });
  }

  /** 更新直接提问的未发送草稿。 */
  updateDirectQuestionDraft(question: string): void {
    this.dispatch({ type: "update_direct_question_draft", question });
  }

  /** 替换或清除当前待附带的选区重点材料。 */
  setPendingSelection(snapshot: SelectionSnapshot | null): void {
    this.dispatch({ type: "set_pending_selection", snapshot });
  }

  /** 用户主动移除待附带选区：记录其身份，使同一选区在 focus sync 时保持忽略。 */
  removePendingSelection(): void {
    this.dispatch({ type: "remove_pending_selection" });
  }

  /** 提交直接提问：冻结问题与选区并进入 loading。空问题被拒绝。 */
  beginDirectQuestion(question: string, selection: SelectionSnapshot | null): boolean {
    return this.dispatch({ type: "begin_direct_question", question, selection });
  }

  succeedDirectQuestion(response: string): boolean {
    return this.dispatch({ type: "succeed_direct_question", response });
  }

  failDirectQuestion(error: GenerateAiError): boolean {
    return this.dispatch({ type: "fail_direct_question", error });
  }

  requireDirectQuestionConfiguration(): boolean {
    return this.dispatch({ type: "require_direct_question_configuration" });
  }

  /** 推进一条流式增量文本（仅生成中的请求接受；其余状态原样返回 false）。 */
  appendStreamText(text: string): boolean {
    return this.dispatch({ type: "append_stream_text", text });
  }

  /** 驱动进程丢失后进入对话恢复态（仅当存在对话时接受）。 */
  beginRecovery(): boolean {
    return this.dispatch({ type: "begin_recovery" });
  }

  /** 对话重放完成：回到对话成功显示。 */
  completeRecovery(): boolean {
    return this.dispatch({ type: "complete_recovery" });
  }

  /** 对话重放失败：进入错误态并引导新建对话。 */
  failRecovery(): boolean {
    return this.dispatch({ type: "fail_recovery" });
  }
}
