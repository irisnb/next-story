import type {
  PanelRequestState,
  PanelStateView,
} from "./ai-panel-request-state.ts";
import {
  conversationRestrictionNotice,
  type ReadonlyTemporaryConversation,
} from "./ai-panel-conversation.ts";
import type {
  MaterialProvenance,
  OnDemandReadingProvenance,
  ReadingDepth,
} from "./conversation-archive.ts";

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

/**
 * 「本次参考了什么」显示层的文档身份解析入口：标题按当前作品树解析，隐藏来源必须脱敏。
 * 由窗口层注入真实实现；缺省时标题回退为「文档已不可用」，不做隐藏判定。
 */
export interface MaterialContext {
  readonly resolveDocumentTitle: (documentId: string) => string | null;
  readonly isDocumentHidden: (documentId: string) => boolean;
}

/** 单条实际使用材料的显示项（只展示真实使用过的材料，不列出未读取内容）。 */
export interface MaterialSourceView {
  readonly kindLabel: string;
  readonly title: string;
  readonly versionLabel: string | null;
  readonly stateLabel: string | null;
  readonly matchedTerm: string | null;
  readonly masked: boolean;
}

/** 单轮材料说明（按轮次分组）。 */
export interface MaterialRoundView {
  readonly roundLabel: string;
  readonly sources: readonly MaterialSourceView[];
  readonly retrievalLabel: string | null;
  readonly limited: boolean;
  /** 本轮是否收到 provider 发送回执（`message_sent`）。 */
  readonly sentConfirmed: boolean;
  /** 发送状态说明：区分「已确认送达」与「已组装、送达未确认」，无回执不伪造。 */
  readonly sendStateLabel: string;
}

/** 「本次参考了什么」轻量说明的显示数据。 */
export interface MaterialView {
  readonly rounds: readonly MaterialRoundView[];
  /** 是否因旧档案缺少材料出处而无法说明。 */
  readonly unavailable: boolean;
  /** 被脱敏（已隐藏）的来源数量。 */
  readonly hiddenSourceCount: number;
  /** 统一的检索范围与诚实边界说明。 */
  readonly scopeNote: string;
}

/**
 * 按需补读授权请求卡（add-agent-on-demand-reading 任务 7.1）的显示数据：
 * 模型提供的请求原因 + 权限边界说明。措辞红线：不得表述为「现在才允许 AI 查看
 * 作品」——既有自动材料（关注文档现场、目录投影、检索片段）本来就在工作；
 * 本卡只决定是否开启「围绕当前问题补充阅读作品文档」。
 */
export interface ReadingRequestView {
  /** 模型提供的请求原因（透传）。 */
  readonly reason: string;
  /** 权限边界说明（仅本讨论、只读、不再重复询问、可随时关闭）。 */
  readonly boundaryNotes: readonly string[];
}

/** 授权卡的固定边界说明（任务 7.1 行为合同）。 */
export const READING_REQUEST_BOUNDARY_NOTES: readonly string[] = [
  "只在本讨论内生效，其他讨论不受影响",
  "AI 只会阅读作品文档，不会修改任何内容",
  "允许后本讨论内不再重复询问，AI 需要时自行补读",
  "你可以随时在窗口菜单关闭；关闭不会清除已读内容",
];

/** 授权卡的标题说明（区分「按需补读」与既有自动附带材料）。 */
export const READING_REQUEST_TITLE =
  "AI 希望围绕这个问题补充阅读你的作品文档";

/** 补读过程轻量状态（任务 7.3）的显示数据：一句话状态 + 可展开的文档列表。 */
export interface ReadingProgressView {
  /** 简短状态行（正在检索 / 正在阅读 / 正在查看目录）。 */
  readonly statusLabel: string;
  /** 正在阅读 / 已读的文档显示项（标题按当前作品树解析，隐藏来源脱敏）。 */
  readonly documents: ReadonlyArray<{ readonly title: string; readonly masked: boolean }>;
  /** 是否有可展开的文档列表。 */
  readonly hasDocuments: boolean;
}

