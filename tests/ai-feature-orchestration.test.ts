import assert from "node:assert/strict";
import test from "node:test";
import type { JSONContent } from "@tiptap/core";

import { setupAiFeature } from "../src/ai-feature.ts";
import { waitTiming } from "../src/ai-timing.ts";
import type { AiSessionTransport } from "../src/ai-session-transport.ts";
import type { AppDom } from "../src/dom.ts";
import type { SelectionEntryEditor } from "../src/selection-entry.ts";
import type { RichTextEditorSelection } from "../src/rich-text-editor.ts";
import type { ConversationRecord } from "../src/conversation-archive.ts";
import type {
  ContentTree,
  GenerateAiRequest,
  GenerateAiResult,
  LlmConfigSummary,
} from "../src/types.ts";
import { FakeElement, installAiFeatureEnvironment } from "./ai-panel-dom-fixture.ts";

/**
 * extract-ai-request-orchestration 任务组 1：请求编排的组合级安全网。
 *
 * 经 `maxConcurrent` / `transport` / `loadConfig` 三个既有注入缝驱动 `setupAiFeature`，
 * 只断言外部可见效果（transport 收到的调用序列、状态迁移、窗口显示、waitTiming
 * 收集、档案保存），不引用实现内部——为后续编排拆分织网。
 */

async function flush(): Promise<void> {
  for (let i = 0; i < 64; i += 1) await Promise.resolve();
}

const savedConfig: LlmConfigSummary = {
  api_base_url: "https://api.example.com/v1",
  model: "m",
  has_api_key: true,
};

const okResult: GenerateAiResult = { ok: true, content: "回答" };

/** 作品树：doc-1 / doc-2 可见；doc-secret 关闭 AI 可见性。 */
function storyTree(): ContentTree {
  return {
    root_children: ["doc-1", "doc-2", "doc-secret"],
    nodes: {
      "doc-1": { id: "doc-1", name: "第一稿", kind: "Document", children: [] },
      "doc-2": { id: "doc-2", name: "设定集", kind: "Document", children: [] },
      "doc-secret": { id: "doc-secret", name: "秘密", kind: "Document", children: [], ai_visible: false },
    },
    recycle_bin: [],
  };
}

interface SentRequest {
  conversationId: string;
  request: GenerateAiRequest;
}

interface OrchestrationHarness {
  controller: ReturnType<typeof setupAiFeature>;
  /** transport 实际收到的调用序列（按发送顺序）。 */
  sent: SentRequest[];
  saves: ConversationRecord[];
  windowRoots: FakeElement[];
  /** 当前隐藏文档集合（可在排队期间变更以驱动派发前复核）。 */
  hidden: Set<string>;
  /** 当前聚焦讨论（动态取，不依赖内部 id 分配次序）。 */
  activeId(): string;
  setSelection(text: string): void;
  /** 新窗口内提交直接提问（不附带选区）。 */
  submitDirectQuestion(question: string): void;
  /** 新窗口内提交直接提问（先冻结当前编辑器选区）。 */
  submitDirectQuestionWithSelection(question: string): void;
  /** 经浮动「AI」入口以当前编辑器选区发起及时召唤。 */
  summonSelection(): void;
  /** 点击第 index 个窗口的停止按钮。 */
  stopWindow(index: number): void;
  /** 触发窗口渲染层装好的「停止后重试追问」处理器。 */
  clickStoppedFollowUpRetry(index: number): void;
  /** 按发送顺序完成一条在途请求。 */
  finishNext(result?: GenerateAiResult): void;
  restore(): void;
}

