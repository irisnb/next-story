import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";
import type { AppDom } from "../src/dom.ts";
import { createFocusRestorer, setupLeaveDialog } from "../src/leave-dialog.ts";

test("restores focus to the connected element that invoked the leave dialog", () => {
  let focuses = 0;
  const invoker = {
    isConnected: true,
    focus: () => { focuses += 1; },
  };
  const restore = createFocusRestorer(() => invoker);

  restore.capture();
  restore.restore();

  assert.equal(focuses, 1);
});

test("does not focus an invoking element that was disconnected before the dialog finished", () => {
  let focuses = 0;
  const invoker = {
    isConnected: true,
    focus: () => { focuses += 1; },
  };
  const restore = createFocusRestorer(() => invoker);

  restore.capture();
  invoker.isConnected = false;
  restore.restore();

  assert.equal(focuses, 0);
});

test("focus helper consumes its capture once", () => {
  let focused = 0;
  const restore = createFocusRestorer(() => ({ isConnected: true, focus() { focused += 1; } }));
  restore.capture(); restore.restore(); restore.restore();
  assert.equal(focused, 1);
});

// Body selection belongs to the pause handle / workspace owner, not this helper.
for (const external of [false, true]) {
  test(`real leave dialog cancel preserves default focus behavior (external owner=${external})`, async () => {
    const window = new Window();
    const previous = new Map(["document", "HTMLElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: window.document },
      HTMLElement: { configurable: true, value: window.HTMLElement },
    });
    try {
      const document = window.document;
      const invoker = document.createElement("button");
      const dialog = document.createElement("dialog");
      const cancel = document.createElement("button");
      const discard = document.createElement("button");
      const save = document.createElement("button");
      dialog.append(cancel, discard, save);
      document.body.append(invoker, dialog);
      const controller = setupLeaveDialog({ leaveDialog: dialog, btnCancelLeave: cancel, btnDiscardAndLeave: discard, btnSaveAndLeave: save } as unknown as AppDom);
      invoker.focus();
      let restored = 0;
      invoker.addEventListener("focus", () => { restored += 1; });
      const waiting = external ? controller.choose({ restoreFocusExternally: true }) : controller.choose();
      assert.equal(document.activeElement, cancel);
      cancel.click();
      assert.equal(await waiting, "cancel");
      assert.equal(dialog.open, false);
      assert.equal(restored, external ? 0 : 1);
      if (!external) assert.equal(document.activeElement, invoker);
      // An externally-owned call must not disable the default for the next dialog.
      invoker.focus(); restored = 0;
      const next = controller.choose();
      cancel.click();
      assert.equal(await next, "cancel");
      assert.equal(restored, 1);
    } finally {
      await window.happyDOM.abort();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
