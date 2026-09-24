import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import { setupAiWindow } from "../src/ai-window.ts";
import { conversationFromRecord, HIDDEN_MATERIAL_RESTRICTION_NOTICE } from "../src/ai-panel-conversation.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  GenerateAiRequest,
  GenerateAiResult,
} from "../src/types.ts";
import {
  collectText,
  createAiWindowFixture,
  FakeElement,
  installAiFeatureEnvironment,
  installDocument,
} from "./ai-panel-dom-fixture.ts";

type GenerateAiResultSource = GenerateAiResult | Promise<GenerateAiResult>;

function deferredGenerateResult(): {
  promise: Promise<GenerateAiResult>;
  resolve(result: GenerateAiResult): void;
} {
  let resolveResult: ((result: GenerateAiResult) => void) | null = null;
  const promise = new Promise<GenerateAiResult>((resolve) => { resolveResult = resolve; });
  if (!resolveResult) throw new Error("deferred result was not initialized");
  return { promise, resolve: resolveResult };
}

function conversationText(root: FakeElement): string[] {
  const conv = root.queryResults.get('[data-role="conversation"]')!;
  return conv.children.map((child) => child.textContent);
}

async function flushAiFeatureFlow(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

function windowActions(state: AiPanelState) {
  let stopCalls = 0;
  let closeCalls = 0;
  let newConversationCalls = 0;
  return {
    stopCalls: () => stopCalls,
    closeCalls: () => closeCalls,
    newConversationCalls: () => newConversationCalls,
    actions: {
      onRetry: () => {},
      onRetryFollowUp: () => Promise.resolve(true),
      onRetryStoppedFollowUp: () => Promise.resolve(true),
      onGoToConfig: () => {},
      onSubmitFollowUp: () => Promise.resolve(true),
      onEditFollowUp: () => Promise.resolve(true),
      onSubmitDirectQuestion: () => Promise.resolve(true),
      onRemoveDirectQuestionSelection: () => state.setPendingSelection(null),
      onDirectQuestionFocus: () => {},
      onStop: () => { stopCalls += 1; },
      onClose: () => { closeCalls += 1; },
      onNewConversation: () => { newConversationCalls += 1; },
    },
  };
}

test("window renders a conversation with user and assistant messages", () => {
  const { root } = createAiWindowFixture("1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    const wa = windowActions(state);
    setupAiWindow(root as unknown as HTMLElement, state, "1", wa.actions);

    state.beginDirectQuestion("问题", null);
    state.succeedDirectQuestion("回答");

    assert.deepEqual(conversationText(root), ["问题", "回答"]);
  } finally {
    doc.restore();
  }
});

test("window streams incremental text into the conversation thread", () => {
  const { root } = createAiWindowFixture("1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    const wa = windowActions(state);
    setupAiWindow(root as unknown as HTMLElement, state, "1", wa.actions);

    state.beginDirectQuestion("这个角色为什么犹豫？", null);
    state.appendStreamText("1", "她可能\n");
    state.appendStreamText("1", "在隐瞒动机");

    assert.deepEqual(conversationText(root), [
      "这个角色为什么犹豫？",
      "她可能\n在隐瞒动机",
      "正在思考…",
    ]);
  } finally {
    doc.restore();
  }
});

test("window stop and close buttons invoke the bound actions", () => {
  const { root } = createAiWindowFixture("1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    const wa = windowActions(state);
    setupAiWindow(root as unknown as HTMLElement, state, "1", wa.actions);

    state.beginDirectQuestion("问题", null);
    root.queryResults.get('[data-role="stop"]')!.dispatch("click");
    assert.equal(wa.stopCalls(), 1);
    root.queryResults.get('[data-role="close"]')!.dispatch("click");
    assert.equal(wa.closeCalls(), 1);
  } finally {
    doc.restore();
  }
});

test("restricted discussion window shows a notice, disables follow-up, and offers a new conversation", () => {
  const { root } = createAiWindowFixture("c-1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.openDiscussion(conversationFromRecord(
        {
          version: 1,
          conversation_id: "c-1",
          title: "选区",
          created_at: "t0",
          updated_at: "t0",
          focus_document_id: "doc-1",
          focus_document_title: null,
          first_round_material: { kind: "summon", question: "", selection_text: "选区" },
          turns: [{ role: "assistant", text: "首答", status: "done" }],
          provenance: [
            {
              document_id: "doc-1",
              material_type: "selection",
              document_version: null,
              turn_index: 0,
              entered_model_context: true,
            },
          ],
        },
      { hiddenDocumentIds: new Set(["doc-1"]) }), "doc-1", null);

    const wa = windowActions(state);
    setupAiWindow(root as unknown as HTMLElement, state, "c-1", wa.actions);

    const notice = root.queryResults.get('[data-role="restriction-notice"]');
    assert.ok(notice, "受限讨论必须有提示节点");
    assert.equal(notice.classList.contains("hidden"), false);
    assert.equal(
      root.queryResults.get('[data-role="restriction-notice-message"]')!.textContent,
      HIDDEN_MATERIAL_RESTRICTION_NOTICE,
    );
    // 追问输入与发送入口被禁用。
    assert.equal(root.queryResults.get('[data-role="follow-up-input"]')!.disabled, true);
    assert.equal(root.queryResults.get('[data-role="follow-up-send"]')!.disabled, true);

    const newConversationBtn = root.queryResults.get('[data-role="restriction-new-conversation"]');
    assert.ok(newConversationBtn, "受限提示提供新建讨论入口");
    newConversationBtn.dispatch("click");
    assert.equal(wa.newConversationCalls(), 1);
  } finally {
    doc.restore();
  }
});

