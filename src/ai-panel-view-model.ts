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

export interface DirectQuestionView {
  readonly draft: string;
  /**
   * 输入框应显示的值：生成中显示空字符串（问题已作为用户消息进入对话流，
   * 输入框不保留副本）；其余状态（idle/error/configuration_required）显示草稿，
   * 失败后草稿恢复可见供重试编辑。
   */
  readonly inputValue: string;
  readonly pendingSelection: SnapshotView | null;
  readonly status: "idle" | "loading" | "error" | "configuration_required";
  readonly errorMessage: string | null;
  /** 生成中禁用输入：避免打字被渲染覆盖，与发送按钮的禁用语义一致。 */
  readonly inputEnabled: boolean;
  readonly submitEnabled: boolean;
}

export interface AiPanelView {
  readonly panelVisible: boolean;
  readonly snapshot: SnapshotView | null;
  readonly loadingVisible: boolean;
  /** 生成中占位文案：普通生成“正在思考…”，对话恢复“恢复对话中”。 */
  readonly loadingMessage: string | null;
  readonly response: string | null;
  readonly conversation: ConversationView | null;
  /** 空状态欢迎语：无任何对话轮次且无进行中请求时显示。 */
  readonly welcomeVisible: boolean;
  readonly errorBlock: ErrorBlockView | null;
  readonly configBlock: boolean;
  readonly followUpError: FollowUpErrorView | null;
  readonly followUpForm: FollowUpFormView | null;
  readonly retryAvailable: boolean;
  readonly directQuestion: DirectQuestionView | null;
  /** 是否有可结束的内容（临时对话或进行中的首轮/追问/直接提问请求），决定“新建对话”是否显示。 */
  readonly newConversationVisible: boolean;
}

/** 从 `request.kind` 穷尽推导出的、只依赖请求本身的显示片段。 */
interface RequestDisplayFacts {
  readonly snapshot: SnapshotView | null;
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
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
      };
    case "first_blocked":
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        blockedMessage: request.message,
      };
    case "loading":
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        loadingVisible: request.phase !== "follow_up",
      };
    case "success":
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        successResponse: request.response,
      };
    case "error":
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        errorMessage: request.error.message,
      };
    case "configuration_required":
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        configRequired: true,
      };
    case "direct_question":
      // 直接提问的状态由 DirectQuestionView 单独呈现，不占用旧请求区。
      return EMPTY_FACTS;
    case "recovering":
      // 驱动进程丢失后的对话恢复：复用生成中占位样式，显示恢复文案。
      return {
        ...EMPTY_FACTS,
        snapshot: request.snapshot ? { text: request.snapshot.selectedText } : null,
        loadingVisible: true,
      };
    default:
      return assertNever(request);
  }
}

function buildConversationView(
  conversation: ReadonlyTemporaryConversation | null,
): ConversationView | null {
  if (!conversation) return null;
  const messages: ConversationMessageView[] = [];
  const material = conversation.initialUserMaterial;
  // 直接提问来源：首轮用户原问题先于 AI 首轮回答显示；选区召唤保持原顺序。
  if (material.kind === "direct_question") {
    messages.push({ role: "user", text: material.question });
  }
  messages.push({ role: "assistant", text: conversation.firstResponse });
  for (const turn of conversation.turns) {
    messages.push({ role: "user", text: turn.question });
    messages.push({ role: "assistant", text: turn.response });
  }
  if (conversation.pending) {
    messages.push({ role: "user", text: conversation.pending.question });
    if (!conversation.pending.error) {
      // 流式增量草稿逐字追加为助手消息；尚未有增量时只显示思考中状态。
      if (conversation.pending.streamedText) {
        messages.push({ role: "assistant", text: conversation.pending.streamedText });
      }
      messages.push({ role: "status", text: "正在思考…" });
    }
  }
  return { messages };
}

function buildFirstRoundLoadingView(
  request: Extract<PanelRequestState, { kind: "loading" }>,
): ConversationView {
  const messages: ConversationMessageView[] = [];
  if (request.snapshot?.selectedText) {
    messages.push({ role: "user", text: request.snapshot.selectedText });
  }
  if (request.streamedText) {
    messages.push({ role: "assistant", text: request.streamedText });
  }
  messages.push({ role: "status", text: "正在思考…" });
  return { messages };
}

