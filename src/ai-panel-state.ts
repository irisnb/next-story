import {
  conversationIdentityOf,
  followUpAvailableOf,
  followUpRequestForQuestionOf,
  followUpRequestOf,
  readonlyConversationView,
  retryFollowUpQuestionOf,
  summaryOf,
  type Discussion,
  type ReadonlyTemporaryConversation,
  type TemporaryConversation,
} from "./ai-panel-conversation.ts";
import {
  activeRequestOf,
  initialAiPanelCoreState,
  reduceAiPanelState,
  type AiPanelCoreState,
  type AiPanelEvent,
  type WindowPlacement,
} from "./ai-panel-reducer.ts";
import type { PanelStateView } from "./ai-panel-request-state.ts";
import { idleRequest } from "./ai-panel-request-state.ts";
import type { ConversationSummary } from "./conversation-archive.ts";
import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";
import type { FirstRoundMaterial } from "./ai-panel-conversation.ts";

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
 * AI 面板的显式状态机外观（公开 API 保持稳定）。
 *
 * 状态迁移全部收敛到纯函数 `reduceAiPanelState`：公开方法只负责构造事件并 dispatch，
 * 由 reducer 决定迁移是否合法（非法迁移原样返回，不触发通知）。因此非法操作的结构性
 * 约束在 reducer 里是可见的分支，而不是散落在各方法里的隐式布尔判断。
 *
 * 讨论集合模型：面板一次显示一个当前讨论（聚焦窗口的讨论），其余讨论保留为档案；
 * 新召唤 / 直接提问首轮 / 新建对话开启新讨论并保留旧讨论。结果按 `conversationId` 路由，
 * 迟到结果若所属讨论已删除或已切换作品则被丢弃。窗口结构状态（打开窗口 + 聚焦窗口）
 * 作为唯一事实源的一部分随迁移更新；窗口几何留在窗口层，不进状态、不持久化。
 */
export class AiPanelState {
  private state: AiPanelCoreState = initialAiPanelCoreState();
  private readonly onChange: () => void;
  private readonly listeners: Array<() => void> = [];
  private readonly newConversationId: () => string;
  private readonly now: () => string;
  private idCounter = 0;