function featureHarness(results: GenerateAiResultSource[]): {
  controller: ReturnType<typeof setupAiFeature>;
  elements: Map<string, FakeElement>;
  windowRoots: FakeElement[];
  requests: GenerateAiRequest[];
  transportLifecycle: {
    emitStream(conversationId: string, text: string): void;
    emitDriverLost(): void;
    readonly streamUnsubscribes: number;
    readonly driverUnsubscribes: number;
    readonly routeDestroys: number;
    readonly endAllCalls: number;
  };
  restore(): void;
} {
  const env = installAiFeatureEnvironment();
  const requests: GenerateAiRequest[] = [];
  const remaining = [...results];
  let streamListener: Parameters<AiSessionTransport["onStreamText"]>[0] | null = null;
  let driverLostListener: Parameters<AiSessionTransport["onDriverLost"]>[0] | null = null;
  let streamUnsubscribes = 0;
  let driverUnsubscribes = 0;
  let routeDestroys = 0;
  let endAllCalls = 0;
  const transport: AiSessionTransport = {
    sendViaResidentSession: (_conversationId, request) => {
      requests.push(request);
      const result = remaining.shift();
      if (!result) throw new Error("missing fake result");
      return Promise.resolve(result);
    },
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => { endAllCalls += 1; },
    replaySession: () => Promise.resolve(),
    onStreamText: (listener) => {
      streamListener = listener;
      return () => { streamUnsubscribes += 1; };
    },
    onDriverLost: (listener) => {
      driverLostListener = listener;
      return () => { driverUnsubscribes += 1; };
    },
    onToolCall: () => () => {},
    onReadingRequest: () => () => {},
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => { routeDestroys += 1; },
  };
  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => "doc-1",
    getCurrentEditor: () => null,
    openConfigPage: () => {},
  }, {
    transport,
    loadConfig: () => Promise.resolve({ api_base_url: "https://api.example.com/v1", model: "m", has_api_key: true }),
  });
  return {
    controller,
    elements: env.elements,
    windowRoots: env.windowRoots,
    requests,
    transportLifecycle: {
      emitStream: (conversationId, text) => streamListener?.({ conversationId, messageId: "late-message", text }),
      emitDriverLost: () => driverLostListener?.(),
      get streamUnsubscribes() { return streamUnsubscribes; },
      get driverUnsubscribes() { return driverUnsubscribes; },
      get routeDestroys() { return routeDestroys; },
      get endAllCalls() { return endAllCalls; },
    },
    restore: () => env.restore(),
  };
}

function submitDirectQuestion(ui: { elements: Map<string, FakeElement>; windowRoots: FakeElement[] }, question: string): void {
  ui.elements.get("ai-new-conversation")!.dispatch("click");
  const win = ui.windowRoots[ui.windowRoots.length - 1];
  const input = win.queryResults.get('[data-role="direct-question-input"]')!;
  input.value = question;
  input.dispatch("input");
  win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
}

test("real AI feature flow submits a direct question into its own window", async () => {
  const ui = featureHarness([{ ok: true, content: "直接提问回答" }]);
  try {
    submitDirectQuestion(ui, "这个角色为什么犹豫？");
    await flushAiFeatureFlow();

    assert.deepEqual(ui.requests, [{
      kind: "direct_question",
      question: "这个角色为什么犹豫？",
      // 阶段五 A：常规直接提问附带关注文档身份（此处关注文档 = 当前文档 doc-1）。
      focus_document_id: "doc-1",
    }]);
    assert.equal(ui.windowRoots.length, 1);
    assert.deepEqual(conversationText(ui.windowRoots[0]), ["这个角色为什么犹豫？", "直接提问回答"]);
  } finally {
    ui.restore();
  }
});

