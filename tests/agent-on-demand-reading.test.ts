import assert from "node:assert/strict";
import test from "node:test";

import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiFeature } from "../src/ai-feature.ts";
import { setupAiWindow } from "../src/ai-window.ts";
import {
  buildAiPanelView,
  READING_REQUEST_BOUNDARY_NOTES,
  READING_REQUEST_TITLE,
} from "../src/ai-panel-view-model.ts";
import { ResidentAiSessionTransport } from "../src/ai-session-transport.ts";
import type {
  AiSessionTransport,
  ReadingRequestEvent,
  ToolCallEvent,
} from "../src/ai-session-transport.ts";
import type {
  ConversationRecord,
  OnDemandReadingState,
} from "../src/conversation-archive.ts";
import { deriveConversationSummary } from "../src/conversation-archive.ts";
import { setupFileManagement } from "../src/file-management.ts";
import type { AppDom } from "../src/dom.ts";
import type {
  ContentTree,
  GenerateAiResult,
  LlmConfigSummary,
} from "../src/types.ts";
import {
  collectText,
  createAiWindowFixture,
  installAiFeatureEnvironment,
  installDocument,
  FakeElement,
} from "./ai-panel-dom-fixture.ts";

/**
 * add-agent-on-demand-reading 任务组 7 前端测试：
 * 授权流程（请求 / 允许 / 拒绝 / 措辞）、开关语义（与停止生成解耦）、
 * 补读过程显示、「本次参考了什么」扩展、可见性关闭前影响提示、中断轮重试路径。
 */

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "m",
  has_api_key: true,
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function recordOf(partial: Partial<ConversationRecord> & { conversation_id: string }): ConversationRecord {
  return {
    version: 1,
    title: partial.conversation_id,
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问题", selection_text: null },
    turns: [{ role: "assistant", text: "回答", status: "done" }],
    provenance: [],
    on_demand_reading_grant: null,
    on_demand_reading_provenance: null,
    ...partial,
  };
}

const baseWindowActions = {
  onRetry: () => {},
  onRetryFollowUp: () => Promise.resolve(true),
  onRetryStoppedFollowUp: () => Promise.resolve(true),
  onGoToConfig: () => {},
  onSubmitFollowUp: () => Promise.resolve(true),
  onEditFollowUp: () => Promise.resolve(true),
  onSubmitDirectQuestion: () => Promise.resolve(true),
  onRemoveDirectQuestionSelection: () => {},
  onDirectQuestionFocus: () => {},
  onStop: () => {},
  onClose: () => {},
  onNewConversation: () => {},
};

// ========== 任务 7.1：授权请求卡片（显示 / 允许 / 拒绝 / 措辞） ==========

test("7.1a 授权请求进入讨论状态并在窗口显示原因与权限边界", () => {
  const { root } = createAiWindowFixture("w");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.newConversation();
    const conversationId = state.focusedConversationId!;
    setupAiWindow(root as unknown as HTMLElement, state, conversationId, baseWindowActions);

    state.beginDirectQuestion("这个问题涉及其他文档的伏笔吗？", null);
    state.receiveReadingRequest(conversationId, {
      sessionId: "session-1",
      messageId: `${conversationId}:msg-1`,
      callId: "call-1",
      reason: "需要确认第三章的时间线才能回答",
    });

    const card = root.queryResults.get('[data-role="reading-request"]')!;
    assert.equal(card.classList.contains("hidden"), false, "等待授权时授权卡可见");
    assert.equal(
      root.queryResults.get('[data-role="reading-request-reason"]')!.textContent,
      "需要确认第三章的时间线才能回答",
      "显示模型提供的请求原因",
    );

    const cardText = collectText(card);
    for (const keyword of ["本讨论内生效", "不会修改", "不再重复询问", "随时", "关闭"]) {
      assert.ok(cardText.includes(keyword), `授权卡应说明权限边界（${keyword}）`);
    }
  } finally {
    doc.restore();
  }
});