  constructor(
    onChange: () => void = () => {},
    newConversationId?: () => string,
    now?: () => string,
  ) {
    this.onChange = onChange;
    this.newConversationId = newConversationId ?? (() => {
      this.idCounter += 1;
      return String(this.idCounter);
    });
    this.now = now ?? (() => new Date().toISOString());
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
      request: activeRequestOf(this.state),
      directQuestionDraft: this.draftOf(this.state.focusedConversationId),
      pendingSelection: this.state.pendingSelection,
      saveError: this.state.saveError,
    };
  }

  /**
   * 指定讨论窗口的只读显示输入：以该讨论的请求状态为输入，而非全局聚焦讨论。
   * 供每个窗口各自派生显示决策（纯派生、单一事实源）；草稿按讨论归属，
   * 待附带选区只附着聚焦窗口。
   */
  viewOf(conversationId: string): PanelStateView {
    const discussion = this.state.discussions.get(conversationId);
    return {
      visibility: "open",
      request: discussion?.request ?? idleRequest(),
      directQuestionDraft: this.draftOf(conversationId),
      pendingSelection: this.state.focusedConversationId === conversationId
        ? this.state.pendingSelection
        : null,
      saveError: this.state.saveError,
    };
  }

  private draftOf(conversationId: string | null): string {
    if (conversationId === null) return "";
    return this.state.directQuestionDrafts.get(conversationId) ?? "";
  }

  /** 指定讨论的只读对话视图（供窗口渲染）。 */
  conversationOf(conversationId: string): ReadonlyTemporaryConversation | null {
    const discussion = this.state.discussions.get(conversationId);
    return readonlyConversationView(discussion?.conversation ?? null);
  }

  get conversation(): ReadonlyTemporaryConversation | null {
    const active = this.state.focusedConversationId;
    const discussion = active === null ? null : this.state.discussions.get(active) ?? null;
    return readonlyConversationView(discussion?.conversation ?? null);
  }

  get followUpAvailable(): boolean {
    const discussion = this.activeDiscussion();
    return followUpAvailableOf(discussion?.conversation ?? null);
  }

  get conversationIdentity(): { conversationId: string; turnId?: number } | null {
    const discussion = this.activeDiscussion();
    return conversationIdentityOf(discussion?.conversation ?? null);
  }

  /** 当前显示的讨论身份（首轮在途也携带，供单请求协调器按讨论隔离）。 */
  get requestIdentity(): { conversationId: string; turnId?: number } | null {
    if (this.state.focusedConversationId === null) return null;
    const discussion = this.activeDiscussion();
    const turnId = discussion?.conversation?.pending?.id;
    return turnId === undefined
      ? { conversationId: this.state.focusedConversationId }
      : { conversationId: this.state.focusedConversationId, turnId };
  }

  /** 当前显示的讨论（即聚焦窗口的讨论）；无窗口时为 null。 */
  get activeConversationId(): string | null {
    return this.state.focusedConversationId;
  }

  /** 当前聚焦窗口的讨论身份；无窗口时为 null。 */
  get focusedConversationId(): string | null {
    return this.state.focusedConversationId;
  }

  /** 当前打开的窗口集合（键为讨论 id，一讨论至多一个窗口）。 */
  get windows(): ReadonlyMap<string, WindowPlacement> {
    return this.state.windows;
  }

  /** 当前作品的讨论集合（轻量视图：身份、标题、时间、终态 + 重开所需完整轮次）。 */
  get conversations(): ConversationSummary[] {
    const summaries: ConversationSummary[] = [];
    for (const discussion of this.state.discussions.values()) {
      if (discussion.conversation === null) continue;
      summaries.push(summaryOf(discussion.conversation, discussion.focusDocumentId, discussion.focusDocumentTitle));
    }
    return summaries;
  }

  get saveError(): string | null {
    return this.state.saveError;
  }

  /** 返回指定讨论的完整运行期数据（供编排层构建档案保存记录）。 */
  getDiscussion(conversationId: string): Discussion | null {
    return this.state.discussions.get(conversationId) ?? null;
  }

  /**
   * 单调递增的对话身份代次。
   *
   * 只增不减：`newConversation` 与每次首轮请求分配都会推进它，`reset` 也推进它。
   * 供在途预检在每次 `await` 之后校验自身是否已被作废（ABA 安全：代次不会回退）。
   */
  get conversationGeneration(): number {
    return this.state.generation;
  }

  get isOpen(): boolean {
    return this.state.visibility === "open";
  }

  private activeDiscussion() {
    if (this.state.focusedConversationId === null) return null;
    return this.state.discussions.get(this.state.focusedConversationId) ?? null;
  }

  private resolveConversationId(conversationId?: string): string | null {
    return conversationId ?? this.state.focusedConversationId;
  }

  /** 用户点击“召唤 AI”：展开面板并以本次冻结快照进入预览（旧式预检预览）。 */
  previewFirstRequest(
    snapshot: SelectionSnapshot,
    firstRequest?: FirstRoundMaterial,
  ): void {
    this.dispatch({ type: "preview_first_request", snapshot, firstRequest });
  }

  blockFirstRequest(snapshot: SelectionSnapshot): void {
    this.dispatch({ type: "block_first_request", snapshot });
  }

  /** 用户点击“召唤 AI”且请求被接受：展开面板并以本次冻结快照进入 loading。 */
  beginRequest(
    snapshot: SelectionSnapshot,
    firstRequest?: FirstRoundMaterial,
    focusDocumentId: string | null = snapshot.documentId,
    focusDocumentTitle: string | null = null,
  ): void {
    this.dispatch({
      type: "begin_request",
      snapshot,
      firstRequest,
      conversationId: this.newConversationId(),
      createdAt: this.now(),
      focusDocumentId,
      focusDocumentTitle,
    });
  }

  /** 生成成功：按讨论身份路由结果；生成期间收起也不自动展开。 */
  succeed(snapshot: SelectionSnapshot, response: string, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "succeed", snapshot, response, conversationId: id });
  }

  /** 生成失败：按讨论身份路由，保留原冻结快照，保持当前 visibility。 */
  fail(snapshot: SelectionSnapshot, error: GenerateAiError, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId) ?? "";
    return this.dispatch({ type: "fail", snapshot, error, conversationId: id });
  }

  /** 缺少 LLM 配置：按讨论身份路由。 */
  requireConfiguration(snapshot: SelectionSnapshot, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId) ?? "";
    return this.dispatch({ type: "require_configuration", snapshot, conversationId: id });
  }

  beginFollowUp(question: string): number | null {
    const next = reduceAiPanelState(this.state, { type: "begin_follow_up", question });
    if (next === this.state) return null;
    this.state = next;
    this.emit();
    const discussion = this.state.focusedConversationId === null
      ? null
      : this.state.discussions.get(this.state.focusedConversationId) ?? null;
    return discussion?.conversation?.pending?.id ?? null;
  }

  succeedFollowUp(turnId: number, response: string, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "succeed_follow_up", turnId, response, conversationId: id });
  }

  failFollowUp(turnId: number, error: GenerateAiError, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "fail_follow_up", turnId, error, conversationId: id });
  }

  requireFollowUpConfiguration(turnId: number, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "require_follow_up_configuration", turnId, conversationId: id });
  }

  retryFollowUpQuestion(): string | null {
    const discussion = this.activeDiscussion();
    return retryFollowUpQuestionOf(discussion?.conversation ?? null);
  }

  followUpRequestForQuestion(question: string): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
    const discussion = this.activeDiscussion();
    return followUpRequestForQuestionOf(discussion?.conversation ?? null, question);
  }

  acceptEditedFollowUp(question: string): boolean {
    return this.dispatch({ type: "accept_edited_follow_up", question });
  }

  cancelFollowUp(turnId: number): boolean {
    return this.dispatch({ type: "cancel_follow_up", turnId });
  }

  retryFollowUpRequest(): GenerateAiRequest | null {
    const discussion = this.activeDiscussion();
    const pending = discussion?.conversation?.pending;
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
    const discussion = this.activeDiscussion();
    return followUpRequestOf(discussion?.conversation ?? null);
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
   * 用户主动“新建对话”：开启一个新讨论并保留旧讨论为档案，面板保持展开。
   *
   * 仅当存在可归档的内容（任一讨论有对话或进行中请求）时有效；纯空状态原样返回 false。
   */
  newConversation(
    focusDocumentId: string | null = null,
    focusDocumentTitle: string | null = null,
  ): boolean {
    return this.dispatch({
      type: "new_conversation",
      conversationId: this.newConversationId(),
      createdAt: this.now(),
      focusDocumentId,
      focusDocumentTitle,
    });
  }

  /** 返回重新发起请求所用的快照（error / configuration_required / stopped 首轮时有效）。 */
  retrySnapshot(): SelectionSnapshot | null {
    const request = activeRequestOf(this.state);
    if (request.kind === "error") return request.snapshot;
    if (request.kind === "configuration_required") return request.snapshot;
    if (request.kind === "stopped" && request.phase === "first") return request.snapshot;
    return null;
  }

  retryFirstRequest(): FirstRoundMaterial | null {
    const request = activeRequestOf(this.state);
    if (
      request.kind !== "error" &&
      request.kind !== "configuration_required" &&
      !(request.kind === "stopped" && request.phase === "first")
    ) {
      return null;
    }
    const discussion = this.activeDiscussion();
    return discussion?.pendingFirstRequest ?? null;
  }

  /** 作品卸载或替换后清空面板状态，避免旧内容污染新作品。 */
  reset(): void {
    this.dispatch({ type: "reset" });
  }

  /** 切换作品后加载新作品的讨论列表（归档档案重建为可重开讨论）。 */
  loadDiscussions(summaries: readonly ConversationSummary[], skipped: readonly string[]): void {
    this.dispatch({ type: "load_discussions", summaries, skipped });
  }

  /** 从列表重开一个讨论：以已保存轮次重建显示数据。 */
  openDiscussion(
    conversation: TemporaryConversation,
    focusDocumentId: string | null,
    focusDocumentTitle: string | null,
  ): boolean {
    return this.dispatch({ type: "open_discussion", conversation, focusDocumentId, focusDocumentTitle });
  }

  /** 删除讨论是独立的明确动作：移除其内存记录与档案。 */
  deleteDiscussion(conversationId: string): boolean {
    return this.dispatch({ type: "delete_discussion", conversationId });
  }

  setSaveError(message: string): void {
    this.dispatch({ type: "set_save_error", message });
  }

  clearSaveError(): void {
    this.dispatch({ type: "clear_save_error" });
  }

  /** 更新指定讨论的直接提问未发送草稿（逐窗口归属）。 */
  updateDirectQuestionDraft(conversationId: string, question: string): void {
    this.dispatch({ type: "update_direct_question_draft", conversationId, question });
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
  beginDirectQuestion(
    question: string,
    selection: SelectionSnapshot | null,
    focusDocumentId: string | null = selection?.documentId ?? null,
    focusDocumentTitle: string | null = null,
  ): boolean {
    return this.dispatch({
      type: "begin_direct_question",
      question,
      selection,
      conversationId: this.newConversationId(),
      createdAt: this.now(),
      focusDocumentId,
      focusDocumentTitle,
    });
  }

  succeedDirectQuestion(response: string, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "succeed_direct_question", response, conversationId: id });
  }

  failDirectQuestion(error: GenerateAiError, conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "fail_direct_question", error, conversationId: id });
  }

  requireDirectQuestionConfiguration(conversationId?: string): boolean {
    const id = this.resolveConversationId(conversationId);
    if (id === null) return false;
    return this.dispatch({ type: "require_direct_question_configuration", conversationId: id });
  }

  /** 推进一条流式增量文本到指定讨论（仅生成中的请求接受；其余状态原样返回 false）。 */
  appendStreamText(conversationId: string, text: string): boolean {
    return this.dispatch({ type: "append_stream_text", conversationId, text });
  }

  /** 停止指定讨论的当前生成：进入「已停止」终态，保留已流式内容，不产生成功轮次。 */
  stopRequest(conversationId: string): boolean {
    return this.dispatch({ type: "stop_request", conversationId });
  }

  /** 聚焦指定讨论的窗口（仅已打开窗口有效；非法迁移原样返回 false）。 */
  focusWindow(conversationId: string): boolean {
    return this.dispatch({ type: "focus_window", conversationId });
  }

  /** 关闭指定讨论的窗口（只结束显示，不删除讨论与档案）。 */
  closeWindow(conversationId: string): boolean {
    return this.dispatch({ type: "close_window", conversationId });
  }

  /** 设置指定窗口的停靠/浮动归属（拖动 / 双击标题栏切换）。 */
  setWindowPlacement(conversationId: string, placement: WindowPlacement): boolean {
    return this.dispatch({ type: "set_window_placement", conversationId, placement });
  }

  /** 恢复默认布局：所有窗口回到停靠（几何由窗口层重置，不进状态）。 */
  resetLayout(): boolean {
    return this.dispatch({ type: "reset_layout" });
  }

  /** 重命名讨论（自定义标题持久化到档案）。 */
  renameDiscussion(conversationId: string, title: string): boolean {
    return this.dispatch({ type: "rename_discussion", conversationId, title });
  }

  /** 置顶 / 取消置顶讨论（持久化到档案）。 */
  setDiscussionPinned(conversationId: string, pinned: boolean): boolean {
    return this.dispatch({ type: "set_discussion_pinned", conversationId, pinned });
  }

  /** 直接提问首轮「已停止」后重试：以原问题与选区重新进入生成。 */
  retryDirectQuestion(conversationId: string): boolean {
    return this.dispatch({ type: "retry_direct_question", conversationId });
  }

  /** 追问「已停止」后重试：以同一问题重新进入生成（聚焦讨论）。 */
  retryStoppedFollowUp(): boolean {
    return this.dispatch({ type: "retry_stopped_follow_up" });
  }

  /** 驱动进程丢失后进入对话恢复态（仅当存在对话时接受）。 */
  beginRecovery(conversationId: string): boolean {
    return this.dispatch({ type: "begin_recovery", conversationId });
  }

  /** 对话重放完成：回到对话成功显示。 */
  completeRecovery(conversationId: string): boolean {
    return this.dispatch({ type: "complete_recovery", conversationId });
  }

  /** 对话重放失败：进入错误态并引导新建对话。 */
  failRecovery(conversationId: string): boolean {
    return this.dispatch({ type: "fail_recovery", conversationId });
  }

  /** 把指定讨论的请求标记为排队中（达到全局并发上限时）。 */
  queueRequest(conversationId: string): boolean {
    return this.dispatch({ type: "queue_request", conversationId });
  }

  /** 把指定讨论的排队请求恢复为生成中（名额释放后按序开始）。 */
  startQueuedRequest(conversationId: string): boolean {
    return this.dispatch({ type: "start_queued_request", conversationId });
  }

  /** 指定讨论是否处于首轮进行中（首轮 / 直接提问 loading；供预检过期隔离）。 */
  isFirstRoundLoading(conversationId: string): boolean {
    const discussion = this.state.discussions.get(conversationId);
    if (!discussion) return false;
    const request = discussion.request;
    if (request.kind === "direct_question") return request.status === "loading";
    if (request.kind === "loading") return request.phase === "first";
    return false;
  }
}
