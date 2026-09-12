import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";
import type {
  ConversationRecord,
  ConversationSummary,
  ConversationTurn,
  FirstRoundMaterial as ArchivedFirstRoundMaterial,
  MaterialProvenance,
} from "./conversation-archive.ts";
import { deriveConversationTitle } from "./conversation-archive.ts";

export interface SuccessfulFollowUpTurn {
  id: number;
  question: string;
  response: string;
}

export interface PendingFollowUpTurn {
  id: number;
  question: string;
  /** 流式增量草稿（begin 时初始 ""，逐字追加；done 全文到达后整体替换）。 */
  streamedText?: string;
  error?: GenerateAiError;
  /** 重开时未完成轮被打上「中断」标记：显示为中断终态，不自动重发。 */
  interrupted?: boolean;
}

/**
 * 选区召唤和直接提问统一进入同一讨论。
 */
export type FirstRoundMaterial =
  | Extract<GenerateAiRequest, { kind: "summon" }>
  | Extract<GenerateAiRequest, { kind: "direct_question" }>;

/**
 * 讨论材料权限受限的原因（controlled-story-read-visibility 任务 5.2/5.4）：
 * - `hidden_material`：出处引用后来被关闭 AI 可见性的文档；
 * - `missing_provenance`：旧档案缺少材料出处，按保守策略无法确认所用材料是否仍可查看。
 */
export type RestrictionReason = "hidden_material" | "missing_provenance";

/**
 * 一个讨论的完整显示数据（首轮冻结材料、首轮回应与后续问答轮次），
 * 是显示与崩溃恢复重放的运行期事实源。`id` 是全局唯一 `conversation_id`。
 */
export interface TemporaryConversation {
  id: string;
  createdAt: string;
  /** 首轮冻结选区锚点；直接提问无选区时为 null。 */
  anchor: SelectionSnapshot | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  /** 首轮回应是否在生成途中被打断（重开档案时标记）；false/undefined 表示首轮已完成。 */
  firstRoundInterrupted?: boolean;
  turns: SuccessfulFollowUpTurn[];
  pending: PendingFollowUpTurn | null;
  /** 用户自定义标题；null/空白表示未重命名，回退到派生标题。 */
  customTitle?: string | null;
  /** 置顶标记；缺失表示未置顶。 */
  pinned?: boolean;
  /** 材料权限已变化（可查看但不可沿原上下文继续 / 重放）；缺省为 false。 */
  restricted?: boolean;
  /** 受限原因；仅在 `restricted` 为 true 时有意义。 */
  restrictionReason?: RestrictionReason;
  /**
   * 已知材料出处（重开档案时保留原档案出处；新建讨论时缺省，保存时由锚点派生）。
   * `undefined` 仅在「旧档案缺出处」时出现（由 `restrictionReason` 区分）。
   */
  provenance?: MaterialProvenance[];
}

export type ReadonlyTemporaryConversation = Readonly<{
  id: string;
  createdAt: string;
  anchor: Readonly<SelectionSnapshot> | null;
  initialUserMaterial: Readonly<FirstRoundMaterial>;
  firstResponse: string;
  /** 首轮回应是否在生成途中被打断（重开档案时标记）；false/undefined 表示首轮已完成。 */
  firstRoundInterrupted?: boolean;
  turns: ReadonlyArray<Readonly<SuccessfulFollowUpTurn>>;
  pending: Readonly<PendingFollowUpTurn> | null;
  customTitle?: string | null;
  pinned?: boolean;
  restricted?: boolean;
  restrictionReason?: RestrictionReason;
  provenance?: ReadonlyArray<Readonly<MaterialProvenance>>;
}>;

/**
 * 讨论集合中的单个条目：讨论自身的显示请求状态（首轮在途或已建立对话的追问态）、
 * 已建立对话本体（首轮成功前为 null）与首轮材料。讨论的迟到结果按其 `id` 隔离。
 */