test("7.1b 措辞红线：授权卡不得表述为「现在才允许 AI 查看作品」", () => {
  const fullText = [READING_REQUEST_TITLE, ...READING_REQUEST_BOUNDARY_NOTES].join("\n");
  // 既有自动材料本来就在工作；本卡只决定是否开启按需补读。
  assert.ok(!fullText.includes("现在才允许"), "不得出现「现在才允许」");
  assert.ok(!fullText.includes("才允许 AI 查看"), "不得表述为「才允许 AI 查看」");
  assert.ok(!fullText.includes("之前看不到"), "不得暗示 AI 之前看不到作品");
  // 权限边界四要素齐备：仅本讨论 / 只读 / 不再重复询问 / 可随时关闭。
  assert.ok(READING_REQUEST_BOUNDARY_NOTES.some((note) => note.includes("本讨论")));
  assert.ok(READING_REQUEST_BOUNDARY_NOTES.some((note) => note.includes("只会阅读")));
  assert.ok(READING_REQUEST_BOUNDARY_NOTES.some((note) => note.includes("不再重复询问")));
  assert.ok(READING_REQUEST_BOUNDARY_NOTES.some((note) => note.includes("随时") && note.includes("关闭")));
});

interface ReadingFeatureHarness {
  openRecord(record: ConversationRecord): Promise<void>;
  controller: ReturnType<typeof setupAiFeature>;
  windowRoots: FakeElement[];
  body: FakeElement;
  saves: ConversationRecord[];
  resolveCalls: Array<{ sessionId: string; callId: string; granted: boolean }>;
  toggleCalls: Array<{ conversationId: string; granted: boolean }>;
  onDemandFetches: string[];
  fireReadingRequest(event: ReadingRequestEvent): void;
  fireToolCall(event: ToolCallEvent): void;
  startDirectQuestion(question: string): { finish(result: GenerateAiResult): Promise<void> };
  restore(): void;
}

function readingHarness(overrides: {
  resolveResult?: (args: { sessionId: string; callId: string; granted: boolean }) => GenerateAiResult;
  toggleResult?: (args: { conversationId: string; granted: boolean }) => Promise<void>;
  onDemandState?: (conversationId: string) => OnDemandReadingState;
} = {}): ReadingFeatureHarness {
  const env = installAiFeatureEnvironment();
  const archives = new Map<string, ConversationRecord>();
  const saves: ConversationRecord[] = [];
  const resolveCalls: Array<{ sessionId: string; callId: string; granted: boolean }> = [];
  const toggleCalls: Array<{ conversationId: string; granted: boolean }> = [];
  const onDemandFetches: string[] = [];
  const readingRequestHandlers: Array<(event: ReadingRequestEvent) => void> = [];
  const toolCallHandlers: Array<(event: ToolCallEvent) => void> = [];
  let pendingResult: { resolve(value: GenerateAiResult): void } | null = null;

  const transport: AiSessionTransport = {
    sendViaResidentSession: () =>
      new Promise<GenerateAiResult>((resolveResult) => {
        pendingResult = { resolve: resolveResult };
      }),
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => {},
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    onReadingRequest: (listener) => {
      readingRequestHandlers.push(listener);
      return () => {};
    },
    onToolCall: (listener) => {
      toolCallHandlers.push(listener);
      return () => {};
    },
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => {},
  };

  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => "doc-1",
    getCurrentEditor: () => null,
    openConfigPage: () => {},
    getCurrentProjectPath: () => "作品路径",
    getCurrentDocumentTitle: () => "草稿",
  }, {
    transport,
    loadConfig: () => Promise.resolve(savedConfig),
    conversationList: () => Promise.resolve({ conversations: [], skipped: [] }),
    conversationRead: async (_path, id) => {
      const record = archives.get(id);
      assert.ok(record);
      return record;
    },
    conversationSave: (_projectPath, record) => {
      saves.push(record);
      return Promise.resolve();
    },
    newConversationId: () => "c-1",
    resolveReadingRequest: (sessionId, callId, granted) => {
      resolveCalls.push({ sessionId, callId, granted });
      return Promise.resolve(
        overrides.resolveResult
          ? overrides.resolveResult({ sessionId, callId, granted })
          : { ok: true, content: "" },
      );
    },
    setOnDemandReading: (_projectPath, conversationId, granted) => {
      toggleCalls.push({ conversationId, granted });
      return overrides.toggleResult
        ? overrides.toggleResult({ conversationId, granted })
        : Promise.resolve();
    },
    fetchOnDemandReading: (_projectPath, conversationId) => {
      onDemandFetches.push(conversationId);
      return Promise.resolve(
        overrides.onDemandState
          ? overrides.onDemandState(conversationId)
          : { grant: null, provenance: null },
      );
    },
  });

  return {
    controller,
    async openRecord(record) {
      archives.set(record.conversation_id, record);
      controller.openDiscussion(deriveConversationSummary(record));
      await flush();
    },
    windowRoots: env.windowRoots,
    body: env.body,
    saves,
    resolveCalls,
    toggleCalls,
    onDemandFetches,
    fireReadingRequest(event) {
      for (const handler of readingRequestHandlers) handler(event);
    },
    fireToolCall(event) {
      for (const handler of toolCallHandlers) handler(event);
    },
    startDirectQuestion(question) {
      env.elements.get("ai-new-conversation")!.dispatch("click");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
      return {
        async finish(result) {
          // 等待异步发送链（loadConfig → 调度 → 传输）真正建好在途请求。
          await flush();
          const holder = pendingResult;
          assert.ok(holder, "应有在途请求");
          holder.resolve(result);
          await flush();
        },
      };
    },
    restore: () => { env.restore(); },
  };
}

