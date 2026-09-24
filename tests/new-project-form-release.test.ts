import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import type { AppDom } from "../src/dom.ts";
import { setupProjectFlow, type ProjectFlowHandle } from "../src/new-project-form.ts";

function fixture(release: () => void, guardLeave: () => Promise<boolean> = async () => false) {
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = window.document as unknown as Document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const elements = new Map<string, HTMLElement>();
  const dom = new Proxy({} as AppDom, {
    get(_target, key: string) {
      if (!elements.has(key)) {
        const element = document.createElement(key.startsWith("btn") ? "button" : key.endsWith("Input") ? "input" : "div");
        elements.set(key, element);
        document.body.append(element);
      }
      return elements.get(key);
    },
  });
  const unexpected = async (): Promise<never> => { throw new Error("No external service expected after cancellation"); };
  const flow = setupProjectFlow(dom, {
    release, guardLeave, onProjectReady: unexpected,
    services: {
      createProject: unexpected, openContentTree: unexpected, loadRecentWorks: async () => [],
      openProject: async () => ({
        metadata: { name: "合成", created_at: "2026-01-01", updated_at: "2026-01-01", version: 3 },
        tree: { root_children: [], nodes: {}, recycle_bin: [] },
      }),
    },
  });
  dom.projectNameInput.value = "合成";
  dom.saveLocationInput.value = "unused";
  return {
    dom, flow,
    async cleanup() {
      flow.destroy();
      await window.happyDOM.abort();
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else Reflect.deleteProperty(globalThis, "document");
    },
  };
}

function start(flow: ProjectFlowHandle, kind: "open" | "create") {
  return kind === "open" ? flow.openPath("unused") : flow.create();
}

for (const kind of ["open", "create"] as const) {
  test(`${kind} clears its busy state and restores controls before owner release`, async () => {
    const observed: Array<{ busy: boolean; disabled: boolean }> = [];
    const ui = fixture(() => observed.push({ busy: ui.flow.isBusy(), disabled: ui.dom.btnOpenProject.disabled }));
    try {
      assert.deepEqual(await start(ui.flow, kind), { status: "cancelled" });
      assert.deepEqual([...observed], [{ busy: false, disabled: false }]);
    } finally { await ui.cleanup(); }
  });

  test(`${kind} owner release can start another operation without the old finally unlocking it`, async () => {
    let finish!: (value: boolean) => void;
    let calls = 0;
    let next: ReturnType<typeof start> | undefined;
    const ui = fixture(() => {
      if (!next && calls === 1) next = start(ui.flow, kind);
    }, () => {
      calls += 1;
      return calls === 1 ? Promise.resolve(false) : new Promise<boolean>((resolve) => { finish = resolve; });
    });
    try {
      assert.equal((await start(ui.flow, kind)).status, "cancelled");
      for (let tick = 0; tick < 30 && calls < 2; tick += 1) await Promise.resolve();
      assert.equal(calls, 2);
      assert.equal(ui.flow.isBusy(), true);
      assert.equal(ui.dom.btnOpenProject.disabled, true);
      finish(false);
      assert.equal((await next)?.status, "cancelled");
      assert.equal(ui.flow.isBusy(), false);
    } finally { await ui.cleanup(); }
  });

  test(`${kind} late finally after destroy does not release twice or touch controls`, async () => {
    let finish!: (value: boolean) => void;
    let releases = 0;
    const ui = fixture(() => { releases += 1; }, () => new Promise<boolean>((resolve) => { finish = resolve; }));
    try {
      const pending = start(ui.flow, kind);
      for (let tick = 0; tick < 30 && !finish; tick += 1) await Promise.resolve();
      assert.ok(finish);
      ui.flow.destroy();
      assert.equal(releases, 1);
      finish(true);
      assert.equal((await pending).status, "stale");
      assert.equal(releases, 1);
      assert.equal(ui.dom.btnOpenProject.disabled, true);
    } finally { await ui.cleanup(); }
  });
}