export interface Discussion {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly focusDocumentId: string | null;
  readonly focusDocumentTitle: string | null;
  readonly request: import("./ai-panel-request-state.ts").PanelRequestState;
  readonly conversation: TemporaryConversation | null;
  readonly pendingFirstRequest: FirstRoundMaterial | null;
  /** 首轮冻结选区锚点；直接提问无选区时为 null。 */
  readonly anchor: SelectionSnapshot | null;
}

export function frozenSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({ ...snapshot });
}

/** 把请求形态的首轮材料转成档案形态（召唤归一为空问题 + 选区）。 */
export function firstRoundMaterialToArchive(
  material: FirstRoundMaterial,
): ArchivedFirstRoundMaterial {
  if (material.kind === "summon") {
    return { kind: "summon", question: "", selection_text: material.selected_text };
  }
  return {
    kind: "direct_question",
    question: material.question,
    selection_text: material.selected_text ?? null,
  };
}

/** 把档案形态的首轮材料还原为请求形态（供重开与重放使用）。 */
export function firstRoundMaterialFromArchive(
  material: ArchivedFirstRoundMaterial,
): FirstRoundMaterial {
  if (material.kind === "summon") {
    return { kind: "summon", selected_text: material.selection_text ?? "" };
  }
  return {
    kind: "direct_question",
    question: material.question,
    ...(material.selection_text !== null ? { selected_text: material.selection_text } : {}),
  };
}

/**
 * 从冻结选区锚点派生最小材料出处元数据（不复制正文）。
 * 当前特性只有「冻结选区」一种进入模型上下文的材料；无选区 / 无来源文档时为空数组。
 * 版本身份在当前快照契约尚未携带版本时记 null，待 selection-ai-summon 任务 4 补齐。
 */
export function materialProvenanceFromAnchor(
  anchor: SelectionSnapshot | null,
): MaterialProvenance[] {
  if (!anchor || !anchor.documentId || !anchor.selectedText.trim()) return [];
  return [
    {
      document_id: anchor.documentId,
      material_type: "selection",
      document_version: anchor.documentVersion ?? null,
      turn_index: 0,
      entered_model_context: true,
    },
  ];
}

/** 出处条目是否已因权限关闭被锁存（`material_type: "revoked"`，任务 5.4）。 */
export function isRevokedMaterial(p: MaterialProvenance): boolean {
  return p.material_type === "revoked";
}

/**
 * 判定一份档案是否因材料权限变化而受限（controlled-story-read-visibility 任务 5.2/5.4）：
 * - 旧档案缺少 `provenance` 字段 → 保守受限（无法确认所用材料是否仍可查看，不自动重放）；
 * - 出处引用了当前被关闭 AI 可见性的文档 → 受限；
 * - 出处含锁存标记（`revoked`）→ 永久受限（不因重新开启可见性解除）。
 * `hiddenDocumentIds` 是「不允许 AI 查看」的文档 ID 集合；后端可见性 API 未接入时传空集
 * （不引入任何受限，行为与旧版一致，见集成点注释）。
 */
export function isConversationMaterialRestricted(
  record: ConversationRecord | ConversationSummary,
  hiddenDocumentIds: ReadonlySet<string>,
): boolean {
  if (record.provenance === undefined || record.provenance === null) return true;
  return record.provenance.some(
    (p) => isRevokedMaterial(p) || hiddenDocumentIds.has(p.document_id),
  );
}

/** 受限原因：旧档案缺出处 / 出处引用隐藏文档 / 出处含锁存标记。 */
export function restrictionReasonOf(
  record: ConversationRecord | ConversationSummary,
  hiddenDocumentIds: ReadonlySet<string>,
): RestrictionReason | undefined {
  if (record.provenance === undefined || record.provenance === null) return "missing_provenance";
  return record.provenance.some(
    (p) => isRevokedMaterial(p) || hiddenDocumentIds.has(p.document_id),
  )
    ? "hidden_material"
    : undefined;
}

/** 材料权限已变化的受限讨论提示（不泄露隐藏文件名称 / 身份 / 路径）。 */
export const HIDDEN_MATERIAL_RESTRICTION_NOTICE =
  "该讨论曾使用后来已隐藏的文件，无法沿原上下文继续。请新建对话继续。";