test("7.1c 允许：调 ai_resolve_reading_request(true)，授权卡消失，普通保存不携带后端授权", async () => {
  const ui = readingHarness({ onDemandState: () => ({ grant: { granted_at: "t1" }, provenance: null }) });
  try {
    const round = ui.startDirectQuestion("涉及其他文档的问题");
    ui.fireReadingRequest({
      conversationId: "c-1",
      sessionId: "session-9",
      messageId: "c-1:msg-1",
      callId: "call-9",
      reason: "现有材料不足以确认时间线",
    });
    await flush();

    const win = ui.windowRoots[ui.windowRoots.length - 1];
    assert.equal(
      win.queryResults.get('[data-role="reading-request"]')!.classList.contains("hidden"),
      false,
      "等待授权时授权卡可见",
    );
    win.queryResults.get('[data-role="reading-allow"]')!.dispatch("click");
    await flush();

    assert.deepEqual(ui.resolveCalls, [
      { sessionId: "session-9", callId: "call-9", granted: true },
    ], "允许应回填 true（后端写授权并继续原问题）");
    assert.equal(
      win.queryResults.get('[data-role="reading-request"]')!.classList.contains("hidden"),
      true,
      "决定后授权卡消失",
    );
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-1"), true, "授权写入讨论");

    // 授权已由后端窄更新保管；终态保存不得携带运行期授权副本。
    await round.finish({ ok: true, content: "回答" });
    const terminal = ui.saves[ui.saves.length - 1];
    assert.equal("on_demand_reading_grant" in terminal, false, "终态普通保存不得改写授权");
    assert.equal("on_demand_reading_grant" in JSON.parse(JSON.stringify(terminal)), false);
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-1"), true, "刷新后仍显示后端授权");
  } finally {
    ui.restore();
  }
});

test("7.1d 拒绝：调 ai_resolve_reading_request(false)，授权卡消失，讨论保持未授权", async () => {
  const ui = readingHarness();
  try {
    const round = ui.startDirectQuestion("问题");
    ui.fireReadingRequest({
      conversationId: "c-1",
      sessionId: "session-9",
      messageId: "c-1:msg-1",
      callId: "call-9",
      reason: "材料不足",
    });
    await flush();
    const win = ui.windowRoots[ui.windowRoots.length - 1];
    win.queryResults.get('[data-role="reading-deny"]')!.dispatch("click");
    await flush();

    assert.deepEqual(ui.resolveCalls, [
      { sessionId: "session-9", callId: "call-9", granted: false },
    ], "拒绝应回填 false（模型基于既有材料有限回答）");
    assert.equal(
      win.queryResults.get('[data-role="reading-request"]')!.classList.contains("hidden"),
      true,
    );
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-1"), false, "拒绝不写授权");
    await round.finish({ ok: true, content: "有限回答" });
  } finally {
    ui.restore();
  }
});

