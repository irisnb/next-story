import assert from "node:assert/strict";
import test from "node:test";
import type { Editor, JSONContent } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import { Window } from "happy-dom";
import { createRichTextEditor } from "../src/rich-text-editor.ts";
import { canonicalNotebookJson } from "../src/structured-notebook.ts";

const initialDocument: JSONContent = {
  type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "起稿" }] }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const window = new Window({ url: "http://localhost" });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const globals: Record<string, unknown> = {
    window, document: window.document, navigator: window.navigator,
    Node: window.Node, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const adapter = createRichTextEditor(host as unknown as HTMLElement, initialDocument);
  const native = (host.firstElementChild as unknown as { editor: Editor }).editor;
  return {
    adapter, native, window,
    event(type: string) { return new window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event; },
    flushFrames() {
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(0);
    },
    async cleanup() {
      adapter.destroy();
      await window.happyDOM.abort();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("real kernel restores the captured reverse selection without changing the document", async () => {
  const f = fixture();
  try {
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 3, 1)));
    const before = f.native.state.selection.toJSON();
    const document = canonicalNotebookJson(f.adapter.getDocument());
    const pause = await f.adapter.pauseEditing();
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
    assert.notDeepEqual(f.native.state.selection.toJSON(), before);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), document);
    pause.resume();
    assert.equal(pause.restoreSelection(), true);
    assert.deepEqual(f.native.state.selection.toJSON(), before);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), document);
    const restoredState = f.native.state;
    pause.resume();
    assert.equal(pause.restoreSelection(), true);
    assert.equal(f.native.state, restoredState, "repeat restoration does not dispatch another transaction");
  } finally { await f.cleanup(); }
});

for (const kind of ["node", "all"] as const) {
  test(`pause restoration preserves ${kind} selection type`, async () => {
    const f = fixture();
    try {
      const selection = kind === "node"
        ? NodeSelection.create(f.native.state.doc, 0)
        : new AllSelection(f.native.state.doc);
      f.native.view.dispatch(f.native.state.tr.setSelection(selection));
      const before = f.native.state.selection.toJSON();
      const document = canonicalNotebookJson(f.adapter.getDocument());
      const pause = await f.adapter.pauseEditing();
      f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
      pause.resume();
      assert.equal(pause.restoreSelection(), true);
      assert.deepEqual(f.native.state.selection.toJSON(), before);
      assert.equal(canonicalNotebookJson(f.adapter.getDocument()), document);
    } finally { await f.cleanup(); }
  });
}

test("selection restoration adds no undo step and preserves pre-pause edit undo/redo", async () => {
  const f = fixture();
  try {
    f.native.commands.insertContent("已写");
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 5, 1)));
    const edited = canonicalNotebookJson(f.adapter.getDocument());
    const depths = { undo: undoDepth(f.native.state), redo: redoDepth(f.native.state) };
    assert.equal(depths.undo, 1);
    const pause = await f.adapter.pauseEditing();
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
    pause.resume();
    assert.equal(pause.restoreSelection(), true);
    assert.deepEqual({ undo: undoDepth(f.native.state), redo: redoDepth(f.native.state) }, depths);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), edited);
    assert.equal(f.native.commands.undo(), true);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), canonicalNotebookJson(initialDocument));
    assert.equal(undoDepth(f.native.state), 0);
    assert.equal(f.native.commands.redo(), true);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), edited);
  } finally { await f.cleanup(); }
});

test("an older pause handle cannot restore selection or resume a newer permit", async () => {
  const f = fixture();
  try {
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 3, 1)));
    const old = await f.adapter.pauseEditing();
    old.resume();
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
    const current = await f.adapter.pauseEditing();
    const state = f.native.state;
    old.resume();
    assert.equal(old.restoreSelection(), false);
    assert.equal(f.native.state, state);
    assert.equal(f.native.isEditable, false, "old resume cannot release the new pause");
    current.resume();
    assert.equal(current.restoreSelection(), true);
    assert.equal(f.native.isEditable, true);
  } finally { await f.cleanup(); }
});

test("a completed pause handle is inert after its editor is destroyed", async () => {
  const f = fixture();
  try {
    const pause = await f.adapter.pauseEditing();
    f.adapter.destroy();
    pause.resume();
    assert.equal(pause.restoreSelection(), false);
    assert.equal(pause.restoreSelection({ syncDOM: true }), false);
    assert.equal(f.native.isDestroyed, true);
    const afterDestroy = await f.adapter.pauseEditing();
    afterDestroy.resume();
    assert.equal(afterDestroy.restoreSelection(), false);
  } finally { await f.cleanup(); }
});

test("selection restoration refuses a changed document without rewriting it", async () => {
  const f = fixture();
  try {
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 3, 1)));
    const pause = await f.adapter.pauseEditing();
    pause.resume();
    f.native.commands.insertContent("新正文");
    const state = f.native.state;
    const changed = canonicalNotebookJson(f.adapter.getDocument());
    assert.equal(pause.restoreSelection(), false);
    assert.equal(f.native.state, state);
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), changed);
  } finally { await f.cleanup(); }
});

for (const editable of [true, false]) {
  test(`resume preserves editable=${editable} and neither resume nor default restoration steals focus`, async () => {
    const f = fixture();
    try {
      f.native.setEditable(editable, false);
      f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 3, 1)));
      const input = f.window.document.createElement("textarea");
      f.window.document.body.append(input);
      input.focus();
      const pause = await f.adapter.pauseEditing();
      f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
      pause.resume();
      assert.equal(f.native.isEditable, editable);
      assert.equal(f.native.state.selection.anchor, 2, "resume alone does not restore selection");
      assert.equal(f.window.document.activeElement, input);
      assert.equal(pause.restoreSelection(), true);
      assert.equal(f.native.state.selection.anchor, 3);
      assert.equal(f.native.state.selection.head, 1);
      assert.equal(f.window.document.activeElement, input);
      pause.resume();
      assert.equal(f.native.isEditable, editable);
      assert.equal(f.window.document.activeElement, input);
    } finally { await f.cleanup(); }
  });
}