function orchestrationHarness(options: { maxConcurrent?: number } = {}): OrchestrationHarness {
  waitTiming.clear();
  const env = installAiFeatureEnvironment();
  const editorPage = new FakeElement("editor-page");
  const sent: SentRequest[] = [];
  const saves: ConversationRecord[] = [];
  const hidden = new Set<string>();
  const resolvers: Array<(result: GenerateAiResult) => void> = [];
  const selectionState = { text: "林站在天台边。" };
  let nextId = 0;

  const editor: SelectionEntryEditor = {
    element: env.editor as unknown as HTMLElement,
    getDocument: (): JSONContent => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: selectionState.text }] }],
    }),
    getSelection: (): RichTextEditorSelection =>
      ({ from: 1, to: selectionState.text.length + 1, head: selectionState.text.length + 1 }),
    coordinatesAt: () => ({ left: 0, right: 1, top: 0, bottom: 10 }),
  };

  const transport: AiSessionTransport = {
    sendViaResidentSession: (conversationId, request) => {
      sent.push({ conversationId, request });
      return new Promise<GenerateAiResult>((resolve) => {
        resolvers.push(resolve);
      });
    },
    cancelMessage: () => {},
    endSession: () => {},
    endAllSessions: () => {},
    replaySession: () => Promise.resolve(),
    onStreamText: () => () => {},
    onDriverLost: () => () => {},
    onToolCall: () => () => {},
    onReadingRequest: () => () => {},
    installSessionEventRouting: () => {},
    destroySessionEventRouting: () => {},
  };

  const controller = setupAiFeature({
    aiDock: env.dom,
    editorTextarea: env.editor,
    btnToggleAi: env.btnToggleAi,
    editorPage: editorPage as unknown as HTMLElement,
  } as unknown as AppDom, {
    getCurrentDocumentId: () => "doc-1",
    getCurrentEditor: () => editor,
    openConfigPage: () => {},
    getCurrentProjectPath: () => "作品路径",
    getCurrentDocumentTitle: () => "第一稿",
    getCurrentTree: () => storyTree(),
  }, {
    transport,
    loadConfig: () => Promise.resolve(savedConfig),
    conversationList: () => Promise.resolve({ conversations: [], skipped: [] }),
    conversationSave: (_projectPath, record) => {
      saves.push(record);
      return Promise.resolve();
    },
    conversationDelete: () => Promise.resolve(),
    conversationRestore: () => Promise.resolve(),
    newConversationId: () => `c-${++nextId}`,
    fetchOnDemandReading: () => Promise.resolve({ grant: null, provenance: null }),
    getHiddenDocumentIds: () => hidden,
    ...(options.maxConcurrent !== undefined ? { maxConcurrent: options.maxConcurrent } : {}),
  });

  return {
    controller,
    sent,
    saves,
    hidden,
    windowRoots: env.windowRoots,
    activeId: () => controller.state.activeConversationId!,
    setSelection(text: string): void {
      selectionState.text = text;
    },
    submitDirectQuestion(question: string): void {
      env.elements.get("ai-new-conversation")!.dispatch("click");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
    },
    submitDirectQuestionWithSelection(question: string): void {
      env.elements.get("ai-new-conversation")!.dispatch("click");
      env.editor.dispatch("mouseup");
      const win = env.windowRoots[env.windowRoots.length - 1];
      const input = win.queryResults.get('[data-role="direct-question-input"]')!;
      input.value = question;
      input.dispatch("input");
      win.queryResults.get('[data-role="direct-question-form"]')!.dispatch("submit");
    },
    summonSelection(): void {
      env.editor.dispatch("mouseup");
      const entry = editorPage.children.find((child) => child.id === "ai-selection-entry");
      assert.ok(entry, "有意义的选区应显示召唤入口");
      const trigger = entry.children[0];
      assert.ok(trigger, "召唤入口应包含触发按钮");
      trigger.dispatch("click");
    },
    stopWindow(index: number): void {
      env.windowRoots[index].queryResults.get('[data-role="stop"]')!.dispatch("click");
    },
    clickStoppedFollowUpRetry(index: number): void {
      const retryBtn = env.windowRoots[index].queryResults.get('[data-role="follow-up-retry"]')!;
      const installed = (retryBtn as unknown as { onclick: (() => void) | null }).onclick;
      assert.ok(installed, "停止后的追问窗口应装有「重试」处理器");
      installed();
    },
    finishNext(result?: GenerateAiResult): void {
      const resolve = resolvers.shift();
      assert.ok(resolve, "应有在途请求可完成");
      resolve(result ?? okResult);
    },
    restore: () => {
      env.restore();
    },
  };
}

function badgeOf(win: FakeElement): string {
  return win.queryResults.get('[data-role="badge"]')!.textContent;
}

// ========== 1.1 快车道并发：常规生成中召唤独立发起 ==========

