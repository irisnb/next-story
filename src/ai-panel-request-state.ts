import type { GenerateAiError, SelectionSnapshot } from "./types.ts";

export type PanelVisibility = "open" | "closed";

export type PanelRequestState =
  | { kind: "idle" }
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
