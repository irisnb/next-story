import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import { setupAiPanel } from "../src/ai-panel.ts";
import type { SelectionEntryEditor } from "../src/selection-entry.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
  SelectionSnapshot,
} from "../src/types.ts";
import {
  createAiPanelDomFixture,
  FakeElement,
} from "./ai-panel-dom-fixture.ts";

type GenerateAiResultSource = GenerateAiResult | Promise<GenerateAiResult>;

function snapshot(text: string): SelectionSnapshot {
  return { documentId: "draft", selectedText: text, from: 0, to: text.length };
}

function deferredGenerateResult(): {
  promise: Promise<GenerateAiResult>;
  resolve(result: GenerateAiResult): void;
  reject(error: Error): void;
} {
  let resolveResult: ((result: GenerateAiResult) => void) | null = null;
  let rejectResult: ((error: Error) => void) | null = null;
  const promise = new Promise<GenerateAiResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  if (!resolveResult || !rejectResult) throw new Error("deferred result was not initialized");
  return { promise, resolve: resolveResult, reject: rejectResult };
}

function conversationText(ui: { elements: Map<string, FakeElement> }): string[] {
  return ui.elements.get("ai-conversation")!.children.map((child) => child.textContent);
}

function fixtureElement(elements: Map<string, FakeElement>, id: string): FakeElement {
  const element = elements.get(id);
  assert.ok(element, `missing fixture element: ${id}`);
  return element;
}

async function flushAiFeatureFlow(): Promise<void> {
  // 固定次数（原来 4 次）的微任务刷洗，一旦流程内部多加一层 await 就会失效。
  // 改为有界循环刷洗，让链式 Promise 充分落定，同时仍不会「完成」一个由测试手动
  // 控制的挂起 Promise（那些断言中间态的测试因此不受影响）。
  for (let i = 0; i < 64; i += 1) {
    await Promise.resolve();
  }
}

function harness(): {
  state: AiPanelState;
	  elements: Map<string, FakeElement>;
	  submitted: string[];
	  startedThinkingExpansions: string[];
	  retried: number;
  edited: string[];
  firstRetries: number;
  restore(): void;
} {
  const { elements, dom } = createAiPanelDomFixture();
  const editor = new FakeElement("editor-textarea");
  editor.value = "用户正文";
  elements.set("editor-textarea", editor);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

	  const state = new AiPanelState();
	  const submitted: string[] = [];
	  const startedThinkingExpansions: string[] = [];
	  const edited: string[] = [];
  let retried = 0;
  let firstRetries = 0;
  setupAiPanel(dom, state, {
    onRetry: () => { firstRetries += 1; },
    onGoToConfig: () => {},
	    onSubmitFollowUp: (question) => { submitted.push(question); return Promise.resolve(true); },
	    onRetryFollowUp: () => { retried += 1; return Promise.resolve(true); },
	    onEditFollowUp: (question) => { edited.push(question); return Promise.resolve(true); },
	    onStartThinkingExpansion: (direction) => { startedThinkingExpansions.push(direction); return true; },
    onSubmitDirectQuestion: () => Promise.resolve(true),
    onRemoveDirectQuestionSelection: () => state.setPendingSelection(null),
    onDirectQuestionFocus: () => {},
    onOpenPanel: () => {},
	  });

  return {
    state,
	    elements,
	    submitted,
	    startedThinkingExpansions,
    get retried() { return retried; },
    edited,
    get firstRetries() { return firstRetries; },
    restore: () => { globalThis.document = previousDocument; },
  };
}

