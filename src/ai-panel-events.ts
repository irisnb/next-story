import type {
  FirstRoundMaterial,
  TemporaryConversation,
} from "./ai-panel-conversation.ts";
import type {
  ConversationSummary,
  MaterialProvenance,
  OnDemandReadingGrant,
  OnDemandReadingProvenance,
} from "./conversation-archive.ts";
import type { GenerateAiError, SelectionSnapshot } from "./types.ts";

/**
 * AI 面板事件类型的单一事实源（change: extract-ai-logic-seams 任务 2.1）。
 *
 * 本模块只定义 `AiPanelEvent` 联合与它的配套载荷类型（`PendingReadingRequest` /
 * `ReadingProgress` / `WindowPlacement`），不包含任何状态或迁移逻辑。
 * reducer 与各消费方经本模块（或 `ai-panel-reducer.ts` 的重导出）使用同一类型，
 * 全仓库不出现第二份定义或形状分叉。
 */

/** 窗口的停靠状态；浮动行为后续 wave 实现，本 wave 全部为「停靠」。 */
export type WindowPlacement = "docked" | "floating";

/**
 * 待决的按需补读授权请求（add-agent-on-demand-reading 任务 7.1）：后端拦截
 * `story-request-reading` 后转来的授权提示。等待期间该轮挂起；用户决定经
 * `ai_resolve_reading_request` 回填。停止生成取消等待时一并清除。
 */
export interface PendingReadingRequest {
  readonly sessionId: string;
  readonly messageId: string;
  readonly callId: string;
  /** 模型提供的请求原因（透传）。 */
  readonly reason: string;
}

/**
 * 补读过程的轻量状态（任务 7.3）：由 `ai-tool-call` 事件驱动；只记录正在做什么
 * 与工具引用过的文档身份，不记录（也不展示）模型内部推理。显示层只在生成中呈现。
 */
export interface ReadingProgress {
  /** 最近一次工具的活动：列目录 / 检索 / 阅读。 */
  readonly status: "listing" | "searching" | "reading";
  /** 工具（story-read）引用过的文档身份（去重，按出现顺序）。 */
  readonly documentIds: readonly string[];
}

/**
 * 面板全部可观察操作的事件。非法迁移由 reducer 原样返回输入状态（同一引用），
 * 调用方据此不触发通知。
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
      readonly conversationId: string;
      readonly createdAt: string;
      readonly focusDocumentId: string | null;
      readonly focusDocumentTitle: string | null;
    }
  | {
      readonly type: "succeed";
      readonly snapshot: SelectionSnapshot;
      readonly response: string;
      readonly conversationId: string;
    }
  | {
      readonly type: "fail";
      readonly snapshot: SelectionSnapshot;
      readonly error: GenerateAiError;
      readonly conversationId: string;
    }
  | {
      readonly type: "require_configuration";
      readonly snapshot: SelectionSnapshot;
      readonly conversationId: string;
    }
  | { readonly type: "begin_follow_up"; readonly question: string }
  | {
      readonly type: "succeed_follow_up";
      readonly turnId: number;
      readonly response: string;
      readonly conversationId: string;
    }
  | {
      readonly type: "fail_follow_up";
      readonly turnId: number;
      readonly error: GenerateAiError;
      readonly conversationId: string;
    }
  | {
      readonly type: "require_follow_up_configuration";
      readonly turnId: number;
      readonly conversationId: string;
    }
  | { readonly type: "accept_edited_follow_up"; readonly question: string }
  | { readonly type: "cancel_follow_up"; readonly turnId: number }
  | { readonly type: "accept_follow_up_retry" }
  | { readonly type: "accept_first_retry" }
  | { readonly type: "update_direct_question_draft"; readonly conversationId: string; readonly question: string }
  | { readonly type: "set_pending_selection"; readonly snapshot: SelectionSnapshot | null }
  | { readonly type: "remove_pending_selection" }
  | {
      readonly type: "begin_direct_question";
      readonly question: string;
      readonly selection: SelectionSnapshot | null;
      readonly conversationId: string;
      readonly createdAt: string;
      readonly focusDocumentId: string | null;
      readonly focusDocumentTitle: string | null;
    }
  | { readonly type: "succeed_direct_question"; readonly response: string; readonly conversationId: string }
  | { readonly type: "fail_direct_question"; readonly error: GenerateAiError; readonly conversationId: string }
  | { readonly type: "require_direct_question_configuration"; readonly conversationId: string }
  | { readonly type: "append_stream_text"; readonly conversationId: string; readonly text: string }
  | { readonly type: "begin_recovery"; readonly conversationId: string }
  | { readonly type: "complete_recovery"; readonly conversationId: string }
  | { readonly type: "fail_recovery"; readonly conversationId: string }
  | { readonly type: "close" }
  | { readonly type: "open" }
  | {
      readonly type: "new_conversation";
      readonly conversationId: string;
      readonly createdAt: string;
      readonly focusDocumentId: string | null;
      readonly focusDocumentTitle: string | null;
    }
  | { readonly type: "reset" }
  | {
      readonly type: "load_discussions";
      readonly summaries: readonly ConversationSummary[];
      readonly skipped: readonly string[];
      readonly hiddenDocumentIds: ReadonlySet<string>;
    }
  | { readonly type: "recompute_restrictions"; readonly hiddenDocumentIds: ReadonlySet<string> }
  | {
      readonly type: "open_discussion";
      readonly conversation: TemporaryConversation;
      readonly focusDocumentId: string | null;
      readonly focusDocumentTitle: string | null;
    }
  | { readonly type: "delete_discussion"; readonly conversationId: string }
  | { readonly type: "set_save_error"; readonly message: string }
  | { readonly type: "clear_save_error" }
  | { readonly type: "stop_request"; readonly conversationId: string }
  | { readonly type: "focus_window"; readonly conversationId: string }
  | { readonly type: "close_window"; readonly conversationId: string }
  | { readonly type: "retry_direct_question"; readonly conversationId: string }
  | { readonly type: "retry_stopped_follow_up" }
  | { readonly type: "set_window_placement"; readonly conversationId: string; readonly placement: WindowPlacement }
  | { readonly type: "reset_layout" }
  | { readonly type: "queue_request"; readonly conversationId: string }
  | { readonly type: "start_queued_request"; readonly conversationId: string }
  | { readonly type: "reject_queued_request"; readonly conversationId: string; readonly error: GenerateAiError }
  | { readonly type: "rename_discussion"; readonly conversationId: string; readonly title: string }
  | { readonly type: "set_discussion_pinned"; readonly conversationId: string; readonly pinned: boolean }
  | {
      readonly type: "record_round_provenance";
      readonly conversationId: string;
      readonly entries: MaterialProvenance[];
    }
  | {
      readonly type: "set_focus_document";
      readonly conversationId: string;
      readonly focusDocumentId: string | null;
      readonly focusDocumentTitle: string | null;
    }
  | {
      readonly type: "reading_request";
      readonly conversationId: string;
      readonly sessionId: string;
      readonly messageId: string;
      readonly callId: string;
      readonly reason: string;
    }
  | { readonly type: "resolve_reading_request"; readonly conversationId: string; readonly granted: boolean }
  | { readonly type: "set_on_demand_reading"; readonly conversationId: string; readonly granted: boolean }
  | {
      readonly type: "note_tool_call";
      readonly conversationId: string;
      readonly tool: string;
      readonly documentId?: string;
    }
  | {
      readonly type: "update_on_demand_state";
      readonly conversationId: string;
      readonly grant: OnDemandReadingGrant | null;
      readonly provenance: OnDemandReadingProvenance[] | null;
    };