test("7.1e 回填失败（迟到 / 身份不符）：清除授权卡但不伪造授权", async () => {
  const ui = readingHarness({
    resolveResult: () => ({ ok: false, error: { code: "service", message: "没有该身份的待决授权请求" } }),
  });
  try {
    const round = ui.startDirectQuestion("问题");
    ui.fireReadingRequest({
      conversationId: "c-1",
      sessionId: "session-9",
      messageId: "c-1:msg-1",
      callId: "call-stale",
      reason: "材料不足",
    });
    await flush();
    const win = ui.windowRoots[ui.windowRoots.length - 1];
    win.queryResults.get('[data-role="reading-allow"]')!.dispatch("click");
    await flush();

    assert.equal(
      win.queryResults.get('[data-role="reading-request"]')!.classList.contains("hidden"),
      true,
      "失败也清除授权卡（该轮已收束）",
    );
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-1"), false, "失败不伪造授权");
    await round.finish({ ok: true, content: "回答" });
  } finally {
    ui.restore();
  }
});

// ========== 任务 7.2：讨论内授权开关（含与停止生成解耦） ==========

function clickMenuItem(ui: ReadingFeatureHarness, textPattern: RegExp): FakeElement {
  const win = ui.windowRoots[ui.windowRoots.length - 1];
  win.queryResults.get('[data-role="more"]')!.dispatch("click");
  const menu = ui.body.children.filter((el) => el.classList.contains("ai-menu")).pop();
  assert.ok(menu, "窗口菜单应打开");
  const item = menu!.children.find((child) => {
    const text = collectText(child);
    return textPattern.test(text) && child.listeners.has("click");
  });
  assert.ok(item, `菜单应包含匹配 ${textPattern} 的项`);
  return item!;
}

test("7.2a 窗口菜单开关：开启 / 关闭调用后端命令并更新状态，关闭文案明示不清除已读", async () => {
  const ui = readingHarness();
  try {
    await ui.openRecord(recordOf({ conversation_id: "c-2" }));
    await flush();

    const enableItem = clickMenuItem(ui, /开启按需补读/);
    enableItem.dispatch("click");
    await flush();

    assert.deepEqual(ui.toggleCalls, [{ conversationId: "c-2", granted: true }]);
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-2"), true);

    // 已授权后菜单文案明示「关闭不会清除已读内容」。
    const closeItem = clickMenuItem(ui, /关闭按需补读/);
    assert.ok(collectText(closeItem).includes("不清除已读内容"), "关闭入口明示不清除已读内容");
    closeItem.dispatch("click");
    await flush();

    assert.deepEqual(ui.toggleCalls, [
      { conversationId: "c-2", granted: true },
      { conversationId: "c-2", granted: false },
    ]);
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-2"), false, "关闭立即生效");
  } finally {
    ui.restore();
  }
});

test("7.2b 开关命令失败：授权状态不变并给出可见提示", async () => {
  const ui = readingHarness({
    toggleResult: () => Promise.reject(new Error("磁盘写入失败")),
  });
  try {
    await ui.openRecord(recordOf({ conversation_id: "c-2" }));
    await flush();
    clickMenuItem(ui, /开启按需补读/).dispatch("click");
    await flush();

    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-2"), false, "失败时授权状态不变");
    assert.match(ui.controller.state.saveError ?? "", /按需补读设置未能保存/);
  } finally {
    ui.restore();
  }
});