function featureHarness(results: GenerateAiResultSource[], options: {
  readonly apiBaseUrl?: string;
  readonly apiBaseUrls?: readonly string[];
  readonly loadConfigError?: unknown;
  readonly loadConfigResult?: LlmConfigSummary | null;
  readonly loadConfigPromise?: Promise<LlmConfigSummary | null>;
  readonly currentEditor?: SelectionEntryEditor | null;
} = {}): {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  requests: GenerateAiRequest[];
  summon(snap: SelectionSnapshot): void;
  thinkingExpansion(snap: SelectionSnapshot): void;
  setCurrentDocumentId(documentId: string): void;
  openedConfig: string[];
  restore(): void;
} {
  // Build an independent DOM fixture so setupAiFeature's setupAiPanel
  // does not double-subscribe on top of a harness() panel.
  const { elements, dom } = createAiPanelDomFixture();
  const editor = new FakeElement("editor-textarea");
  editor.value = "用户正文";
  elements.set("editor-textarea", editor);

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  let onSummon: ((snap: SelectionSnapshot) => void) | null = null;
  let onThinkingExpansion: ((snap: SelectionSnapshot) => void) | null = null;
  const requests: GenerateAiRequest[] = [];
  const openedConfig: string[] = [];
  const apiBaseUrls = [...(options.apiBaseUrls ?? [])];
  const loadConfigResult = options.loadConfigResult;
  let currentDocumentId = "doc-1";
  const currentEditor = options.currentEditor ?? null;

  const controller = setupAiFeature({
    aiPanelDom: dom,
    aiPanel: dom.panel,
    aiResponse: dom.response,
    btnToggleAi: dom.toggleBtn,
    editorTextarea: editor,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => currentDocumentId,
    getCurrentEditor: () => currentEditor,
    openConfigPage: () => { openedConfig.push("settings"); },
  }, {
    generate: async (request) => {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error("missing fake result");
      return result;
    },
    loadConfig: async () => {
      if (options.loadConfigError) throw options.loadConfigError;
      if (options.loadConfigPromise) return options.loadConfigPromise;
      if (loadConfigResult !== undefined) return loadConfigResult;
      return {
        api_base_url: apiBaseUrls.shift() ?? options.apiBaseUrl ?? "https://api.example.com/v1",
        model: "saved-model",
        has_api_key: true,
      };
    },
    setupEntry: (options) => {
      onSummon = options.onSummon;
      onThinkingExpansion = options.onThinkingExpansion;
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
    thinkingExpansion: (snap) => {
      if (!onThinkingExpansion) throw new Error("thinking expansion callback missing");
      onThinkingExpansion(snap);
    },
    setCurrentDocumentId: (documentId) => { currentDocumentId = documentId; },
    openedConfig,
    restore: () => { globalThis.document = previousDocument; },
  };
}

test("first summon sends directly without creative-content confirmation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    const editor = ui.elements.get("editor-textarea")!;

    ui.summon(snapshot("冻结选区"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{ kind: "first", selected_text: "冻结选区" }]);
    assert.equal(ui.elements.get("ai-panel")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "冻结选区");
    assert.equal(editor.value, "用户正文");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-error-block")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), ["首答"]);
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("same-project first request rejection shows blocked feedback without generation", async () => {
  const pending = deferredGenerateResult();
  const ui = featureHarness([pending.promise, { ok: true, content: "不应发起" }]);
  try {
    ui.summon(snapshot("当前作品选区一"));
    await flushAiFeatureFlow();

    ui.summon(snapshot("当前作品选区二"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "当前作品选区一" },
    ]);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "当前作品选区二");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-error-block")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-error-message")!.textContent, "已有 AI 请求正在进行，本次请求没有发出。");
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("first request preflight exception shows readable feedback without generation", async () => {
  const ui = featureHarness([{ ok: true, content: "不应出现" }], {
    loadConfigError: new Error("配置读取失败，请稍后重试"),
  });
  try {
    ui.summon(snapshot("异常前冻结选区"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, []);
    assert.equal(ui.elements.get("ai-panel")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "异常前冻结选区");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-error-block")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-error-message")!.textContent, "配置读取失败，请稍后重试");
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("first request string preflight rejection preserves the backend message", async () => {
  const ui = featureHarness([{ ok: true, content: "不应出现" }], {
    loadConfigError: "LLM 配置文件读取失败，请检查配置文件权限",
  });
  try {
    ui.summon(snapshot("字符串异常前冻结选区"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, []);
    assert.equal(ui.elements.get("ai-panel")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "字符串异常前冻结选区");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-error-block")!.classList.contains("hidden"), false);
    assert.equal(
      ui.elements.get("ai-error-message")!.textContent,
      "LLM 配置文件读取失败，请检查配置文件权限",
    );
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("missing LLM config on first summon shows configuration-required controls and skips generation", async () => {
  const ui = featureHarness([{ ok: true, content: "不应出现" }], { loadConfigResult: null });
  try {
    ui.summon(snapshot("冻结选区"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, []);
    assert.equal(ui.elements.get("ai-config-block")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-retry")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("follow-up sends directly without changed-origin creative-content confirmation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }, { ok: true, content: "追问回答" }], {
    apiBaseUrls: ["https://api.example.com/v1", "https://other.example.com/v1"],
  });
  try {
    ui.summon(snapshot("冻结选区"));
    await flushAiFeatureFlow();

    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "不要丢掉的追问";
    input.dispatch("input");
    ui.elements.get("ai-follow-up-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.equal(input.value, "");
    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "冻结选区" },
      {
        kind: "follow_up",
        selected_text: "冻结选区",
        messages: [
          { role: "assistant", content: "首答" },
          { role: "user", content: "不要丢掉的追问" },
        ],
      },
    ]);
    assert.deepEqual(conversationText(ui), ["首答", "不要丢掉的追问", "追问回答"]);
  } finally {
    ui.restore();
  }
});

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

test("thinking expansion prestate renders the approved form and starts from the draft direction", () => {
  const ui = harness();
  try {
    const anchor = snapshot("冻结选区文本");

    ui.state.beginThinkingExpansion(anchor);

    assert.equal(ui.elements.get("ai-thinking-expansion-prestate")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-thinking-expansion-title")!.textContent, "思维扩展");
    assert.equal(ui.elements.get("ai-thinking-expansion-count")!.textContent, "已选中 6 字");
    assert.equal(ui.elements.get("ai-thinking-expansion-input")!.focusCount, 1);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "冻结选区文本");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);

    const input = ui.elements.get("ai-thinking-expansion-input")!;
    input.value = "想追的方向";
    input.dispatch("input");
    ui.elements.get("ai-thinking-expansion-form")!.dispatch("submit");

    assert.deepEqual(ui.startedThinkingExpansions, ["想追的方向"]);
    assert.equal((ui.elements.get("editor-textarea")?.value ?? "用户正文"), "用户正文");
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
    assert.equal((ui.elements.get("editor-textarea")?.value ?? "用户正文"), "用户正文");
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
  const panelSource = readFileSync(new URL("../src/ai-panel.ts", import.meta.url), "utf8");
  const domSource = readFileSync(new URL("../src/dom.ts", import.meta.url), "utf8");
  assert.doesNotMatch(html, /应用到正文|插入正文|替换正文|写入草稿|写入正文/);
  // 契约收敛到 dom.ts 的显式类型；面板模块只消费契约，不再做全局节点查询。
  assert.match(panelSource, /import type \{ AiPanelDom \} from "\.\/dom\.ts";/);
  assert.doesNotMatch(panelSource, /document\.getElementById/);
  assert.doesNotMatch(panelSource, /querySelector/);
  assert.match(domSource, /export interface AiPanelDom/);
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

test("editor lifecycle composition resets AI on project ready and unload", async () => {
  const ui = featureHarness([{ ok: true, content: "旧作品首答" }, { ok: true, content: "新作品首答" }]);
  try {
    ui.summon(snapshot("旧作品选区"));
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["旧作品首答"]);

    // endProject（作品卸载）：清空旧对话，AI 面板回到初始状态。
    ui.controller.endProject();
    assert.equal(ui.elements.get("ai-conversation")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), []);

    // beginProject（新作品就绪）：可以立刻在新作品里召唤，旧内容不残留。
    ui.controller.beginProject();
    ui.summon(snapshot("新作品选区"));
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["新作品首答"]);
  } finally {
    ui.restore();
  }
});

test("editor shell keeps the AI panel viewport-stable and scrolls its body", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.editor-page\s*\{[^}]*(?:\{|;)\s*height:\s*100vh;/s);
  assert.match(styles, /\.ai-panel-body\s*\{[^}]*overflow:\s*auto;/s);
});

test("selection entry menu opens from a locked trigger anchor", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.ai-selection-entry\s*\{[^}]*width:\s*44px;/s);
  assert.match(styles, /\.ai-selection-entry\s*\{[^}]*height:\s*32px;/s);
  assert.match(styles, /#ai-selection-entry-trigger\s*\{[^}]*border-radius:\s*var\(--radius-sm\);/s);
  assert.match(styles, /#ai-selection-entry-trigger\s*\{[^}]*font-weight:\s*700;/s);
  assert.match(styles, /#ai-selection-entry-menu\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /#ai-selection-entry-menu\s*\{[^}]*left:\s*calc\(100% \+ 0\.35rem\);/s);
});

test("real AI feature flow never writes notebooks across success, failure, retry, and edit-resend", async () => {
  const ui = featureHarness([
    { ok: true, content: "首答" },
    { ok: false, error: { code: "network", message: "网络失败" } },
    { ok: false, error: { code: "network", message: "仍然失败" } },
    { ok: true, content: "编辑后的回答" },
  ]);
  try {
    const editor = ui.elements.get("editor-textarea")!;
    const original = editor.value;
    ui.summon(snapshot("冻结选区"));
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.submitFollowUp("失败问题"), true);
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.retryFollowUp(), true);
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.editFollowUp("编辑问题"), true);
    await flushAiFeatureFlow();

    assert.equal(editor.value, original);
    assert.equal(ui.requests.length, 4);
  } finally {
    ui.restore();
  }
});

test("first request, retry, and follow-up keep the clicked snapshot after editor context changes", async () => {
  const configDeferred: { resolve: ((config: LlmConfigSummary | null) => void) | null } = {
    resolve: null,
  };
  const configPromise = new Promise<LlmConfigSummary | null>((resolve) => {
    configDeferred.resolve = resolve;
  });
  const ui = featureHarness([
    { ok: false, error: { code: "network", message: "网络失败" } },
    { ok: true, content: "重试回答" },
    { ok: true, content: "追问回答" },
  ], { loadConfigPromise: configPromise });
  try {
    const editor = fixtureElement(ui.elements, "editor-textarea");
    const retry = fixtureElement(ui.elements, "ai-retry");

    ui.summon(snapshot("点击时冻结选区"));
    editor.value = "点击后改写的内容与新选区";
    ui.setCurrentDocumentId("doc-2");
    configDeferred.resolve?.({
      api_base_url: "https://api.example.com/v1",
      model: "saved-model",
      has_api_key: true,
    });
    await flushAiFeatureFlow();

    editor.value = "重试前再次改写内容";
    retry.dispatch("click");
    await flushAiFeatureFlow();

    editor.value = "追问前继续编辑内容";
    assert.equal(await ui.controller.submitFollowUp("继续追问"), true);
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "点击时冻结选区" },
      { kind: "first", selected_text: "点击时冻结选区" },
      {
        kind: "follow_up",
        selected_text: "点击时冻结选区",
        messages: [
          { role: "assistant", content: "重试回答" },
          { role: "user", content: "继续追问" },
        ],
      },
    ]);
    assert.equal(editor.value, "追问前继续编辑内容");
  } finally {
    ui.restore();
  }
});