/** 旧档案缺少材料出处的保守提示。 */
export const MISSING_PROVENANCE_RESTRICTION_NOTICE =
  "该讨论缺少材料出处记录，无法确认所用材料是否仍可查看。请新建对话继续。";

/** 返回受限讨论的中文提示；未受限返回 null。接受可变或只读对话视图。 */
export function conversationRestrictionNotice(
  conversation: { restricted?: boolean; restrictionReason?: RestrictionReason } | null,
): string | null {
  if (!conversation?.restricted) return null;
  return conversation.restrictionReason === "missing_provenance"
    ? MISSING_PROVENANCE_RESTRICTION_NOTICE
    : HIDDEN_MATERIAL_RESTRICTION_NOTICE;
}

/**
 * 讨论保存时应写出的材料出处：
 * - 旧档案缺出处（`missing_provenance`）→ `undefined`（保持缺省，不悄悄升级为「无材料」）；
 * - 重开档案已携带出处 → 原样保留（权限变化后重存不丢失影响关系）；
 * - 新建讨论 → 由冻结选区锚点派生。
 */
export function conversationProvenanceForArchive(
  conversation: TemporaryConversation,
): MaterialProvenance[] | undefined {
  if (conversation.restrictionReason === "missing_provenance") return undefined;
  const provenance = conversation.provenance ?? materialProvenanceFromAnchor(conversation.anchor);
  // 锁存：受限讨论（hidden_material）重存时把出处标记为 `revoked`，使重新开启可见性后
  // 重开该讨论也不会被当前可见性重算解除（任务 5.4）。
  if (conversation.restrictionReason === "hidden_material") {
    return provenance.map((p) => (isRevokedMaterial(p) ? p : { ...p, material_type: "revoked" }));
  }
  return provenance;
}

/**
 * 崩溃恢复 / 重放前按当前 `hiddenDocumentIds` 重算讨论材料限制（任务 5.5）。
 *
 * 与开档时固化的 `restricted` 不同，这里用「此刻」的隐藏文档集合重新判断当前 provenance：
 * - 旧档案缺出处（`missing_provenance`）→ 保守受限（无法确认所用材料是否仍可查看，不重放）；
 * - 出处（档案出处，或新建讨论由冻结锚点派生）引用了当前被隐藏的文档 → 受限（不重放）；
 * - 无材料（无选区直接提问）或出处文档仍可见 → 不受限，可恢复重放。
 *
 * 这样驱动进程丢失后，恢复过滤不会把打开后新隐藏的材料通过历史重放再次发送给 DSH。
 */
export function isConversationRestrictedForRecovery(
  conversation: TemporaryConversation,
  hiddenDocumentIds: ReadonlySet<string>,
): boolean {
  if (conversation.restrictionReason === "missing_provenance") return true;
  // 已锁存的受限讨论（restricted / revoked 出处）永久不可重放，不因重新开启可见性解除。
  if (conversation.restricted) return true;
  const provenance = conversation.provenance ?? materialProvenanceFromAnchor(conversation.anchor);
  return provenance.some((p) => isRevokedMaterial(p) || hiddenDocumentIds.has(p.document_id));
}

/**
 * 权限变更后重算并锁存单个讨论的材料限制（任务 5.2/5.4）：
 * - 已受限（`restricted`）的讨论保持受限（单调，不因重新开启可见性解除）；
 * - 未受限但出处引用了当前被隐藏的文档 → 标记受限并返回新对象；
 * - 无材料 / 出处文档仍可见 → 原样返回（同一引用，调用方据此判定无变化）。
 */
export function latchConversationRestriction(
  conversation: TemporaryConversation,
  hiddenDocumentIds: ReadonlySet<string>,
): TemporaryConversation {
  if (conversation.restricted) return conversation;
  const provenance = conversation.provenance ?? materialProvenanceFromAnchor(conversation.anchor);
  if (!provenance.some((p) => hiddenDocumentIds.has(p.document_id))) return conversation;
  return { ...conversation, restricted: true, restrictionReason: "hidden_material" };
}

