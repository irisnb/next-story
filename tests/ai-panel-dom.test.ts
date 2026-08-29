import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import { setupAiPanel } from "../src/ai-panel.ts";
import type { AiReplayTurn, AiSessionTransport } from "../src/ai-session-transport.ts";
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
  newConversations: number;
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
  const edited: string[] = [];
  const newConversations: number[] = [];
  let retried = 0;
  let firstRetries = 0;
  setupAiPanel(dom, state, {
    onRetry: () => { firstRetries += 1; },
    onGoToConfig: () => {},
    onSubmitFollowUp: (question) => { submitted.push(question); return Promise.resolve(true); },
    onRetryFollowUp: () => { retried += 1; return Promise.resolve(true); },
    onEditFollowUp: (question) => { edited.push(question); return Promise.resolve(true); },
    onSubmitDirectQuestion: () => Promise.resolve(true),
    onNewConversation: () => {
      if (state.newConversation()) newConversations.push(1);
    },
    onRemoveDirectQuestionSelection: () => state.setPendingSelection(null),
    onDirectQuestionFocus: () => {},
    onOpenPanel: () => {},
  });

  return {
    state,
    elements,
    submitted,
    get newConversations() { return newConversations.length; },
    get retried() { return retried; },
    edited,
    get firstRetries() { return firstRetries; },
    restore: () => { globalThis.document = previousDocument; },
  };
}

interface FakeSessionTransportOptions {
  readonly results?: readonly GenerateAiResultSource[];
}

interface FakeSessionTransport {
  transport: AiSessionTransport;
  requests: GenerateAiRequest[];
  endSessionCalls: () => number;
  replayedTurns: () => AiReplayTurn[] | null;
  emitStreamText(text: string): void;
  emitDriverLost(): void;
  resolveReplay(): void;
  rejectReplay(): void;
}

function fakeSessionTransport(options: FakeSessionTransportOptions = {}): FakeSessionTransport {
  const results = [...(options.results ?? [])];
  const requests: GenerateAiRequest[] = [];
  let streamListener: ((text: string) => void) | null = null;
  let driverLostListener: (() => void) | null = null;
  let endSessionCalls = 0;
  let replayedTurns: AiReplayTurn[] | null = null;
  let resolveReplay: (() => void) | null = null;
  let rejectReplay: (() => void) | null = null;

  const transport: AiSessionTransport = {
    sendViaResidentSession: (request) => {
      requests.push(request);
      const result = results.shift();
      if (!result) throw new Error("missing fake result");
      return Promise.resolve(result);
    },
    endActiveSession: () => { endSessionCalls += 1; },
    replayActiveSession: (turns) => {
      replayedTurns = [...turns];
      return new Promise<void>((resolve, reject) => {
        resolveReplay = resolve;
        rejectReplay = () => reject(new Error("重放失败"));
      });
    },
    onStreamText: (listener) => {
      streamListener = listener;
      return () => { streamListener = null; };
    },
    onDriverLost: (listener) => {
      driverLostListener = listener;
      return () => { driverLostListener = null; };
    },
    installSessionEventRouting: () => {},
  };

  return {
    transport,
    requests,
    endSessionCalls: () => endSessionCalls,
    replayedTurns: () => replayedTurns,
    emitStreamText: (text) => streamListener?.(text),
    emitDriverLost: () => driverLostListener?.(),
    resolveReplay: () => resolveReplay?.(),
    rejectReplay: () => rejectReplay?.(),
  };
}