test("7.2c 停止生成只结束当前轮：清除等待中的授权卡，但不改变授权状态", async () => {
  const ui = readingHarness();
  try {
    await ui.openRecord(recordOf({
      conversation_id: "c-3",
      on_demand_reading_grant: { granted_at: "t0" },
    }));
    await flush();
    assert.equal(ui.controller.state.onDemandReadingEnabledOf("c-3"), true);

    // 等待授权中的轮次可被停止取消：授权卡清除，授权不变。
    ui.controller.state.beginFollowUp("新问题");
    ui.controller.state.receiveReadingRequest("c-3", {
      sessionId: "s",
      messageId: "m",
      callId: "call-x",
      reason: "材料不足",
    });
    assert.ok(ui.controller.state.pendingReadingRequestOf("c-3"), "授权卡在等待");

    ui.controller.state.stopRequest("c-3");
    assert.equal(ui.controller.state.pendingReadingRequestOf("c-3"), null, "停止取消等待");
    assert.equal(
      ui.controller.state.onDemandReadingEnabledOf("c-3"),
      true,
      "停止生成不得改变授权状态（解耦）",
    );
    // 停止路径不触发授权开关命令。
    assert.deepEqual(ui.toggleCalls, [], "停止生成不得调用授权开关命令");
  } finally {
    ui.restore();
  }
});

// ========== 任务 7.3：补读过程轻量状态（可展开，不含模型内部推理） ==========

test("7.3a 工具调用驱动轻量状态行：正在检索 / 正在阅读，可展开已读文档列表", () => {
  const { root } = createAiWindowFixture("w");
  const doc = installDocument();
  try {
    const state = new AiPanelState();
    state.newConversation();
    const conversationId = state.focusedConversationId!;
    setupAiWindow(root as unknown as HTMLElement, state, conversationId, {
      ...baseWindowActions,
      resolveDocumentTitle: (documentId) =>
        documentId === "doc-7" ? "第七章 转折" : null,
    });

    state.beginDirectQuestion("问题", null);
    // 直接提问复用聚焦空讨论，讨论身份不变。

    const status = root.queryResults.get('[data-role="reading-status"]')!;
    assert.equal(status.classList.contains("hidden"), true, "无补读活动时不显示过程状态");

    state.noteToolCall(conversationId, "story-search");
    assert.equal(
      root.queryResults.get('[data-role="reading-status-line"]')!.textContent,
      "正在检索作品文档…",
    );

    state.noteToolCall(conversationId, "story-read", "doc-7");
    assert.equal(
      root.queryResults.get('[data-role="reading-status-line"]')!.textContent,
      "正在阅读作品文档…（已读 1 篇）",
    );

    const list = root.queryResults.get('[data-role="reading-status-list"]')!;
    root.queryResults.get('[data-role="reading-toggle"]')!.dispatch("click");
    assert.equal(list.classList.contains("hidden"), false, "展开后显示已读文档列表");
    assert.ok(collectText(list).includes("第七章 转折"), "列表显示解析后的文档标题");

    // 轮次结束后不再显示补读过程（过程状态只在生成中呈现）。
    state.succeedDirectQuestion("回答", conversationId);
    assert.equal(status.classList.contains("hidden"), true, "终态后过程状态隐藏");
  } finally {
    doc.restore();
  }
});

test("7.3b 过程状态不含模型内部推理：noteToolCall 只记录活动类型与文档身份", () => {
  const state = new AiPanelState();
  state.newConversation();
  state.beginDirectQuestion("问题", null);
  const target = state.focusedConversationId!;
  state.noteToolCall(target, "story-read", "doc-1");
  const progress = state.readingProgressOf(target)!;
  assert.ok(progress);
  assert.equal(progress.status, "reading");
  assert.deepEqual(progress.documentIds, ["doc-1"]);
  // 结构上不存在推理文本字段。
  assert.deepEqual(Object.keys(progress).sort(), ["documentIds", "status"]);
});

