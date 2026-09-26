import {
  acceptConversationFollowUpRetry,
  acceptEditedConversationFollowUp,
  beginConversationFollowUp,
  cancelConversationFollowUp,
  isConversationMaterialRestricted,
  summaryOf,
  createConversationFromFirstSuccess,
  failConversationFollowUp,
  frozenSnapshot,
  latchConversationRestriction,
  materialProvenanceFromAnchor,
  succeedConversationFollowUp,
  type Discussion,
  type FirstRoundMaterial,
} from "./ai-panel-conversation.ts";
import {
  cancelFollowUpSuccessRequest,
  configurationRequiredRequest,
  directQuestionLoadingRequest,
  firstBlockedRequest,
  firstErrorRequest,
  firstLoadingRequest,
  firstPreviewRequest,
  firstRetryLoadingRequest,
  firstSuccessRequest,
  followUpErrorRequest,
  followUpLoadingRequest,
  followUpSuccessRequest,
  idleRequest,
  recoveringRequest,
  type PanelRequestState,
  type PanelVisibility,
} from "./ai-panel-request-state.ts";
import type { SelectionSnapshot } from "./types.ts";
import type { ConversationSummary } from "./conversation-archive.ts";
import { sameSelectionSnapshot } from "./shared-storage-and-selection-identity.ts";
import type {
  AiPanelEvent,
  PendingReadingRequest,
  WindowPlacement,
} from "./ai-panel-events.ts";

// 事件与配套载荷类型的单一事实源在 ai-panel-events.ts；此处重导出保持既有
// 消费方（ai-panel-state.ts / ai-panel-conversation.ts 内联类型导入）零改动。
export type {
  AiPanelEvent,
  PendingReadingRequest,
  ReadingProgress,
  WindowPlacement,
} from "./ai-panel-events.ts";

/**
 * AI 面板核心状态的显式数据模型（reducer 的输入 / 输出）。
 *
 * 讨论集合模型（change: add-conversation-persistence-and-isolation）：
 * - `discussions`：当前作品内各讨论的完整运行期数据（身份、时间、关注文档、请求状态、
 *   已建立对话、首轮材料与锚点）。
 * - `windows`：当前打开的窗口集合（以讨论 id 为键，一讨论至多一个窗口）；
 *   `focusedConversationId`：当前聚焦窗口的讨论，替代旧单一 `activeConversationId`
 *   的显示语义。窗口几何（位置/尺寸/层叠）留在窗口层，不进状态、不持久化。
 * - `previewRequest`：首轮预检预览 / 阻塞提示等瞬态请求状态（不归属任何讨论）。
 * - `generation`：单调递增的代次计数器（ABA 安全：`newConversation` / 首轮接受 / reset 推进）。
 * - `nextTurnId`：讨论内追问轮次的单调编号。
 * - `saveError`：讨论档案保存失败时对用户可见的提示位。
 */

export interface AiPanelCoreState {
  readonly visibility: PanelVisibility;
  readonly previewRequest: PanelRequestState | null;
  readonly discussions: ReadonlyMap<string, Discussion>;
  readonly summaries: ReadonlyMap<string, ConversationSummary>;
  readonly deletedIds: ReadonlySet<string>;
  readonly opening: ReadonlyMap<string, { readonly error: string | null }>;
  readonly saveErrors: ReadonlyMap<string, string>;
  /** 当前打开的窗口（键为讨论 id，一讨论至多一个窗口）。 */
  readonly windows: ReadonlyMap<string, WindowPlacement>;
  /** 当前聚焦窗口的讨论；无窗口时为 null。 */
  readonly focusedConversationId: string | null;
  readonly generation: number;
  readonly nextTurnId: number;
  readonly saveError: string | null;
  /** 各讨论的直接提问未发送草稿（键为讨论 id；缺省为空串）。 */
  readonly directQuestionDrafts: ReadonlyMap<string, string>;
  /** 当前待附带的选区重点材料；无选区时为 null。 */
  readonly pendingSelection: SelectionSnapshot | null;
  /** 用户主动移除后应保持忽略的选区身份；新选区出现时清除。 */
  readonly ignoredSelection: SelectionSnapshot | null;
}

export function initialAiPanelCoreState(): AiPanelCoreState {
  return {
    visibility: "closed",
    previewRequest: null,
    discussions: new Map(),
    summaries: new Map(),
    deletedIds: new Set(),
    opening: new Map(),
    saveErrors: new Map(),
    windows: new Map(),
    focusedConversationId: null,
    generation: 1,
    nextTurnId: 1,
    saveError: null,
    directQuestionDrafts: new Map(),
    pendingSelection: null,
    ignoredSelection: null,
  };
}

function activeDiscussion(state: AiPanelCoreState): Discussion | null {
  if (state.focusedConversationId === null) return null;
  return state.discussions.get(state.focusedConversationId) ?? null;
}

function discussionById(state: AiPanelCoreState, id: string): Discussion | null {
  return state.discussions.get(id) ?? null;
}

