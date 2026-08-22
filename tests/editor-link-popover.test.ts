import assert from "node:assert/strict";
import test from "node:test";

import type { JSONContent } from "@tiptap/core";

import {
  createLinkPopover,
  type LinkPopoverDeps,
  type LinkPopoverEditorCapabilities,
} from "../src/editor-link-popover.ts";
import {
  createLinkActions,
  linkHrefAt,
  type LinkActions,
} from "../src/editor-link-actions.ts";
import type { FormatCommand } from "../src/format-commands.ts";

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
  readonly style: Record<string, string> = {};
  offsetWidth = 200;

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
}

function linkDoc(href: string): JSONContent {
  return {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: "链接", marks: [{ type: "link", attrs: { href } }] }],
    }],
  };
}

function plainDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

class FakeLinkEditor implements LinkPopoverEditorCapabilities {
  selection = { from: 1, to: 1, head: 1 };
  document: JSONContent = plainDoc("");
  coords = { left: 100, bottom: 200 };

  getSelection(): { from: number; to: number; head: number } {
    return this.selection;
  }

  getDocument(): JSONContent {
    return this.document;
  }

  coordinatesAt(_position: number): { left: number; bottom: number } {
    return this.coords;
  }
}

class FakeLinkActions implements LinkActions {
  opened: string[] = [];
  edited: string[] = [];
  created = 0;
  removed = 0;

  openLinkHref(href: string): void { this.opened.push(href); }
  editLinkHref(currentHref: string): void { this.edited.push(currentHref); }
  createLinkHref(): void { this.created += 1; }
  removeLinkHref(): void { this.removed += 1; }
}

/** 安装带 innerWidth/prompt 的假 window；返回恢复函数。 */
function installFakeWindow(promptResult: string | null = null): () => void {
  const previous = globalThis.window;
  globalThis.window = {
    innerWidth: 1024,
    prompt: () => promptResult,
  } as unknown as Window & typeof globalThis;
  return () => { globalThis.window = previous; };
}

function captureAlert(): { messages: string[]; restore(): void } {
  const previous = globalThis.alert;
  const messages: string[] = [];
  globalThis.alert = (message?: unknown) => { messages.push(String(message)); };
  return {
    messages,
    restore: () => { globalThis.alert = previous; },
  };
}

interface LinkPopoverFixture {
  elements: {
    linkPopover: FakeElement;
    btnLinkOpen: FakeElement;
    btnLinkEdit: FakeElement;
    btnLinkRemove: FakeElement;
  };
  editor: FakeLinkEditor;
  actions: FakeLinkActions;
  popover: ReturnType<typeof createLinkPopover>;
}

function linkPopoverFixture(
  extra: { getEditor?: () => LinkPopoverEditorCapabilities | null } = {},
): LinkPopoverFixture {
  const elements = {
    linkPopover: new FakeElement(),
    btnLinkOpen: new FakeElement(),
    btnLinkEdit: new FakeElement(),
    btnLinkRemove: new FakeElement(),
  };
  const editor = new FakeLinkEditor();
  const actions = new FakeLinkActions();
  const popover = createLinkPopover({
    dom: elements as unknown as LinkPopoverDeps["dom"],
    getEditor: extra.getEditor ?? (() => editor),
    linkActions: actions,
  });
  return { elements, editor, actions, popover };
}

// ---- linkHrefAt 语义 ----

test("linkHrefAt finds the link at a cursor strictly inside the text", () => {
  const doc = linkDoc("https://example.com");
  assert.equal(linkHrefAt(doc, 2, 2), "https://example.com");
});

test("linkHrefAt returns null for a cursor at the text boundary", () => {
  const doc = linkDoc("https://example.com");
  assert.equal(linkHrefAt(doc, 1, 1), null);
  assert.equal(linkHrefAt(doc, 3, 3), null);
});

test("linkHrefAt finds the link under a selection", () => {
  const doc = linkDoc("https://example.com");
  assert.equal(linkHrefAt(doc, 1, 3), "https://example.com");
});

test("linkHrefAt returns null when there is no link", () => {
  const doc = plainDoc("正文");
  assert.equal(linkHrefAt(doc, 1, 3), null);
});

