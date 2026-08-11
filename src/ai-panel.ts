import type { AppDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { buildAiPanelView, type ConversationView } from "./ai-panel-view-model.ts";

export interface AiPanelActions {
  onRetry: () => void;
  onGoToConfig: () => void;
  onStartThinkingExpansion: (direction: string) => boolean;
  onSubmitFollowUp: (question: string) => Promise<boolean>;
  onRetryFollowUp: () => Promise<boolean>;
  onEditFollowUp: (question: string) => Promise<boolean>;
}

type AiPanelDom = Pick<AppDom, "aiPanel" | "aiResponse" | "btnToggleAi">;

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
  dom: AiPanelDom,
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
  const thinkingExpansionPrestate = requireEl("ai-thinking-expansion-prestate");
  const thinkingExpansionTitle = requireEl("ai-thinking-expansion-title");
  const thinkingExpansionCount = requireEl("ai-thinking-expansion-count");
  const thinkingExpansionForm = requireEl<HTMLFormElement>("ai-thinking-expansion-form");
  const thinkingExpansionInput = requireEl<HTMLTextAreaElement>("ai-thinking-expansion-input");
  const thinkingExpansionStart = requireEl<HTMLButtonElement>("ai-thinking-expansion-start");
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
  let thinkingExpansionFocused = false;

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
  thinkingExpansionInput.addEventListener("input", () => {
    state.updateThinkingExpansionDirection(thinkingExpansionInput.value);
  });
  thinkingExpansionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const request = state.view.request;
    if (request.kind !== "thinking_expansion") return;
    actions.onStartThinkingExpansion(request.direction);
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

  async function submitFollowUp(): Promise<void> {
    const question = followUpInput.value;
    if (followUpInput.disabled || !question.trim()) return;
    const accepted = await (editingFailedQuestion
      ? actions.onEditFollowUp(question)
      : actions.onSubmitFollowUp(question));
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

  function renderConversation(conversation: ConversationView | null): void {
    conversationElement.replaceChildren();
    conversationElement.classList.toggle("hidden", conversation === null);
    if (!conversation) return;

    for (const item of conversation.messages) {
      conversationElement.append(message(item.text, item.role));
    }
  }

  function render(): void {
    // 所有请求/对话的显示决策交给纯函数 view model 推导；本函数只负责把结构化
    // 结果落到既有 DOM 节点，并保留焦点、滚动、输入等交互态。
    const view = buildAiPanelView(state.view, state.conversation);

    panel.classList.toggle("hidden", !view.panelVisible);
    if (scrollReset.shouldReset(state.view.request)) {
      panelBody.scrollTop = 0;
      snapshotText.scrollTop = 0;
      response.scrollTop = 0;
    }

    snapshotBlock.classList.toggle("hidden", view.snapshot === null);
    if (view.snapshot) {
      // 纯文本绑定：保留换行、可选择复制，不解析 HTML/Markdown
      snapshotText.textContent = view.snapshot.text;
    }

    const thinkingExpansion = view.thinkingExpansion;
    thinkingExpansionPrestate.classList.toggle("hidden", thinkingExpansion === null);
    if (thinkingExpansion) {
      thinkingExpansionTitle.textContent = "思维扩展";
      thinkingExpansionCount.textContent = `已选中 ${thinkingExpansion.selectionLength} 字`;
      if (thinkingExpansionInput.value !== thinkingExpansion.direction) {
        thinkingExpansionInput.value = thinkingExpansion.direction;
      }
      thinkingExpansionStart.disabled = false;
      if (!thinkingExpansionFocused) {
        thinkingExpansionInput.focus();
        thinkingExpansionFocused = true;
      }
    } else {
      thinkingExpansionFocused = false;
      thinkingExpansionInput.value = "";
    }

    loading.classList.toggle("hidden", !view.loadingVisible);

    response.classList.toggle("hidden", view.response === null);
    if (view.response !== null) {
      response.textContent = view.response;
    }

    renderConversation(view.conversation);

    errorBlock.classList.toggle("hidden", view.errorBlock === null);
    if (view.errorBlock) {
      errorMessage.textContent = view.errorBlock.message;
    }
    retryBtn.classList.toggle("hidden", !view.retryAvailable);

    configBlock.classList.toggle("hidden", !view.configBlock);

    const followUpErrorView = view.followUpError;
    followUpError.classList.toggle("hidden", followUpErrorView === null);
    if (followUpErrorView) {
      followUpErrorMessage.textContent = followUpErrorView.message;
    }

    const followUpFormView = view.followUpForm;
    followUpForm.classList.toggle("hidden", followUpFormView === null);
    if (followUpFormView === null) {
      editingFailedQuestion = false;
      followUpInput.value = "";
      followUpSend.textContent = "发送";
    }
    followUpInput.disabled = followUpFormView === null || !followUpFormView.inputEnabled;
    followUpRetry.disabled = followUpErrorView === null || !followUpErrorView.retryAvailable;
    followUpEdit.disabled = followUpErrorView === null || !followUpErrorView.editAvailable;
    if (followUpErrorView === null && editingFailedQuestion) {
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