test("快车道并发：常规生成进行中，及时召唤独立发起而不排队", async () => {
  const ui = orchestrationHarness();
  try {
    ui.submitDirectQuestion("这个角色为什么犹豫？");
    await flush();
    const regular = ui.activeId();
    ui.summonSelection();
    await flush();
    const summon = ui.activeId();

    // 召唤未等常规生成完成：两条请求同时在途。
    assert.equal(ui.sent.length, 2, "默认并发上限内召唤应立即独立发出");
    assert.equal(ui.sent[0].conversationId, regular);
    assert.equal(ui.sent[0].request.kind, "direct_question");
    assert.notEqual(summon, regular, "召唤开启独立讨论");
    assert.equal(ui.sent[1].conversationId, summon);
    assert.equal(ui.sent[1].request.kind, "summon");

    // 两条讨论同时处于生成中（等待计时按各自讨论记录）。
    const direct = ui.controller.state.viewOf(regular).request;
    assert.equal(direct.kind, "direct_question");
    if (direct.kind === "direct_question") assert.equal(direct.status, "loading");
    const summonRequest = ui.controller.state.viewOf(summon).request;
    assert.equal(summonRequest.kind, "loading");
    if (summonRequest.kind === "loading") assert.equal(summonRequest.phase, "first");

    const summonTiming = waitTiming.getRecords().find((r) => r.conversationId === summon);
    assert.ok(summonTiming, "召唤应接入等待计时");
    assert.equal(summonTiming.kind, "summon");

    // 分别完成后各自落档，互不干扰。
    ui.finishNext();
    await flush();
    assert.equal(ui.controller.state.getDiscussion(regular)!.conversation?.firstResponse, "回答");
    ui.finishNext();
    await flush();
    assert.equal(ui.controller.state.getDiscussion(summon)!.conversation?.firstResponse, "回答");
    assert.ok(ui.saves.some((record) => record.conversation_id === regular));
    assert.ok(ui.saves.some((record) => record.conversation_id === summon));
  } finally {
    ui.restore();
  }
});

// ========== 1.2 达上限排队 + 窗口排队显示 ==========

test("达到全局上限后排队的请求只在对应讨论显示排队状态", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    ui.submitDirectQuestion("第一个问题");
    await flush();
    const runningId = ui.activeId();
    ui.submitDirectQuestion("第二个问题");
    await flush();
    const queuedId = ui.activeId();

    // 只有第一条真正发出；第二条排队。
    assert.equal(ui.sent.length, 1, "上限内只允许一条在途");
    const queued = ui.controller.state.viewOf(queuedId).request;
    assert.equal(queued.kind, "direct_question");
    if (queued.kind === "direct_question") {
      assert.equal(queued.status, "loading");
      assert.equal(queued.queued, true);
    }
    const running = ui.controller.state.viewOf(runningId).request;
    assert.equal(running.kind, "direct_question");
    if (running.kind === "direct_question") assert.notEqual(running.queued, true);

    // 排队状态只在第二个窗口显示；第一个窗口保持生成中。
    assert.equal(badgeOf(ui.windowRoots[0]), "生成中");
    assert.equal(badgeOf(ui.windowRoots[1]), "排队中");

    // 名额释放后按序开始，排队标记清除。
    ui.finishNext();
    await flush();
    assert.equal(ui.sent.length, 2, "名额释放后排队请求开始");
    assert.equal(ui.sent[1].conversationId, queuedId);
    const resumed = ui.controller.state.viewOf(queuedId).request;
    assert.equal(resumed.kind, "direct_question");
    if (resumed.kind === "direct_question") assert.notEqual(resumed.queued, true);
    assert.equal(badgeOf(ui.windowRoots[1]), "生成中");
  } finally {
    ui.restore();
  }
});

// ========== 1.3 停止排队中的请求 ==========

test("停止排队中的请求：取消派发并留下已停止终态、计时收束与持久化", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    ui.submitDirectQuestion("第一个问题");
    await flush();
    const runningId = ui.activeId();
    ui.submitDirectQuestion("排队中的问题");
    await flush();
    const queuedId = ui.activeId();
    assert.equal(ui.sent.length, 1);

    ui.stopWindow(1);

    // 停止只作用于排队的讨论：不产生新发送，状态转为已停止。
    assert.equal(ui.sent.length, 1);
    const stopped = ui.controller.state.viewOf(queuedId).request;
    assert.equal(stopped.kind, "direct_question");
    if (stopped.kind === "direct_question") {
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.question, "排队中的问题");
      assert.equal(stopped.queued, undefined);
    }
    assert.equal(badgeOf(ui.windowRoots[1]), "已停止");

    // 等待计时随停止收束（不残留「进行中」）。
    const timing = waitTiming.getRecords().find((r) => r.conversationId === queuedId);
    assert.ok(timing);
    assert.notEqual(timing.completedAt, null, "停止应收束等待计时");

    // 停止终态被持久化（接受即存的讨论档案更新）。
    assert.ok(
      ui.saves.some((record) => record.conversation_id === queuedId),
      "停止排队请求应留下档案",
    );

    // 名额释放后不再派发已停止的排队请求。
    ui.finishNext();
    await flush();
    assert.equal(ui.sent.length, 1, "已停止的排队请求不得再被派发");
    assert.equal(ui.controller.state.getDiscussion(runningId)!.conversation?.firstResponse, "回答");
    const stillStopped = ui.controller.state.viewOf(queuedId).request;
    assert.equal(stillStopped.kind, "direct_question");
    if (stillStopped.kind === "direct_question") assert.equal(stillStopped.status, "stopped");
  } finally {
    ui.restore();
  }
});

