import {
  acceptConversationFollowUpRetry,
  acceptEditedConversationFollowUp,
  allocateConversationId,
  beginConversationFollowUp,
  cancelConversationFollowUp,
  clearConversationContext,
  createConversationFromFirstSuccess,
  emptyConversationContext,
  failConversationFollowUp,
  frozenSnapshot,
  succeedConversationFollowUp,
  type TemporaryConversationContext,
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
import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";
import { sameSelectionSnapshot } from "./shared-storage-and-selection-identity.ts";

/**
 * AI 面板核心状态的显式数据模型（reducer 的输入 / 输出）。
 *
 * 与旧 `AiPanelState` 的字段一一对应：
 * - `visibility`：面板展开 / 收起。收起只改这一维，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 * - `conversationContext`：临时对话本体与 id 计数器（单调递增，`reset` 也不清零）。
 * - `pendingFirstConversationId`：首轮召唤分配的对话身份，成功前保留。
 * - `pendingFirstRequest`：首轮候选请求，失败后重试仍可用。
 */
export interface AiPanelCoreState {
  readonly visibility: PanelVisibility;
  readonly request: PanelRequestState;
  readonly conversationContext: TemporaryConversationContext;
  readonly pendingFirstConversationId: number | null;
  readonly pendingFirstRequest: FirstRoundMaterial | null;
  /** 直接提问的未发送草稿。 */
  readonly directQuestionDraft: string;
  /** 当前待附带的选区重点材料；无选区时为 null。 */
  readonly pendingSelection: SelectionSnapshot | null;
  /** 用户主动移除后应保持忽略的选区身份；新选区出现时清除。 */
  readonly ignoredSelection: SelectionSnapshot | null;
}

export function initialAiPanelCoreState(): AiPanelCoreState {
  return {
    visibility: "closed",
    request: idleRequest(),
    conversationContext: emptyConversationContext(),
    pendingFirstConversationId: null,
    pendingFirstRequest: null,
    directQuestionDraft: "",
    pendingSelection: null,
    ignoredSelection: null,
  };
}

/**
 * 面板全部可观察操作的事件。非法迁移（如没有对话时开追问、重复收起）由 reducer
 * 原样返回输入状态（同一引用），调用方据此不触发通知。
 */
export type AiPanelEvent =
  | {
      readonly type: "preview_first_request";
      readonly snapshot: SelectionSnapshot;
      readonly firstRequest?: FirstRoundMaterial;
    }
  | { readonly type: "block_first_request"; readonly snapshot: SelectionSnapshot }
  | {
      readonly type: "begin_request";
      readonly snapshot: SelectionSnapshot;
      readonly firstRequest?: FirstRoundMaterial;
    }
  | { readonly type: "succeed"; readonly snapshot: SelectionSnapshot; readonly response: string }
  | { readonly type: "fail"; readonly snapshot: SelectionSnapshot; readonly error: GenerateAiError }
  | { readonly type: "require_configuration"; readonly snapshot: SelectionSnapshot }
  | { readonly type: "begin_follow_up"; readonly question: string }
  | { readonly type: "succeed_follow_up"; readonly turnId: number; readonly response: string }
  | { readonly type: "fail_follow_up"; readonly turnId: number; readonly error: GenerateAiError }
  | { readonly type: "require_follow_up_configuration"; readonly turnId: number }
  | { readonly type: "accept_edited_follow_up"; readonly question: string }
  | { readonly type: "cancel_follow_up"; readonly turnId: number }
  | { readonly type: "accept_follow_up_retry" }
  | { readonly type: "accept_first_retry" }
  | { readonly type: "update_direct_question_draft"; readonly question: string }
  | { readonly type: "set_pending_selection"; readonly snapshot: SelectionSnapshot | null }
  | { readonly type: "remove_pending_selection" }
  | {
      readonly type: "begin_direct_question";
      readonly question: string;
      readonly selection: SelectionSnapshot | null;
    }
  | { readonly type: "succeed_direct_question"; readonly response: string }
  | { readonly type: "fail_direct_question"; readonly error: GenerateAiError }
  | { readonly type: "require_direct_question_configuration" }
  | {
      readonly type: "append_stream_text";
      readonly text: string;
    }
  | { readonly type: "begin_recovery" }
  | { readonly type: "complete_recovery" }
  | { readonly type: "fail_recovery" }
  | { readonly type: "close" }
  | { readonly type: "open" }
  | { readonly type: "new_conversation" }
  | { readonly type: "reset" };

/**
 * 首轮请求是否仍在途中：首轮 loading、预检预览或阻塞提示。
 *
 * `fail` / `require_configuration` 只接受这些阶段的结果；清空（新建对话 / reset）后
 * 到达的迟到结果处于 idle / 直接提问 / 追问等状态，一律拒绝，防止污染空状态。
 * `first_blocked` 也视为在途：阻塞提示意味着原首轮请求仍在生成，其结果应正常应用。
 */
function isFirstRoundInFlight(state: AiPanelCoreState): boolean {
  const request = state.request;
  if (request.kind === "loading") return request.phase !== "follow_up";
  return request.kind === "first_preview" || request.kind === "first_blocked";
}

/** “新建对话”是否有可结束的内容：存在临时对话、已分配的首轮身份或任何非空请求。 */
function hasEndableConversationWork(state: AiPanelCoreState): boolean {
  return (
    state.conversationContext.conversation !== null ||
    state.pendingFirstConversationId !== null ||
    state.request.kind !== "idle"
  );
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
      const anchor = frozenSnapshot(event.snapshot);
      return {
        ...state,
        visibility: "open",
        conversationContext: clearConversationContext(state.conversationContext),
        request: firstPreviewRequest(anchor),
        pendingFirstConversationId: null,
        pendingFirstRequest:
          event.firstRequest ?? { kind: "summon", selected_text: anchor.selectedText },
      };
    }
    case "block_first_request": {
      // 与旧实现一致：不触碰当前对话，只进入阻塞反馈
      return {
        ...state,
        visibility: "open",
        request: firstBlockedRequest(frozenSnapshot(event.snapshot)),
        pendingFirstConversationId: null,
        pendingFirstRequest: null,
      };
    }
    case "begin_request": {
      const anchor = frozenSnapshot(event.snapshot);
      const allocation = allocateConversationId(state.conversationContext);
      return {
        ...state,
        visibility: "open",
        conversationContext: clearConversationContext(allocation.context),
        request: firstLoadingRequest(anchor, allocation.conversationId),
        pendingFirstConversationId: allocation.conversationId,
        pendingFirstRequest:
          event.firstRequest ?? { kind: "summon", selected_text: anchor.selectedText },
      };
    }
    case "succeed": {
      const request = state.request;
      // 只接受首轮在途（loading 或阻塞提示）的完成结果：新建对话清空后（idle /
      // 直接提问 / 追问阶段）到达的迟到成功结果一律拒绝，不得重建对话。
      if (request.kind !== "loading" && request.kind !== "first_blocked") return state;
      if (request.kind === "loading" && request.phase === "follow_up") return state;
      let conversationId = state.pendingFirstConversationId;
      let context = state.conversationContext;
      if (conversationId === null) {
        // 阻塞提示下没有已分配的首轮身份：分配新身份（保持单调递增）。
        conversationId = context.nextConversationId;
        context = { ...context, nextConversationId: context.nextConversationId + 1 };
      }
      const created = createConversationFromFirstSuccess(
        context,
        conversationId,
        event.snapshot,
        state.pendingFirstRequest ?? { kind: "summon", selected_text: event.snapshot.selectedText },
        event.response,
      );
      return {
        ...state,
        request: firstSuccessRequest(created.conversation.anchor, event.response, conversationId),
        conversationContext: created.context,
        pendingFirstRequest: null,
        // 首轮身份在成功时消费完毕：后续迟到结果不再拥有可用的首轮身份。
        pendingFirstConversationId: null,
      };
    }
    case "fail": {
      if (!isFirstRoundInFlight(state)) return state;
      const identity = state.request.kind === "loading" ? state.request : null;
      return {
        ...state,
        request: firstErrorRequest(frozenSnapshot(event.snapshot), event.error, identity),
      };
    }
    case "require_configuration": {
      if (!isFirstRoundInFlight(state)) return state;
      const identity = state.request.kind === "loading" ? state.request : null;
      return {
        ...state,
        request: configurationRequiredRequest(
          frozenSnapshot(event.snapshot),
          identity?.conversationId,
        ),
      };
    }
    case "begin_follow_up": {
      const outcome = beginConversationFollowUp(state.conversationContext, event.question);
      if (outcome.turnId === null) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: followUpLoadingRequest(conversation.anchor, conversation.id, outcome.turnId),
      };
    }
    case "succeed_follow_up": {
      const outcome = succeedConversationFollowUp(
        state.conversationContext,
        event.turnId,
        event.response,
      );
      if (outcome.turn === null) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: followUpSuccessRequest(
          conversation.anchor,
          event.response,
          conversation.id,
          event.turnId,
        ),
      };
    }
    case "fail_follow_up": {
      const outcome = failConversationFollowUp(state.conversationContext, event.turnId, event.error);
      if (!outcome.ok) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: followUpErrorRequest(
          conversation.anchor,
          event.error,
          conversation.id,
          event.turnId,
        ),
      };
    }
    case "require_follow_up_configuration": {
      // 与旧实现一致：配置缺失按一次带配置错误的追问失败处理
      const outcome = failConversationFollowUp(state.conversationContext, event.turnId, {
        code: "configuration_required",
        message: "请先配置 LLM 后再重试",
      });
      if (!outcome.ok) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: configurationRequiredRequest(conversation.anchor, conversation.id, event.turnId),
      };
    }
    case "accept_edited_follow_up": {
      const outcome = acceptEditedConversationFollowUp(state.conversationContext, event.question);
      if (outcome.turnId === null) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: followUpLoadingRequest(conversation.anchor, conversation.id, outcome.turnId),
      };
    }
    case "cancel_follow_up": {
      const outcome = cancelConversationFollowUp(state.conversationContext, event.turnId);
      if (outcome.response === null) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: cancelFollowUpSuccessRequest(conversation.anchor, outcome.response),
      };
    }
    case "accept_follow_up_retry": {
      const outcome = acceptConversationFollowUpRetry(state.conversationContext);
      if (outcome.turnId === null) return state;
      const conversation = outcome.context.conversation;
      if (!conversation) return state;
      return {
        ...state,
        conversationContext: outcome.context,
        request: followUpLoadingRequest(conversation.anchor, conversation.id, outcome.turnId),
      };
    }
    case "accept_first_retry": {
      const request = state.request;
      if (request.kind !== "error" && request.kind !== "configuration_required") return state;
      if (request.conversationId === undefined) return state;
      return {
        ...state,
        request: firstRetryLoadingRequest(request.snapshot, request.conversationId),
      };
    }
    case "update_direct_question_draft":
      return { ...state, directQuestionDraft: event.question };
    case "set_pending_selection": {
      if (event.snapshot === null) {
        // 编辑器选区被清空：移除待附带材料，但不标记为「主动忽略」。
        return { ...state, pendingSelection: null };
      }
      // 用户主动移除过的同一选区在 focus sync 时保持忽略，不重新附加。
      if (
        state.ignoredSelection !== null &&
        sameSelectionSnapshot(event.snapshot, state.ignoredSelection)
      ) {
        return { ...state, pendingSelection: null };
      }
      // 新选区：附加并清除忽略标记。
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
      const allocation = allocateConversationId(state.conversationContext);
      // 自行冻结选区：不依赖调用方复制，调用后修改原对象不影响状态/请求/对话锚点。
      const frozenSelection = event.selection ? frozenSnapshot(event.selection) : null;
      return {
        ...state,
        visibility: "open",
        request: directQuestionLoadingRequest(event.question, frozenSelection),
        conversationContext: clearConversationContext(allocation.context),
        pendingFirstConversationId: allocation.conversationId,
        pendingFirstRequest: null,
        pendingSelection: null,
      };
    }
    case "succeed_direct_question": {
      const request = state.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      let nextContext = state.conversationContext;
      let conversationId: number;
      if (state.pendingFirstConversationId === null) {
        conversationId = nextContext.nextConversationId;
        nextContext = { ...nextContext, nextConversationId: nextContext.nextConversationId + 1 };
      } else {
        conversationId = state.pendingFirstConversationId;
      }
      const material: Extract<GenerateAiRequest, { kind: "direct_question" }> = {
        kind: "direct_question",
        question: request.question,
        ...(request.selection ? { selected_text: request.selection.selectedText } : {}),
      };
      const anchor = request.selection ? frozenSnapshot(request.selection) : null;
      const created = createConversationFromFirstSuccess(
        nextContext,
        conversationId,
        anchor,
        material,
        event.response,
      );
      return {
        ...state,
        request: firstSuccessRequest(created.conversation.anchor, event.response, conversationId),
        conversationContext: created.context,
        pendingFirstConversationId: null,
        directQuestionDraft: "",
      };
    }
    case "fail_direct_question": {
      const request = state.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      // 失败终态丢弃部分流式草稿（done 全文才是最终事实）。
      const { streamedText: _dropped, ...rest } = request;
      return { ...state, request: { ...rest, status: "error", error: event.error } };
    }
    case "require_direct_question_configuration": {
      const request = state.request;
      if (request.kind !== "direct_question" || request.status !== "loading") return state;
      const { streamedText: _dropped, ...rest } = request;
      return { ...state, request: { ...rest, status: "configuration_required" } };
    }
    case "append_stream_text": {
      // 流式增量只推进「生成中」的请求：直接提问 loading 或对话内无错误的待答轮次。
      // 其余状态原样返回（同一引用），迟到增量一律丢弃。
      const request = state.request;
      if (request.kind === "direct_question" && request.status === "loading") {
        return {
          ...state,
          request: { ...request, streamedText: (request.streamedText ?? "") + event.text },
        };
      }
      if (request.kind === "loading" && request.phase === "first") {
        return {
          ...state,
          request: { ...request, streamedText: (request.streamedText ?? "") + event.text },
        };
      }
      const conversation = state.conversationContext.conversation;
      const pending = conversation?.pending;
      if (conversation && pending && !pending.error) {
        return {
          ...state,
          conversationContext: {
            ...state.conversationContext,
            conversation: {
              ...conversation,
              pending: { ...pending, streamedText: (pending.streamedText ?? "") + event.text },
            },
          },
        };
      }
      return state;
    }
    case "begin_recovery": {
      // 驱动进程丢失：仅当存在对话时进入恢复态（保留对话与锚点）。
      const conversation = state.conversationContext.conversation;
      if (!conversation) return state;
      return {
        ...state,
        request: recoveringRequest(conversation.anchor, conversation.id),
      };
    }
    case "complete_recovery": {
      // 恢复成功：回到对话成功显示（done 全文以重放前的首轮回应为准）。
      const request = state.request;
      const conversation = state.conversationContext.conversation;
      if (request.kind !== "recovering" || !conversation) return state;
      return {
        ...state,
        request: firstSuccessRequest(
          conversation.anchor,
          conversation.firstResponse,
          conversation.id,
        ),
      };
    }
    case "fail_recovery": {
      // 恢复失败：进入错误态，引导用户新建对话。
      const request = state.request;
      if (request.kind !== "recovering") return state;
      return {
        ...state,
        request: firstErrorRequest(request.snapshot, {
          code: "service",
          message: "对话恢复失败，请点击新建对话开始新对话",
        }, { conversationId: request.conversationId }),
      };
    }
    case "close":
      return state.visibility === "closed" ? state : { ...state, visibility: "closed" };
    case "open":
      return state.visibility === "open" ? state : { ...state, visibility: "open" };
    case "new_conversation": {
      // 纯空 idle 状态（无对话、无进行中请求）没有可结束的内容：原样返回，不通知。
      if (!hasEndableConversationWork(state)) return state;
      // 保留单调递增的对话 ID 计数器并预分配下一身份：
      // 后续首轮请求不会复用任何旧对话身份（新建对话与 reset 都保留计数器）。
      const allocation = allocateConversationId(state.conversationContext);
      return {
        ...state,
        visibility: "open",
        request: idleRequest(),
        conversationContext: clearConversationContext(allocation.context),
        pendingFirstConversationId: null,
        pendingFirstRequest: null,
        directQuestionDraft: "",
        pendingSelection: null,
        ignoredSelection: null,
      };
    }
    case "reset":
      // 保留 id 计数器：与旧实现 `conversationState.clear()` 一致
      return {
        ...state,
        visibility: "closed",
        request: idleRequest(),
        conversationContext: clearConversationContext(state.conversationContext),
        pendingFirstConversationId: null,
        pendingFirstRequest: null,
        directQuestionDraft: "",
        pendingSelection: null,
        ignoredSelection: null,
      };
  }
}