test("stopRequest marks only the target discussion stopped", async () => {
  // 讨论 A 生成中（挂起），讨论 B 已完成：停止 A 只影响 A。
  const pending = deferredGenerateResult();
  const ui = featureHarness([pending.promise, { ok: true, content: "回答二" }]);
  try {
    submitDirectQuestion(ui, "问题一");
    await flushAiFeatureFlow();
    submitDirectQuestion(ui, "问题二");
    await flushAiFeatureFlow();

    const state = ui.controller.state;
    const idA = [...state.windows.keys()].find((id) => {
      const d = state.getDiscussion(id)!;
      return d.request.kind === "direct_question" && d.request.status === "loading";
    });
    assert.ok(idA, "讨论 A 仍在生成中");

    assert.equal(state.stopRequest(idA), true);
    let reqA = state.getDiscussion(idA)!.request;
    assert.equal(reqA.kind, "direct_question");
    if (reqA.kind === "direct_question") assert.equal(reqA.status, "stopped");
    pending.resolve({ ok: false, error: { code: "timeout", message: "已取消" } });
    await flushAiFeatureFlow();
    // 迟到终态不把「已停止」改回失败。
    reqA = state.getDiscussion(idA)!.request;
    if (reqA.kind === "direct_question") assert.equal(reqA.status, "stopped");
  } finally {
    ui.restore();
  }
});

test("closeWindow ends display but keeps the discussion", async () => {
  const ui = featureHarness([{ ok: true, content: "回答" }]);
  try {
    submitDirectQuestion(ui, "问题");
    await flushAiFeatureFlow();
    const id = ui.controller.state.conversations[0].conversation_id;

    assert.equal(ui.controller.state.closeWindow(id), true);
    assert.equal(ui.controller.state.windows.size, 0);
    assert.ok(ui.controller.state.getDiscussion(id), "关闭窗口不删除讨论");
  } finally {
    ui.restore();
  }
});

test("project lifecycle reset clears windows and discussions", async () => {
  const ui = featureHarness([{ ok: true, content: "旧作品回答" }, { ok: true, content: "新作品回答" }]);
  try {
    submitDirectQuestion(ui, "旧作品问题");
    await flushAiFeatureFlow();
    assert.equal(ui.windowRoots.length, 1);

    ui.controller.endProject();
    assert.equal(ui.controller.state.windows.size, 0);
    assert.equal(ui.windowRoots[0].parentElement, null, "切换作品销毁所有窗口");

    ui.controller.beginProject();
    submitDirectQuestion(ui, "新作品问题");
    await flushAiFeatureFlow();
    assert.deepEqual(conversationText(ui.windowRoots[1]), ["新作品问题", "新作品回答"]);
  } finally {
    ui.restore();
  }
});

test("AI feature destroy releases owned resources once and ignores late work", async () => {
  const pending = deferredGenerateResult();
  const ui = featureHarness([pending.promise]);
  try {
    submitDirectQuestion(ui, "销毁前的问题");
    await flushAiFeatureFlow();
    const conversationId = ui.controller.state.activeConversationId!;
    const editor = ui.elements.get("editor-textarea")!;
    const toggle = ui.elements.get("btn-toggle-ai")!;
    assert.equal(editor.listenerCount("mouseup"), 1);
    assert.equal(toggle.listenerCount("click"), 1);
    assert.equal(ui.windowRoots[0].parentElement !== null, true);

    ui.controller.destroy();
    const stateAfterDestroy = ui.controller.state.view;
    assert.equal(editor.listenerCount("mouseup"), 0, "编辑器监听被移除");
    assert.equal(toggle.listenerCount("click"), 0, "面板按钮监听被移除");
    assert.equal(ui.elements.get("ai-new-conversation")!.listenerCount("click"), 0, "停靠区常驻监听被移除");
    assert.equal(ui.windowRoots[0].parentElement, null, "AI 面板控制器销毁窗口和状态订阅");
    assert.equal(ui.transportLifecycle.streamUnsubscribes, 1);
    assert.equal(ui.transportLifecycle.driverUnsubscribes, 1);
    assert.equal(ui.transportLifecycle.routeDestroys, 1);
    assert.equal(ui.transportLifecycle.endAllCalls, 1);

    ui.transportLifecycle.emitStream(conversationId, "迟到流式文本");
    ui.transportLifecycle.emitDriverLost();
    pending.resolve({ ok: true, content: "迟到终态" });
    await flushAiFeatureFlow();
    assert.deepEqual(ui.controller.state.view, stateAfterDestroy, "迟到事件和请求结果不得再写状态");

    ui.controller.destroy();
    assert.equal(ui.transportLifecycle.streamUnsubscribes, 1, "重复销毁不重复退订");
    assert.equal(ui.transportLifecycle.driverUnsubscribes, 1);
    assert.equal(ui.transportLifecycle.routeDestroys, 1);
    assert.equal(ui.transportLifecycle.endAllCalls, 1);
  } finally {
    ui.restore();
  }
});