// ---- 链接弹层：显示/隐藏/定位 ----

test("update shows the popover positioned at the link", () => {
  const { elements, editor, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  editor.coords = { left: 100, bottom: 200 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  assert.equal(elements.linkPopover.classList.contains("hidden"), false);
  assert.equal(elements.linkPopover.style.left, "100px");
  assert.equal(elements.linkPopover.style.top, "206px");
});

test("update hides the popover when there is no link at the selection", () => {
  const { elements, editor, popover } = linkPopoverFixture();
  editor.document = plainDoc("正文");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

test("update hides the popover when there is no editor", () => {
  const { elements, popover } = linkPopoverFixture({ getEditor: () => null });
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

test("hide hides the popover", () => {
  const { elements, editor, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }
  assert.equal(elements.linkPopover.classList.contains("hidden"), false);

  popover.hide();
  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

// ---- 链接弹层：按钮动作 ----

test("link open button opens the link and hides the popover", () => {
  const { elements, editor, actions, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  elements.btnLinkOpen.dispatch("click");

  assert.deepEqual(actions.opened, ["https://example.com"]);
  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

test("link edit button edits the link and hides the popover", () => {
  const { elements, editor, actions, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  elements.btnLinkEdit.dispatch("click");

  assert.deepEqual(actions.edited, ["https://example.com"]);
  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

test("link remove button removes the link and hides the popover", () => {
  const { elements, editor, actions, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  elements.btnLinkRemove.dispatch("click");

  assert.equal(actions.removed, 1);
  assert.equal(elements.linkPopover.classList.contains("hidden"), true);
});

test("dispose removes listeners so buttons no longer act", () => {
  const { elements, editor, actions, popover } = linkPopoverFixture();
  editor.document = linkDoc("https://example.com");
  editor.selection = { from: 1, to: 3, head: 3 };
  const restoreWindow = installFakeWindow();
  try {
    popover.update();
  } finally {
    restoreWindow();
  }

  popover.dispose();
  elements.btnLinkOpen.dispatch("click");
  elements.btnLinkEdit.dispatch("click");
  elements.btnLinkRemove.dispatch("click");

  assert.equal(actions.opened.length, 0);
  assert.equal(actions.edited.length, 0);
  assert.equal(actions.removed, 0);
});

// ---- 链接动作：open/edit/create/remove ----

test("openLinkHref opens http links and alerts for non-http links", () => {
  const opened: string[] = [];
  const actions = createLinkActions({
    runFormatCommand: () => true,
    openUrl: async (href) => { opened.push(href); },
  });

  actions.openLinkHref("https://example.com");
  assert.deepEqual(opened, ["https://example.com"]);

  const alerts = captureAlert();
  try {
    actions.openLinkHref("ftp://example.com");
  } finally {
    alerts.restore();
  }
  assert.match(alerts.messages[0] ?? "", /不是 http\/https/);
});

test("editLinkHref prompts and runs setLink", () => {
  const commands: FormatCommand[] = [];
  const actions = createLinkActions({
    runFormatCommand: (command) => { commands.push(command); return true; },
    openUrl: async () => {},
  });
  const restoreWindow = installFakeWindow("https://new.example.com");
  try {
    actions.editLinkHref("https://old.example.com");
  } finally {
    restoreWindow();
  }

  assert.deepEqual(commands, [{ kind: "setLink", href: "https://new.example.com" }]);
});

test("createLinkHref prompts and runs setLink", () => {
  const commands: FormatCommand[] = [];
  const actions = createLinkActions({
    runFormatCommand: (command) => { commands.push(command); return true; },
    openUrl: async () => {},
  });
  const restoreWindow = installFakeWindow("https://new.example.com");
  try {
    actions.createLinkHref();
  } finally {
    restoreWindow();
  }

  assert.deepEqual(commands, [{ kind: "setLink", href: "https://new.example.com" }]);
});

test("removeLinkHref runs unsetLink", () => {
  const commands: FormatCommand[] = [];
  const actions = createLinkActions({
    runFormatCommand: (command) => { commands.push(command); return true; },
    openUrl: async () => {},
  });

  actions.removeLinkHref();

  assert.deepEqual(commands, [{ kind: "unsetLink" }]);
});