/** 按需补读阅读程度（三档，任务 7.4；判定在后端，显示层只翻译标签）。 */
const READING_DEPTH_LABELS: Record<ReadingDepth, string> = {
  search_snippet: "搜索片段",
  partial: "局部阅读",
  full: "完整阅读",
};

/** 材料类型的显示标签；`revoked` 属于锁存脱敏标记，不单独展示。 */
const MATERIAL_KIND_LABELS: Record<MaterialProvenance["material_type"], string> = {
  focus_document: "关注文档",
  search_snippet: "跨文档命中",
  selection: "选区材料",
  snapshot: "未保存快照",
  document: "已保存正文",
  revoked: "已隐藏来源",
};

const MASKED_SOURCE_TITLE = "（已隐藏的来源）";
const MISSING_SOURCE_TITLE = "（文档已不可用）";

/** 「本次参考了什么」的范围与诚实边界说明（不把未读取内容列为已知）。 */
export const MATERIAL_SCOPE_NOTE =
  "只列出本轮实际进入请求的材料；检索范围为当前允许 AI 查看的作品正文，不含隐藏文档与回收站。未读取的内容不会列为已知。";

function shortVersion(version: string | null): string | null {
  if (!version) return null;
  return version.length > 8 ? version.slice(0, 8) : version;
}

function sourceStateLabel(entry: MaterialProvenance): string | null {
  if (entry.material_type === "focus_document") {
    return entry.from_unsaved_snapshot ? "未保存快照" : "已保存正文";
  }
  if (entry.material_type === "snapshot") return "未保存快照";
  return null;
}

function retrievalLabelFor(
  entries: readonly MaterialProvenance[],
  status: string | undefined,
  limited: boolean,
): string | null {
  const snippetCount = entries.filter((entry) => entry.material_type === "search_snippet").length;
  let label: string;
  switch (status) {
    case "hit":
      label = `跨文档检索：命中 ${snippetCount} 处`;
      break;
    case "not_found":
      label = "跨文档检索：本次没有命中片段";
      break;
    case "no_query_terms":
      label = "跨文档检索：本轮问题没有可检索的词";
      break;
    default:
      label = snippetCount > 0 ? `跨文档检索：命中 ${snippetCount} 处` : "跨文档检索：本次没有命中片段";
      break;
  }
  return limited ? `${label}（本次检索受限，未做全量检索）` : label;
}

/**
 * 把讨论的材料出处投影为「本次参考了什么」显示数据（纯函数）。
 *
 * 诚实边界：只展示实际使用过的材料与版本 / 未保存状态 / 检索来源与限制；
 * 隐藏来源脱敏（不显示名称 / ID / 路径），`not_found` / `no_query_terms` 只作为
 * 检索结果状态呈现，绝不作为正文或材料内容展示。旧档案缺少出处时标记为不可说明。
 */