export function createConversationFromFirstSuccess(
  conversationId: string,
  createdAt: string,
  snapshot: SelectionSnapshot | null,
  firstRequest: FirstRoundMaterial,
  response: string,
): TemporaryConversation {
  const anchor = snapshot ? frozenSnapshot(snapshot) : null;
  return {
    id: conversationId,
    createdAt,
    anchor,
    initialUserMaterial: Object.freeze({ ...firstRequest }),
    firstResponse: response,
    firstRoundInterrupted: false,
    turns: [],
    pending: null,
    customTitle: null,
    pinned: false,
  };
}

export function beginConversationFollowUp(
  conversation: TemporaryConversation,
  question: string,
  turnId: number,
): { conversation: TemporaryConversation; turnId: number } | { conversation: null; turnId: null } {
  if (!question.trim()) return { conversation: null, turnId: null };
  // 材料权限受限的讨论不可沿原上下文追问（须新建干净讨论）。
  if (conversation.restricted) return { conversation: null, turnId: null };
  // 已有进行中的待答轮次时拒绝；已中断（重开）的待答轮可被新问题替换。
  if (conversation.pending && !conversation.pending.interrupted) {
    return { conversation: null, turnId: null };
  }
  return {
    conversation: { ...conversation, pending: { id: turnId, question, streamedText: "" } },
    turnId,
  };
}

export function succeedConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
  response: string,
): { conversation: TemporaryConversation | null; turn: SuccessfulFollowUpTurn | null } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, turn: null };
  }
  const turn: SuccessfulFollowUpTurn = {
    id: pending.id,
    question: pending.question,
    response,
  };
  return {
    conversation: {
      ...conversation,
      turns: [...conversation.turns, turn],
      pending: null,
    },
    turn,
  };
}

export function failConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
  error: GenerateAiError,
): { conversation: TemporaryConversation | null; ok: boolean } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, ok: false };
  }
  return {
    conversation: { ...conversation, pending: { ...pending, error } },
    ok: true,
  };
}

export function acceptEditedConversationFollowUp(
  conversation: TemporaryConversation | null,
  question: string,
): { conversation: TemporaryConversation | null; turnId: number | null } {
  const pending = conversation?.pending;
  if (!conversation || conversation.restricted || !pending?.error || !question.trim()) {
    return { conversation, turnId: null };
  }
  return {
    conversation: {
      ...conversation,
      pending: { id: pending.id, question, streamedText: "" },
    },
    turnId: pending.id,
  };
}

export function cancelConversationFollowUp(
  conversation: TemporaryConversation | null,
  turnId: number,
): { conversation: TemporaryConversation | null; response: string | null } {
  const pending = conversation?.pending;
  if (!conversation || pending?.id !== turnId) {
    return { conversation, response: null };
  }
  const response =
    conversation.turns.length > 0
      ? conversation.turns[conversation.turns.length - 1].response
      : conversation.firstResponse;
  return {
    conversation: { ...conversation, pending: null },
    response,
  };
}

export function acceptConversationFollowUpRetry(
  conversation: TemporaryConversation | null,
): { conversation: TemporaryConversation | null; turnId: number | null } {
  const pending = conversation?.pending;
  if (!conversation || conversation.restricted || !pending?.error) {
    return { conversation, turnId: null };
  }
  return {
    conversation: {
      ...conversation,
      pending: { id: pending.id, question: pending.question, streamedText: "" },
    },
    turnId: pending.id,
  };
}

/**
 * 追问请求的来源身份（作品 / 文档 / 版本身份 + 未保存正文快照）。
 * 身份三要素必须一起透传：后端对「有选区或有快照」的请求要求三者齐全，缺一即拒。
 * 优先取冻结锚点（`conversation.anchor`，SelectionSnapshot 携带作品/版本身份），
 * 其次取首轮材料（`initialUserMaterial` 上的 `document_id` / `project_path` /
 * `document_version`）；两者都缺省（无选区直接提问）时返回空对象，保持无身份。
 */
