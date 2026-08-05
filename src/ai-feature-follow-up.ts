import type { AiPanelState } from "./ai-panel-state.ts";
import type { GenerateAiRequest } from "./types.ts";

type FollowUpRequest = (
  payload: GenerateAiRequest,
  identity: { conversationId: number; turnId: number },
) => Promise<void> | null;

export function followUpAcceptedRequest(
  state: AiPanelState,
  question: string,
  request: FollowUpRequest,
): boolean {
  const turnId = state.beginFollowUp(question);
  const identity = state.conversationIdentity;
  const payload = state.followUpRequest();
  if (turnId === null || !identity || identity.turnId === undefined || !payload) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) {
    state.cancelFollowUp(turnId);
    return false;
  }
  return true;
}

export function retryFollowUpAcceptedRequest(
  state: AiPanelState,
  request: FollowUpRequest,
): boolean {
  const payload = state.retryFollowUpRequest();
  const identity = state.conversationIdentity;
  if (!payload || !identity || identity.turnId === undefined) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) return false;
  return state.acceptFollowUpRetry();
}

export function editAndResendFollowUpAcceptedRequest(
  state: AiPanelState,
  question: string,
  request: FollowUpRequest,
): boolean {
  const payload = state.followUpRequestForQuestion(question);
  const identity = state.conversationIdentity;
  if (!payload || !identity || identity.turnId === undefined) return false;
  const accepted = request(payload, {
    conversationId: identity.conversationId,
    turnId: identity.turnId,
  });
  if (accepted === null) {
    return false;
  }
  return state.acceptEditedFollowUp(question);
}