test("AI panel source never exposes writeback entry points", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const domSource = readFileSync(new URL("../src/dom.ts", import.meta.url), "utf8");
  const windowSource = readFileSync(new URL("../src/ai-window.ts", import.meta.url), "utf8");
  assert.doesNotMatch(html, /应用到正文|插入正文|替换正文|写入草稿|写入正文/);
  assert.doesNotMatch(windowSource, /document\.getElementById/);
  assert.match(domSource, /export interface AiWindowDom/);
  assert.match(domSource, /export function buildAiWindowDom/);
});

test("selection entry menu keeps its locked trigger anchor styling", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.ai-selection-entry\s*\{[^}]*width:\s*44px;/s);
  assert.match(styles, /#ai-selection-entry-trigger\s*\{[^}]*font-weight:\s*700;/s);
});

test("focus switch opens the picker and shows a clear Chinese notice when switching", () => {
  const { root } = createAiWindowFixture("c-1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.beginDirectQuestion("问题", null, "doc-1", "第一稿");
    const id = state.activeConversationId!;
    let pickerAnchor: unknown = null;
    const controller = setupAiWindow(root as unknown as HTMLElement, state, id, {
      ...windowActions(state).actions,
      onOpenFocusPicker: (anchor) => { pickerAnchor = anchor; },
    });

    const focusSwitch = root.queryResults.get('[data-role="focus-switch"]')!;
    focusSwitch.dispatch("click");
    assert.equal(pickerAnchor, focusSwitch, "切换入口把自身作为选择器锚点");

    // 选择器动作在改绑后显式触发提示（不把初始绑定误报成切换）。
    state.setFocusDocument(id, "doc-2", "设定集");
    controller.showFocusNotice("已切换关注文档：《设定集》。从下一轮开始使用。");
    const notice = root.queryResults.get('[data-role="focus-notice"]')!;
    assert.equal(notice.classList.contains("hidden"), false);
    assert.match(notice.textContent, /已切换关注文档/);
    assert.match(notice.textContent, /设定集/);
    assert.match(notice.textContent, /下一轮/);
  } finally {
    doc.restore();
  }
});

test("materials toggle shows the actual material sources and hides them again", () => {
  const { root } = createAiWindowFixture("c-1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.beginDirectQuestion("林晓是谁？", null, "doc-1", "第一稿");
    const id = state.activeConversationId!;
    state.succeedDirectQuestion("回答", id);
    state.recordRoundProvenance(id, [
      {
        document_id: "doc-1",
        material_type: "focus_document",
        document_version: "v1",
        turn_index: 0,
        entered_model_context: true,
        from_unsaved_snapshot: true,
        search_status: "hit",
        search_limited: false,
      },
      {
        document_id: "doc-2",
        material_type: "search_snippet",
        document_version: "v2",
        turn_index: 0,
        entered_model_context: true,
        matched_term: "林晓",
      },
    ]);
    setupAiWindow(root as unknown as HTMLElement, state, id, {
      ...windowActions(state).actions,
      resolveDocumentTitle: (documentId) => (documentId === "doc-1" ? "第一稿" : "设定集"),
      isDocumentHidden: () => false,
    });

    const panel = root.queryResults.get('[data-role="materials-panel"]')!;
    assert.equal(panel.classList.contains("hidden"), true, "默认收起，不打断对话");
    root.queryResults.get('[data-role="materials-toggle"]')!.dispatch("click");
    assert.equal(panel.classList.contains("hidden"), false);

    const body = root.queryResults.get('[data-role="materials-body"]')!;
    const text = collectText(body);
    assert.match(text, /关注文档：第一稿/);
    assert.match(text, /未保存快照/);
    assert.match(text, /跨文档命中：设定集/);
    assert.match(text, /匹配词「林晓」/);
    assert.match(text, /跨文档检索：命中 1 处/);

    root.queryResults.get('[data-role="materials-close"]')!.dispatch("click");
    assert.equal(panel.classList.contains("hidden"), true);
  } finally {
    doc.restore();
  }
});

test("a hidden focus document is masked in the window header", () => {
  const { root } = createAiWindowFixture("c-1");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.beginDirectQuestion("问题", null, "doc-1", "秘密文档");
    const id = state.activeConversationId!;
    setupAiWindow(root as unknown as HTMLElement, state, id, {
      ...windowActions(state).actions,
      resolveDocumentTitle: () => null,
      isDocumentHidden: (documentId) => documentId === "doc-1",
    });

    const label = root.queryResults.get('[data-role="doc"]')!;
    assert.ok(!label.textContent.includes("秘密文档"), "隐藏文档名称不得显示");
    assert.match(label.textContent, /已隐藏/);
  } finally {
    doc.restore();
  }
});