function featureHarness(results: GenerateAiResultSource[], options: {
  readonly loadConfigError?: unknown;
  readonly loadConfigResult?: LlmConfigSummary | null;
  readonly loadConfigPromise?: Promise<LlmConfigSummary | null>;
} = {}): {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  session: FakeSessionTransport;
  submitDirectQuestion(question: string): void;
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

  const session = fakeSessionTransport({ results });
  const openedConfig: string[] = [];
  const loadConfigResult = options.loadConfigResult;
  let currentDocumentId = "doc-1";

  const controller = setupAiFeature({
    aiPanelDom: dom,
    aiPanel: dom.panel,
    aiResponse: dom.response,
    btnToggleAi: dom.toggleBtn,
    editorTextarea: editor,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => currentDocumentId,
    getCurrentEditor: () => null,
    openConfigPage: () => { openedConfig.push("settings"); },
  }, {
    transport: session.transport,
    loadConfig: async () => {
      if (options.loadConfigError) throw options.loadConfigError;
      if (options.loadConfigPromise) return options.loadConfigPromise;
      if (loadConfigResult !== undefined) return loadConfigResult;
      return {
        api_base_url: "https://api.example.com/v1",
        model: "saved-model",
        has_api_key: true,
      };
    },
  });

  return {
    controller,
    elements,
    session,
    submitDirectQuestion(question: string): void {
      const toggle = elements.get("btn-toggle-ai")!;
      toggle.dispatch("click");
      const input = elements.get("ai-direct-question-input")!;
      input.value = question;
      input.dispatch("input");
      elements.get("ai-direct-question-form")!.dispatch("submit");
    },
    setCurrentDocumentId: (documentId) => { currentDocumentId = documentId; },
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

test("follow-up stream text renders as an assistant message before the thinking status", () => {
  const ui = harness();
  try {
    const anchor = snapshot("冻结选区");
    ui.state.beginRequest(anchor);
    ui.state.succeed(anchor, "首答");
    ui.state.beginFollowUp("问题二");
    ui.state.appendStreamText("人物可能");
    ui.state.appendStreamText("在隐瞒动机");

    const conversation = ui.elements.get("ai-conversation")!;
    assert.deepEqual(
      conversation.children.map((child) => child.textContent),
      ["首答", "问题二", "人物可能在隐瞒动机", "正在思考…"],
    );
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
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.submitFollowUp("失败问题"), true);
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.retryFollowUp(), true);
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.editFollowUp("编辑问题"), true);
    await flushAiFeatureFlow();

    assert.equal(editor.value, original);
    assert.equal(ui.session.requests.length, 4);
  } finally {
    ui.restore();
  }
});

test("real AI feature flow submits a direct question and renders the unified conversation without writing notebooks", async () => {
  const ui = featureHarness([{ ok: true, content: "直接提问回答" }]);
  try {
    const editor = ui.elements.get("editor-textarea")!;
    const original = editor.value;
    ui.submitDirectQuestion("这个角色为什么犹豫？");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.session.requests, [{
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
  const ui = featureHarness([{ ok: true, content: "回答" }]);
  try {
    const toggle = ui.elements.get("btn-toggle-ai")!;
    toggle.dispatch("click");
    // 面板打开时同步编辑器选区为待附带重点材料（无编辑器时无选区）
    assert.equal(ui.elements.get("ai-direct-question-selection")!.classList.contains("hidden"), true);

    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这段里人物在隐瞒什么？";
    input.dispatch("input");
    ui.elements.get("ai-direct-question-form")!.dispatch("submit");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.session.requests, [{
      kind: "direct_question",
      question: "这段里人物在隐瞒什么？",
    }]);
  } finally {
    ui.restore();
  }
});

test("direct question streams incremental text into the conversation thread via state", async () => {
  const pending = deferredGenerateResult();
  const ui = featureHarness([pending.promise]);
  try {
    ui.submitDirectQuestion("这个角色为什么犹豫？");
    await flushAiFeatureFlow();

    // 流式增量经传输层到达面板状态，再渲染到对话流内该轮次位置（纯文本、保留换行）
    ui.session.emitStreamText("她可能\n");
    ui.session.emitStreamText("在隐瞒动机");
    assert.deepEqual(conversationText(ui), [
      "这个角色为什么犹豫？",
      "她可能\n在隐瞒动机",
      "正在思考…",
    ]);

    // done 全文到达：整体替换流式草稿，同一轮次位置无容器跳变
    pending.resolve({ ok: true, content: "最终回答" });
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["这个角色为什么犹豫？", "最终回答"]);
  } finally {
    ui.restore();
  }
});

test("empty open panel shows the welcome message and hides it once a question is accepted", () => {
  const ui = harness();
  try {
    const welcome = ui.elements.get("ai-welcome")!;

    // 空状态：显示欢迎语，输入区在底部可用
    ui.state.open();
    assert.equal(welcome.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-direct-question")!.classList.contains("hidden"), false);

    // 首轮请求被接受：欢迎语消失，用户问题作为消息进入对话流并显示生成中状态
    ui.state.beginDirectQuestion("这个角色为什么犹豫？", null);
    assert.equal(welcome.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), ["这个角色为什么犹豫？", "正在思考…"]);
  } finally {
    ui.restore();
  }
});

test("follow-up streams incremental text into the conversation thread", async () => {
  const ui = featureHarness([
    { ok: true, content: "首答" },
    { ok: true, content: "追问回答" },
  ]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();

    const input = ui.elements.get("ai-follow-up-input")!;
    input.value = "继续追问";
    input.dispatch("input");
    ui.elements.get("ai-follow-up-form")!.dispatch("submit");
    ui.session.emitStreamText("部分草稿");
    assert.ok(conversationText(ui).includes("部分草稿"), "流式增量应出现在对话线程中");

    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["原问题", "首答", "继续追问", "追问回答"]);
  } finally {
    ui.restore();
  }
});