test("thinking expansion keeps the clicked snapshot after editor context changes", async () => {
  const ui = featureHarness([{ ok: true, content: "扩展回答" }]);
  try {
    const editor = fixtureElement(ui.elements, "editor-textarea");
    const direction = fixtureElement(ui.elements, "ai-thinking-expansion-input");
    const form = fixtureElement(ui.elements, "ai-thinking-expansion-form");

    ui.thinkingExpansion(snapshot("思维扩展冻结选区"));
    editor.value = "点击后改写的内容与新选区";
    ui.setCurrentDocumentId("doc-2");
    direction.value = "追人物的犹豫";
    direction.dispatch("input");
    form.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "first",
      selected_text: "思维扩展冻结选区",
      thinking_direction: "追人物的犹豫",
    }]);
    assert.equal(editor.value, "点击后改写的内容与新选区");
  } finally {
    ui.restore();
  }
});

test("real AI feature flow opens thinking expansion prestate and waits for Start before generating", async () => {
  const ui = featureHarness([{ ok: true, content: "扩展回答" }]);
  try {
    const editor = ui.elements.get("editor-textarea")!;
    const original = editor.value;
    const input = ui.elements.get("ai-thinking-expansion-input")!;

    ui.thinkingExpansion(snapshot("冻结选区"));

    assert.equal(ui.requests.length, 0);
    assert.equal(ui.elements.get("ai-thinking-expansion-prestate")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-snapshot-text")!.textContent, "冻结选区");

    input.value = "想追的方向";
    input.dispatch("input");
    ui.elements.get("ai-thinking-expansion-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "first",
      selected_text: "冻结选区",
      thinking_direction: "想追的方向",
    }]);
    assert.equal(editor.value, original);
  } finally {
    ui.restore();
  }
});

