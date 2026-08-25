import type { GenerateAiError, SelectionSnapshot } from "./types.ts";

export type PanelVisibility = "open" | "closed";

export type PanelRequestState =
  | { kind: "idle" }
  | {
      kind: "first_preview";
      snapshot: SelectionSnapshot | null;
    }
  | {
      kind: "first_blocked";
      snapshot: SelectionSnapshot | null;
      message: string;
    }
  | {
      kind: "thinking_expansion";
      snapshot: SelectionSnapshot | null;
      direction: string;
    }
  | {
      kind: "loading";
      snapshot: SelectionSnapshot | null;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "success";
      snapshot: SelectionSnapshot | null;
      response: string;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "error";
      snapshot: SelectionSnapshot | null;
      error: GenerateAiError;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "configuration_required";
      snapshot: SelectionSnapshot | null;
      conversationId?: number;
      turnId?: number;
    }
  | {
      kind: "direct_question";
      question: string;
      selection: SelectionSnapshot | null;
      status: "loading" | "error" | "configuration_required";
      error?: GenerateAiError;
    };

export interface PanelStateView {
  visibility: PanelVisibility;
  request: PanelRequestState;
  /** 直接提问的未发送草稿。 */
  directQuestionDraft: string;
  /** 当前待附带的选区重点材料；无选区时为 null。 */
  pendingSelection: SelectionSnapshot | null;
}

export function idleRequest(): PanelRequestState {
  return { kind: "idle" };
}

export function firstPreviewRequest(snapshot: SelectionSnapshot | null): PanelRequestState {
  return { kind: "first_preview", snapshot };
}

export function firstBlockedRequest(snapshot: SelectionSnapshot | null): PanelRequestState {
  return { kind: "first_blocked", snapshot, message: "已有 AI 请求正在进行，本次请求没有发出。" };
}

export function thinkingExpansionRequest(
  snapshot: SelectionSnapshot | null,
  direction: string,
): PanelRequestState {
  return { kind: "thinking_expansion", snapshot, direction };
}

export function firstLoadingRequest(
  snapshot: SelectionSnapshot | null,
  conversationId: number,
): PanelRequestState {
  return { kind: "loading", snapshot, conversationId, phase: "first" };
}

export function firstSuccessRequest(
  snapshot: SelectionSnapshot | null,
  response: string,
  conversationId: number,
): PanelRequestState {
  return { kind: "success", snapshot, response, conversationId, phase: "first" };
}

export function firstErrorRequest(
  snapshot: SelectionSnapshot | null,
  error: GenerateAiError,
  identity: { conversationId?: number; phase?: "first" | "follow_up" } | null,
): PanelRequestState {
  if (identity?.conversationId === undefined) {
    return { kind: "error", snapshot, error };
  }
  return {
    kind: "error",
    snapshot,
    error,
    conversationId: identity.conversationId,
    phase: identity.phase,
  };
}

export function configurationRequiredRequest(
  snapshot: SelectionSnapshot | null,
  conversationId?: number,
  turnId?: number,
): PanelRequestState {
  if (conversationId === undefined) {
    return { kind: "configuration_required", snapshot };
  }
  if (turnId === undefined) {
    return { kind: "configuration_required", snapshot, conversationId };
  }
  return { kind: "configuration_required", snapshot, conversationId, turnId };
}

export function followUpLoadingRequest(
  snapshot: SelectionSnapshot | null,
  conversationId: number,
  turnId: number,
): PanelRequestState {
  return {
    kind: "loading",
    snapshot,
    conversationId,
    phase: "follow_up",
    turnId,
  };
}

export function followUpSuccessRequest(
  snapshot: SelectionSnapshot | null,
  response: string,
  conversationId: number,
  turnId: number,
): PanelRequestState {
  return {
    kind: "success",
    snapshot,
    response,
    conversationId,
    phase: "follow_up",
    turnId,
  };
}

export function followUpErrorRequest(
  snapshot: SelectionSnapshot | null,
  error: GenerateAiError,
  conversationId: number,
  turnId: number,
): PanelRequestState {
  return {
    kind: "error",
    snapshot,
    error,
    conversationId,
    phase: "follow_up",
    turnId,
  };
}

export function cancelFollowUpSuccessRequest(
  snapshot: SelectionSnapshot | null,
  response: string,
): PanelRequestState {
  return { kind: "success", snapshot, response };
}

export function firstRetryLoadingRequest(
  snapshot: SelectionSnapshot | null,
  conversationId: number,
): PanelRequestState {
  return {
    kind: "loading",
    snapshot,
    conversationId,
    phase: "first",
  };
}

export function directQuestionLoadingRequest(
  question: string,
  selection: SelectionSnapshot | null,
): PanelRequestState {
  return { kind: "direct_question", question, selection, status: "loading" };
}