export function followUpIdentityOf(
  conversation: TemporaryConversation,
): {
  document_id?: string;
  project_path?: string;
  document_version?: string;
  snapshot?: string;
} {
  const anchor = conversation.anchor;
  const material = conversation.initialUserMaterial;
  const documentId = anchor?.documentId ?? material.document_id;
  const projectPath = anchor?.projectPath ?? material.project_path;
  const documentVersion = anchor?.documentVersion ?? material.document_version;
  const snapshot = material.snapshot ?? anchor?.bodySnapshot;
  // 无选区直接提问（无 documentId、无来源身份）保持无身份；其余至少具备文档身份。
  if (documentId === undefined) return {};
  // 身份三要素齐全才透传（缺任一来源身份时后端会拒绝有材料请求）；
  // snapshot 存在时必须三项身份一起透传。
  if (projectPath === undefined || documentVersion === undefined) {
    return {};
  }
  return {
    document_id: documentId,
    project_path: projectPath,
    document_version: documentVersion,
    ...(snapshot !== undefined ? { snapshot } : {}),
  };
}

/** 只有成功轮次进入追问 payload；待回答轮次只取 question 本身。 */
export function buildFollowUpRequest(
  conversation: TemporaryConversation,
  question: string,
): Extract<GenerateAiRequest, { kind: "follow_up" }> {
  const material = conversation.initialUserMaterial;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (material.kind === "direct_question") {
    messages.push({ role: "user", content: material.question });
  }
  messages.push({ role: "assistant", content: conversation.firstResponse });
  for (const turn of conversation.turns) {
    messages.push({ role: "user" as const, content: turn.question });
    messages.push({ role: "assistant" as const, content: turn.response });
  }
  messages.push({ role: "user", content: question });
  return {
    kind: "follow_up",
    selected_text: material.selected_text ?? "",
    ...(material.kind === "direct_question"
      ? { origin: "direct_question" as const }
      : {}),
    ...followUpIdentityOf(conversation),
    messages,
  };
}

export function followUpRequestOf(
  conversation: TemporaryConversation | null,
): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
  if (!conversation?.pending) return null;
  if (conversation.restricted) return null;
  return buildFollowUpRequest(conversation, conversation.pending.question);
}

export function followUpRequestForQuestionOf(
  conversation: TemporaryConversation | null,
  question: string,
): Extract<GenerateAiRequest, { kind: "follow_up" }> | null {
  if (!conversation?.pending || !conversation.pending.error || !question.trim()) return null;
  if (conversation.restricted) return null;
  return buildFollowUpRequest(conversation, question);
}

export function followUpAvailableOf(conversation: TemporaryConversation | null): boolean {
  if (conversation === null) return false;
  // 材料权限受限的讨论不可沿原上下文继续。
  if (conversation.restricted) return false;
  return conversation.pending === null || conversation.pending.interrupted === true;
}

export function conversationIdentityOf(
  conversation: TemporaryConversation | null,
): { conversationId: string; turnId?: number } | null {
  if (!conversation) return null;
  return conversation.pending
    ? { conversationId: conversation.id, turnId: conversation.pending.id }
    : { conversationId: conversation.id };
}

export function retryFollowUpQuestionOf(conversation: TemporaryConversation | null): string | null {
  if (conversation?.restricted) return null;
  return conversation?.pending?.error ? conversation.pending.question : null;
}

/** 深冻结的防御性只读视图；外部拿到后无法反向改写内部状态。 */
export function readonlyConversationView(
  conversation: TemporaryConversation | null,
): ReadonlyTemporaryConversation | null {
  if (!conversation) return null;
  const turns = conversation.turns.map((turn) => Object.freeze({ ...turn }));
  const pending = conversation.pending
    ? Object.freeze({
        ...conversation.pending,
        error: conversation.pending.error
          ? Object.freeze({ ...conversation.pending.error })
          : undefined,
      })
    : null;
  return Object.freeze({
    id: conversation.id,
    createdAt: conversation.createdAt,
    anchor: conversation.anchor ? Object.freeze({ ...conversation.anchor }) : null,
    initialUserMaterial: Object.freeze({ ...conversation.initialUserMaterial }),
    firstResponse: conversation.firstResponse,
    firstRoundInterrupted: conversation.firstRoundInterrupted,
    turns: Object.freeze(turns),
    pending,
    customTitle: conversation.customTitle,
    pinned: conversation.pinned,
    restricted: conversation.restricted,
    restrictionReason: conversation.restrictionReason,
    provenance: conversation.provenance
      ? Object.freeze(conversation.provenance.map((p) => Object.freeze({ ...p })))
      : undefined,
  });
}