test("7.3c 传输层按在途消息路由工具调用、按讨论身份路由授权请求", async () => {
  const toolCallHandlers: Array<(payload: {
    session_id: string;
    message_id: string;
    call_id: string;
    tool: string;
    args: Record<string, unknown>;
  }) => void> = [];
  const readingRequestHandlers: Array<(payload: {
    conversation_id: string;
    session_id: string;
    message_id: string;
    call_id: string;
    reason: string;
  }) => void> = [];
  const pending = deferred<GenerateAiResult>();

  const transport = new ResidentAiSessionTransport({
    startSession: () => Promise.resolve({ ok: true, content: "" }),
    sendMessage: () => pending.promise,
    listenToolCall: (handler) => {
      toolCallHandlers.push((payload) => handler(payload));
      return Promise.resolve(() => {});
    },
    listenReadingRequest: (handler) => {
      readingRequestHandlers.push((payload) => handler(payload));
      return Promise.resolve(() => {});
    },
    newId: () => "session-t",
  });
  const toolEvents: ToolCallEvent[] = [];
  const requestEvents: ReadingRequestEvent[] = [];
  transport.onToolCall((event) => toolEvents.push(event));
  transport.onReadingRequest((event) => requestEvents.push(event));
  transport.installSessionEventRouting();

  const sending = transport.sendViaResidentSession("conv-a", {
    kind: "direct_question",
    question: "问题",
  });
  await flush();

  // 在途消息的工具调用路由到所属讨论；迟到的未知消息不转发。
  for (const handler of toolCallHandlers) {
    handler({ session_id: "session-t", message_id: "conv-a:msg-1", call_id: "call-1", tool: "story-read", args: { document_id: "doc-1" } });
    handler({ session_id: "session-t", message_id: "unknown-msg", call_id: "call-2", tool: "story-read", args: {} });
  }
  for (const handler of readingRequestHandlers) {
    handler({ session_id: "session-t", message_id: "conv-a:msg-1", call_id: "call-1", conversation_id: "conv-a", reason: "材料不足" });
  }
  await flush();

  assert.deepEqual(toolEvents, [
    {
      conversationId: "conv-a",
      messageId: "conv-a:msg-1",
      callId: "call-1",
      tool: "story-read",
      args: { document_id: "doc-1" },
    },
  ], "只有匹配在途消息的工具调用被路由");
  assert.deepEqual(requestEvents.map((event) => event.conversationId), ["conv-a"], "授权请求按讨论身份路由");

  pending.resolve({ ok: true, content: "回答" });
  await sending;
});

// ========== 任务 7.4：「本次参考了什么」显示按需补读文档与阅读程度 ==========

test("7.4a 参考说明按轮显示按需补读文档与三档阅读程度", () => {
  const state = new AiPanelState();
  const panelState = state.viewOf("c-5");
  const view = buildAiPanelView(
    { ...panelState, readingRequest: null, readingProgress: null },
    {
      id: "c-5",
      createdAt: "t0",
      anchor: null,
      initialUserMaterial: { kind: "direct_question", question: "问题", selected_text: undefined },
      firstResponse: "回答",
      turns: [],
      pending: null,
      provenance: [
        {
          document_id: "doc-focus",
          material_type: "focus_document",
          document_version: null,
          turn_index: 1,
          entered_model_context: true,
        },
      ],
      onDemandReadingProvenance: [
        { document_id: "doc-a", version: "v1", depth: "search_snippet", turn_index: 1, entered_model_context: true },
        { document_id: "doc-b", version: "v2", depth: "partial", turn_index: 1, entered_model_context: true },
        { document_id: "doc-c", version: "v3", depth: "full", turn_index: 1, entered_model_context: true },
      ],
    },
    {
      resolveDocumentTitle: (documentId) =>
        documentId === "doc-b" ? "背景设定" : null,
      isDocumentHidden: () => false,
    },
  );
  const round = view.material?.rounds.find((r) => r.roundLabel === "第 1 轮");
  assert.ok(round, "出处按轮分组");
  const onDemand = round!.sources.filter((source) => source.kindLabel === "按需补读");
  assert.equal(onDemand.length, 3);
  assert.deepEqual(
    onDemand.map((source) => source.stateLabel),
    ["搜索片段", "局部阅读", "完整阅读"],
    "三档阅读程度如实显示",
  );
  assert.ok(onDemand.some((source) => source.title === "背景设定"), "标题按作品树解析");
  assert.ok(onDemand.some((source) => source.title.includes("不可用")), "未知文档回退提示");
});