test("real AI feature flow omits thinking direction when the prestate direction is blank", async () => {
  const ui = featureHarness([{ ok: true, content: "扩展回答" }]);
  try {
    const input = ui.elements.get("ai-thinking-expansion-input")!;

    ui.thinkingExpansion(snapshot("冻结选区"));

    input.value = "   \n  ";
    input.dispatch("input");
    ui.elements.get("ai-thinking-expansion-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "first",
      selected_text: "冻结选区",
    }]);
  } finally {
    ui.restore();
  }
});

test("thinking expansion follow-up reuses the original direction-bearing first material", async () => {
  const ui = featureHarness([
    { ok: true, content: "扩展回答" },
    { ok: true, content: "追问回答" },
  ]);
  try {
    const input = ui.elements.get("ai-thinking-expansion-input")!;

    ui.thinkingExpansion(snapshot("冻结选区"));

    input.value = "追人物的犹豫";
    input.dispatch("input");
    ui.elements.get("ai-thinking-expansion-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.equal(await ui.controller.submitFollowUp("继续追问"), true);
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests[1], {
      kind: "follow_up",
      selected_text: "冻结选区",
      thinking_direction: "追人物的犹豫",
      messages: [
        { role: "assistant", content: "扩展回答" },
        { role: "user", content: "继续追问" },
      ],
    });
  } finally {
    ui.restore();
  }
});