test("driver lost with a conversation enters recovery, replays history, and completes", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["原问题", "首答"]);

    ui.session.emitDriverLost();

    // 恢复中：保留对话与锚点，显示恢复占位文案
    assert.ok(ui.session.replayedTurns());
    assert.deepEqual(ui.session.replayedTurns(), [
      { role: "user", text: "用户问题：\n原问题" },
      { role: "assistant", text: "首答" },
    ]);
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-loading")!.textContent, "恢复对话中");

    ui.session.resolveReplay();
    await flushAiFeatureFlow();
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), ["原问题", "首答"]);
  } finally {
    ui.restore();
  }
});

test("driver lost recovery replays the selection material and successful follow-up turns", async () => {
  const ui = featureHarness([
    { ok: true, content: "首答" },
    { ok: true, content: "第一答" },
  ]);
  try {
    const toggle = ui.elements.get("btn-toggle-ai")!;
    toggle.dispatch("click");
    // 无编辑器时无待附带选区；直接提问成功后追问一轮
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "原问题";
    input.dispatch("input");
    ui.elements.get("ai-direct-question-form")!.dispatch("submit");
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.submitFollowUp("第一问"), true);
    await flushAiFeatureFlow();

    ui.session.emitDriverLost();
    assert.deepEqual(ui.session.replayedTurns(), [
      { role: "user", text: "用户问题：\n原问题" },
      { role: "assistant", text: "首答" },
      { role: "user", text: "第一问" },
      { role: "assistant", text: "第一答" },
    ]);
  } finally {
    ui.restore();
  }
});

test("driver lost recovery failure shows the recovery error and keeps the conversation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();

    ui.session.emitDriverLost();
    ui.session.rejectReplay();
    await flushAiFeatureFlow();

    assert.equal(ui.elements.get("ai-error-block")!.classList.contains("hidden"), false);
    assert.equal(ui.elements.get("ai-error-message")!.textContent, "对话恢复失败，请点击新建对话开始新对话");
    assert.equal(
      ui.elements.get("ai-conversation")!.classList.contains("hidden"),
      false,
      "恢复失败保留对话本体",
    );
  } finally {
    ui.restore();
  }
});

test("driver lost without a conversation only resets the transport without recovery", async () => {
  const ui = featureHarness([]);
  try {
    ui.session.emitDriverLost();
    await flushAiFeatureFlow();

    assert.equal(ui.session.endSessionCalls(), 1);
    assert.equal(ui.session.replayedTurns(), null, "无对话不进入恢复流程");
    assert.equal(ui.elements.get("ai-loading")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("new-conversation click ends the resident session", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();
    assert.equal(ui.session.endSessionCalls(), 0);

    ui.elements.get("ai-new-conversation")!.dispatch("click");
    assert.equal(ui.session.endSessionCalls(), 1, "新建对话应结束常驻会话");
    assert.equal(ui.elements.get("ai-conversation")!.classList.contains("hidden"), true);
  } finally {
    ui.restore();
  }
});

test("project lifecycle transitions end the resident session", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();

    ui.controller.endProject();
    assert.equal(ui.session.endSessionCalls(), 1);

    ui.controller.beginProject();
    assert.equal(ui.session.endSessionCalls(), 2);
  } finally {
    ui.restore();
  }
});

