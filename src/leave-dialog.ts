import type { AppDom } from "./dom";
import type { LeaveChoice } from "./leave-guard";

export interface LeaveDialogController {
  choose(options?: { restoreFocusExternally?: boolean }): Promise<LeaveChoice>;
}

export interface FocusTarget {
  readonly isConnected: boolean;
  focus(): void;
}

export function createFocusRestorer(getActive: () => FocusTarget | null): {
  capture(): void;
  restore(): void;
} {
  let captured: FocusTarget | null = null;
  return {
    capture(): void {
      captured = getActive();
    },
    restore(): void {
      const target = captured;
      captured = null;
      if (target?.isConnected) target.focus();
    },
  };
}

export function setupLeaveDialog(dom: AppDom): LeaveDialogController {
  let pending: ((choice: LeaveChoice) => void) | null = null;
  let restoreFocusExternally = false;
  const focus = createFocusRestorer(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement ? active : null;
  });

  function finish(choice: LeaveChoice): void {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    dom.leaveDialog.close();
    if (!restoreFocusExternally) focus.restore();
    resolve(choice);
  }

  dom.btnSaveAndLeave.addEventListener("click", () => finish("save-and-leave"));
  dom.btnDiscardAndLeave.addEventListener("click", () => finish("discard-and-leave"));
  dom.btnCancelLeave.addEventListener("click", () => finish("cancel"));
  dom.leaveDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish("cancel");
  });

  return {
    choose(options = {}): Promise<LeaveChoice> {
      if (pending) return Promise.resolve("cancel");
      restoreFocusExternally = options.restoreFocusExternally ?? false;
      if (!restoreFocusExternally) focus.capture();
      dom.leaveDialog.showModal();
      dom.btnCancelLeave.focus();
      return new Promise((resolve) => { pending = resolve; });
    },
  };
}
