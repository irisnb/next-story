import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import { setupAiPanel } from "../src/ai-panel.ts";
import type { AppDom } from "../src/dom.ts";
import type { GenerateAiRequest, GenerateAiResult, SelectionSnapshot } from "../src/types.ts";

type Listener = (event: FakeEvent) => void;

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: string[] = []) {
    for (const value of initial) this.values.add(value);
  }

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

class FakeEvent {
  defaultPrevented = false;
  readonly type: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;

  constructor(type: string, key = "", shiftKey = false, isComposing = false) {
    this.type = type;
    this.key = key;
    this.shiftKey = shiftKey;
    this.isComposing = isComposing;
  }

  preventDefault(): void { this.defaultPrevented = true; }
}

class FakeElement {
  readonly classList: FakeClassList;
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  textContent = "";
  value = "";
  disabled = false;
  scrollTop = 0;
  readonly id: string;

  constructor(id: string, classes: string[] = []) {
    this.id = id;
    this.classList = new FakeClassList(classes);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(
    type: string,
    options: { key?: string; shiftKey?: boolean; isComposing?: boolean } = {},
  ): FakeEvent {
    const event = new FakeEvent(type, options.key, options.shiftKey, options.isComposing);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  append(...children: FakeElement[]): void { this.children.push(...children); }
  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }
  focus(): void {}
  querySelector<T>(_selector: string): T | null { return null; }
}

function snapshot(text: string): SelectionSnapshot {
  return { notebook: "draft", selectedText: text, start: 0, end: text.length };
}

function harness(): {
  state: AiPanelState;
  elements: Map<string, FakeElement>;
  submitted: string[];
  retried: number;
  edited: string[];
  firstRetries: number;
  restore(): void;
} {
  const ids = [
    "ai-snapshot-block", "ai-snapshot-text", "ai-loading", "ai-error-block",
    "ai-error-message", "ai-retry", "ai-config-block", "ai-go-config",
    "ai-panel-collapse", "ai-conversation", "ai-follow-up-form",
    "ai-follow-up-input", "ai-follow-up-send", "ai-follow-up-error",
    "ai-follow-up-error-message", "ai-follow-up-retry", "ai-follow-up-edit",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id, ["hidden"])]));
  const panelBody = new FakeElement("panel-body", ["ai-panel-body"]);
  const panel = new FakeElement("ai-panel", ["hidden"]);
  panel.querySelector = <T>(selector: string): T | null =>
    selector === ".ai-panel-body" ? panelBody as T : null;
  const toggle = new FakeElement("btn-toggle-ai");
  const response = new FakeElement("ai-response", ["hidden"]);
  const draft = new FakeElement("draft-textarea");
  const main = new FakeElement("main-textarea");
  draft.value = "用户草稿";
  main.value = "用户正文";
  elements.set("draft-textarea", draft);
  elements.set("main-textarea", main);
  elements.set("ai-panel", panel);
  elements.set("ai-response", response);
  elements.set("btn-toggle-ai", toggle);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  const state = new AiPanelState();
  const submitted: string[] = [];
  const edited: string[] = [];
  let retried = 0;
  let firstRetries = 0;
  setupAiPanel({
    aiPanel: panel,
    aiResponse: response,
    btnToggleAi: toggle,
    draftTextarea: draft,
    mainTextarea: main,
  } as unknown as AppDom, state, {
    onRetry: () => { firstRetries += 1; },
    onGoToConfig: () => {},
    onSubmitFollowUp: (question) => { submitted.push(question); return true; },
    onRetryFollowUp: () => { retried += 1; return true; },
    onEditFollowUp: (question) => { edited.push(question); return true; },
  });

  return {
    state,
    elements,
    submitted,
    get retried() { return retried; },
    edited,
    get firstRetries() { return firstRetries; },
    restore: () => { globalThis.document = previousDocument; },
  };
}

