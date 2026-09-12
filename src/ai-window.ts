import type { AiWindowDom } from "./dom.ts";
import { buildAiWindowDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { buildAiPanelView, type ConversationView } from "./ai-panel-view-model.ts";
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
}

export interface AiWindowController {
  readonly element: HTMLElement;
  readonly dom: AiWindowDom;
  /** 移除订阅与事件监听、从 DOM 摘除窗口。 */
  destroy(): void;
  /** 重新读取状态并渲染（外部触发，如聚焦变化）。 */
  refresh(): void;
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

  function render(): void {
    const view = buildAiPanelView(
      state.viewOf(conversationId),
      state.conversationOf(conversationId),
    );

    // 窗口头：活动态 + 标题 / 关注文档 / 状态点 / 徽标。
    const focused = state.focusedConversationId === conversationId;
    root.classList.toggle("active", focused);
    root.classList.toggle("inactive", !focused);

    const discussion = state.getDiscussion(conversationId);
    dom.title.textContent = discussionTitle(discussion);
    const docTitle = discussion?.focusDocumentTitle ?? null;
    dom.doc.classList.toggle("hidden", docTitle === null);
    if (docTitle !== null) dom.doc.textContent = docTitle;

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

    dom.errorBlock.classList.toggle("hidden", view.errorBlock === null);
    if (view.errorBlock) {
      dom.errorMessage.textContent = view.errorBlock.message;
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
    destroy(): void {
      disposed = true;
      unsubscribe();
      root.remove();
    },
  };
}
