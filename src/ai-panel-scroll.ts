import type { PanelRequestState } from "./ai-panel-state.ts";
import type { SelectionSnapshot } from "./types.ts";

function sameSnapshot(left: SelectionSnapshot, right: SelectionSnapshot): boolean {
  return (
    left.notebook === right.notebook &&
    left.start === right.start &&
    left.end === right.end &&
    left.selectedText === right.selectedText
  );
}

export class AiPanelScrollResetController {
  private lastRequestSnapshot: SelectionSnapshot | null = null;

  shouldReset(request: PanelRequestState): boolean {
    if (request.kind !== "loading") {
      return false;
    }
    if (this.lastRequestSnapshot && sameSnapshot(this.lastRequestSnapshot, request.snapshot)) {
      return false;
    }
    this.lastRequestSnapshot = request.snapshot;
    return true;
  }
}