function setDiscussion(state: AiPanelCoreState, discussion: Discussion): AiPanelCoreState {
  return { ...state, discussions: new Map(state.discussions).set(discussion.id, discussion) };
}

/** 当前面板显示的请求状态：瞬态预览优先，其次为当前讨论的请求，最后回退 idle。 */
export function activeRequestOf(state: AiPanelCoreState): PanelRequestState {
  if (state.previewRequest) return state.previewRequest;
  return activeDiscussion(state)?.request ?? idleRequest();
}

function isFirstRoundInFlight(request: PanelRequestState): boolean {
  if (request.kind === "loading") return request.phase !== "follow_up";
  return request.kind === "first_preview" || request.kind === "first_blocked";
}

/** 讨论是否为空（未接受首轮）：无对话、无待首轮材料、请求为空闲。 */
function isEmptyDiscussion(discussion: Discussion): boolean {
  return (
    discussion.conversation === null &&
    discussion.pendingFirstRequest === null &&
    discussion.request.kind === "idle"
  );
}

/** 在目标讨论上创建首轮成功后的对话，返回更新后的讨论。 */
function applyFirstSuccess(discussion: Discussion, response: string): Discussion {
  const material = discussion.pendingFirstRequest ?? {
    kind: "summon" as const,
    selected_text: discussion.anchor?.selectedText ?? "",
  };
  const created = createConversationFromFirstSuccess(
    discussion.id,
    discussion.createdAt,
    discussion.anchor,
    material,
    response,
  );
  // 首轮在途期间允许的按需补读授权随对话本体落档（授权属于讨论）。
  created.onDemandReadingGrant = discussion.onDemandReadingGrant ?? null;
  return {
    ...discussion,
    updatedAt: discussion.createdAt,
    request: firstSuccessRequest(created.anchor, response, discussion.id),
    conversation: created,
    pendingFirstRequest: null,
  };
}

/**
 * 纯状态迁移：`(state, event) -> state`，无副作用、无通知。
 *
 * 被拒绝的非法迁移返回与输入相同的引用（`next === state` 即未变化）；
 * 每次接受的迁移都返回新的状态对象，字段按事件精确替换。
 */