function featureHarness(results: GenerateAiResult[]): {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  requests: GenerateAiRequest[];
  summon(snap: SelectionSnapshot): void;
  openedConfig: string[];
  restore(): void;
} {
  // Build an independent DOM fixture so setupAiFeature's setupAiPanel
  // does not double-subscribe on top of a harness() panel.
  const allIds = [
    "ai-snapshot-block", "ai-snapshot-text", "ai-loading", "ai-error-block",
    "ai-error-message", "ai-retry", "ai-config-block", "ai-go-config",
    "ai-panel-collapse", "ai-conversation", "ai-follow-up-form",
    "ai-follow-up-input", "ai-follow-up-send", "ai-follow-up-error",
    "ai-follow-up-error-message", "ai-follow-up-retry", "ai-follow-up-edit",
  ];
  const elements = new Map(allIds.map((id) => [id, new FakeElement(id, ["hidden"])]));
  const panelBody = new FakeElement("panel-body", ["ai-panel-body"]);
  const panel = new FakeElement("ai-panel", ["hidden"]);
  panel.querySelector = <T>(selector: string): T | null =>
    selector === ".ai-panel-body" ? panelBody as T : null;
  const toggle = new FakeElement("btn-toggle-ai");
  const response = new FakeElement("ai-response", ["hidden"]);
  const draft = new FakeElement("draft-textarea");
  const main = new FakeElement("main-textarea");
  draft.value = "用户草稿";
  main.value = "用户正文";
  elements.set("ai-panel", panel);
  elements.set("ai-response", response);
  elements.set("btn-toggle-ai", toggle);
  elements.set("draft-textarea", draft);
  elements.set("main-textarea", main);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  let onSummon: ((snap: SelectionSnapshot) => void) | null = null;
  const requests: GenerateAiRequest[] = [];
  const openedConfig: string[] = [];

  const controller = setupAiFeature({
    aiPanel: panel,
    aiResponse: response,
    btnToggleAi: toggle,
    draftTextarea: draft,
    mainTextarea: main,
  } as unknown as AppDom, {
    getCurrentNotebook: () => "draft",
    openConfigPage: (returnPage) => { openedConfig.push(returnPage); },
  }, {
    generate: async (request) => {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error("missing fake result");
      return result;
    },
    setupEntry: (options) => {
      onSummon = options.onSummon;
      return { reset: () => {}, destroy: () => {} };
    },
  });

  return {
    controller,
    elements,
    requests,
    summon: (snap) => {
      if (!onSummon) throw new Error("summon callback missing");
      onSummon(snap);
    },
    openedConfig,
    restore: () => { globalThis.document = previousDocument; },
  };
}

