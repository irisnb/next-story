import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { confirmDialog, installNativeDialogs, showMessage } from "../src/app-dialog.ts";

test("installNativeDialogs routes confirm to the injected implementation", async () => {
  const previous = globalThis.confirm;
  try {
    const messages: string[] = [];
    installNativeDialogs({
      confirm: async (message) => { messages.push(message); return true; },
    });
    assert.equal(await globalThis.confirm("x"), true);
    assert.deepEqual(messages, ["x"]);
  } finally {
    globalThis.confirm = previous;
  }
});

test("installNativeDialogs routes alert to message and consumes rejection", async () => {
  const previous = globalThis.alert;
  const unhandled: unknown[] = [];
  const collect = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", collect);
  try {
    const messages: string[] = [];
    installNativeDialogs({
      message: async (message) => { messages.push(message); throw new Error("授权被拒"); },
    });
    assert.equal(globalThis.alert("y"), undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(messages, ["y"]);
    assert.deepEqual(unhandled, []);
  } finally {
    globalThis.alert = previous;
    process.off("unhandledRejection", collect);
  }
});

for (const expected of [false, true]) {
  test(`confirmDialog accepts synchronous ${expected}`, async () => {
    const previous = globalThis.confirm;
    try {
      globalThis.confirm = (message) => {
        assert.equal(message, "确认文案");
        return expected;
      };
      assert.equal(await confirmDialog("确认文案"), expected);
    } finally {
      globalThis.confirm = previous;
    }
  });

  test(`confirmDialog awaits Promise(${expected})`, async () => {
    const previous = globalThis.confirm;
    try {
      globalThis.confirm = (() => Promise.resolve(expected)) as unknown as typeof globalThis.confirm;
      assert.equal(await confirmDialog("确认文案"), expected);
    } finally {
      globalThis.confirm = previous;
    }
  });
}

test("confirmDialog treats synchronous errors and Promise rejection as unconfirmed", async () => {
  const previous = globalThis.confirm;
  try {
    globalThis.confirm = () => { throw new Error("调用失败"); };
    assert.equal(await confirmDialog("确认文案"), false);
    globalThis.confirm = (() => Promise.reject(new Error("授权被拒"))) as unknown as typeof globalThis.confirm;
    assert.equal(await confirmDialog("确认文案"), false);
  } finally {
    globalThis.confirm = previous;
  }
});

test("confirmDialog preserves permission to proceed when confirm is not a function", async () => {
  const previous = globalThis.confirm;
  try {
    for (const value of [undefined, null, false]) {
      globalThis.confirm = value as unknown as typeof globalThis.confirm;
      assert.equal(await confirmDialog("确认文案"), true);
    }
  } finally {
    globalThis.confirm = previous;
  }
});

test("showMessage calls a synchronous alert with the original message", () => {
  const previous = globalThis.alert;
  const messages: string[] = [];
  try {
    globalThis.alert = (message) => { messages.push(message); };
    assert.equal(showMessage("提示文案"), undefined);
    assert.deepEqual(messages, ["提示文案"]);
  } finally {
    globalThis.alert = previous;
  }
});

test("showMessage does nothing when alert is not a function", () => {
  const previous = globalThis.alert;
  try {
    globalThis.alert = undefined as unknown as typeof globalThis.alert;
    assert.equal(showMessage("提示文案"), undefined);
  } finally {
    globalThis.alert = previous;
  }
});

test("showMessage consumes asynchronous rejection without unhandledRejection", async () => {
  const previous = globalThis.alert;
  const unhandled: unknown[] = [];
  const collect = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", collect);
  try {
    globalThis.alert = () => Promise.reject(new Error("授权被拒"));
    assert.equal(showMessage("提示文案"), undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    globalThis.alert = previous;
    process.off("unhandledRejection", collect);
  }
});

test("main window capabilities authorize message but not deprecated confirm", async () => {
  const capability = JSON.parse(await readFile(
    new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8",
  ));
  assert.equal(capability.permissions.includes("dialog:allow-confirm"), false);
  assert.ok(capability.permissions.includes("dialog:allow-message"));
});
