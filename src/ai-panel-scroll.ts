import type { PanelRequestState } from "./ai-panel-state.ts";
import { sameSelectionSnapshot } from "./shared-storage-and-selection-identity.ts";
import type { SelectionSnapshot } from "./types.ts";

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
    if (
      request.snapshot !== null &&
      this.lastRequestSnapshot !== null &&
      sameSelectionSnapshot(this.lastRequestSnapshot, request.snapshot)
    ) {
      return false;
    }
    this.lastConversationId = request.conversationId ?? null;
    this.lastRequestSnapshot = request.snapshot;
    return true;
  }
}
