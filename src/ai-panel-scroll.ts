import type { PanelRequestState } from "./ai-panel-state.ts";
import type { SelectionSnapshot } from "./types.ts";

function sameSnapshot(left: SelectionSnapshot, right: SelectionSnapshot): boolean {
  return (
    left.documentId === right.documentId &&
    left.from === right.from &&
    left.to === right.to &&
    left.selectedText === right.selectedText
  );
}

export class AiPanelScrollResetController {
  private lastConversationId: number | null = null;
  private lastRequestSnapshot: SelectionSnapshot | null = null;

  shouldReset(request: PanelRequestState): boolean {
    if (request.kind !== "loading") {
      return false;
    }
    if (
      request.conversationId !== undefined &&
      this.lastConversationId !== null &&
      request.conversationId !== this.lastConversationId
    ) {
      this.lastConversationId = request.conversationId;
      this.lastRequestSnapshot = request.snapshot;
      return true;
    }
    if (this.lastRequestSnapshot && sameSnapshot(this.lastRequestSnapshot, request.snapshot)) {
      return false;
    }
    this.lastConversationId = request.conversationId ?? null;
    this.lastRequestSnapshot = request.snapshot;
    return true;
  }
}
