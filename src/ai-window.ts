import type { AiWindowDom } from "./dom.ts";
import { buildAiWindowDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import {
  buildAiPanelView,
  READING_REQUEST_TITLE,
  type ConversationView,
  type MaterialSourceView,
  type MaterialView,
} from "./ai-panel-view-model.ts";
import {
  firstRoundMaterialToArchive,
  type Discussion,
} from "./ai-panel-conversation.ts";
import { deriveConversationTitle } from "./conversation-archive.ts";

/**
 * 单个讨论窗口的动作（由窗口管理器按讨论身份绑定）。
 *
 * 追问 / 重试 / 直接提问等沿用「聚焦讨论」语义：窗口在交互前会先聚焦自身，
 * 因此这些动作作用于该窗口的讨论。停止 / 关闭是显示层动作，按讨论身份绑定。
 */
export interface AiWindowActions {
  /** 首轮重试（error / configuration_required / stopped 首轮）。 */
  onRetry: () => void;
  /** 追问失败重试。 */
  onRetryFollowUp: () => Promise<boolean>;
  /** 追问「已停止」后重试。 */
  onRetryStoppedFollowUp: () => Promise<boolean>;
  onGoToConfig: () => void;
  onSubmitFollowUp: (question: string) => Promise<boolean>;
  onEditFollowUp: (question: string) => Promise<boolean>;
  onSubmitDirectQuestion: (question: string) => Promise<boolean>;
  onRemoveDirectQuestionSelection: () => void;
  onDirectQuestionFocus: () => void;
  /** 停止本窗口讨论的当前生成。 */
  onStop: () => void;
  /** 关闭本窗口（只结束显示，不删除讨论）。 */
  onClose: () => void;
  /** 新建一个干净讨论（受限讨论的继续路径）。 */
  onNewConversation: () => void;
  /** 请求打开「切换关注文档」选择器（锚点为本窗口的切换按钮）；缺省不显示入口。 */
  onOpenFocusPicker?: (anchor: HTMLElement) => void;
  /** 按文档 ID 解析当前作品中的文档标题（「本次参考了什么」用）；缺省回退为不可用。 */
  resolveDocumentTitle?: (documentId: string) => string | null;
  /** 文档当前是否不允许 AI 查看（隐藏来源脱敏判定）；缺省不做隐藏判定。 */
  isDocumentHidden?: (documentId: string) => boolean;
  /**
   * 用户对按需补读授权请求的决定（任务 7.1）：允许 → 后端写授权并继续原问题；
   * 拒绝 → AI 基于既有材料有限回答。缺省不显示操作（无接线时卡片不可交互）。
   */
  onResolveReadingRequest?: (granted: boolean) => void;
}

export interface AiWindowController {
  readonly element: HTMLElement;
  readonly dom: AiWindowDom;
  /** 移除订阅与事件监听、从 DOM 摘除窗口。 */
  destroy(): void;
  /** 重新读取状态并渲染（外部触发，如聚焦变化）。 */
  refresh(): void;
  /** 展开 / 收起「本次参考了什么」面板（供窗口菜单调用）。 */
  toggleMaterials(): void;
  /** 显示「已切换关注文档…下一轮生效」的清晰中文提示（由选择器动作显式触发）。 */
  showFocusNotice(text: string): void;
}

/** 窗口状态点与徽标的统一状态词（排队中 / 生成中 / 已停止 / 失败 / 恢复中 / 已完成）。 */
export type WindowStatus = "idle" | "generating" | "queued" | "stopped" | "failed" | "recovering" | "done";

/** 从讨论的请求与对话推导窗口状态（纯派生，供标题栏状态点与徽标使用）。 */
export function windowStatusOf(
  request: import("./ai-panel-request-state.ts").PanelRequestState,
): WindowStatus {
  switch (request.kind) {
    case "loading":
      return request.queued ? "queued" : "generating";
    case "stopped":
      return "stopped";
    case "error":
      return "failed";
    case "configuration_required":
      return "failed";
    case "recovering":
      return "recovering";
    case "direct_question":
      if (request.queued) return "queued";
      return request.status === "loading"
        ? "generating"
        : request.status === "stopped"
          ? "stopped"
          : request.status === "error" || request.status === "configuration_required"
            ? "failed"
            : "idle";
    case "success":
      return "done";
    default:
      return "idle";
  }
}

/** 讨论标题：自定义标题优先，否则取首轮问题 / 召唤选区截断，空则「新讨论」。 */
export function discussionTitle(discussion: Discussion | null): string {
  if (!discussion) return "新讨论";
  const custom = discussion.conversation?.customTitle;
  if (custom && custom.trim()) return custom;
  const material =
    discussion.conversation?.initialUserMaterial ?? discussion.pendingFirstRequest ?? null;
  if (!material) return "新讨论";
  return deriveConversationTitle(firstRoundMaterialToArchive(material), discussion.createdAt);
}

/** 把统一状态词映射为徽标文字（「已完成」「空闲」不显示徽标）。 */
export function statusBadgeLabel(status: WindowStatus): string | null {
  switch (status) {
    case "generating":
      return "生成中";
    case "queued":
      return "排队中";
    case "stopped":
      return "已停止";
    case "failed":
      return "失败";
    case "recovering":
      return "恢复中";
    default:
      return null;
  }
}

/**
 * 把窗口渲染到单个讨论窗口的 DOM。
 *
 * 所需节点全部来自 `AiWindowDom` 契约（由 `buildAiWindowDom` 按窗口根节点解析），
 * 本模块不执行全局节点查找。状态变化时由 `AiPanelState` 订阅触发重绘；`destroy`
 * 退订并摘除窗口，支持多实例创建与销毁。
 */
export function setupAiWindow(
  root: HTMLElement,
  state: AiPanelState,
  conversationId: string,
  actions: AiWindowActions,
): AiWindowController {
  const dom = buildAiWindowDom(root);
  const scrollReset = new AiPanelScrollResetController();
  let editingFailedQuestion = false;
  let disposed = false;
  /** 「本次参考了什么」面板展开状态（纯显示层，不进状态、不持久化）。 */
  let materialsOpen = false;
  /** 补读过程详情（已读文档列表）展开状态（纯显示层，不进状态、不持久化）。 */
  let readingDetailsOpen = false;
  /** 切换关注文档提示的显示时长。 */
  const FOCUS_NOTICE_MS = 6000;
  let focusNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFocusNoticeTimer(): void {
    if (focusNoticeTimer !== null) {
      clearTimeout(focusNoticeTimer);
      focusNoticeTimer = null;
    }
  }

  /** 显示切换关注文档的清晰中文提示（短暂显示后自动隐藏，不打断对话）。 */
  function showFocusNotice(text: string): void {
    clearFocusNoticeTimer();
    dom.focusNotice.textContent = text;
    dom.focusNotice.classList.remove("hidden");
    focusNoticeTimer = setTimeout(() => {
      focusNoticeTimer = null;
      dom.focusNotice.classList.add("hidden");
    }, FOCUS_NOTICE_MS);
    focusNoticeTimer.unref?.();
  }

  function toggleMaterials(): void {
    materialsOpen = !materialsOpen;
    render();
  }

  dom.materialsToggle.addEventListener("click", () => toggleMaterials());
  dom.materialsClose.addEventListener("click", () => {
    materialsOpen = false;
    render();
  });
  dom.focusSwitch.addEventListener("click", () => actions.onOpenFocusPicker?.(dom.focusSwitch));
  // 授权卡决定（任务 7.1）：允许 → 继续原问题；拒绝 → 有限回答。
  dom.readingAllow.addEventListener("click", () => actions.onResolveReadingRequest?.(true));
  dom.readingDeny.addEventListener("click", () => actions.onResolveReadingRequest?.(false));
  // 补读过程详情（任务 7.3）：展开 / 收起已读文档列表。
  dom.readingToggle.addEventListener("click", () => {
    readingDetailsOpen = !readingDetailsOpen;
    render();
  });

  // 吸底滚动：滚动事件只维护「贴底」布尔标记（阈值约 40px）。
  const BOTTOM_FOLLOW_THRESHOLD_PX = 40;
  let pinnedToBottom = true;
  dom.body.addEventListener("scroll", () => {
    const distanceToBottom = dom.body.scrollHeight - dom.body.scrollTop - dom.body.clientHeight;
    pinnedToBottom = distanceToBottom < BOTTOM_FOLLOW_THRESHOLD_PX;
  });

  dom.stopBtn.addEventListener("click", () => actions.onStop());
  dom.closeBtn.addEventListener("click", () => actions.onClose());
  dom.restrictionNewConversation.addEventListener("click", () => actions.onNewConversation());
  dom.retryBtn.addEventListener("click", () => actions.onRetry());
  dom.goConfigBtn.addEventListener("click", () => actions.onGoToConfig());
  dom.followUpRetry.addEventListener("click", () => {
    void actions.onRetryFollowUp();
  });
  dom.followUpEdit.addEventListener("click", () => {
    const pending = state.conversationOf(conversationId)?.pending;
    if (!pending?.error) return;
    editingFailedQuestion = true;
    dom.followUpInput.value = pending.question;
    dom.followUpInput.disabled = false;
    dom.followUpSend.textContent = "修改后重发";
    updateFollowUpSendState();
    dom.followUpInput.focus();
  });

  dom.followUpInput.addEventListener("input", updateFollowUpSendState);
  dom.followUpInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitFollowUp();
    }
  });
  dom.followUpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitFollowUp();
  });

  dom.directQuestionInput.addEventListener("input", () => {
    state.updateDirectQuestionDraft(conversationId, dom.directQuestionInput.value);
  });
  dom.directQuestionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitDirectQuestion();
    }
  });
  dom.directQuestionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitDirectQuestion();
  });
  dom.directQuestionSelectionRemove.addEventListener("click", () => {
    actions.onRemoveDirectQuestionSelection();
  });
  dom.directQuestionGoConfig.addEventListener("click", () => actions.onGoToConfig());
  dom.directQuestionInput.addEventListener("mousedown", () => actions.onDirectQuestionFocus());
  dom.directQuestionInput.addEventListener("focus", () => actions.onDirectQuestionFocus());

  async function submitDirectQuestion(): Promise<void> {
    const question = dom.directQuestionInput.value;
    if (dom.directQuestionSend.disabled || !question.trim()) return;
    await actions.onSubmitDirectQuestion(question);
  }

  function updateFollowUpSendState(): void {
    dom.followUpSend.disabled = dom.followUpInput.disabled || !dom.followUpInput.value.trim();
  }

  async function submitFollowUp(): Promise<void> {
    const question = dom.followUpInput.value;
    if (dom.followUpInput.disabled || !question.trim()) return;
    const accepted = await (editingFailedQuestion
      ? actions.onEditFollowUp(question)
      : actions.onSubmitFollowUp(question));
    if (!accepted) return;
    editingFailedQuestion = false;
    dom.followUpInput.value = "";
    dom.followUpSend.textContent = "发送";
    updateFollowUpSendState();
  }

  function message(text: string, role: "user" | "assistant" | "status"): HTMLElement {
    const element = document.createElement(role === "status" ? "div" : "pre");
    element.classList.add("ai-message", `ai-message-${role}`);
    element.textContent = text;
    return element;
  }

  function renderConversation(conversation: ConversationView | null): void {
    dom.conversation.replaceChildren();
    dom.conversation.classList.toggle("hidden", conversation === null);
    if (!conversation) return;
    for (const item of conversation.messages) {
      dom.conversation.append(message(item.text, item.role));
    }
  }

  function materialSourceLine(source: MaterialSourceView): HTMLElement {
    const line = document.createElement("div");
    line.classList.add("ai-material-source");
    if (source.masked) line.classList.add("is-masked");
    const parts: string[] = [`${source.kindLabel}：${source.title}`];
    if (source.versionLabel !== null) parts.push(`版本 ${source.versionLabel}`);
    if (source.stateLabel !== null) parts.push(source.stateLabel);
    if (source.matchedTerm !== null) parts.push(`匹配词「${source.matchedTerm}」`);
    line.textContent = parts.join(" · ");
    return line;
  }

  /**
   * 渲染「本次参考了什么」轻量说明：只展示实际使用过的材料与限制，
   * 隐藏来源已由视图层脱敏，`not_found` / `no_query_terms` 只作为检索结果呈现。
   */
  function renderMaterials(material: MaterialView | null): void {
    // 面板默认收起（不打断对话）：只有用户主动展开且确有说明数据时才显示。
    if (material === null) materialsOpen = false;
    dom.materialsPanel.classList.toggle("hidden", !materialsOpen || material === null);
    dom.materialsBody.replaceChildren();
    if (material === null) return;
    if (material.unavailable) {
      const note = document.createElement("div");
      note.classList.add("ai-material-note");
      note.textContent = "该讨论缺少材料出处记录，无法说明本次参考了什么。";
      dom.materialsBody.append(note);
      return;
    }
    if (material.rounds.length === 0) {
      const note = document.createElement("div");
      note.classList.add("ai-material-note");
      note.textContent = "本次没有附带作品材料。";
      dom.materialsBody.append(note);
    }
    for (const round of material.rounds) {
      const section = document.createElement("div");
      section.classList.add("ai-material-round");
      const label = document.createElement("div");
      label.classList.add("ai-material-round-label");
      label.textContent = round.roundLabel;
      section.append(label);
      for (const source of round.sources) section.append(materialSourceLine(source));
      // 发送状态：区分「已组装」与「已确认送达」，无回执时如实显示未确认。
      const sendState = document.createElement("div");
      sendState.classList.add("ai-material-retrieval");
      sendState.textContent = round.sendStateLabel;
      section.append(sendState);
      if (round.retrievalLabel !== null) {
        const retrieval = document.createElement("div");
        retrieval.classList.add("ai-material-retrieval");
        retrieval.textContent = round.retrievalLabel;
        section.append(retrieval);
      }
      dom.materialsBody.append(section);
    }
    if (material.hiddenSourceCount > 0) {
      const hidden = document.createElement("div");
      hidden.classList.add("ai-material-note");
      hidden.textContent = `其中 ${material.hiddenSourceCount} 处来源已隐藏，已脱敏显示。`;
      dom.materialsBody.append(hidden);
    }
    const scope = document.createElement("div");
    scope.classList.add("ai-material-note");
    scope.textContent = material.scopeNote;
    dom.materialsBody.append(scope);
  }

  /**
   * 渲染按需补读授权请求卡（任务 7.1）：显示模型提供的请求原因与权限边界
   * （仅本讨论、只读、不再重复询问、可随时关闭），提供允许 / 拒绝。
   * 措辞红线：不得表述为「现在才允许 AI 查看作品」。
   */
  function renderReadingRequest(
    view: import("./ai-panel-view-model.ts").ReadingRequestView | null,
  ): void {
    dom.readingRequest.classList.toggle("hidden", view === null);
    if (view === null) return;
    dom.readingRequestTitle.textContent = READING_REQUEST_TITLE;
    dom.readingRequestReason.textContent = view.reason;
    dom.readingRequestNotes.replaceChildren();
    for (const note of view.boundaryNotes) {
      const line = document.createElement("div");
      line.classList.add("ai-reading-request-note");
      line.textContent = note;
      dom.readingRequestNotes.append(line);
    }
  }

  /**
   * 渲染补读过程轻量状态（任务 7.3）：默认一行状态（正在检索 / 正在阅读），
   * 可展开查看已读文档列表；不展示模型内部推理。
   */
  function renderReadingProgress(
    view: import("./ai-panel-view-model.ts").ReadingProgressView | null,
  ): void {
    dom.readingStatus.classList.toggle("hidden", view === null);
    if (view === null) {
      readingDetailsOpen = false;
      return;
    }
    dom.readingStatusLine.textContent = view.hasDocuments
      ? `${view.statusLabel}（已读 ${view.documents.length} 篇）`
      : view.statusLabel;
    dom.readingStatusList.classList.toggle("hidden", !readingDetailsOpen || !view.hasDocuments);
    dom.readingStatusList.replaceChildren();
    if (!readingDetailsOpen) return;
    for (const doc of view.documents) {
      const line = document.createElement("div");
      line.classList.add("ai-reading-doc");
      if (doc.masked) line.classList.add("is-masked");
      line.textContent = doc.title;
      dom.readingStatusList.append(line);
    }
  }

  function render(): void {
    const conversationView = state.conversationOf(conversationId);
    const view = buildAiPanelView(
      state.viewOf(conversationId),
      conversationView,
      {
        resolveDocumentTitle: (documentId) => actions.resolveDocumentTitle?.(documentId) ?? null,
        isDocumentHidden: (documentId) => actions.isDocumentHidden?.(documentId) ?? false,
      },
    );

    // 窗口头：活动态 + 标题 / 关注文档 / 状态点 / 徽标。
    const focused = state.focusedConversationId === conversationId;
    root.classList.toggle("active", focused);
    root.classList.toggle("inactive", !focused);

    const discussion = state.getDiscussion(conversationId);
    dom.title.textContent = discussionTitle(discussion);

    // 关注文档标签：受限讨论或隐藏来源必须脱敏，不泄露隐藏文档名称。
    const focusDocumentId = discussion?.focusDocumentId ?? null;
    const focusDocumentHidden =
      focusDocumentId !== null && (actions.isDocumentHidden?.(focusDocumentId) ?? false);
    const focusTitleMasked =
      discussion?.conversation?.restricted === true || focusDocumentHidden;
    const rawDocTitle = discussion?.focusDocumentTitle ?? null;
    const docTitle =
      rawDocTitle === null ? null : focusTitleMasked ? "（已隐藏的文档）" : rawDocTitle;
    dom.doc.classList.toggle("hidden", docTitle === null);
    if (docTitle !== null) dom.doc.textContent = docTitle;

    // 「切换关注文档」入口：无关注文档或受限讨论时不可用。
    const canSwitchFocus =
      focusDocumentId !== null &&
      discussion?.conversation?.restricted !== true &&
      actions.onOpenFocusPicker !== undefined;
    dom.focusSwitch.classList.toggle("hidden", !canSwitchFocus);
    // 「本次参考了什么」入口：无任何材料说明数据时不显示。
    dom.materialsToggle.classList.toggle("hidden", view.material === null);

    // 切换关注文档的清晰提示由选择器动作显式触发（`showFocusNotice`），
    // 避免把「讨论创建时的初始绑定」误报成用户切换。

    const status = windowStatusOf(state.viewOf(conversationId).request);
    applyStatusDot(dom, status);
    const badge = statusBadgeLabel(status);
    dom.badge.classList.toggle("hidden", badge === null);
    if (badge !== null) dom.badge.textContent = badge;
    applyBadgeClass(dom, status);
    dom.stopBtn.classList.toggle("hidden", status !== "generating" && status !== "queued");

    // 新请求开始：回到贴底跟随，让新消息可见。
    if (scrollReset.shouldReset(state.viewOf(conversationId).request)) {
      pinnedToBottom = true;
    }

    dom.snapshotBlock.classList.toggle("hidden", view.snapshot === null);
    if (view.snapshot) {
      dom.snapshotText.textContent = view.snapshot.text;
    }

    dom.loading.classList.toggle("hidden", !view.loadingVisible);
    if (view.loadingMessage !== null) {
      dom.loading.textContent = view.loadingMessage;
    }

    dom.response.classList.toggle("hidden", view.response === null);
    if (view.response !== null) {
      dom.response.textContent = view.response;
    }

    dom.welcome.classList.toggle("hidden", !view.welcomeVisible);

    renderConversation(view.conversation);
    renderMaterials(view.material);
    renderReadingRequest(view.readingRequest);
    renderReadingProgress(view.readingProgress);

    dom.errorBlock.classList.toggle("hidden", view.errorBlock === null && view.saveError === null);
    if (view.errorBlock || view.saveError !== null) {
      dom.errorMessage.textContent = [view.errorBlock?.message, view.saveError].filter(Boolean).join("\n");
    }
    dom.retryBtn.classList.toggle("hidden", !view.retryAvailable);

    dom.configBlock.classList.toggle("hidden", !view.configBlock);

    // 追问反馈：失败显示「重试 + 修改」，停止只显示「重试」。
    const followUpErrorView = view.followUpError;
    const showFollowUpError = followUpErrorView !== null;
    const showFollowUpStopped = view.followUpStopped;
    dom.followUpError.classList.toggle("hidden", !showFollowUpError && !showFollowUpStopped);
    if (followUpErrorView) {
      dom.followUpErrorMessage.textContent = followUpErrorView.message;
    } else if (showFollowUpStopped) {
      dom.followUpErrorMessage.textContent = "已停止";
    }
    dom.followUpRetry.classList.toggle("hidden", !showFollowUpError && !showFollowUpStopped);
    dom.followUpRetry.disabled = false;
    dom.followUpEdit.classList.toggle("hidden", !showFollowUpError);
    dom.followUpEdit.disabled = !followUpErrorView?.editAvailable;
    // 停止后的重试走 onRetryStoppedFollowUp；失败后的重试走 onRetryFollowUp。
    dom.followUpRetry.onclick = showFollowUpStopped
      ? () => { void actions.onRetryStoppedFollowUp(); }
      : () => { void actions.onRetryFollowUp(); };

    // 受限讨论提示（材料权限已变化）：历史保留只读，引导新建干净讨论。
    const restrictionNotice = view.restrictionNotice;
    dom.restrictionNotice.classList.toggle("hidden", restrictionNotice === null);
    if (restrictionNotice !== null) {
      dom.restrictionNoticeMessage.textContent = restrictionNotice;
    }

    // 追问输入区。
    const followUpFormView = view.followUpForm;
    dom.followUpForm.classList.toggle("hidden", followUpFormView === null);
    if (followUpFormView === null) {
      editingFailedQuestion = false;
      dom.followUpInput.value = "";
      dom.followUpSend.textContent = "发送";
    }
    dom.followUpInput.disabled = followUpFormView === null || !followUpFormView.inputEnabled;
    if (followUpFormView === null && editingFailedQuestion) {
      editingFailedQuestion = false;
      dom.followUpInput.value = "";
      dom.followUpSend.textContent = "发送";
    }
    updateFollowUpSendState();

    // 直接提问入口。
    const directQuestionView = view.directQuestion;
    dom.directQuestion.classList.toggle("hidden", directQuestionView === null);
    if (directQuestionView) {
      if (dom.directQuestionInput.value !== directQuestionView.inputValue) {
        dom.directQuestionInput.value = directQuestionView.inputValue;
      }
      dom.directQuestionInput.disabled = !directQuestionView.inputEnabled;
      dom.directQuestionSelection.classList.toggle(
        "hidden",
        directQuestionView.pendingSelection === null,
      );
      if (directQuestionView.pendingSelection) {
        dom.directQuestionSelectionText.textContent = directQuestionView.pendingSelection.text;
      }
      dom.directQuestionError.classList.toggle(
        "hidden",
        directQuestionView.errorMessage === null,
      );
      if (directQuestionView.errorMessage !== null) {
        dom.directQuestionErrorMessage.textContent = directQuestionView.errorMessage;
      }
      dom.directQuestionConfig.classList.toggle(
        "hidden",
        directQuestionView.status !== "configuration_required",
      );
      dom.directQuestionSend.disabled = !directQuestionView.submitEnabled;
    } else {
      dom.directQuestionInput.value = "";
      dom.directQuestionInput.disabled = false;
      dom.directQuestionSelection.classList.add("hidden");
      dom.directQuestionError.classList.add("hidden");
      dom.directQuestionConfig.classList.add("hidden");
    }

    // 吸底跟随：仅在贴底状态下渲染后滚动到底部。
    if (pinnedToBottom) {
      dom.body.scrollTop = dom.body.scrollHeight;
    }
  }

  function applyStatusDot(dom: AiWindowDom, status: WindowStatus): void {
    dom.statusDot.className = "ai-window-status-dot";
    if (status !== "idle" && status !== "done") {
      dom.statusDot.classList.add(`is-${status}`);
    } else if (status === "done") {
      dom.statusDot.classList.add("is-done");
    }
  }

  function applyBadgeClass(dom: AiWindowDom, status: WindowStatus): void {
    dom.badge.className = "ai-window-badge";
    if (status !== "idle" && status !== "done") {
      dom.badge.classList.add(`is-${status}`);
    }
  }

  const unsubscribe = state.subscribe(() => {
    if (disposed) return;
    render();
  });
  render();

  return {
    element: root,
    dom,
    refresh: render,
    toggleMaterials,
    showFocusNotice,
    destroy(): void {
      disposed = true;
      clearFocusNoticeTimer();
      unsubscribe();
      root.remove();
    },
  };
}