test("DOM sync is an explicit synchronous focus opt-in after resume (not desktop certification)", async () => {
  const f = fixture();
  try {
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 3, 1)));
    const input = f.window.document.createElement("textarea");
    f.window.document.body.append(input);
    input.focus();
    const pause = await f.adapter.pauseEditing();
    f.native.view.dispatch(f.native.state.tr.setSelection(TextSelection.create(f.native.state.doc, 2)));
    assert.equal(pause.restoreSelection({ syncDOM: true }), false);
    assert.equal(f.native.state.selection.anchor, 2);
    assert.equal(f.window.document.activeElement, input);
    pause.resume();
    assert.equal(pause.restoreSelection({ syncDOM: true }), true);
    assert.equal(f.window.document.activeElement, f.native.view.dom);
    assert.equal(f.native.state.selection.anchor, 3);
    assert.equal(f.native.state.selection.head, 1);
  } finally { await f.cleanup(); }
});

test("real kernel waits for composition final update before pausing (synthetic, not native IME certification)", async () => {
  const f = fixture();
  try {
    f.native.view.dom.dispatchEvent(f.event("compositionstart"));
    assert.equal(f.native.view.composing, true);
    let finished = false;
    const waiting = f.adapter.pauseEditing().then((release) => { finished = true; return release; });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.equal(f.native.isEditable, true, "existing composition is not forcibly ended");
    assert.equal(f.adapter.runCommand({ kind: "bold" }), false, "unrelated commands cannot interrupt composition");
    f.native.view.dom.dispatchEvent(f.event("compositionend"));
    f.native.commands.insertContent("最终汉字");
    f.flushFrames();
    const release = await waiting;
    assert.match(JSON.stringify(f.adapter.getDocument()), /最终汉字/);
    assert.equal(f.native.isEditable, false);
    release.resume(); release.resume();
    assert.equal(f.native.isEditable, true, "release is idempotent");
  } finally { await f.cleanup(); }
});

test("pause rejects adapter commands, direct transactions, history, native input, paste/cut/drop; release preserves history", async () => {
  const f = fixture();
  try {
    f.native.commands.insertContent("已写");
    f.native.commands.setTextSelection({ from: 1, to: 3 });
    f.adapter.setFind("已写", false);
    const snapshot = canonicalNotebookJson(f.adapter.getDocument());
    const selection = f.adapter.getSelection();
    const release = await f.adapter.pauseEditing();
    for (const command of [{ kind: "bold" }, { kind: "setLink", href: "https://example.com" }, { kind: "undo" }, { kind: "redo" }] as const) {
      assert.equal(f.adapter.runCommand(command), false);
    }
    assert.equal(f.adapter.replaceCurrent("替换"), false);
    assert.equal(f.adapter.replaceAll("替换"), 0);
    assert.equal(await f.adapter.pastePlainText(), false);
    await f.adapter.cutSelection();
    f.native.view.dispatch(f.native.state.tr.insertText("直接修改"));
    f.native.view.dispatch(f.native.state.tr.addStoredMark(f.native.schema.marks.bold.create()));
    f.native.commands.undo();
    for (const type of ["beforeinput", "cut"]) {
      const event = f.event(type); f.native.view.dom.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, type);
    }
    for (const prop of ["handlePaste", "handleDrop"] as const) {
      const event = f.event(prop === "handlePaste" ? "paste" : "drop");
      const handler = f.native.view.props[prop]!;
      // The blocked branch must return before consulting event data or a slice.
      assert.equal(Reflect.apply(handler, null, [f.native.view, event, null, false]), true);
    }
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), snapshot);
    assert.deepEqual(f.adapter.getSelection(), selection);
    release.resume();
    assert.equal(f.adapter.canUndo(), true);
    f.adapter.runCommand({ kind: "undo" });
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), canonicalNotebookJson(initialDocument));
  } finally { await f.cleanup(); }
});

test("late paste and cut never execute after pause and restoration of the same kernel", async () => {
  const f = fixture();
  try {
    const pasted = deferred<string>();
    const copied = deferred<void>();
    Object.defineProperty(f.window.navigator, "clipboard", { configurable: true, value: {
      readText: () => pasted.promise, writeText: () => copied.promise,
    } });
    f.native.commands.setTextSelection({ from: 1, to: 3 });
    const before = canonicalNotebookJson(f.adapter.getDocument());
    const paste = f.adapter.pastePlainText();
    const cut = f.adapter.cutSelection();
    const release = await f.adapter.pauseEditing();
    release.resume();
    pasted.resolve("迟到粘贴"); copied.resolve();
    assert.equal(await paste, false);
    await cut;
    assert.equal(canonicalNotebookJson(f.adapter.getDocument()), before);
    f.native.commands.insertContent("继续写");
    assert.match(JSON.stringify(f.adapter.getDocument()), /继续写/);
  } finally { await f.cleanup(); }
});

test("destroy resolves a composition waiter without restoring a destroyed editor", async () => {
  const f = fixture();
  try {
    f.native.view.dom.dispatchEvent(f.event("compositionstart"));
    const waiting = f.adapter.pauseEditing();
    f.adapter.destroy();
    const release = await waiting;
    release.resume();
    assert.equal(release.restoreSelection(), false);
    assert.equal(f.native.isDestroyed, true);
  } finally { await f.cleanup(); }
});