export function reduceAiPanelState(
  state: AiPanelCoreState,
  event: AiPanelEvent,
): AiPanelCoreState {
  switch (event.type) {
    case "preview_first_request": {
      return {
        ...state,
        visibility: "open",
        previewRequest: firstPreviewRequest(frozenSnapshot(event.snapshot)),
      };
    }
    case "block_first_request": {
      return {
        ...state,
        visibility: "open",
        previewRequest: firstBlockedRequest(frozenSnapshot(event.snapshot)),
      };
    }
    case "begin_request": {
      const anchor = frozenSnapshot(event.snapshot);
      const material = event.firstRequest ?? { kind: "summon" as const, selected_text: anchor.selectedText };
      const current = activeDiscussion(state);
      let discussion: Discussion;
      if (current && isEmptyDiscussion(current)) {
        // 复用空讨论：空讨论尚无任何材料，按本次发起重新绑定关注文档（阶段五 A）。
        discussion = {
          ...current,
          request: firstLoadingRequest(anchor, current.id),
          anchor,
          pendingFirstRequest: material,
          focusDocumentId: event.focusDocumentId,
          focusDocumentTitle: event.focusDocumentTitle,
        };
      } else {
        discussion = {
          id: event.conversationId,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
          focusDocumentId: event.focusDocumentId,
          focusDocumentTitle: event.focusDocumentTitle,
          request: firstLoadingRequest(anchor, event.conversationId),
          conversation: null,
          anchor,
          pendingFirstRequest: material,
          onDemandReadingGrant: null,
          pendingReadingRequest: null,
          readingProgress: null,
        };
      }
      return {
        ...state,
        visibility: "open",
        previewRequest: null,
        discussions: new Map(state.discussions).set(discussion.id, discussion),
        windows: new Map(state.windows).set(discussion.id, "docked"),
        focusedConversationId: discussion.id,
        generation: state.generation + 1,
      };
    }
    case "succeed": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      const blockedPreview = state.previewRequest?.kind === "first_blocked";
      if (request.kind === "loading" && request.phase === "follow_up") return state;
      if (request.kind !== "loading" && !blockedPreview) return state;
      return {
        ...state,
        previewRequest: null,
        discussions: new Map(state.discussions).set(
          discussion.id,
          applyFirstSuccess(discussion, event.response),
        ),
      };
    }
    case "fail": {
      const discussion = discussionById(state, event.conversationId);
      if (discussion) {
        const request = discussion.request;
        if (!isFirstRoundInFlight(request)) return state;
        const identity = request.kind === "loading" ? request : null;
        return setDiscussion(state, {
          ...discussion,
          request: firstErrorRequest(frozenSnapshot(event.snapshot), event.error, identity),
        });
      }
      // 无讨论（旧式预检预览）：仅在瞬态预览态接受失败。
      if (state.previewRequest && isFirstRoundInFlight(state.previewRequest)) {
        return {
          ...state,
          previewRequest: firstErrorRequest(frozenSnapshot(event.snapshot), event.error, null),
        };
      }
      return state;
    }
    case "require_configuration": {
      const discussion = discussionById(state, event.conversationId);
      if (discussion) {
        const request = discussion.request;
        if (!isFirstRoundInFlight(request)) return state;
        const identity = request.kind === "loading" ? request : null;
        return setDiscussion(state, {
          ...discussion,
          request: configurationRequiredRequest(
            frozenSnapshot(event.snapshot),
            identity?.conversationId,
          ),
        });
      }
      if (state.previewRequest && isFirstRoundInFlight(state.previewRequest)) {
        return {
          ...state,
          previewRequest: configurationRequiredRequest(frozenSnapshot(event.snapshot)),
        };
      }
      return state;
    }
    case "begin_follow_up": {
      const discussion = activeDiscussion(state);
      const conversation = discussion?.conversation;
      if (!discussion || !conversation) return state;
      const outcome = beginConversationFollowUp(conversation, event.question, state.nextTurnId);
      if (outcome.conversation === null) return state;
      return {
        ...state,
        nextTurnId: state.nextTurnId + 1,
        discussions: new Map(state.discussions).set(discussion.id, {
          ...discussion,
          conversation: outcome.conversation,
          request: followUpLoadingRequest(conversation.anchor, discussion.id, outcome.turnId!),
        }),
      };
    }
    case "succeed_follow_up": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const outcome = succeedConversationFollowUp(discussion.conversation, event.turnId, event.response);
      if (outcome.turn === null || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: followUpSuccessRequest(
          outcome.conversation.anchor,
          event.response,
          discussion.id,
          event.turnId,
        ),
      });
    }
    case "fail_follow_up": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const outcome = failConversationFollowUp(discussion.conversation, event.turnId, event.error);
      if (!outcome.ok || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: followUpErrorRequest(
          outcome.conversation.anchor,
          event.error,
          discussion.id,
          event.turnId,
        ),
      });
    }
    case "require_follow_up_configuration": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const outcome = failConversationFollowUp(discussion.conversation, event.turnId, {
        code: "configuration_required",
        message: "请先配置 LLM 后再重试",
      });
      if (!outcome.ok || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: configurationRequiredRequest(
          outcome.conversation.anchor,
          discussion.id,
          event.turnId,
        ),
      });
    }
    case "accept_edited_follow_up": {
      const discussion = activeDiscussion(state);
      if (!discussion) return state;
      const outcome = acceptEditedConversationFollowUp(discussion.conversation, event.question);
      if (outcome.turnId === null || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: followUpLoadingRequest(outcome.conversation.anchor, discussion.id, outcome.turnId),
      });
    }
    case "cancel_follow_up": {
      const discussion = activeDiscussion(state);
      if (!discussion) return state;
      const outcome = cancelConversationFollowUp(discussion.conversation, event.turnId);
      if (outcome.response === null || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: cancelFollowUpSuccessRequest(outcome.conversation.anchor, outcome.response),
      });
    }
    case "accept_follow_up_retry": {
      const discussion = activeDiscussion(state);
      if (!discussion) return state;
      const outcome = acceptConversationFollowUpRetry(discussion.conversation);
      if (outcome.turnId === null || outcome.conversation === null) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: outcome.conversation,
        request: followUpLoadingRequest(outcome.conversation.anchor, discussion.id, outcome.turnId),
      });
    }
    case "accept_first_retry": {
      const discussion = activeDiscussion(state);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind === "stopped" && request.phase === "first") {
        return setDiscussion(state, {
          ...discussion,
          request: firstRetryLoadingRequest(request.snapshot, discussion.id),
        });
      }
      if (request.kind !== "error" && request.kind !== "configuration_required") return state;
      if (request.conversationId === undefined) return state;
      return setDiscussion(state, {
        ...discussion,
        request: firstRetryLoadingRequest(request.snapshot, request.conversationId),
      });
    }
    case "update_direct_question_draft": {
      const drafts = new Map(state.directQuestionDrafts).set(event.conversationId, event.question);
      return { ...state, directQuestionDrafts: drafts };
    }
    case "set_pending_selection": {
      if (event.snapshot === null) {
        return { ...state, pendingSelection: null };
      }
      if (
        state.ignoredSelection !== null &&
        sameSelectionSnapshot(event.snapshot, state.ignoredSelection)
      ) {
        return { ...state, pendingSelection: null };
      }
      return {
        ...state,
        pendingSelection: frozenSnapshot(event.snapshot),
        ignoredSelection: null,
      };
    }
    case "remove_pending_selection": {
      if (state.pendingSelection === null) return state;
      return {
        ...state,
        pendingSelection: null,
        ignoredSelection: frozenSnapshot(state.pendingSelection),
      };
    }
    case "begin_direct_question": {
      if (!event.question.trim()) return state;
      const frozenSelection = event.selection ? frozenSnapshot(event.selection) : null;
      const material: FirstRoundMaterial = {
        kind: "direct_question",
        question: event.question,
        ...(frozenSelection ? { selected_text: frozenSelection.selectedText } : {}),
        ...(frozenSelection?.bodySnapshot !== undefined
          ? { snapshot: frozenSelection.bodySnapshot }
          : {}),
      };
      const current = activeDiscussion(state);
      let discussion: Discussion;
      if (current && isEmptyDiscussion(current)) {
        // 复用空讨论：空讨论尚无任何材料，按本次发起重新绑定关注文档（阶段五 A）。
        discussion = {
          ...current,
          request: directQuestionLoadingRequest(event.question, frozenSelection),
          anchor: frozenSelection,
          pendingFirstRequest: material,
          focusDocumentId: event.focusDocumentId,
          focusDocumentTitle: event.focusDocumentTitle,
        };
      } else {
        discussion = {
          id: event.conversationId,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
          focusDocumentId: event.focusDocumentId,
          focusDocumentTitle: event.focusDocumentTitle,
          request: directQuestionLoadingRequest(event.question, frozenSelection),
          conversation: null,
          anchor: frozenSelection,
          pendingFirstRequest: material,
          onDemandReadingGrant: null,
          pendingReadingRequest: null,
          readingProgress: null,
        };
      }
      return {
        ...state,
        visibility: "open",
        previewRequest: null,
        discussions: new Map(state.discussions).set(discussion.id, discussion),
        windows: new Map(state.windows).set(discussion.id, "docked"),
        focusedConversationId: discussion.id,
        generation: state.generation + 1,
        pendingSelection: null,
      };
    }
    case "succeed_direct_question": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      const created = applyFirstSuccess(discussion, event.response);
      const drafts = new Map(state.directQuestionDrafts);
      drafts.delete(discussion.id);
      return {
        ...state,
        discussions: new Map(state.discussions).set(discussion.id, created),
        directQuestionDrafts: drafts,
      };
    }
    case "fail_direct_question": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      const { streamedText: _dropped, ...rest } = request;
      return setDiscussion(state, {
        ...discussion,
        request: { ...rest, status: "error", error: event.error },
      });
    }
    case "require_direct_question_configuration": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      const { streamedText: _dropped, ...rest } = request;
      return setDiscussion(state, {
        ...discussion,
        request: { ...rest, status: "configuration_required" },
      });
    }
    case "append_stream_text": {
      // 按讨论身份路由增量：只写入发起请求的讨论，不写入「当前活动讨论」。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind === "direct_question" && request.status === "loading") {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, streamedText: (request.streamedText ?? "") + event.text },
        });
      }
      if (request.kind === "loading" && request.phase === "first") {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, streamedText: (request.streamedText ?? "") + event.text },
        });
      }
      const conversation = discussion.conversation;
      const pending = conversation?.pending;
      if (conversation && pending && !pending.error) {
        return setDiscussion(state, {
          ...discussion,
          conversation: {
            ...conversation,
            pending: { ...pending, streamedText: (pending.streamedText ?? "") + event.text },
          },
        });
      }
      return state;
    }
    case "begin_recovery": {
      const discussion = discussionById(state, event.conversationId);
      const conversation = discussion?.conversation;
      if (!discussion || !conversation) return state;
      return setDiscussion(state, {
        ...discussion,
        request: recoveringRequest(conversation.anchor, discussion.id),
      });
    }
    case "complete_recovery": {
      const discussion = discussionById(state, event.conversationId);
      const conversation = discussion?.conversation;
      if (!discussion || !conversation) return state;
      if (discussion.request.kind !== "recovering") return state;
      return setDiscussion(state, {
        ...discussion,
        request: firstSuccessRequest(conversation.anchor, conversation.firstResponse, discussion.id),
      });
    }
    case "fail_recovery": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      if (discussion.request.kind !== "recovering") return state;
      return setDiscussion(state, {
        ...discussion,
        request: firstErrorRequest(discussion.request.snapshot, {
          code: "service",
          message: "对话恢复失败，请点击新建对话开始新对话",
        }, { conversationId: discussion.request.conversationId }),
      });
    }
    case "close":
      return state.visibility === "closed" ? state : { ...state, visibility: "closed" };
    case "open":
      return state.visibility === "open" ? state : { ...state, visibility: "open" };
    case "new_conversation": {
      // 聚焦窗口已是空窗口：复用它，避免空窗口堆积。
      const current = activeDiscussion(state);
      if (current && isEmptyDiscussion(current)) return state;
      const discussion: Discussion = {
        id: event.conversationId,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        focusDocumentId: event.focusDocumentId,
        focusDocumentTitle: event.focusDocumentTitle,
        request: idleRequest(),
        conversation: null,
        anchor: null,
        pendingFirstRequest: null,
        onDemandReadingGrant: null,
        pendingReadingRequest: null,
        readingProgress: null,
      };
      return {
        ...state,
        visibility: "open",
        previewRequest: null,
        discussions: new Map(state.discussions).set(discussion.id, discussion),
        windows: new Map(state.windows).set(discussion.id, "docked"),
        focusedConversationId: discussion.id,
        generation: state.generation + 1,
        pendingSelection: null,
        ignoredSelection: null,
        saveError: null,
      };
    }
    case "reset":
      return {
        ...state,
        visibility: "closed",
        previewRequest: null,
        discussions: new Map(),
        summaries: new Map(),
        deletedIds: new Set(),
        opening: new Map(),
        saveErrors: new Map(),
        windows: new Map(),
        focusedConversationId: null,
        generation: state.generation + 1,
        saveError: null,
        directQuestionDrafts: new Map(),
        pendingSelection: null,
        ignoredSelection: null,
      };
    // 提示数据仍由 getUndoNotice 拉取；新引用只用于触发订阅者重新渲染。
    case "undo_notice_changed":
      return { ...state };
    case "load_discussions": {
      const summaries = new Map<string, ConversationSummary>();
      for (const summary of event.summaries) {
        if (state.deletedIds.has(summary.conversation_id)) continue;
        summaries.set(summary.conversation_id, {
          ...summary,
          restricted: state.summaries.get(summary.conversation_id)?.restricted ||
            isConversationMaterialRestricted(summary, event.hiddenDocumentIds),
        });
      }
      return { ...state, summaries };
    }
    case "upsert_summary": {
      const id = event.summary.conversation_id;
      if (state.deletedIds.has(id) && !event.restored) return state;
      const deletedIds = new Set(state.deletedIds);
      if (event.restored) deletedIds.delete(id);
      const previous = state.summaries.get(id);
      return { ...state, deletedIds, summaries: new Map(state.summaries).set(id, {
        ...event.summary,
        restricted: previous?.restricted || isConversationMaterialRestricted(event.summary, new Set()),
        provenance_has_revoked: previous?.provenance_has_revoked || event.summary.provenance_has_revoked,
      }) };
    }
    case "begin_open_discussion": {
      if (state.deletedIds.has(event.conversationId)) return state;
      return {
        ...state,
        visibility: "open",
        previewRequest: null,
        opening: new Map(state.opening).set(event.conversationId, { error: null }),
        windows: new Map(state.windows).set(event.conversationId, "docked"),
        focusedConversationId: event.conversationId,
      };
    }
    case "fail_open_discussion": {
      if (!state.opening.has(event.conversationId)) return state;
      return { ...state, opening: new Map(state.opening).set(event.conversationId, { error: event.message }) };
    }
    case "latch_restrictions": {
      const summaries = new Map(state.summaries);
      const discussions = new Map(state.discussions);
      for (const id of event.conversationIds) {
        const summary = summaries.get(id);
        if (summary) summaries.set(id, { ...summary, restricted: true });
        const discussion = discussions.get(id);
        if (discussion?.conversation) discussions.set(id, { ...discussion, conversation: {
          ...discussion.conversation, restricted: true,
          restrictionReason: discussion.conversation.restrictionReason ?? "hidden_material",
        } });
      }
      return { ...state, summaries, discussions };
    }
    case "recompute_restrictions": {
      // 权限变更后重算各已打开讨论的材料限制并锁存（任务 5.2/5.4）：
      // 出处引用当前隐藏文档的讨论被标记受限；已受限讨论保持受限（单调）。
      let changed = false;
      const summaries = new Map(state.summaries);
      for (const [id, summary] of summaries) {
        if (!summary.restricted && isConversationMaterialRestricted(summary, event.hiddenDocumentIds)) {
          summaries.set(id, { ...summary, restricted: true });
          changed = true;
        }
      }
      const discussions = new Map(state.discussions);
      for (const [id, discussion] of state.discussions) {
        const conversation = discussion.conversation;
        if (!conversation) continue;
        const latched = latchConversationRestriction(conversation, event.hiddenDocumentIds);
        if (latched !== conversation) {
          discussions.set(id, { ...discussion, conversation: latched });
          changed = true;
        }
      }
      return changed ? { ...state, discussions, summaries } : state;
    }
    case "open_discussion": {
      const conversation = event.conversation;
      if (state.deletedIds.has(conversation.id)) return state;
      if (state.windows.has(conversation.id) && !state.opening.has(conversation.id)) {
        return { ...state, visibility: "open", focusedConversationId: conversation.id };
      }
      const opening = new Map(state.opening);
      opening.delete(conversation.id);
      const discussion: Discussion = {
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.createdAt,
        focusDocumentId: event.focusDocumentId,
        focusDocumentTitle: event.focusDocumentTitle,
        request: firstSuccessRequest(conversation.anchor, conversation.firstResponse, conversation.id),
        conversation,
        anchor: conversation.anchor,
        pendingFirstRequest: null,
        onDemandReadingGrant: conversation.onDemandReadingGrant ?? null,
        pendingReadingRequest: null,
        readingProgress: null,
      };
      return {
        ...state,
        visibility: "open",
        previewRequest: null,
        opening,
        discussions: new Map(state.discussions).set(discussion.id, discussion),
        // 一讨论至多一个窗口：已打开则聚焦，不重复创建。
        windows: new Map(state.windows).set(discussion.id, state.windows.get(discussion.id) ?? "docked"),
        focusedConversationId: state.opening.has(discussion.id) ? state.focusedConversationId : discussion.id,
        generation: state.generation + 1,
        saveError: null,
      };
    }
    case "delete_discussion": {
      if (!state.discussions.has(event.conversationId) && !state.summaries.has(event.conversationId) && !state.windows.has(event.conversationId)) return state;
      const discussions = new Map(state.discussions);
      discussions.delete(event.conversationId);
      const summaries = new Map(state.summaries);
      summaries.delete(event.conversationId);
      const opening = new Map(state.opening);
      opening.delete(event.conversationId);
      const saveErrors = new Map(state.saveErrors);
      saveErrors.delete(event.conversationId);
      const windows = new Map(state.windows);
      windows.delete(event.conversationId);
      const drafts = new Map(state.directQuestionDrafts);
      drafts.delete(event.conversationId);
      const focusedConversationId =
        state.focusedConversationId === event.conversationId ? null : state.focusedConversationId;
      return {
        ...state,
        discussions,
        summaries,
        opening,
        saveErrors,
        deletedIds: new Set(state.deletedIds).add(event.conversationId),
        windows,
        directQuestionDrafts: drafts,
        focusedConversationId,
        ...(focusedConversationId === null ? { previewRequest: null } : {}),
      };
    }
    case "set_save_error":
      return event.conversationId === undefined
        ? { ...state, saveError: event.message }
        : state.deletedIds.has(event.conversationId) ? state
          : { ...state, saveErrors: new Map(state.saveErrors).set(event.conversationId, event.message) };
    case "clear_save_error": {
      if (event.conversationId === undefined) return state.saveError === null ? state : { ...state, saveError: null };
      const saveErrors = new Map(state.saveErrors);
      saveErrors.delete(event.conversationId);
      return { ...state, saveErrors };
    }
    case "stop_request": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      // 停止生成只结束当前轮：清除等待中的授权请求与过程状态（等待中可停止取消，
      // 任务 7.1/7.6），但不改变按需补读授权状态（停止与授权解耦，任务 7.2）。
      const cleared: Discussion = {
        ...discussion,
        pendingReadingRequest: null,
        readingProgress: null,
      };
      const request = discussion.request;
      if (request.kind === "direct_question" && (request.status === "loading" || request.queued)) {
        // 直接提问首轮停止（含排队中）：保留问题与已流式内容，标记为「已停止」。
        return setDiscussion(state, {
          ...cleared,
          request: { ...request, status: "stopped", queued: undefined },
        });
      }
      if (request.kind === "loading" && request.phase === "first") {
        // 召唤首轮停止：保留冻结材料与已流式内容。
        return setDiscussion(state, {
          ...cleared,
          request: {
            kind: "stopped",
            snapshot: request.snapshot,
            conversationId: request.conversationId,
            phase: "first",
            streamedText: request.streamedText,
          },
        });
      }
      if (request.kind === "loading" && request.phase === "follow_up") {
        const conversation = discussion.conversation;
        const pending = conversation?.pending;
        if (!conversation || !pending || pending.error || pending.interrupted) return state;
        return setDiscussion(state, {
          ...cleared,
          conversation: { ...conversation, pending: { ...pending, interrupted: true } },
          request: {
            kind: "stopped",
            snapshot: conversation.anchor,
            conversationId: discussion.id,
            phase: "follow_up",
            turnId: pending.id,
          },
        });
      }
      // 非生成中状态：仅当残留待决授权卡 / 过程状态时清理（等待授权的轮次停止路径
      // 由 loading 分支与直接提问分支覆盖；这里兜底迟到残留）。
      if (discussion.pendingReadingRequest === null && discussion.readingProgress === null) {
        return state;
      }
      return setDiscussion(state, cleared);
    }
    case "focus_window": {
      if (!state.windows.has(event.conversationId)) return state;
      if (state.focusedConversationId === event.conversationId) return state;
      return { ...state, focusedConversationId: event.conversationId };
    }
    case "close_window": {
      if (!state.windows.has(event.conversationId)) return state;
      const windows = new Map(state.windows);
      windows.delete(event.conversationId);
      const opening = new Map(state.opening);
      opening.delete(event.conversationId);
      const focusedConversationId =
        state.focusedConversationId === event.conversationId ? null : state.focusedConversationId;
      return {
        ...state,
        windows,
        opening,
        focusedConversationId,
        ...(focusedConversationId === null ? { previewRequest: null } : {}),
      };
    }
    case "retry_direct_question": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind !== "direct_question" || request.status !== "stopped") return state;
      return setDiscussion(state, {
        ...discussion,
        request: { ...request, status: "loading", streamedText: "" },
      });
    }
    case "retry_stopped_follow_up": {
      const discussion = activeDiscussion(state);
      const conversation = discussion?.conversation;
      const pending = conversation?.pending;
      if (!discussion || !conversation || conversation.restricted || !pending || !pending.interrupted) return state;
      return setDiscussion(state, {
        ...discussion,
        conversation: { ...conversation, pending: { id: pending.id, question: pending.question, streamedText: "" } },
        request: followUpLoadingRequest(conversation.anchor, discussion.id, pending.id),
      });
    }
    case "set_window_placement": {
      if (!state.windows.has(event.conversationId)) return state;
      if (state.windows.get(event.conversationId) === event.placement) return state;
      return {
        ...state,
        windows: new Map(state.windows).set(event.conversationId, event.placement),
      };
    }
    case "reset_layout": {
      let changed = false;
      const windows = new Map<string, WindowPlacement>();
      for (const [id, placement] of state.windows) {
        if (placement !== "docked") changed = true;
        windows.set(id, "docked");
      }
      if (!changed) return state;
      return { ...state, windows };
    }
    case "queue_request": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind === "direct_question" && request.status === "loading" && !request.queued) {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, queued: true },
        });
      }
      if (request.kind === "loading" && !request.queued) {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, queued: true },
        });
      }
      return state;
    }
    case "start_queued_request": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind === "direct_question" && request.status === "loading" && request.queued) {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, queued: undefined },
        });
      }
      if (request.kind === "loading" && request.queued) {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, queued: undefined },
        });
      }
      return state;
    }
    case "reject_queued_request": {
      // 排队请求在派发前重新校验材料权限失败：不派发，转为可读失败终态（任务 6.1）。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request = discussion.request;
      if (request.kind === "direct_question" && request.status === "loading" && request.queued) {
        return setDiscussion(state, {
          ...discussion,
          request: { ...request, status: "error", error: event.error, queued: undefined },
        });
      }
      if (request.kind === "loading" && request.queued) {
        if (request.phase === "follow_up" && request.turnId !== undefined) {
          const outcome = failConversationFollowUp(
            discussion.conversation,
            request.turnId,
            event.error,
          );
          if (outcome.ok && outcome.conversation !== null) {
            return setDiscussion(state, {
              ...discussion,
              conversation: outcome.conversation,
              request: followUpErrorRequest(
                request.snapshot,
                event.error,
                discussion.id,
                request.turnId,
              ),
            });
          }
          return state;
        }
        // 首轮召唤排队中被拒。
        return setDiscussion(state, {
          ...discussion,
          request: firstErrorRequest(request.snapshot, event.error, {
            conversationId: discussion.id,
            phase: "first",
          }),
        });
      }
      return state;
    }
    case "rename_discussion": {
      const discussion = discussionById(state, event.conversationId);
      const summary = state.summaries.get(event.conversationId);
      if (!discussion?.conversation && !summary) return state;
      if ((!discussion?.conversation || discussion.conversation.customTitle === event.title) &&
          (!summary || (summary.custom_title ?? null) === (event.title.trim() || null))) return state;
      const next = discussion?.conversation ? setDiscussion(state, {
        ...discussion,
        conversation: { ...discussion.conversation, customTitle: event.title },
      }) : state;
      if (!summary) return next;
      const title = event.title.trim() || (discussion?.conversation
        ? summaryOf({ ...discussion.conversation, customTitle: null }, discussion.focusDocumentId, discussion.focusDocumentTitle).title
        : summary.title);
      return { ...next, summaries: new Map(next.summaries).set(event.conversationId, {
        ...summary, title, custom_title: event.title.trim() || null,
      }) };
    }
    case "set_discussion_pinned": {
      const discussion = discussionById(state, event.conversationId);
      const summary = state.summaries.get(event.conversationId);
      if (!discussion?.conversation && !summary) return state;
      if ((!discussion?.conversation || Boolean(discussion.conversation.pinned) === event.pinned) &&
          (!summary || Boolean(summary.pinned) === event.pinned)) return state;
      const next = discussion?.conversation ? setDiscussion(state, {
        ...discussion,
        conversation: { ...discussion.conversation, pinned: event.pinned },
      }) : state;
      return summary ? { ...next, summaries: new Map(next.summaries).set(event.conversationId, {
        ...summary, pinned: event.pinned,
      }) } : next;
    }
    case "record_round_provenance": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion || !discussion.conversation) return state;
      const conversation = discussion.conversation;
      // 保留冻结选区出处（若此前未显式设置），再追加本轮自动取材出处。
      const base = conversation.provenance ?? materialProvenanceFromAnchor(discussion.anchor);
      return setDiscussion(state, {
        ...discussion,
        conversation: { ...conversation, provenance: [...base, ...event.entries] },
      });
    }
    case "set_focus_document": {
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      // 材料权限受限的讨论永久只读：不得改绑关注文档。
      if (discussion.conversation?.restricted) return state;
      if (
        discussion.focusDocumentId === event.focusDocumentId &&
        discussion.focusDocumentTitle === event.focusDocumentTitle
      ) {
        return state;
      }
      // 只改绑关注对象；已发送 / 正在生成的轮次已冻结自己的材料，不受影响。
      // 新关注对象从下一轮请求开始生效（请求组装时读取当前 focusDocumentId）。
      return setDiscussion(state, {
        ...discussion,
        focusDocumentId: event.focusDocumentId,
        focusDocumentTitle: event.focusDocumentTitle,
      });
    }
    case "reading_request": {
      // 收到按需补读授权请求（任务 7.1）：显示授权卡，轮次挂起等待用户决定。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const request: PendingReadingRequest = {
        sessionId: event.sessionId,
        messageId: event.messageId,
        callId: event.callId,
        reason: event.reason,
      };
      if (
        discussion.pendingReadingRequest !== null &&
        discussion.pendingReadingRequest.callId === request.callId
      ) {
        return state;
      }
      return setDiscussion(state, { ...discussion, pendingReadingRequest: request });
    }
    case "resolve_reading_request": {
      // 用户对授权请求的决定（任务 7.1）：清除授权卡；允许 → 授权写入讨论
      // （授权属于讨论、跨重启保留；首轮在途时讨论尚无对话本体，授权记在
      // Discussion 级真相源，首轮成功后随对话落档）。拒绝不改变授权状态。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      if (!event.granted) {
        if (discussion.pendingReadingRequest === null) return state;
        return setDiscussion(state, { ...discussion, pendingReadingRequest: null });
      }
      const grant = discussion.onDemandReadingGrant ?? { granted_at: new Date().toISOString() };
      if (discussion.pendingReadingRequest === null && discussion.onDemandReadingGrant === grant) {
        return state;
      }
      return setDiscussion(state, {
        ...discussion,
        pendingReadingRequest: null,
        onDemandReadingGrant: grant,
        ...(discussion.conversation
          ? { conversation: { ...discussion.conversation, onDemandReadingGrant: grant } }
          : {}),
      });
    }
    case "set_on_demand_reading": {
      // 讨论内授权开关（任务 7.2）：随时开 / 关；关闭（granted=false）立即阻止
      // 后续读取（后端逐次校验档案授权），且不清除已读内容（出处保留）。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const current = discussion.onDemandReadingGrant ?? null;
      const next = event.granted ? (current ?? { granted_at: new Date().toISOString() }) : null;
      if (current !== null && next !== null) {
        // 已授权再开启：授权状态不变（保留原授权时间），仅清掉残留授权卡。
        return discussion.pendingReadingRequest === null
          ? state
          : setDiscussion(state, { ...discussion, pendingReadingRequest: null });
      }
      if (current === next) return state;
      return setDiscussion(state, {
        ...discussion,
        onDemandReadingGrant: next,
        ...(discussion.conversation
          ? { conversation: { ...discussion.conversation, onDemandReadingGrant: next } }
          : {}),
      });
    }
    case "note_tool_call": {
      // 补读过程轻量状态（任务 7.3）：由 ai-tool-call 事件驱动；只记录活动类型与
      // 工具引用过的文档身份，不记录模型内部推理。状态只在生成中由显示层呈现。
      const discussion = discussionById(state, event.conversationId);
      if (!discussion) return state;
      const status =
        event.tool === "story-search"
          ? ("searching" as const)
          : event.tool === "story-read"
            ? ("reading" as const)
            : event.tool === "story-list"
              ? ("listing" as const)
              : null;
      if (status === null) return state;
      const previous = discussion.readingProgress;
      const documentIds = event.tool === "story-read" && event.documentId
        ? previous?.documentIds.includes(event.documentId)
          ? previous.documentIds
          : [...(previous?.documentIds ?? []), event.documentId]
        : (previous?.documentIds ?? []);
      if (
        previous !== null &&
        previous.status === status &&
        previous.documentIds === documentIds
      ) {
        return state;
      }
      return setDiscussion(state, {
        ...discussion,
        readingProgress: { status, documentIds },
      });
    }
    case "update_on_demand_state": {
      // 轮次完成后从档案刷新按需补读状态（任务 7.4）：合并后端通道按轮写入的
      // 补读出处与授权事实，供「本次参考了什么」展示。
      const discussion = discussionById(state, event.conversationId);
      const conversation = discussion?.conversation ?? null;
      if (!discussion || !conversation) return state;
      const nextProvenance = event.provenance ?? undefined;
      const nextGrant = event.grant ?? null;
      if (
        (discussion.onDemandReadingGrant ?? null) === nextGrant &&
        conversation.onDemandReadingProvenance === nextProvenance
      ) {
        return state;
      }
      return setDiscussion(state, {
        ...discussion,
        onDemandReadingGrant: nextGrant,
        conversation: {
          ...conversation,
          onDemandReadingGrant: nextGrant,
          onDemandReadingProvenance: nextProvenance,
        },
      });
    }
  }
}
