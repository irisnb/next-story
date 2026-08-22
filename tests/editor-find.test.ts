import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorFind,
  type EditorFindDeps,
  type FindEditorCapabilities,
} from "../src/editor-find.ts";

type Listener = () => void;

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, Listener[]>();
  value = "";
  checked = false;
  disabled = false;
  textContent = "";
  focused = false;
  selected = false;

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  focus(): void { this.focused = true; }
  select(): void { this.selected = true; }
}

class FakeFindEditor implements FindEditorCapabilities {
  queries: Array<{ query: string; caseSensitive: boolean }> = [];
  activated: number[] = [];
  replaced: string[] = [];
  replacedAll: string[] = [];
  focusCount = 0;
  matchCount = 0;

  setFind(query: string, caseSensitive: boolean): number {
    this.queries.push({ query, caseSensitive });
    return this.matchCount;
  }

  activateMatch(index: number): void {
    this.activated.push(index);
  }

  replaceCurrent(replacement: string): boolean {
    this.replaced.push(replacement);
    return true;
  }

  replaceAll(replacement: string): number {
    this.replacedAll.push(replacement);
    return this.matchCount;
  }

  focus(): void {
    this.focusCount += 1;
  }
}

interface FindFixture {
  elements: {
    findBar: FakeElement;
    findInput: FakeElement;
    findCaseSensitive: FakeElement;
    findCount: FakeElement;
    btnFindPrev: FakeElement;
    btnFindNext: FakeElement;
    btnReplace: FakeElement;
    btnReplaceAll: FakeElement;
    btnFindClose: FakeElement;
    replaceInput: FakeElement;
  };
  editor: FakeFindEditor;
  find: ReturnType<typeof createEditorFind>;
}

function findFixture(): FindFixture {
  const elements = {
    findBar: new FakeElement(),
    findInput: new FakeElement(),
    findCaseSensitive: new FakeElement(),
    findCount: new FakeElement(),
    btnFindPrev: new FakeElement(),
    btnFindNext: new FakeElement(),
    btnReplace: new FakeElement(),
    btnReplaceAll: new FakeElement(),
    btnFindClose: new FakeElement(),
    replaceInput: new FakeElement(),
  };
  // 与真实 HTML 一致：查找栏初始隐藏。
  elements.findBar.classList.add("hidden");
  const editor = new FakeFindEditor();
  const find = createEditorFind({
    dom: elements as unknown as EditorFindDeps["dom"],
    getEditor: () => editor,
  });
  return { elements, editor, find };
}

test("openFindBar shows the bar, focuses the find input, and runs the initial find", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 3;
  elements.findInput.value = "foo";

  find.openFindBar("find");

  assert.equal(elements.findBar.classList.contains("hidden"), false);
  assert.equal(elements.findInput.focused, true);
  assert.equal(elements.findInput.selected, true);
  assert.deepEqual(editor.queries, [{ query: "foo", caseSensitive: false }]);
  assert.equal(elements.findCount.textContent, "1 / 3");
});

test("openFindBar with replace target focuses the replace input instead", () => {
  const { elements, find } = findFixture();

  find.openFindBar("replace");

  assert.equal(elements.replaceInput.focused, true);
  assert.equal(elements.findInput.focused, false);
  assert.equal(elements.findBar.classList.contains("hidden"), false);
});

test("closeFindBar hides the bar, clears the active find, and refocuses the editor", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 2;
  elements.findInput.value = "foo";

  find.openFindBar("find");
  find.closeFindBar();

  assert.equal(elements.findBar.classList.contains("hidden"), true);
  assert.equal(editor.focusCount, 1);
  // 有关键词时关闭查找栏会用空查询清除高亮。
  assert.deepEqual(editor.queries[1], { query: "", caseSensitive: false });
  // 输入框仍保留关键词，计数复位为 0 / 0。
  assert.equal(elements.findCount.textContent, "0 / 0");
});

test("closeFindBar is a no-op when the bar is not open", () => {
  const { elements, editor, find } = findFixture();

  find.closeFindBar();

  assert.equal(elements.findBar.classList.contains("hidden"), true);
  assert.equal(editor.focusCount, 0);
  assert.equal(editor.queries.length, 0);
});

test("find next and previous step through matches cyclically", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 3;
  elements.findInput.value = "foo";

  find.openFindBar("find");
  elements.btnFindNext.dispatch("click");
  elements.btnFindNext.dispatch("click");
  elements.btnFindPrev.dispatch("click");

  assert.deepEqual(editor.activated, [1, 2, 1]);
  assert.equal(elements.findCount.textContent, "2 / 3");
});

test("replace and replace-all use the current replacement value", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 2;
  elements.findInput.value = "foo";
  elements.replaceInput.value = "bar";

  find.openFindBar("find");
  elements.btnReplace.dispatch("click");
  elements.btnReplaceAll.dispatch("click");

  assert.deepEqual(editor.replaced, ["bar"]);
  assert.deepEqual(editor.replacedAll, ["bar"]);
});

test("replace buttons are disabled and do nothing when there are no matches", () => {
  const { elements, editor, find } = findFixture();
  elements.findInput.value = "foo";
  elements.replaceInput.value = "bar";

  find.openFindBar("find");

  assert.equal(elements.btnFindPrev.disabled, true);
  assert.equal(elements.btnFindNext.disabled, true);
  assert.equal(elements.btnReplace.disabled, true);
  assert.equal(elements.btnReplaceAll.disabled, true);

  elements.btnReplace.dispatch("click");
  elements.btnReplaceAll.dispatch("click");
  assert.equal(editor.replaced.length, 0);
  assert.equal(editor.replacedAll.length, 0);
});

test("typing in the find input re-runs the find", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 1;

  find.openFindBar("find");
  elements.findInput.value = "abc";
  elements.findInput.dispatch("input");

  assert.deepEqual(editor.queries, [
    { query: "", caseSensitive: false },
    { query: "abc", caseSensitive: false },
  ]);
});

test("case-sensitive toggle re-runs the find", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 1;
  elements.findInput.value = "Foo";

  find.openFindBar("find");
  elements.findCaseSensitive.checked = true;
  elements.findCaseSensitive.dispatch("change");

  assert.deepEqual(editor.queries[1], { query: "Foo", caseSensitive: true });
});

test("refreshFindAfterEdit re-runs the find only while the bar is open with a query", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 2;
  elements.findInput.value = "foo";

  find.refreshFindAfterEdit();
  assert.equal(editor.queries.length, 0);

  find.openFindBar("find");
  const before = editor.queries.length;
  find.refreshFindAfterEdit();
  assert.equal(editor.queries.length, before + 1);

  // 空关键词不刷新。
  elements.findInput.value = "";
  find.refreshFindAfterEdit();
  assert.equal(editor.queries.length, before + 1);
});

test("dispose removes listeners and resets the find bar", () => {
  const { elements, editor, find } = findFixture();
  editor.matchCount = 2;
  elements.findInput.value = "foo";

  find.openFindBar("find");
  find.dispose();

  assert.equal(elements.findBar.classList.contains("hidden"), true);
  // 输入框仍保留关键词，计数复位为 0 / 0。
  assert.equal(elements.findCount.textContent, "0 / 0");

  // 输入事件不再触发查找。
  const before = editor.queries.length;
  elements.findInput.value = "zzz";
  elements.findInput.dispatch("input");
  assert.equal(editor.queries.length, before);

  // 按钮不再响应。
  elements.btnFindNext.dispatch("click");
  assert.equal(editor.activated.length, 0);
  elements.btnFindClose.dispatch("click");
  assert.equal(elements.findBar.classList.contains("hidden"), true);
});