/**
 * 直接提问入口的纯显示决策：面板打开且处于空闲或直接提问请求时可见。
 * 空闲时展示草稿与待附带选区；请求中禁用重复提交；成功/失败/配置缺失分别呈现。
 * 流式增量与请求状态不再由本视图承载——它们统一渲染在对话流内对应轮次的位置。
 */
function buildDirectQuestionView(panelState: PanelStateView): DirectQuestionView | null {
  const request = panelState.request;
  const isDirectQuestion = request.kind === "direct_question";
  if (panelState.visibility !== "open" || (request.kind !== "idle" && !isDirectQuestion)) {
    return null;
  }

  const status = isDirectQuestion ? request.status : "idle";
  const errorMessage =
    isDirectQuestion && request.status === "error" ? (request.error?.message ?? null) : null;
  const pendingSelection = panelState.pendingSelection
    ? { text: panelState.pendingSelection.selectedText }
    : null;

  return {
    draft: panelState.directQuestionDraft,
    inputValue: status === "loading" ? "" : panelState.directQuestionDraft,
    pendingSelection,
    status,
    errorMessage,
    inputEnabled: status !== "loading",
    submitEnabled: panelState.directQuestionDraft.trim().length > 0 && status !== "loading",
  };
}

/**
 * 首轮直接提问从被接受那一刻起的统一对话视图（D1）：
 * 用户问题立即作为用户消息，生成中占位与流式增量在该消息正下方原地展开。
 * 首轮成功后由 `buildConversationView` 接管，消息位置不变，无容器切换跳变。
 */
function buildDirectQuestionConversationView(
  request: Extract<PanelRequestState, { kind: "direct_question" }>,
): ConversationView {
  const messages: ConversationMessageView[] = [{ role: "user", text: request.question }];
  if (request.status === "loading") {
    // 流式增量草稿逐字追加为助手消息；尚未有增量时只显示思考中状态。
    if (request.streamedText) {
      messages.push({ role: "assistant", text: request.streamedText });
    }
    messages.push({ role: "status", text: "正在思考…" });
  }
  // 错误 / 缺配置状态由对话流内对应轮次位置的独立反馈区块呈现（见渲染层）。
  return { messages };
}

export function buildAiPanelView(
  panelState: PanelStateView,
  conversation: ReadonlyTemporaryConversation | null,
): AiPanelView {
  const facts = requestFacts(panelState.request);
  // 统一对话视图（D1）：直接提问请求从被接受起就产出对话流；
  // 其余情况由已建立的临时对话推导。两条路径不再互斥切换。
  const directQuestionRequest =
    panelState.request.kind === "direct_question" ? panelState.request : null;
  const firstRoundLoadingRequest =
    panelState.request.kind === "loading" &&
    panelState.request.phase === "first" &&
    panelState.request.streamedText
      ? panelState.request
      : null;
  const conversationView = directQuestionRequest
    ? buildDirectQuestionConversationView(directQuestionRequest)
    : firstRoundLoadingRequest
      ? buildFirstRoundLoadingView(firstRoundLoadingRequest)
      : buildConversationView(conversation);
  const hasConversation = conversation !== null;
  const directQuestion = buildDirectQuestionView(panelState);

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

  // 空状态欢迎语（D5）：无任何对话轮次（含直接提问进行中的统一轮次）且无进行中请求。
  const welcomeVisible = panelState.request.kind === "idle" && conversation === null;

  // “新建对话”仅在存在临时对话或存在任何非空闲请求（首轮预检/阻塞/加载/成功/失败/配置、
  // 追问或直接提问请求）时显示；空白直接提问 idle 状态隐藏。与 reducer 的
  // `hasEndableConversationWork` 语义一致（用户有“可结束的内容”才看到结束入口）。
  const newConversationVisible = hasConversation || panelState.request.kind !== "idle";

  return {
    panelVisible: panelState.visibility === "open",
    snapshot: facts.snapshot,
    loadingVisible: facts.loadingVisible,
    loadingMessage: facts.loadingVisible
      ? panelState.request.kind === "recovering"
        ? "恢复对话中"
        : "正在思考…"
      : null,
    response,
    conversation: conversationView,
    welcomeVisible,
    errorBlock,
    configBlock: facts.configRequired,
    followUpError,
    followUpForm,
    retryAvailable,
    directQuestion,
    newConversationVisible,
  };
}
