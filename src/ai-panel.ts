import type { AiPanelDom } from "./dom.ts";
import { AiPanelScrollResetController } from "./ai-panel-scroll.ts";
import { AiPanelState } from "./ai-panel-state.ts";
import { buildAiPanelView, type ConversationView } from "./ai-panel-view-model.ts";

export interface AiPanelActions {
  onRetry: () => void;
  onGoToConfig: () => void;
  onSubmitFollowUp: (question: string) => Promise<boolean>;
  onRetryFollowUp: () => Promise<boolean>;
  onEditFollowUp: (question: string) => Promise<boolean>;
  onSubmitDirectQuestion: (question: string) => Promise<boolean>;
  /** 用户点击“新建对话”：结束当前对话并结束常驻 AI 会话。 */
  onNewConversation: () => void;
  onRemoveDirectQuestionSelection: () => void;
  onDirectQuestionFocus: () => void;
  onOpenPanel: () => void;
}

/**
 * 把面板状态渲染到右侧 AI 面板的 DOM。
 *
 * 所有回复、错误与选区文字都通过 `textContent` / `<pre>` 纯文本绑定，绝不解析 HTML 或
 * Markdown；面板不持有任何写入草稿本或正文本的回调。状态变化时由 `AiPanelState` 订阅触发重绘。
 *
 * 思维扩展预备态的渲染与提交接线已移除。直接提问、选区召唤、选区附带、流式增量、
 * 追问与重试照常工作。
 *
 * 所需节点全部来自显式 `AiPanelDom` 契约（由 `getAppDom()` 集中解析），本模块不再执行
 * 全局节点查找或面板内部选择器查询。
 */
