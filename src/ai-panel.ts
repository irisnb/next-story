import type { AppDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";

export interface AiPanelActions {
  onRetry: () => void;
  onGoToConfig: () => void;
  onSubmitFollowUp: (question: string) => boolean;
  onRetryFollowUp: () => boolean;
  onEditFollowUp: (question: string) => boolean;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required AI panel element: #${id}`);
  }
  return el as T;
}

/**
 * 把面板状态渲染到右侧 AI 面板的 DOM。
 *
 * 所有回复、错误与选区文字都通过 `textContent` / `<pre>` 纯文本绑定，绝不解析 HTML 或
 * Markdown；面板不持有任何写入草稿本或正文本的回调。状态变化时由 `AiPanelState` 订阅触发重绘。
 */
export function setupAiPanel(
  dom: AppDom,
  state: AiPanelState,
  actions: AiPanelActions,
): void {
  const panel = dom.aiPanel;
  const panelBodyElement = panel.querySelector<HTMLElement>(".ai-panel-body");
  if (!panelBodyElement) {
    throw new Error("Missing required AI panel element: .ai-panel-body");
  }
  const panelBody: HTMLElement = panelBodyElement;
  const snapshotBlock = requireEl("ai-snapshot-block");
  const snapshotText = requireEl<HTMLPreElement>("ai-snapshot-text");
  const loading = requireEl("ai-loading");
  const response = dom.aiResponse;
  const errorBlock = requireEl("ai-error-block");
  const errorMessage = requireEl("ai-error-message");
  const retryBtn = requireEl<HTMLButtonElement>("ai-retry");
  const configBlock = requireEl("ai-config-block");
  const goConfigBtn = requireEl<HTMLButtonElement>("ai-go-config");
  const collapseBtn = requireEl<HTMLButtonElement>("ai-panel-collapse");
  const toggleBtn = dom.btnToggleAi;
  const conversationElement = requireEl("ai-conversation");
  const followUpForm = requireEl<HTMLFormElement>("ai-follow-up-form");
  const followUpInput = requireEl<HTMLTextAreaElement>("ai-follow-up-input");
  const followUpSend = requireEl<HTMLButtonElement>("ai-follow-up-send");
  const followUpError = requireEl("ai-follow-up-error");
  const followUpErrorMessage = requireEl("ai-follow-up-error-message");
  const followUpRetry = requireEl<HTMLButtonElement>("ai-follow-up-retry");
  const followUpEdit = requireEl<HTMLButtonElement>("ai-follow-up-edit");
  const scrollReset = new AiPanelScrollResetController();
  let editingFailedQuestion = false;

  retryBtn.addEventListener("click", actions.onRetry);
  goConfigBtn.addEventListener("click", () => actions.onGoToConfig());
  collapseBtn.addEventListener("click", () => state.close());
  toggleBtn.addEventListener("click", () => {
    if (state.isOpen) {
      state.close();
    } else {
      state.open();
    }
  });
  followUpInput.addEventListener("input", updateFollowUpSendState);
  followUpInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitFollowUp();
    }
  });
  followUpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitFollowUp();
  });
  followUpRetry.addEventListener("click", () => {
    actions.onRetryFollowUp();
  });
  followUpEdit.addEventListener("click", () => {
    const pending = state.conversation?.pending;
    if (!pending?.error) return;
    editingFailedQuestion = true;
    followUpInput.value = pending.question;
    followUpInput.disabled = false;
    followUpSend.textContent = "修改后重发";
    updateFollowUpSendState();
    followUpInput.focus();
  });

  function updateFollowUpSendState(): void {
    followUpSend.disabled = followUpInput.disabled || !followUpInput.value.trim();
  }

  function submitFollowUp(): void {
    const question = followUpInput.value;
    if (followUpInput.disabled || !question.trim()) return;
    const accepted = editingFailedQuestion
      ? actions.onEditFollowUp(question)
      : actions.onSubmitFollowUp(question);
    if (!accepted) return;
    editingFailedQuestion = false;
    followUpInput.value = "";
    followUpSend.textContent = "发送";
    updateFollowUpSendState();
  }

  function message(text: string, role: "user" | "assistant" | "status"): HTMLElement {
    const element = document.createElement(role === "status" ? "div" : "pre");
    element.classList.add("ai-message", `ai-message-${role}`);
    element.textContent = text;
    return element;
  }

  function renderConversation(): void {
    const conversation = state.conversation;
    conversationElement.replaceChildren();
    conversationElement.classList.toggle("hidden", conversation === null);
    if (!conversation) return;

    conversationElement.append(message(conversation.firstResponse, "assistant"));
    for (const turn of conversation.turns) {
      conversationElement.append(
        message(turn.question, "user"),
        message(turn.response, "assistant"),
      );
    }
    if (conversation.pending) {
      conversationElement.append(message(conversation.pending.question, "user"));
      if (!conversation.pending.error) {
        conversationElement.append(message("正在思考…", "status"));
      }
    }
  }

  function render(): void {
    panel.classList.toggle("hidden", !state.isOpen);
    const request = state.view.request;
    if (scrollReset.shouldReset(request)) {
      panelBody.scrollTop = 0;
      snapshotText.scrollTop = 0;
      response.scrollTop = 0;
    }

    const hasSnapshot =
      request.kind === "loading" ||
      request.kind === "success" ||
      request.kind === "error" ||
      request.kind === "configuration_required";

    snapshotBlock.classList.toggle("hidden", !hasSnapshot);
    if (hasSnapshot) {
      // 纯文本绑定：保留换行、可选择复制，不解析 HTML/Markdown
      snapshotText.textContent = request.snapshot.selectedText;
    }

    loading.classList.toggle(
      "hidden",
      request.kind !== "loading" || request.phase === "follow_up",
    );

    const conversation = state.conversation;
    response.classList.toggle("hidden", request.kind !== "success" || conversation !== null);
    if (request.kind === "success" && conversation === null) {
      response.textContent = request.response;
    }

    renderConversation();

    const isFollowUpFailure = conversation?.pending?.error !== undefined;
    errorBlock.classList.toggle("hidden", request.kind !== "error" || isFollowUpFailure);
    retryBtn.classList.toggle(
      "hidden",
      request.kind !== "error" && !(request.kind === "configuration_required" && conversation === null),
    );
    if (request.kind === "error" && !isFollowUpFailure) {
      errorMessage.textContent = request.error.message;
    }

    configBlock.classList.toggle("hidden", request.kind !== "configuration_required");
    followUpError.classList.toggle("hidden", !isFollowUpFailure);
    if (isFollowUpFailure) {
      followUpErrorMessage.textContent = conversation.pending?.error?.message ?? "";
    }

    const hasConversation = conversation !== null;
    const hasPending = conversation?.pending !== null;
    followUpForm.classList.toggle("hidden", !hasConversation);
    if (!hasConversation) {
      editingFailedQuestion = false;
      followUpInput.value = "";
      followUpSend.textContent = "发送";
    }
    followUpInput.disabled = !hasConversation || hasPending;
    followUpRetry.disabled = !isFollowUpFailure;
    followUpEdit.disabled = !isFollowUpFailure;
    if (!isFollowUpFailure && editingFailedQuestion) {
      editingFailedQuestion = false;
      followUpInput.value = "";
      followUpSend.textContent = "发送";
    }
    updateFollowUpSendState();

    // 面板展开时，header 的“收起”可用；可在任意状态下收起
    toggleBtn.textContent = state.isOpen ? "收起 AI" : "AI 面板";
  }

  state.subscribe(render);
  render();
}