// ========== 1.4 派发前复核的来源选择 ==========

test("派发前复核：无冻结锚点时回落到关注文档判定", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    ui.submitDirectQuestion("第一个问题");
    await flush();
    ui.submitDirectQuestion("排队且无选区的问题");
    await flush();
    const queuedId = ui.activeId();
    assert.equal(ui.sent.length, 1);

    // 无选区直接提问没有冻结锚点；其材料来源按关注文档（doc-1）复核。
    ui.hidden.add("doc-1");
    ui.finishNext();
    await flush();

    assert.equal(ui.sent.length, 1, "关注文档已隐藏的排队请求不得派发");
    const rejected = ui.controller.state.viewOf(queuedId).request;
    assert.equal(rejected.kind, "direct_question");
    if (rejected.kind === "direct_question") {
      assert.equal(rejected.status, "error");
      assert.equal(rejected.error?.code, "document_not_visible");
      assert.match(rejected.error?.message ?? "", /可见性已变化/);
    }
  } finally {
    ui.restore();
  }
});

test("派发前复核：优先按冻结锚点判定（锚点文档隐藏时拒绝，关注文档仍可见也不放行）", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    // 讨论 A 以 doc-1 上的选区发起（冻结锚点 = doc-1），成功后改绑关注 doc-2。
    ui.submitDirectQuestionWithSelection("带选区的问题");
    await flush();
    const anchoredId = ui.activeId();
    ui.finishNext();
    await flush();
    assert.equal(ui.controller.state.setFocusDocument(anchoredId, "doc-2", "设定集"), true);

    // 讨论 B 占用唯一名额；A 的追问排队。
    ui.submitDirectQuestion("占位问题");
    await flush();
    assert.equal(ui.sent.length, 2);
    ui.controller.state.focusWindow(anchoredId);
    assert.equal(await ui.controller.submitFollowUp("锚点相关的追问"), true);
    await flush();
    assert.equal(ui.sent.length, 2, "追问应排队而非立即发送");

    // 隐藏锚点文档（doc-1），关注文档（doc-2）保持可见。
    ui.hidden.add("doc-1");
    ui.finishNext();
    await flush();

    assert.equal(ui.sent.length, 2, "锚点文档已隐藏的排队追问不得派发");
    const rejected = ui.controller.state.viewOf(anchoredId).request;
    assert.equal(rejected.kind, "error");
    if (rejected.kind === "error") {
      assert.equal(rejected.phase, "follow_up");
      assert.equal(rejected.error.code, "document_not_visible");
    }
    assert.ok(ui.controller.state.conversationOf(anchoredId)?.pending?.error, "追问轮保留可读失败");
  } finally {
    ui.restore();
  }
});

test("派发前复核：锚点文档可见时放行，不受关注文档可见性变化影响", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    ui.submitDirectQuestionWithSelection("带选区的问题");
    await flush();
    const anchoredId = ui.activeId();
    ui.finishNext();
    await flush();
    assert.equal(ui.controller.state.setFocusDocument(anchoredId, "doc-2", "设定集"), true);

    ui.submitDirectQuestion("占位问题");
    await flush();
    assert.equal(ui.sent.length, 2);
    ui.controller.state.focusWindow(anchoredId);
    assert.equal(await ui.controller.submitFollowUp("锚点可见的追问"), true);
    await flush();
    assert.equal(ui.sent.length, 2);

    // 只隐藏关注文档（doc-2）；冻结锚点（doc-1）仍可见 → 追问照常派发。
    ui.hidden.add("doc-2");
    ui.finishNext();
    await flush();

    assert.equal(ui.sent.length, 3, "锚点可见的排队追问应照常派发");
    const dispatched = ui.sent[2];
    assert.equal(dispatched.conversationId, anchoredId);
    assert.equal(dispatched.request.kind, "follow_up");
    const resumed = ui.controller.state.viewOf(anchoredId).request;
    assert.equal(resumed.kind, "loading");
  } finally {
    ui.restore();
  }
});

