import type { GenerateAiError, SelectionSnapshot } from "./types.ts";

export type PanelVisibility = "open" | "closed";

export type PanelRequestState =
  | { kind: "idle" }
  | {
      kind: "first_preview";
      snapshot: SelectionSnapshot;
    }
  | {
      kind: "first_blocked";
      snapshot: SelectionSnapshot;
      message: string;
    }
  | {
      kind: "thinking_expansion";
      snapshot: SelectionSnapshot;
      direction: string;
    }
  | {
      kind: "loading";
      snapshot: SelectionSnapshot;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "success";
      snapshot: SelectionSnapshot;
      response: string;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "error";
      snapshot: SelectionSnapshot;
      error: GenerateAiError;
      conversationId?: number;
      phase?: "first" | "follow_up";
      turnId?: number;
    }
  | {
      kind: "configuration_required";
      snapshot: SelectionSnapshot;
      conversationId?: number;
      turnId?: number;
    };

export interface PanelStateView {
  visibility: PanelVisibility;
  request: PanelRequestState;
}

export function idleRequest(): PanelRequestState {
  return { kind: "idle" };
}

export function firstPreviewRequest(snapshot: SelectionSnapshot): PanelRequestState {
  return { kind: "first_preview", snapshot };
}

export function firstBlockedRequest(snapshot: SelectionSnapshot): PanelRequestState {
  return { kind: "first_blocked", snapshot, message: "已有 AI 请求正在进行，本次请求没有发出。" };
}

export function thinkingExpansionRequest(
  snapshot: SelectionSnapshot,
  direction: string,
): PanelRequestState {
  return { kind: "thinking_expansion", snapshot, direction };
}

export function firstLoadingRequest(
  snapshot: SelectionSnapshot,
  conversationId: number,
): PanelRequestState {
  return { kind: "loading", snapshot, conversationId, phase: "first" };
}

export function firstSuccessRequest(
  snapshot: SelectionSnapshot,
  response: string,
  conversationId: number,
): PanelRequestState {
  return { kind: "success", snapshot, response, conversationId, phase: "first" };
}

export function firstErrorRequest(
  snapshot: SelectionSnapshot,
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
  snapshot: SelectionSnapshot,
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
  snapshot: SelectionSnapshot,
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
  snapshot: SelectionSnapshot,
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
  snapshot: SelectionSnapshot,
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
  snapshot: SelectionSnapshot,
  response: string,
): PanelRequestState {
  return { kind: "success", snapshot, response };
}

export function firstRetryLoadingRequest(
  snapshot: SelectionSnapshot,
  conversationId: number,
): PanelRequestState {
  return {
    kind: "loading",
    snapshot,
    conversationId,
    phase: "first",
  };
}