/** 把讨论投影为档案保存契约（首轮材料 + 线性轮次）。 */
export function buildConversationRecord(
  conversation: TemporaryConversation,
  focusDocumentId: string | null,
  focusDocumentTitle: string | null,
): ConversationRecord {
  const material = firstRoundMaterialToArchive(conversation.initialUserMaterial);
  const turns: ConversationTurn[] = [];
  // 首轮从未产出回应且带中断标记时，档案保留 pending（重开可再次识别为中断）；
  // 一旦有真实回应或已完成，仍为 done。
  const firstStatus: ConversationTurn["status"] =
    conversation.firstRoundInterrupted && conversation.firstResponse === ""
      ? "pending"
      : "done";
  turns.push({ role: "assistant", text: conversation.firstResponse, status: firstStatus });
  for (const turn of conversation.turns) {
    turns.push({ role: "user", text: turn.question, status: "done" });
    turns.push({ role: "assistant", text: turn.response, status: "done" });
  }
  if (conversation.pending) {
    const pending = conversation.pending;
    turns.push({ role: "user", text: pending.question, status: "done" });
    const status: ConversationTurn["status"] = pending.error
      ? "failed"
      : pending.interrupted
        ? "cancelled"
        : "pending";
    turns.push({ role: "assistant", text: pending.streamedText ?? "", status });
  }
  return {
    version: 1,
    conversation_id: conversation.id,
    created_at: conversation.createdAt,
    updated_at: conversation.createdAt,
    focus_document_id: focusDocumentId,
    focus_document_title: focusDocumentTitle,
    first_round_material: material,
    turns,
    ...(conversation.customTitle?.trim() ? { title: conversation.customTitle } : {}),
    ...(conversation.pinned ? { pinned: true } : {}),
    // 材料出处：旧档案缺出处保持缺省；重开档案保留原出处；新建讨论由锚点派生。
    ...(() => {
      const provenance = conversationProvenanceForArchive(conversation);
      return provenance !== undefined ? { provenance } : {};
    })(),
  };
}

/**
 * 从档案重建讨论显示数据（重开用）。未完成轮（status 为 pending）转为「中断」，
 * 不自动重发；失败轮保留错误供查看。首轮 assistant 回应在召唤时为 turns[0]，
 * 直接提问时首轮 user 轮在前，assistant 回应为 turns[1]。
 */