// ========== 1.5 waitTiming 四点接线 ==========

test("waitTiming 四点接线：立即开始与排队两条路径都记录完整时间线", async () => {
  const ui = orchestrationHarness({ maxConcurrent: 1 });
  try {
    ui.submitDirectQuestion("立即开始的问题");
    await flush();
    const immediateId = ui.activeId();
    ui.submitDirectQuestion("排队的问题");
    await flush();
    const queuedId = ui.activeId();

    // 立即开始路径：submit → started，无 queued。
    const immediate = waitTiming.getRecords().find((r) => r.conversationId === immediateId);
    assert.ok(immediate, "立即开始的请求应有计时记录");
    assert.equal(immediate.kind, "direct_question");
    assert.equal(immediate.queuedAt, null, "立即开始不经过排队点");
    assert.notEqual(immediate.startedAt, null, "submit 后应记录 started");

    // 排队路径：submit → queued，此时尚未 started。
    const queued = waitTiming.getRecords().find((r) => r.conversationId === queuedId);
    assert.ok(queued, "排队请求应有计时记录");
    assert.notEqual(queued.queuedAt, null, "达上限应记录 queued");
    assert.equal(queued.startedAt, null, "排队期间不得提前记录 started");

    ui.finishNext();
    await flush();

    // 名额释放：排队请求补记 started（不早于入队）。
    const startedQueued = waitTiming.getRecords().find((r) => r.conversationId === queuedId)!;
    assert.notEqual(startedQueued.startedAt, null);
    assert.ok(
      startedQueued.startedAt! >= startedQueued.queuedAt!,
      "started 不得早于 queued",
    );
    assert.notEqual(
      waitTiming.getRecords().find((r) => r.conversationId === immediateId)!.completedAt,
      null,
      "完成应记录 complete",
    );

    ui.finishNext();
    await flush();
    assert.notEqual(
      waitTiming.getRecords().find((r) => r.conversationId === queuedId)!.completedAt,
      null,
      "排队请求完成也应记录 complete",
    );
  } finally {
    ui.restore();
  }
});

// ========== 1.6 onRetryStoppedFollowUp 组合基线（迁移前置） ==========

test("停止后的追问重试：经窗口「重试」重新发送原问题并回到生成中", async () => {
  const ui = orchestrationHarness();
  try {
    ui.submitDirectQuestion("首轮问题");
    await flush();
    const conversationId = ui.activeId();
    ui.finishNext();
    await flush();
    assert.ok(ui.controller.state.conversationOf(conversationId));

    // 追问 → 停止：待答轮标记中断。
    assert.equal(await ui.controller.submitFollowUp("被停止的追问"), true);
    await flush();
    assert.equal(ui.sent.length, 2);
    ui.stopWindow(0);
    assert.equal(ui.controller.state.viewOf(conversationId).request.kind, "stopped");
    assert.equal(ui.controller.state.conversationOf(conversationId)?.pending?.interrupted, true);

    // 停止后在途请求收束：迟到结果被丢弃（已停止终态不回退）。
    ui.finishNext();
    await flush();
    assert.equal(ui.controller.state.viewOf(conversationId).request.kind, "stopped");

    // 停止后的「重试」重新发送同一问题。
    ui.clickStoppedFollowUpRetry(0);
    await flush();

    assert.equal(ui.sent.length, 3, "停止后的重试应重新发送请求");
    const retry = ui.sent[2];
    assert.equal(retry.conversationId, conversationId);
    assert.equal(retry.request.kind, "follow_up");
    if (retry.request.kind === "follow_up") {
      assert.equal(retry.request.messages[retry.request.messages.length - 1].content, "被停止的追问");
    }
    const resumed = ui.controller.state.viewOf(conversationId).request;
    assert.equal(resumed.kind, "loading", "重试后回到生成中");
    const pending = ui.controller.state.conversationOf(conversationId)?.pending;
    assert.equal(pending?.interrupted, undefined, "中断标记清除");
    assert.equal(pending?.question, "被停止的追问");
    assert.equal(badgeOf(ui.windowRoots[0]), "生成中");
  } finally {
    ui.restore();
  }
});