export function setupAiPanel(
  dom: AiPanelDom,
  state: AiPanelState,
  actions: AiPanelActions,
): void {
  const {
    panel,
    panelBody,
    snapshotBlock,
    snapshotText,
    loading,
    response,
    errorBlock,
    errorMessage,
    retryBtn,
    configBlock,
    goConfigBtn,
    collapseBtn,
    newConversationBtn,
    toggleBtn,
    conversation: conversationElement,
    welcome,
    followUpForm,
    followUpInput,
    followUpSend,
    followUpError,
    followUpErrorMessage,
    followUpRetry,
    followUpEdit,
    directQuestion,
    directQuestionSelection,
    directQuestionSelectionText,
    directQuestionSelectionRemove,
    directQuestionForm,
    directQuestionInput,
    directQuestionSend,
    directQuestionError,
    directQuestionErrorMessage,
    directQuestionConfig,
    directQuestionGoConfig,
  } = dom;
  const scrollReset = new AiPanelScrollResetController();
  let editingFailedQuestion = false;

  // 吸底滚动（D4）：滚动事件只维护“贴底”布尔标记（阈值约 40px），
  // 跟随动作只在渲染后执行；用户上滚脱离贴底后完全不干预滚动。
  const BOTTOM_FOLLOW_THRESHOLD_PX = 40;
  let pinnedToBottom = true;
  let panelWasOpen = false;
  panelBody.addEventListener("scroll", () => {
    const distanceToBottom =
      panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight;
    pinnedToBottom = distanceToBottom < BOTTOM_FOLLOW_THRESHOLD_PX;
  });

  retryBtn.addEventListener("click", actions.onRetry);
  goConfigBtn.addEventListener("click", () => actions.onGoToConfig());
  collapseBtn.addEventListener("click", () => state.close());
  newConversationBtn.addEventListener("click", () => actions.onNewConversation());
  toggleBtn.addEventListener("click", () => {
    if (state.isOpen) {
      state.close();
    } else {
      state.open();
      actions.onOpenPanel();
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

  directQuestionInput.addEventListener("input", () => {
    state.updateDirectQuestionDraft(directQuestionInput.value);
  });
  directQuestionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitDirectQuestion();
    }
  });
  directQuestionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitDirectQuestion();
  });
  directQuestionSelectionRemove.addEventListener("click", () => {
    actions.onRemoveDirectQuestionSelection();
  });
  directQuestionGoConfig.addEventListener("click", () => actions.onGoToConfig());
  // 聚焦输入前同步保存最新有效选区快照，避免失焦清空浏览器 Selection。
  directQuestionInput.addEventListener("mousedown", () => actions.onDirectQuestionFocus());
  directQuestionInput.addEventListener("focus", () => actions.onDirectQuestionFocus());

  async function submitDirectQuestion(): Promise<void> {
    const question = directQuestionInput.value;
    if (directQuestionSend.disabled || !question.trim()) return;
    const accepted = await actions.onSubmitDirectQuestion(question);
    if (!accepted) return;
  }

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

    // 面板重新展开时直接置于贴底状态（收起期间不滚动）。
    const isOpen = state.isOpen;
    if (isOpen && !panelWasOpen) {
      pinnedToBottom = true;
    }
    panelWasOpen = isOpen;

    // 新请求开始（新对话身份 / 新冻结快照）：回到贴底跟随，让新消息可见。
    if (scrollReset.shouldReset(state.view.request)) {
      pinnedToBottom = true;
      snapshotText.scrollTop = 0;
    }

    snapshotBlock.classList.toggle("hidden", view.snapshot === null);
    if (view.snapshot) {
      // 纯文本绑定：保留换行、可选择复制，不解析 HTML/Markdown
      snapshotText.textContent = view.snapshot.text;
    }

    loading.classList.toggle("hidden", !view.loadingVisible);
    if (view.loadingMessage !== null) {
      loading.textContent = view.loadingMessage;
    }

    response.classList.toggle("hidden", view.response === null);
    if (view.response !== null) {
      response.textContent = view.response;
    }

    // 空状态欢迎语：无对话轮次且无进行中请求时显示，对话开始后消失。
    welcome.classList.toggle("hidden", !view.welcomeVisible);

    renderConversation(view.conversation);

    errorBlock.classList.toggle("hidden", view.errorBlock === null);
    if (view.errorBlock) {
      errorMessage.textContent = view.errorBlock.message;
    }
    retryBtn.classList.toggle("hidden", !view.retryAvailable);

    configBlock.classList.toggle("hidden", !view.configBlock);

    newConversationBtn.classList.toggle("hidden", !view.newConversationVisible);

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

    // 直接提问入口：空闲或直接提问请求时可见，其余状态隐藏。
    const directQuestionView = view.directQuestion;
    directQuestion.classList.toggle("hidden", directQuestionView === null);
    if (directQuestionView) {
      // 输入框显示值由视图模型按状态决定：生成中清空（问题已入对话流），
      // 其余状态显示草稿（失败后恢复可见供重试编辑）。
      if (directQuestionInput.value !== directQuestionView.inputValue) {
        directQuestionInput.value = directQuestionView.inputValue;
      }
      directQuestionInput.disabled = !directQuestionView.inputEnabled;
      directQuestionSelection.classList.toggle(
        "hidden",
        directQuestionView.pendingSelection === null,
      );
      if (directQuestionView.pendingSelection) {
        directQuestionSelectionText.textContent = directQuestionView.pendingSelection.text;
      }
      // 生成中占位与流式增量已统一渲染在对话流内该轮次位置（D1/D6），
      // 不再渲染输入区附近的独立加载 / 回复区块。
      directQuestionError.classList.toggle(
        "hidden",
        directQuestionView.errorMessage === null,
      );
      if (directQuestionView.errorMessage !== null) {
        directQuestionErrorMessage.textContent = directQuestionView.errorMessage;
      }
      directQuestionConfig.classList.toggle(
        "hidden",
        directQuestionView.status !== "configuration_required",
      );
      directQuestionSend.disabled = !directQuestionView.submitEnabled;
    } else {
      directQuestionInput.value = "";
      directQuestionInput.disabled = false;
      directQuestionSelection.classList.add("hidden");
      directQuestionError.classList.add("hidden");
      directQuestionConfig.classList.add("hidden");
    }

    // 面板展开时，header 的“收起”可用；可在任意状态下收起
    toggleBtn.textContent = state.isOpen ? "收起 AI" : "AI 面板";

    // 吸底跟随（D4）：仅在面板展开且处于贴底状态时，渲染后滚动到底部；
    // 用户上滚脱离贴底后不再干预，滚回底部后由滚动事件恢复标记。
    if (isOpen && pinnedToBottom) {
      panelBody.scrollTop = panelBody.scrollHeight;
    }
  }

  state.subscribe(render);
  render();
}