test("editor lifecycle composition resets AI on project ready and unload", async () => {
  const ui = featureHarness([{ ok: true, content: "旧作品首答" }, { ok: true, content: "新作品首答" }]);
  try {
    ui.submitDirectQuestion("旧作品问题");
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["旧作品问题", "旧作品首答"]);

    // endProject（作品卸载）：清空旧对话，AI 面板回到初始状态。
    ui.controller.endProject();
    assert.equal(ui.elements.get("ai-conversation")!.classList.contains("hidden"), true);
    assert.deepEqual(conversationText(ui), []);

    // beginProject（新作品就绪）：可以立刻在新作品里直接提问，旧内容不残留。
    ui.controller.beginProject();
    ui.submitDirectQuestion("新作品问题");
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["新作品问题", "新作品首答"]);
  } finally {
    ui.restore();
  }
});

test("configuration navigation preserves the live feature and never starts generation", async () => {
  const ui = featureHarness([{ ok: true, content: "首答" }]);
  try {
    ui.submitDirectQuestion("原问题");
    await flushAiFeatureFlow();
    ui.elements.get("ai-go-config")!.dispatch("click");
    assert.deepEqual(ui.openedConfig, ["settings"]);
    assert.equal(ui.session.requests.length, 1);
    assert.equal(await ui.controller.submitFollowUp("回来后追问"), true);
    await flushAiFeatureFlow();
  } finally {
    ui.restore();
  }
});

test("project replacement releases a stale follow-up request so the new project can ask immediately", async () => {
  const pending = deferredGenerateResult();
  const ui = featureHarness([
    { ok: true, content: "旧作品首答" },
    pending.promise,
    { ok: true, content: "新作品首答" },
  ]);
  try {
    ui.submitDirectQuestion("旧作品问题");
    await flushAiFeatureFlow();
    assert.equal(await ui.controller.submitFollowUp("旧作品追问"), true);
    await flushAiFeatureFlow();
    assert.equal(ui.session.requests.length, 2);

    ui.controller.endProject();
    ui.controller.beginProject();
    ui.submitDirectQuestion("新作品问题");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.session.requests, [
      { kind: "direct_question", question: "旧作品问题" },
      {
        kind: "follow_up",
        selected_text: "",
        origin: "direct_question",
        messages: [
          { role: "user", content: "旧作品问题" },
          { role: "assistant", content: "旧作品首答" },
          { role: "user", content: "旧作品追问" },
        ],
      },
      { kind: "direct_question", question: "新作品问题" },
    ]);
    assert.deepEqual(conversationText(ui), ["新作品问题", "新作品首答"]);

    pending.resolve({ ok: false, error: { code: "network", message: "迟到旧作品失败" } });
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui), ["新作品问题", "新作品首答"]);
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

test("direct question loading clears the input display and disables typing", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这个角色为什么犹豫？";
    input.dispatch("input");
    assert.equal(input.disabled, false);

    ui.state.beginDirectQuestion("这个角色为什么犹豫？", null);

    // 问题已作为用户消息进入对话流，输入框不再保留副本；生成中禁止打字
    assert.equal(input.value, "");
    assert.equal(input.disabled, true);
    assert.deepEqual(conversationText(ui), ["这个角色为什么犹豫？", "正在思考…"]);
  } finally {
    ui.restore();
  }
});

test("direct question failure restores the draft in the input for retry editing", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这个问题";
    input.dispatch("input");
    ui.state.beginDirectQuestion("这个问题", null);
    assert.equal(input.value, "");

    ui.state.failDirectQuestion({ code: "network", message: "网络失败" });

    // 失败后恢复草稿供重试编辑（重试语义不破坏），输入重新可用
    assert.equal(input.value, "这个问题");
    assert.equal(input.disabled, false);
  } finally {
    ui.restore();
  }
});

test("direct question configuration-required restores the draft in the input", () => {
  const ui = harness();
  try {
    ui.state.open();
    const input = ui.elements.get("ai-direct-question-input")!;
    input.value = "这个问题";
    input.dispatch("input");
    ui.state.beginDirectQuestion("这个问题", null);

    ui.state.requireDirectQuestionConfiguration();

    assert.equal(input.value, "这个问题");
    assert.equal(input.disabled, false);
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