test("summon follow-up does not invent a thinking direction", async () => {
  const ui = featureHarness([
    { ok: true, content: "首答" },
    { ok: true, content: "追问回答" },
  ]);
  try {
    ui.summon(snapshot("普通选区"));
    await flushAiFeatureFlow();

    assert.equal(await ui.controller.submitFollowUp("继续追问"), true);
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests[1], {
      kind: "follow_up",
      selected_text: "普通选区",
      messages: [
        { role: "assistant", content: "首答" },
        { role: "user", content: "继续追问" },
      ],
    });
  } finally {
    ui.restore();
  }
});

test("configuration navigation preserves the live feature and never starts generation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.summon(snapshot("锚点"));
    await flushAiFeatureFlow();
    ui.elements.get("ai-go-config")!.dispatch("click");
    assert.deepEqual(ui.openedConfig, ["settings"]);
    assert.equal(ui.requests.length, 1);
    assert.equal(await ui.controller.submitFollowUp("回来后追问"), true);
    await flushAiFeatureFlow();
  } finally {
    ui.restore();
  }
});

test("same-project first requests remain single-flight while the current request is pending", async () => {
  const pending = deferredGenerateResult();
  const ui = featureHarness([pending.promise, { ok: true, content: "不应发起" }]);
  try {
    ui.summon(snapshot("当前作品选区一"));
    ui.summon(snapshot("当前作品选区二"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "当前作品选区一" },
    ]);
  } finally {
    ui.restore();
  }
});

test("project replacement releases a stale first request so the new project can summon immediately", async () => {
    const stale = deferredGenerateResult();
    const ui = featureHarness([stale.promise, { ok: true, content: "新作品回应" }]);
    try {
      ui.summon(snapshot("旧作品选区"));
      await flushAiFeatureFlow();
      assert.equal(ui.requests.length, 1);

    ui.controller.endProject();
    ui.controller.beginProject();
    ui.summon(snapshot("新作品选区"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "旧作品选区" },
      { kind: "first", selected_text: "新作品选区" },
    ]);
    assert.deepEqual(conversationText(ui), ["新作品回应"]);

    stale.resolve({ ok: true, content: "迟到旧作品回应" });
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["新作品回应"]);
  } finally {
    ui.restore();
  }
});

test("project replacement releases a stale follow-up request so the new project can summon immediately", async () => {
  const stale = deferredGenerateResult();
  const ui = featureHarness([
    { ok: true, content: "旧作品首答" },
    stale.promise,
    { ok: true, content: "新作品首答" },
  ]);
    try {
      ui.summon(snapshot("旧作品锚点"));
      await flushAiFeatureFlow();
      assert.equal(await ui.controller.submitFollowUp("旧作品追问"), true);
      await flushAiFeatureFlow();
      assert.equal(ui.requests.length, 2);

    ui.controller.endProject();
    ui.controller.beginProject();
    ui.summon(snapshot("新作品锚点"));
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [
      { kind: "first", selected_text: "旧作品锚点" },
      {
        kind: "follow_up",
        selected_text: "旧作品锚点",
        messages: [
          { role: "assistant", content: "旧作品首答" },
          { role: "user", content: "旧作品追问" },
        ],
      },
      { kind: "first", selected_text: "新作品锚点" },
    ]);
    assert.deepEqual(conversationText(ui), ["新作品首答"]);

    stale.resolve({ ok: false, error: { code: "network", message: "迟到旧作品失败" } });
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["新作品首答"]);
  } finally {
    ui.restore();
  }
});