export function buildMaterialView(
  conversation: ReadonlyTemporaryConversation | null,
  context: MaterialContext = { resolveDocumentTitle: () => null, isDocumentHidden: () => false },
): MaterialView | null {
  if (!conversation) return null;
  if (conversation.provenance === undefined) {
    return { rounds: [], unavailable: true, hiddenSourceCount: 0, scopeNote: MATERIAL_SCOPE_NOTE };
  }

  const byTurn = new Map<number, MaterialProvenance[]>();
  for (const entry of conversation.provenance) {
    const list = byTurn.get(entry.turn_index) ?? [];
    list.push(entry);
    byTurn.set(entry.turn_index, list);
  }
  // 按需补读出处（任务 7.4）：并入同一轮分组，显示文档与阅读程度（三档标签由
  // 后端按轮判定；显示层只翻译，不重算）。
  const onDemandByTurn = new Map<number, OnDemandReadingProvenance[]>();
  for (const entry of conversation.onDemandReadingProvenance ?? []) {
    const list = onDemandByTurn.get(entry.turn_index) ?? [];
    list.push(entry);
    onDemandByTurn.set(entry.turn_index, list);
  }
  const allTurns = [...new Set([...byTurn.keys(), ...onDemandByTurn.keys()])].sort((a, b) => a - b);

  let hiddenSourceCount = 0;
  const rounds: MaterialRoundView[] = [];
  for (const turnIndex of allTurns) {
    const entries = byTurn.get(turnIndex) ?? [];
    const focusEntry = entries.find((entry) => entry.material_type === "focus_document");
    const sources: MaterialSourceView[] = entries.map((entry) => {
      const masked = entry.material_type === "revoked" || context.isDocumentHidden(entry.document_id);
      if (masked) hiddenSourceCount += 1;
      const title = masked
        ? MASKED_SOURCE_TITLE
        : context.resolveDocumentTitle(entry.document_id) ?? MISSING_SOURCE_TITLE;
      return {
        kindLabel: MATERIAL_KIND_LABELS[entry.material_type] ?? "材料",
        title,
        versionLabel: masked ? null : shortVersion(entry.document_version),
        stateLabel: masked ? null : sourceStateLabel(entry),
        matchedTerm: masked ? null : entry.matched_term ?? null,
        masked,
      };
    });
    for (const entry of onDemandByTurn.get(turnIndex) ?? []) {
      const masked = context.isDocumentHidden(entry.document_id);
      if (masked) hiddenSourceCount += 1;
      const title = masked
        ? MASKED_SOURCE_TITLE
        : context.resolveDocumentTitle(entry.document_id) ?? MISSING_SOURCE_TITLE;
      sources.push({
        kindLabel: "按需补读",
        title,
        versionLabel: masked ? null : shortVersion(entry.version),
        stateLabel: masked ? null : READING_DEPTH_LABELS[entry.depth] ?? entry.depth,
        matchedTerm: null,
        masked,
      });
    }
    const limited = focusEntry?.search_limited === true;
    const sentConfirmed = entries.some((entry) => entry.sent_confirmed === true);
    rounds.push({
      roundLabel: turnIndex === 0 ? "首轮" : `第 ${turnIndex} 轮`,
      sources,
      retrievalLabel: focusEntry
        ? retrievalLabelFor(entries, focusEntry.search_status, limited)
        : null,
      limited,
      sentConfirmed,
      sendStateLabel: sentConfirmed
        ? "发送状态：已确认送达模型服务（已观测到模型回应）"
        : "发送状态：已组装进请求，送达未确认（未观测到模型回应）",
    });
  }

  return { rounds, unavailable: false, hiddenSourceCount, scopeNote: MATERIAL_SCOPE_NOTE };
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
  readonly status: "idle" | "loading" | "error" | "configuration_required" | "stopped";
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
  /** 追问轮被用户停止（显示「已停止」+「重试」）。 */
  readonly followUpStopped: boolean;
  readonly followUpForm: FollowUpFormView | null;
  readonly retryAvailable: boolean;
  readonly directQuestion: DirectQuestionView | null;
  /** 是否有可结束的内容（临时对话或进行中的首轮/追问/直接提问请求），决定“新建对话”是否显示。 */
  readonly newConversationVisible: boolean;
  /** 讨论档案保存失败时的可见提示；无错误时为 null。 */
  readonly saveError: string | null;
  /**
   * 材料权限已变化时的中文提示（不含隐藏文件名称 / ID / 路径）；未受限为 null。
   * 受限讨论仍显示已有历史，但不可沿原上下文继续，提示引导用户新建干净讨论。
   */
  readonly restrictionNotice: string | null;
  /**
   * 「本次参考了什么」轻量说明；无讨论时为 null。有讨论时总是非 null（旧档案缺出处时
   * `unavailable` 为 true）。由窗口层按需展开，不打断对话。
   */
  readonly material: MaterialView | null;
  /** 待决的按需补读授权请求卡（任务 7.1）；无待决时为 null。 */
  readonly readingRequest: ReadingRequestView | null;
  /**
   * 补读过程轻量状态（任务 7.3）：仅在生成中呈现（正在搜索 / 正在阅读与已读
   * 文档列表）；不在生成中或无补读活动时为 null。不展示模型内部推理。
   */
  readonly readingProgress: ReadingProgressView | null;
  /** 该讨论是否已开启按需补读授权（任务 7.2 开关状态）。 */
  readonly onDemandReadingEnabled: boolean;
}