test("7.4b 轮次终态后从档案刷新补读出处并合入讨论", async () => {
  const ui = readingHarness({
    onDemandState: (conversationId) =>
      conversationId === "c-1"
        ? {
            grant: { granted_at: "t1" },
            provenance: [
              { document_id: "doc-9", version: "v9", depth: "full", turn_index: 0, entered_model_context: true },
            ],
          }
        : { grant: null, provenance: null },
  });
  try {
    const round = ui.startDirectQuestion("问题");
    await round.finish({ ok: true, content: "回答" });

    assert.ok(ui.onDemandFetches.includes("c-1"), "轮次完成后查询按需补读状态");
    const conversation = ui.controller.state.conversationOf("c-1")!;
    assert.ok(
      conversation.onDemandReadingProvenance?.some((p) => p.document_id === "doc-9"),
      "档案出处合入讨论",
    );
  } finally {
    ui.restore();
  }
});

// ========== 任务 7.6：等待中退出按既有中断轮处理 ==========

test("7.6 等待授权期间退出：重开后该轮显示中断，开启授权后可重发", async () => {
  const ui = readingHarness();
  try {
    // 模拟「等待授权中退出」后的档案：未完成追问轮为 pending（既有中断语义），
    // 不携带任何待决授权状态（等待授权不跨重启持久化，D8）。
    await ui.openRecord(recordOf({
      conversation_id: "c-6",
      turns: [
        { role: "assistant", text: "首答", status: "done" },
        { role: "user", text: "等待中的问题", status: "done" },
        { role: "assistant", text: "", status: "pending" },
      ],
      on_demand_reading_grant: null,
    }));

    const conversation = ui.controller.state.conversationOf("c-6")!;
    assert.equal(conversation.pending?.interrupted, true, "重开后该轮显示中断");
    assert.equal(conversation.pending?.question, "等待中的问题");
    assert.equal(
      ui.controller.state.onDemandReadingEnabledOf("c-6"),
      false,
      "不自动重发也不携带待决授权",
    );

    // 用户经讨论内授权开关开启后可重发原问题（复用既有重发路径，无新增恢复流）。
    assert.equal(await ui.controller.submitFollowUp("等待中的问题"), true, "开启授权后可重发");
  } finally {
    ui.restore();
  }
});

// ========== 任务 7.5：关闭文档 AI 可见性前的影响提示（file-management） ==========

const VISIBILITY_TREE: ContentTree = {
  root_children: ["doc-visible"],
  nodes: {
    "doc-visible": { id: "doc-visible", name: "可见文档", kind: "Document", children: [] },
  },
  recycle_bin: [],
};

interface VisibilityHarness {
  calls: string[];
  confirmMessages: string[];
  toggleVisibleDocument(): Promise<void>;
  restore(): void;
}