export function conversationFromRecord(
  record: ConversationRecord | ConversationSummary,
  options: { hiddenDocumentIds?: ReadonlySet<string> } = {},
): TemporaryConversation {
  const hiddenDocumentIds = options.hiddenDocumentIds ?? new Set<string>();
  const restricted = isConversationMaterialRestricted(record, hiddenDocumentIds);
  const restrictionReason = restrictionReasonOf(record, hiddenDocumentIds);
  const material = firstRoundMaterialFromArchive(record.first_round_material);
  const turns = record.turns;
  const first = turns[0];

  // 首轮 assistant 轮：召唤时即 turns[0]；直接提问时首轮 user 轮在前，assistant 轮在 turns[1]。
  const firstAssistantIndex = first && first.role === "user" ? 1 : 0;
  const firstAssistant = turns[firstAssistantIndex];
  const hasFirstAssistant = firstAssistant !== undefined && firstAssistant.role === "assistant";
  const firstResponse = hasFirstAssistant ? firstAssistant.text : "";
  // 首轮 assistant 轮未完成（pending / cancelled / failed）视为生成途中被打断；done 表示已完成。
  const firstRoundInterrupted = hasFirstAssistant && firstAssistant.status !== "done";

  const followUps: SuccessfulFollowUpTurn[] = [];
  let pending: PendingFollowUpTurn | null = null;
  let nextTurnId = 1;

  // 从首轮 assistant 回应之后，按 user/assistant 交替重建成功轮次与未完成轮。
  let index = firstAssistantIndex + 1;
  while (index < turns.length) {
    const user = turns[index];
    if (user.role !== "user") {
      index += 1;
      continue;
    }
    const assistant = turns[index + 1];
    if (assistant && assistant.role === "assistant" && user.status === "done") {
      if (assistant.status === "done") {
        followUps.push({ id: nextTurnId, question: user.text, response: assistant.text });
        nextTurnId += 1;
      } else {
        // 未完成轮：pending / cancelled → 中断；failed → 显示中断错误。
        pending = assistant.status === "failed"
          ? { id: nextTurnId, question: user.text, streamedText: assistant.text, error: { code: "service" as const, message: "中断" } }
          : { id: nextTurnId, question: user.text, streamedText: assistant.text, interrupted: true };
      }
      index += 2;
      continue;
    }
    // 孤立的 user 轮（生成中途崩溃）：显示中断。
    pending = { id: nextTurnId, question: user.text, streamedText: "", interrupted: true };
    index += 1;
  }

  return {
    id: record.conversation_id,
    createdAt: record.created_at,
    anchor: null,
    initialUserMaterial: Object.freeze({ ...material }),
    firstResponse,
    firstRoundInterrupted,
    turns: followUps,
    pending,
    customTitle: record.title ?? null,
    pinned: record.pinned ?? false,
    restricted,
    restrictionReason,
    provenance: record.provenance,
  };
}

/**
 * 由讨论构建档案保存契约，兼容首轮在途（尚无首轮回应）与已建立对话两种状态。
 * 首轮在途时写入一条 pending 的 assistant 轮；终态由后续 `conversationSave` 原子更新。
 */
export function buildDiscussionRecord(discussion: Discussion): ConversationRecord {
  if (discussion.conversation) {
    return buildConversationRecord(
      discussion.conversation,
      discussion.focusDocumentId,
      discussion.focusDocumentTitle,
    );
  }
  const material = firstRoundMaterialToArchive(
    discussion.pendingFirstRequest ?? {
      kind: "summon" as const,
      selected_text: discussion.anchor?.selectedText ?? "",
    },
  );
  const turns: ConversationTurn[] = [];
  if (material.kind === "direct_question") {
    turns.push({ role: "user", text: material.question, status: "done" });
  }
  turns.push({ role: "assistant", text: "", status: "pending" });
  return {
    version: 1,
    conversation_id: discussion.id,
    created_at: discussion.createdAt,
    updated_at: discussion.updatedAt,
    focus_document_id: discussion.focusDocumentId,
    focus_document_title: discussion.focusDocumentTitle,
    first_round_material: material,
    turns,
    provenance: materialProvenanceFromAnchor(discussion.anchor),
  };
}

/** 由讨论生成会话列表条目（标题取首轮问题/召唤文本截断，空则时间）。 */
export function summaryOf(  conversation: TemporaryConversation,
  focusDocumentId: string | null,
  focusDocumentTitle: string | null,
): ConversationSummary {
  const material = firstRoundMaterialToArchive(conversation.initialUserMaterial);
  const lastStatus: ConversationSummary["last_status"] = conversation.pending
    ? conversation.pending.error
      ? "failed"
      : "pending"
    : conversation.firstRoundInterrupted && conversation.firstResponse === ""
      ? "pending"
      : "done";
  return {
    conversation_id: conversation.id,
    title: conversation.customTitle?.trim()
      ? conversation.customTitle
      : deriveConversationTitle(material, conversation.createdAt),
    created_at: conversation.createdAt,
    updated_at: conversation.createdAt,
    last_status: lastStatus,
    focus_document_id: focusDocumentId,
    focus_document_title: focusDocumentTitle,
    first_round_material: material,
    turns: buildConversationRecord(conversation, focusDocumentId, focusDocumentTitle).turns,
    custom_title: conversation.customTitle ?? null,
    pinned: conversation.pinned ?? false,
    ...(() => {
      const provenance = conversationProvenanceForArchive(conversation);
      return provenance !== undefined ? { provenance } : {};
    })(),
  };
}