test("idle open panel shows the direct question form with submit disabled", () => {
  const ui = harness();
  try {
    const form = ui.elements.get("ai-direct-question")!;
    assert.equal(form.classList.contains("hidden"), true);

    ui.state.open();
    assert.equal(form.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-direct-question-send")!.disabled, true);
    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("direct question draft enables submit and Enter submits the question", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这个角色为什么犹豫？";
    input.dispatch("input");
    assert.equal(ui.elements.get("ai-direct-question-send")!.disabled, false);

    const entered = input.dispatch("keydown", { key: "Enter" });
    assert.equal(entered.defaultPrevented, true);
    assert.equal((ui.elements.get("editor-textarea")?.value ?? "用户正文"), "用户正文");
  } finally {
    ui.restore();
  }
});

test("direct question selection hint shows the attached selection and remove clears it", () => {
  const ui = harness();
  try {
    ui.state.open();
    ui.state.setPendingSelection(snapshot("林站在天台边。"));

    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-direct-question-selection-text")!.textContent, "林站在天台边。");

    ui.elements.get("ai-direct-question-selection-remove")!.dispatch("click");
    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), true);
    assert.equal(ui.state.view.pendingSelection, null);
  } finally {
    ui.restore();
  }
});

test("collapse and reopen preserve the direct question draft and pending selection", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "未发送的问题";
    input.dispatch("input");
    ui.state.setPendingSelection(snapshot("选区"));

    ui.state.close();
    ui.state.open();

    assert.equal(input.value, "未发送的问题");
    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("project lifecycle reset clears direct question draft and pending selection", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "旧作品问题";
    input.dispatch("input");
    ui.state.setPendingSelection(snapshot("旧作品选区"));

    ui.state.reset();

    assert.equal(input.value, "");
    assert.equal(ui.state.view.directQuestionDraft, "");
    assert.equal(ui.state.view.pendingSelection, null);
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("direct question success renders the unified conversation and hides the direct question form", () => {
  const ui = harness();
  try {
    ui.state.open();
    ui.state.beginDirectQuestion("问题", null);
    ui.state.succeedDirectQuestion("回答");

    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), ["问题", "回答"]);
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), false);
    assert.equal((ui.elements.get("editor-textarea")?.value ?? "用户正文"), "用户正文");
  } finally {
    ui.restore();
  }
});

test("direct question success keeps the conversation and unsent follow-up draft across collapse", () => {
  const ui = harness();
  try {
    ui.state.open();
    ui.state.beginDirectQuestion("问题", null);
    ui.state.succeedDirectQuestion("回答");
    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "未发送的追问";
    input.dispatch("input");

    ui.state.close();
    ui.state.open();

    assert.deepEqual(conversationText(ui), ["问题", "回答"]);
    assert.equal(input.value, "未发送的追问");
    assert.deepEqual(ui.submitted, []);
  } finally {
    ui.restore();
  }
});

test("direct question success submits a follow-up through the unified conversation", () => {
  const ui = harness();
  try {
    ui.state.open();
    ui.state.beginDirectQuestion("问题", null);
    ui.state.succeedDirectQuestion("回答");
    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "继续追问";
    input.dispatch("input");
    ui.elements.get("ai-follow-up-form")!.dispatch("submit");

    assert.deepEqual(ui.submitted, ["继续追问"]);
  } finally {
    ui.restore();
  }
});

test("direct question error renders the error message and keeps the draft", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "问题";
    input.dispatch("input");
    ui.state.beginDirectQuestion("问题", null);
    ui.state.failDirectQuestion({ code: "network", message: "网络失败" });

    assert.equal(ui.elements.get("ai-direct-question-error")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-direct-question-error-message")!.textContent, "网络失败");
    assert.equal(input.value, "问题");
  } finally {
    ui.restore();
  }
});