function buildReadingProgressView(
  panelState: PanelStateView,
  generating: boolean,
  context: MaterialContext,
): ReadingProgressView | null {
  const progress = panelState.readingProgress ?? null;
  if (!generating || progress === null) return null;
  const statusLabel =
    progress.status === "searching"
      ? "正在检索作品文档…"
      : progress.status === "reading"
        ? "正在阅读作品文档…"
        : "正在查看作品目录…";
  const documents = progress.documentIds.map((documentId) => {
    const masked = context.isDocumentHidden(documentId);
    return {
      title: masked
        ? MASKED_SOURCE_TITLE
        : context.resolveDocumentTitle(documentId) ?? MISSING_SOURCE_TITLE,
      masked,
    };
  });
  return { statusLabel, documents, hasDocuments: documents.length > 0 };
}

/**
 * 从 `request.kind` 穷尽推导出的、只依赖请求本身的显示片段。
 */
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
    case "stopped":
      // 已停止终态：内容由对话流视图（或直接提问统一轮次）渲染，本区块不占用。
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
  interruptedLabel: string = "中断",
): ConversationView | null {
  if (!conversation) return null;
  const messages: ConversationMessageView[] = [];
  const material = conversation.initialUserMaterial;
  // 首轮用户消息：直接提问显示原问题；选区召唤显示冻结选区文本（与首轮 loading 视图一致）。
  if (material.kind === "direct_question") {
    messages.push({ role: "user", text: material.question });
  } else if (material.selected_text) {
    messages.push({ role: "user", text: material.selected_text });
  }
  // 首轮 assistant 回应：为空（生成途中被打断的首轮）时不推空消息。
  if (conversation.firstResponse) {
    messages.push({ role: "assistant", text: conversation.firstResponse });
  }
  if (conversation.firstRoundInterrupted) {
    messages.push({ role: "status", text: interruptedLabel });
  }
  for (const turn of conversation.turns) {
    messages.push({ role: "user", text: turn.question });
    messages.push({ role: "assistant", text: turn.response });
  }
  if (conversation.pending) {
    messages.push({ role: "user", text: conversation.pending.question });
    if (conversation.pending.interrupted) {
      // 重开时未完成轮显示「中断」（用户停止显示「已停止」）。
      messages.push({ role: "status", text: interruptedLabel });
    } else if (!conversation.pending.error) {
      // 流式增量草稿逐字追加为助手消息；尚未有增量时只显示思考中状态。
      if (conversation.pending.streamedText) {
        messages.push({ role: "assistant", text: conversation.pending.streamedText });
      }
      messages.push({ role: "status", text: "正在思考…" });
    }
  }
  return { messages };
}

function buildFirstRoundStoppedView(
  request: Extract<PanelRequestState, { kind: "stopped" }>,
): ConversationView {
  const messages: ConversationMessageView[] = [];
  if (request.snapshot?.selectedText) {
    messages.push({ role: "user", text: request.snapshot.selectedText });
  }
  if (request.streamedText) {
    messages.push({ role: "assistant", text: request.streamedText });
  }
  messages.push({ role: "status", text: "已停止" });
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
  // 已停止：问题已作为用户消息进入对话流，入口表单隐藏（与成功一致）。
  if (isDirectQuestion && request.status === "stopped") {
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
  } else if (request.status === "stopped") {
    // 用户停止：保留已流式内容，显示「已停止」。
    if (request.streamedText) {
      messages.push({ role: "assistant", text: request.streamedText });
    }
    messages.push({ role: "status", text: "已停止" });
  }
  // 错误 / 缺配置状态由对话流内对应轮次位置的独立反馈区块呈现（见渲染层）。
  return { messages };
}