function visibilityHarness(options: {
  usage: Array<{ conversation_id: string; title: string }>;
  confirmResult: boolean;
  usageFails?: boolean;
}): VisibilityHarness {
  const ids = [
    "fm-new-document", "fm-new-folder", "fm-status", "fm-file-tree",
    "fm-open-recycle-bin", "fm-recycle-bin", "fm-back-from-recycle", "fm-recycle-list",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;

  const calls: string[] = [];
  const confirmMessages: string[] = [];
  const dom = {
    fmNewDocument: elements.get("fm-new-document"),
    fmNewFolder: elements.get("fm-new-folder"),
    fmStatus: elements.get("fm-status"),
    fmFileTree: elements.get("fm-file-tree"),
    fmOpenRecycleBin: elements.get("fm-open-recycle-bin"),
    fmRecycleBin: elements.get("fm-recycle-bin"),
    fmBackFromRecycle: elements.get("fm-back-from-recycle"),
    fmRecycleList: elements.get("fm-recycle-list"),
  } as unknown as Parameters<typeof setupFileManagement>[0];

  const controller = setupFileManagement(dom, {
    onTreeChanged: () => {},
    services: {
      openContentTree: async () => VISIBILITY_TREE,
      setDocumentAiVisibility: async (_projectPath, _documentId, visible) => {
        calls.push(`set:${visible}`);
      },
      conversationsUsingDocument: async () => {
        calls.push("usage");
        if (options.usageFails) throw new Error("查询失败");
        return options.usage;
      },
    },
  });
  controller.showProject({
    projectPath: "D:\\作品",
    projectName: "作品",
    tree: VISIBILITY_TREE,
  });

  // 统一对话框入口读取 globalThis.confirm（app-dialog.ts）；桩必须打在同一对象上，
  // 否则 window 与 globalThis 分离的测试环境会绕过桩。
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = (message?: unknown) => {
    confirmMessages.push(String(message));
    return options.confirmResult;
  };

  return {
    calls,
    confirmMessages,
    async toggleVisibleDocument() {
      const fileTree = elements.get("fm-file-tree")!;
      const button = findClickableByText(fileTree, "允许 AI 查看");
      assert.ok(button, "应渲染可见性开关");
      button.dispatch("click");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    },
    restore() {
      globalThis.confirm = previousConfirm;
      globalThis.document = previousDocument;
    },
  };
}

function findClickableByText(root: FakeElement, label: string): FakeElement | null {
  if (root.textContent === label && root.listeners.has("click")) return root;
  for (const child of root.children) {
    const found = findClickableByText(child, label);
    if (found) return found;
  }
  return null;
}

test("7.5a 关闭可见性前提示受影响讨论：文案明示永久只读与脱敏，取消则不执行", async () => {
  const h = visibilityHarness({
    usage: [{ conversation_id: "c-1", title: "时间线讨论" }],
    confirmResult: false,
  });
  try {
    await h.toggleVisibleDocument();
    assert.ok(h.calls.includes("usage"), "关闭前先查询受影响讨论");
    assert.equal(h.confirmMessages.length, 1, "有受影响讨论时必须确认");
    const message = h.confirmMessages[0];
    assert.ok(message.includes("时间线讨论"), "列出受影响讨论");
    assert.ok(message.includes("永久只读"), "明示永久只读后果");
    assert.ok(message.includes("脱敏"), "明示旧出处脱敏后果");
    assert.ok(!h.calls.includes("set:false"), "用户取消时不执行关闭");
  } finally {
    h.restore();
  }
});

test("7.5b 确认后关闭生效", async () => {
  const h = visibilityHarness({
    usage: [{ conversation_id: "c-1", title: "时间线讨论" }],
    confirmResult: true,
  });
  try {
    await h.toggleVisibleDocument();
    assert.ok(h.calls.includes("usage"));
    assert.ok(h.calls.includes("set:false"), "确认后执行关闭");
  } finally {
    h.restore();
  }
});

test("7.5c 没有受影响讨论时不弹确认", async () => {
  const h = visibilityHarness({ usage: [], confirmResult: false });
  try {
    await h.toggleVisibleDocument();
    assert.equal(h.confirmMessages.length, 0, "无受影响讨论不弹确认");
    assert.ok(h.calls.includes("set:false"), "直接关闭");
  } finally {
    h.restore();
  }
});

test("7.5d 受影响讨论查询失败时保守拦截（失败关闭）", async () => {
  const h = visibilityHarness({ usage: [], confirmResult: false, usageFails: true });
  try {
    await h.toggleVisibleDocument();
    assert.equal(h.confirmMessages.length, 1, "查询失败也要确认");
    assert.ok(h.confirmMessages[0].includes("永久只读"), "失败文案同样明示后果");
    assert.ok(!h.calls.includes("set:false"), "未确认不执行关闭");
  } finally {
    h.restore();
  }
});