test("real AI feature flow submits a direct question and renders the unified conversation without writing notebooks", async () => {
  const ui = featureHarness([{ ok: true, content: "直接提问回答" }]);
  try {
    const editor = ui.elements.get("editor-textarea")!;
    const original = editor.value;
    const toggle = ui.elements.get("btn-toggle-ai")!;
    toggle.dispatch("click");
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), false);

    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这个角色为什么犹豫？";
    input.dispatch("input");
    ui.elements.get("ai-direct-question-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "direct_question",
      question: "这个角色为什么犹豫？",
    }]);
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), ["这个角色为什么犹豫？", "直接提问回答"]);
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), false);
    assert.equal(editor.value, original);
  } finally {
    ui.restore();
  }
});

test("real AI feature flow direct question with pending selection sends question and selection", async () => {
  const fakeEditor: SelectionEntryEditor = {
    element: new FakeElement("editor-textarea") as unknown as HTMLElement,
    getDocument: () => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "林站在天台边。" }] }],
    }),
    getSelection: () => ({ from: 1, to: 8, head: 8 }),
    coordinatesAt: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
  const ui = featureHarness([{ ok: true, content: "回答" }], { currentEditor: fakeEditor });
  try {
    const toggle = ui.elements.get("btn-toggle-ai")!;
    toggle.dispatch("click");
    // 面板打开时同步编辑器选区为待附带重点材料
    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), false);

    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这段里人物在隐瞒什么？";
    input.dispatch("input");
    ui.elements.get("ai-direct-question-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "direct_question",
      question: "这段里人物在隐瞒什么？",
      selected_text: "林站在天台边。",
    }]);
  } finally {
    ui.restore();
  }
});

test("empty idle panel hides the new-conversation control and shows it once a conversation exists", () => {
  const ui = harness();
  try {
    const button = ui.elements.get("ai-new-conversation")!;
    ui.state.open();
    assert.equal(button.classList.contains("hidden"), true);

    const anchor = snapshot("锚点");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    assert.equal(button.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});

test("new-conversation click clears the conversation and returns to the empty direct-question form", () => {
  const ui = harness();
  try {
    ui.state.open();
    ui.state.beginDirectQuestion("问题", null);
    ui.state.succeedDirectQuestion("回答");
    const followUpInput = ui.elements.get("ai-follow-up-input")!;
    followUpInput.value = "未发送追问";
    followUpInput.dispatch("input");

    const button = ui.elements.get("ai-new-conversation")!;
    assert.equal(button.classList.contains("hidden"), false);
    button.dispatch("click");

    assert.equal(ui.state.conversation, null);
    assert.equal(ui.state.isOpen, true);
    assert.equal(ui.elements.get("ai-conversation")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-follow-up-form")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), false);
    assert.equal(button.classList.contains("hidden"), true);
    assert.equal(followUpInput.value, "");
  } finally {
    ui.restore();
  }
});

test("new-conversation during first loading clears the request and rejects its late result", () => {
  const ui = harness();
  try {
    const anchor = snapshot("冻结选区");
    ui.state.beginRequest(anchor);
    const button = ui.elements.get("ai-new-conversation")!;
    assert.equal(button.classList.contains("hidden"), false);
    button.dispatch("click");

    assert.equal(ui.state.conversation, null);
    assert.equal(ui.state.isOpen, true);
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), false);

    ui.state.succeed(anchor, "迟到回答");
    assert.equal(ui.state.conversation, null);
    assert.deepEqual(conversationText(ui), []);
  } finally {
    ui.restore();
  }
});

test("new-conversation clears the direct-question draft and pending selection", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "旧问题";
    input.dispatch("input");
    ui.state.beginDirectQuestion("旧问题", null);
    ui.state.failDirectQuestion({ code: "network", message: "网络失败" });
    ui.state.setPendingSelection(snapshot("旧选区"));

    assert.equal(ui.state.view.directQuestionDraft, "旧问题");

    ui.elements.get("ai-new-conversation")!.dispatch("click");

    assert.equal(ui.state.view.directQuestionDraft, "");
    assert.equal(ui.state.view.pendingSelection, null);
    assert.equal(input.value, "");
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), false);
  } finally {
    ui.restore();
  }
});
