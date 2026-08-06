import type {
  PanelRequestState,
  PanelStateView,
} from "./ai-panel-request-state.ts";
import type { ReadonlyTemporaryConversation } from "./ai-panel-conversation.ts";

/**
 * AI 面板的纯显示决策边界（OpenSpec change: ai-panel-rendering-boundaries）。
 *
 * 该模块只把 `PanelStateView` 与只读临时对话映射成结构化的显示决策数据：
 * 展示哪些区域、可用哪些操作。它不接触 DOM、CSS、action、网络，也不修改任何输入
 * 或缓存状态；返回全新只读数据，供 DOM 控制器消费。
 */

export interface SnapshotView {
  readonly text: string;
}

export interface ThinkingExpansionView {
  readonly selectionLength: number;
  readonly direction: string;
}

export type ConversationMessageRole = "user" | "assistant" | "status";

export interface ConversationMessageView {
  readonly role: ConversationMessageRole;
  readonly text: string;
}

export interface ConversationView {
  readonly messages: ReadonlyArray<ConversationMessageView>;
}

export interface ErrorBlockView {
  readonly message: string;
}

export interface FollowUpErrorView {
  readonly message: string;
  readonly retryAvailable: boolean;
  readonly editAvailable: boolean;
}

export interface FollowUpFormView {
  readonly inputEnabled: boolean;
}

export interface AiPanelView {
  readonly panelVisible: boolean;
  readonly snapshot: SnapshotView | null;
  readonly thinkingExpansion: ThinkingExpansionView | null;
  readonly loadingVisible: boolean;
  readonly response: string | null;
  readonly conversation: ConversationView | null;
  readonly errorBlock: ErrorBlockView | null;
  readonly configBlock: boolean;
  readonly followUpError: FollowUpErrorView | null;
  readonly followUpForm: FollowUpFormView | null;
  readonly retryAvailable: boolean;
}

/** 从 `request.kind` 穷尽推导出的、只依赖请求本身的显示片段。 */
interface RequestDisplayFacts {
  readonly snapshot: SnapshotView | null;
  readonly thinkingExpansion: ThinkingExpansionView | null;
  readonly loadingVisible: boolean;
  readonly successResponse: string | null;
  readonly errorMessage: string | null;
  readonly blockedMessage: string | null;
  readonly configRequired: boolean;
}

function assertNever(value: never): never {
  throw new Error(`未处理的请求状态：${JSON.stringify(value)}`);
}

const EMPTY_FACTS: RequestDisplayFacts = {
  snapshot: null,
  thinkingExpansion: null,
  loadingVisible: false,
  successResponse: null,
  errorMessage: null,
  blockedMessage: null,
  configRequired: false,
};

function requestFacts(request: PanelRequestState): RequestDisplayFacts {
  switch (request.kind) {
    case "idle":
      return EMPTY_FACTS;
    case "first_preview":
      return { ...EMPTY_FACTS, snapshot: { text: request.snapshot.selectedText } };
    case "first_blocked":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        blockedMessage: request.message,
      };
    case "thinking_expansion":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        thinkingExpansion: {
          selectionLength: request.snapshot.selectedText.length,
          direction: request.direction,
        },
      };
    case "loading":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        loadingVisible: request.phase !== "follow_up",
      };
    case "success":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        successResponse: request.response,
      };
    case "error":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        errorMessage: request.error.message,
      };
    case "configuration_required":
      return {
        ...EMPTY_FACTS,
        snapshot: { text: request.snapshot.selectedText },
        configRequired: true,
      };
    default:
      return assertNever(request);
  }
}

function buildConversationView(
  conversation: ReadonlyTemporaryConversation | null,
): ConversationView | null {
  if (!conversation) return null;
  const messages: ConversationMessageView[] = [
    { role: "assistant", text: conversation.firstResponse },
  ];
  for (const turn of conversation.turns) {
    messages.push({ role: "user", text: turn.question });
    messages.push({ role: "assistant", text: turn.response });
  }
  if (conversation.pending) {
    messages.push({ role: "user", text: conversation.pending.question });
    if (!conversation.pending.error) {
      messages.push({ role: "status", text: "正在思考…" });
    }
  }
  return { messages };
}

export function buildAiPanelView(
  panelState: PanelStateView,
  conversation: ReadonlyTemporaryConversation | null,
): AiPanelView {
  const facts = requestFacts(panelState.request);
  const conversationView = buildConversationView(conversation);
  const hasConversation = conversation !== null;

  const pendingError = conversation?.pending?.error;
  const isFollowUpFailure = pendingError !== undefined;

  const response =
    facts.successResponse !== null && !hasConversation ? facts.successResponse : null;

  const firstFeedbackMessage = facts.errorMessage ?? facts.blockedMessage;
  const errorBlock =
    !isFollowUpFailure && firstFeedbackMessage !== null
      ? { message: firstFeedbackMessage }
      : null;

  const followUpError =
    pendingError !== undefined
      ? { message: pendingError.message, retryAvailable: true, editAvailable: true }
      : null;

  const hasPending = conversation !== null && conversation.pending !== null;
  const followUpForm = hasConversation ? { inputEnabled: !hasPending } : null;

  const retryAvailable =
    (facts.errorMessage !== null || facts.configRequired) && !hasConversation;

  return {
    panelVisible: panelState.visibility === "open",
    snapshot: facts.snapshot,
    thinkingExpansion: facts.thinkingExpansion,
    loadingVisible: facts.loadingVisible,
    response,
    conversation: conversationView,
    errorBlock,
    configBlock: facts.configRequired,
    followUpError,
    followUpForm,
    retryAvailable,
  };
}