export function buildAiPanelView(
  panelState: PanelStateView,
  conversation: ReadonlyTemporaryConversation | null,
  materialContext?: MaterialContext,
): AiPanelView {
  const materialContextValue: MaterialContext = materialContext ?? {
    resolveDocumentTitle: () => null,
    isDocumentHidden: () => false,
  };
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
  const stoppedFirstRequest =
    panelState.request.kind === "stopped" && panelState.request.phase === "first"
      ? panelState.request
      : null;
  const stoppedFollowUp =
    panelState.request.kind === "stopped" && panelState.request.phase === "follow_up";
  const conversationView = directQuestionRequest
    ? buildDirectQuestionConversationView(directQuestionRequest)
    : firstRoundLoadingRequest
      ? buildFirstRoundLoadingView(firstRoundLoadingRequest)
      : stoppedFirstRequest
        ? buildFirstRoundStoppedView(stoppedFirstRequest)
        : buildConversationView(conversation, stoppedFollowUp ? "已停止" : "中断");
  const hasConversation = conversation !== null;
  // 材料权限已变化（隐藏材料 / 旧档案缺出处）：保留历史显示，但不可沿原上下文继续。
  const restrictionNotice = conversationRestrictionNotice(conversation);
  const isRestricted = restrictionNotice !== null;
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
    pendingError !== undefined && !isRestricted
      ? { message: pendingError.message, retryAvailable: true, editAvailable: true }
      : null;

  const hasPending = conversation !== null && conversation.pending !== null && !conversation.pending.interrupted;
  // 受限讨论禁用追问输入与发送入口；历史保留只读。
  const followUpForm = hasConversation ? { inputEnabled: !hasPending && !isRestricted } : null;

  const stoppedDirect =
    panelState.request.kind === "direct_question" && panelState.request.status === "stopped";
  const retryAvailable =
    !hasConversation &&
    (facts.errorMessage !== null || facts.configRequired || stoppedFirstRequest !== null || stoppedDirect);

  // 空状态欢迎语（D5）：无任何对话轮次（含直接提问进行中的统一轮次）且无进行中请求。
  const welcomeVisible = panelState.request.kind === "idle" && conversation === null;

  // “新建对话”仅在存在临时对话或存在任何非空闲请求（首轮预检/阻塞/加载/成功/失败/配置、
  // 追问或直接提问请求）时显示；空白直接提问 idle 状态隐藏。与 reducer 的
  // `hasEndableConversationWork` 语义一致（用户有“可结束的内容”才看到结束入口）。
  const newConversationVisible = hasConversation || panelState.request.kind !== "idle" || isRestricted;

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
    followUpStopped: stoppedFollowUp && !isRestricted,
    followUpForm,
    retryAvailable,
    directQuestion,
    newConversationVisible,
    saveError: panelState.saveError,
    restrictionNotice,
    material: buildMaterialView(conversation, materialContextValue),
    readingRequest: panelState.readingRequest
      ? {
          reason: panelState.readingRequest.reason,
          boundaryNotes: READING_REQUEST_BOUNDARY_NOTES,
        }
      : null,
    readingProgress: buildReadingProgressView(
      panelState,
      windowGenerating(panelState.request),
      materialContextValue,
    ),
    onDemandReadingEnabled: panelState.onDemandReadingEnabled ?? false,
  };
}

/** 讨论是否处于生成中（排队中尚无模型请求，不显示补读过程）。 */
function windowGenerating(request: PanelRequestState): boolean {
  if (request.kind === "loading") return !request.queued;
  if (request.kind === "direct_question") return request.status === "loading" && !request.queued;
  return false;
}
