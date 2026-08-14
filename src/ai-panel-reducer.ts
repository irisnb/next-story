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
} from "./ai-panel-conversation.ts";
import {
  cancelFollowUpSuccessRequest,
  configurationRequiredRequest,
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
  thinkingExpansionRequest,
  type PanelRequestState,
  type PanelVisibility,
} from "./ai-panel-request-state.ts";
import type { GenerateAiError, GenerateAiRequest, SelectionSnapshot } from "./types.ts";

/**
 * AI 面板核心状态的显式数据模型（reducer 的输入 / 输出）。
 *
 * 与旧 `AiPanelState` 的字段一一对应：
 * - `visibility`：面板展开 / 收起。收起只改这一维，不清空 `request`。
 * - `request`：idle / loading / success / error / configuration_required。
 * - `conversationContext`：临时对话本体与 id 计数器（单调递增，`reset` 也不清零）。
 * - `pendingFirstConversationId`：首轮召唤分配的对话身份，成功前保留。
 * - `pendingFirstRequest`：首轮候选请求（含思维扩展方向），失败后重试仍可用。
 */
export interface AiPanelCoreState {
  readonly visibility: PanelVisibility;
  readonly request: PanelRequestState;
  readonly conversationContext: TemporaryConversationContext;
  readonly pendingFirstConversationId: number | null;
  readonly pendingFirstRequest: Extract<GenerateAiRequest, { kind: "first" }> | null;
}

export function initialAiPanelCoreState(): AiPanelCoreState {
  return {
    visibility: "closed",
    request: idleRequest(),
    conversationContext: emptyConversationContext(),
    pendingFirstConversationId: null,
    pendingFirstRequest: null,
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
      readonly firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>;
    }
  | { readonly type: "block_first_request"; readonly snapshot: SelectionSnapshot }
  | {
      readonly type: "begin_request";
      readonly snapshot: SelectionSnapshot;
      readonly firstRequest?: Extract<GenerateAiRequest, { kind: "first" }>;
    }
  | { readonly type: "begin_thinking_expansion"; readonly snapshot: SelectionSnapshot }
  | { readonly type: "update_thinking_expansion_direction"; readonly direction: string }
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
  | { readonly type: "close" }
  | { readonly type: "open" }
  | { readonly type: "reset" };

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
          event.firstRequest ?? { kind: "first", selected_text: anchor.selectedText },
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
          event.firstRequest ?? { kind: "first", selected_text: anchor.selectedText },
      };
    }
    case "begin_thinking_expansion": {
      return {
        ...state,
        visibility: "open",
        conversationContext: clearConversationContext(state.conversationContext),
        request: thinkingExpansionRequest(frozenSnapshot(event.snapshot), ""),
        pendingFirstConversationId: null,
        pendingFirstRequest: null,
      };
    }
    case "update_thinking_expansion_direction": {
      const request = state.request;
      if (request.kind !== "thinking_expansion") return state;
      return { ...state, request: thinkingExpansionRequest(request.snapshot, event.direction) };
    }
    case "succeed": {
      let nextContext = state.conversationContext;
      let conversationId: number;
      if (state.pendingFirstConversationId === null) {
        conversationId = nextContext.nextConversationId;
        nextContext = { ...nextContext, nextConversationId: nextContext.nextConversationId + 1 };
      } else {
        conversationId = state.pendingFirstConversationId;
      }
      const created = createConversationFromFirstSuccess(
        nextContext,
        conversationId,
        event.snapshot,
        state.pendingFirstRequest ?? { kind: "first", selected_text: event.snapshot.selectedText },
        event.response,
      );
      return {
        ...state,
        request: firstSuccessRequest(created.conversation.anchor, event.response, conversationId),
        conversationContext: created.context,
        pendingFirstRequest: null,
      };
    }
    case "fail": {
      const identity = state.request.kind === "loading" ? state.request : null;
      return {
        ...state,
        request: firstErrorRequest(frozenSnapshot(event.snapshot), event.error, identity),
      };
    }
    case "require_configuration": {
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
    case "close":
      return state.visibility === "closed" ? state : { ...state, visibility: "closed" };
    case "open":
      return state.visibility === "open" ? state : { ...state, visibility: "open" };
    case "reset":
      // 保留 id 计数器：与旧实现 `conversationState.clear()` 一致
      return {
        ...state,
        visibility: "closed",
        request: idleRequest(),
        conversationContext: clearConversationContext(state.conversationContext),
        pendingFirstConversationId: null,
        pendingFirstRequest: null,
      };
  }
}