test("follow-up composer appears only after the first response succeeds", () => {
  const ui = harness();
  try {
    const form = ui.elements.get("ai-follow-up-form")!;
    assert.equal(form.classList.contains("hidden"), true);

    const anchor = snapshot("冻结选区");
    ui.state.beginRequest(anchor);
    assert.equal(form.classList.contains("hidden"), true);

    ui.state.succeed(anchor, "首次回应");
    assert.equal(form.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-follow-up-input")!.disabled, false);
  } finally {
    ui.restore();
  }
});

test("renders ordered turns as literal text and disables duplicate sends while pending", () => {
  const ui = harness();
  try {
    const anchor = snapshot("冻结选区");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "**首答** <img src=x onerror=alert(1)>");
    ui.state.beginFollowUp("问题一");
    ui.state.succeedFollowUp(1, "回答一");
    ui.state.beginFollowUp("问题二");

    const conversation = ui.elements.get("ai-conversation")!;
    assert.deepEqual(
      conversation.children.map((child) => child.textContent),
      ["**首答** <img src=x onerror=alert(1)>", "问题一", "回答一", "问题二", "正在思考…"],
    );
    assert.equal(conversation.children[0].children.length, 0);
    assert.equal(ui.elements.get("ai-follow-up-input")!.disabled, true);
    assert.equal(ui.elements.get("ai-follow-up-send")!.disabled, true);
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("submits nonblank text with Enter, keeps Shift+Enter, and never writes to notebooks", () => {
  const ui = harness();
  try {
    const anchor = snapshot("冻结");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "   ";
    input.dispatch("input");
    assert.equal(ui.elements.get("ai-follow-up-send")!.disabled, true);

    input.value = "继续问";
    input.dispatch("input");
    const shifted = input.dispatch("keydown", { key: "Enter", shiftKey: true });
    assert.equal(shifted.defaultPrevented, false);
    assert.deepEqual(ui.submitted, []);

    const composing = input.dispatch("keydown", { key: "Enter", isComposing: true });
    assert.equal(composing.defaultPrevented, false);
    assert.deepEqual(ui.submitted, []);

    const entered = input.dispatch("keydown", { key: "Enter" });
    assert.equal(entered.defaultPrevented, true);
    assert.deepEqual(ui.submitted, ["继续问"]);
    assert.equal((ui.elements.get("draft-textarea")?.value ?? "用户草稿"), "用户草稿");
    assert.equal((ui.elements.get("main-textarea")?.value ?? "用户正文"), "用户正文");
  } finally {
    ui.restore();
  }
});

test("failed follow-up offers original retry and edit-resend without changing earlier turns", () => {
  const ui = harness();
  try {
    const anchor = snapshot("锚点");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    ui.state.beginFollowUp("旧问题");
    ui.state.failFollowUp(1, { code: "network", message: "网络失败" });
    const before = ui.elements.get("ai-conversation")!.children.map((child) => child.textContent);

    ui.elements.get("ai-follow-up-retry")!.dispatch("click");
    assert.equal(ui.retried, 1);

    ui.elements.get("ai-follow-up-edit")!.dispatch("click");
    const editInput = ui.elements.get("ai-follow-up-input")!;
    assert.equal(editInput.value, "旧问题");
    editInput.value = "新问题";
    editInput.dispatch("input");
    ui.elements.get("ai-follow-up-form")!.dispatch("submit");
    assert.deepEqual(ui.edited, ["新问题"]);
    assert.deepEqual(before.slice(0, 2), ["首答", "旧问题"]);
  } finally {
    ui.restore();
  }
});

test("configuration-required follow-up keeps recovery controls and exposes configuration navigation", () => {
  const ui = harness();
  try {
    const anchor = snapshot("锚点");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    ui.state.beginFollowUp("待配置问题");
    ui.state.requireFollowUpConfiguration(1);

    assert.equal(ui.elements.get("ai-config-block")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-follow-up-error")!.classList.contains("hidden"), false);
    assert.deepEqual(ui.submitted, []);
  } finally {
    ui.restore();
  }
});

test("configuration-required first summon keeps an explicit retry action", () => {
  const ui = harness();
  try {
    const anchor = snapshot("锚点");
    ui.state.beginRequest(anchor);
    ui.state.requireConfiguration(anchor);

    const retry = ui.elements.get("ai-retry")!;
    assert.equal(retry.classList.contains("hidden"), false);
    retry.dispatch("click");
    assert.equal(ui.firstRetries, 1);
  } finally {
    ui.restore();
  }
});

test("AI panel exposes no apply, insert, replace, or notebook writeback callback", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /应用到正文|插入正文|替换正文|写入草稿|写入正文/);
});

test("collapse and reopen preserve conversation and draft without submitting", () => {
  const ui = harness();
  try {
    const anchor = snapshot("锚点");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "未发送的追问";
    input.dispatch("input");
    ui.state.close();
    ui.state.open();

    assert.deepEqual(
      ui.elements.get("ai-conversation")!.children.map((child) => child.textContent),
      ["首答"],
    );
    assert.equal(input.value, "未发送的追问");
    assert.deepEqual(ui.submitted, []);
  } finally {
    ui.restore();
  }
});

test("project lifecycle reset clears conversation and unsent follow-up draft", () => {
  const ui = harness();
  try {
    const anchor = snapshot("旧作品锚点");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "旧作品首答");
    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "旧作品未发送追问";
    input.dispatch("input");

    ui.state.reset();

    assert.equal(ui.state.conversation, null);
    assert.equal(ui.elements.get("ai-conversation")!.classList.contains("hidden"), true);
    assert.equal(input.value, "");
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("editor lifecycle composition resets AI on project ready and unload", () => {
  const editorSource = readFileSync(new URL("../src/editor.ts", import.meta.url), "utf8");
  const aiFeatureSource = readFileSync(new URL("../src/ai-feature.ts", import.meta.url), "utf8");
  assert.match(editorSource, /function unload\(\): void \{[\s\S]*aiFeature\?\.endProject\(\)/);
  assert.match(editorSource, /function showProject\([\s\S]*aiFeature\?\.beginProject\(\)/);
  assert.match(aiFeatureSource, /const selectionEntry = setupEntry\(/);
  assert.match(aiFeatureSource, /beginProject\(\): void \{[\s\S]*selectionEntry\.reset\(\)/);
  assert.match(aiFeatureSource, /endProject\(\): void \{[\s\S]*selectionEntry\.reset\(\)/);
});

test("editor shell keeps the AI panel viewport-stable and scrolls its body", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.editor-page\s*\{[^}]*(?:\{|;)\s*height:\s*100vh;/s);
  assert.match(styles, /\.ai-panel-body\s*\{[^}]*overflow:\s*auto;/s);
});

test("real AI feature flow never writes notebooks across success, failure, retry, and edit-resend", async () => {
  const ui = featureHarness([
    { ok: true, content: "首答" },
    { ok: false, error: { code: "network", message: "网络失败" } },
    { ok: false, error: { code: "network", message: "仍然失败" } },
    { ok: true, content: "编辑后的回答" },
  ]);
  try {
    const draft = ui.elements.get("draft-textarea")!;
    const main = ui.elements.get("main-textarea")!;
    const original = [draft.value, main.value];
    ui.summon(snapshot("冻结选区"));
    await Promise.resolve();
    assert.equal(ui.controller.submitFollowUp("失败问题"), true);
    await Promise.resolve();
    assert.equal(ui.controller.retryFollowUp(), true);
    await Promise.resolve();
    assert.equal(ui.controller.editFollowUp("编辑问题"), true);
    await Promise.resolve();

    assert.deepEqual([draft.value, main.value], original);
    assert.equal(ui.requests.length, 4);
  } finally {
    ui.restore();
  }
});

test("configuration navigation preserves the live feature and never starts generation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.summon(snapshot("锚点"));
    await Promise.resolve();
    ui.elements.get("ai-go-config")!.dispatch("click");
    assert.deepEqual(ui.openedConfig, ["editor-page"]);
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.controller.submitFollowUp("回来后追问"), true);
    await Promise.resolve();
  } finally {
    ui.restore();
  }
});
