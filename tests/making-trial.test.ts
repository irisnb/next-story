import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { getAppDom } from "../src/dom.ts";
import { setupMaking, type MakingController } from "../src/making/making-module.ts";
import { draftToCardInput, parseCardDrafts, type MakingCardDraft } from "../src/making/making-conversation.ts";
import { createDefaultTrialWorkSource } from "../src/making/making-trial-controller.ts";
import {
  draftsMatchVersion,
  findSavedVersionForDrafts,
  generateTrialId,
  trialFeedbackSummary,
  trialQuestionPreview,
  trialRecordTag,
  trialReplyTextOf,
  trialRunKindLabel,
  trialRunStatusLabel,
  trialSendErrorNotice,
  trialTimeLabel,
} from "../src/making/making-trial.ts";
import type { GenerateAiError, GenerateAiResult, ContentTree } from "../src/types.ts";
import type {
  Chain,
  ChainLibrary,
  ChainVersion,
  InvokeFn,
  ListenFn,
  RecentWorkEntry,
  TrialRecord,
} from "../src/project-api.ts";

/**
 * 试问机制前端车道 F2b 的行为测试（add-making-module-core 任务 6.2/6.3/6.5）：
 * - 纯显示决策（making-trial.ts）：编号前缀、草稿↔版本匹配、标注与摘要；
 * - 发起流守卫：未保存草稿提示先保存、无打开作品禁用＋诚实提示、问题必填；
 * - 运行与授权：流式渲染、等待补读授权的允许/拒绝应答、停止、失败文案；
 * - 对照显式：默认单跑带卡一版，[跑不带卡对照] 才追加不带卡轮；
 * - 试问记录：列表渲染、只读详情（无追问输入）、反馈记录与空白清除、失败降级。
 */

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const DRAFT_REPLY = [
  "好的，先出一版草稿。",
  "【卡草稿开始】",
  "卡名：语气克制",
  "何时用：打磨对白时",
  "何时不用：讨论故事结构时",
  "正文：指出过火的台词，说明问题，再给两种更克制的写法候选，由你决定用哪种。",
  "【卡草稿结束】",
].join("\n");

const DRAFTS: readonly MakingCardDraft[] = parseCardDrafts(DRAFT_REPLY);

// ========== 纯显示与匹配决策 ==========

test("trial ids carry the required trial- prefix", () => {
  const id = generateTrialId(() => "abcd1234");
  assert.match(id, /^trial-/);
  assert.ok(id.length > "trial-".length);
});

test("drafts match a saved version only when every card field matches", () => {
  const version: ChainVersion = {
    id: "v1",
    index: 1,
    created_at: "2026-10-06T00:00:00Z",
    cards: DRAFTS.map((draft, index) => ({ id: `c${index}`, ...draftToCardInput(draft) })),
    change_note: "",
    trials: [],
  };
  assert.equal(draftsMatchVersion(DRAFTS, version), true, "同一草稿保存出的版本逐字一致");

  const edited: ChainVersion = {
    ...version,
    cards: version.cards.map((card, index) =>
      index === 0 ? { ...card, body: `${card.body}（改）` } : card,
    ),
  };
  assert.equal(draftsMatchVersion(DRAFTS, edited), false, "正文改动后不再匹配");
  const extraCard: ChainVersion = {
    ...version,
    cards: [...version.cards, { id: "extra", title: "另一张", trigger_desc: "适用：y", body: "z" }],
  };
  assert.equal(draftsMatchVersion(DRAFTS, extraCard), false, "卡数量不同不匹配");

  // 卡类型参与逐字匹配（add-posture-slot 任务 3.4：证据与版本绑定，类型一致才算同版）。
  const retyped: ChainVersion = {
    ...version,
    cards: version.cards.map((card, index) =>
      index === 0 ? { ...card, slot_type: "posture" } : card,
    ),
  };
  assert.equal(draftsMatchVersion(DRAFTS, retyped), false, "同内容不同类型（要求卡草稿 vs 姿态卡版本）不匹配");
  // 类型缺省＝要求卡：显式 requirement 与无字段视为同一类型。
  const explicitType: ChainVersion = {
    ...version,
    cards: version.cards.map((card, index) =>
      index === 0 ? { ...card, slot_type: "requirement" } : card,
    ),
  };
  assert.equal(draftsMatchVersion(DRAFTS, explicitType), true);

  const chain: Chain = { id: "ch", name: "情节探索", created_at: "2026-10-06T00:00:00Z", versions: [edited, version] };
  const found = findSavedVersionForDrafts(chain, DRAFTS);
  assert.ok(found);
  assert.equal(found.id, "v1", "从最新往回找到内容一致的版本");
  assert.equal(findSavedVersionForDrafts({ ...chain, versions: [edited] }, DRAFTS), null);
});

test("trial labels and summaries degrade honestly", () => {
  assert.equal(trialRunStatusLabel("pending"), "生成中…");
  assert.equal(trialRunStatusLabel("waiting"), "等待补读授权");
  assert.equal(trialRunStatusLabel("cancelled"), "已停止");
  assert.equal(trialRunKindLabel(true), "带卡试问");
  assert.equal(trialRunKindLabel(false), "对照试问（不带卡）");
  assert.equal(trialRecordTag(false), "对照");
  assert.equal(trialQuestionPreview("帮我看看这场戏的对白是否过火"), "帮我看看这场戏的对白是否过火");
  assert.equal(trialQuestionPreview(`第一行${"很".repeat(40)}`), `第一行${"很".repeat(21)}…`);
  assert.equal(trialTimeLabel("2026-10-07T09:30:00Z"), "2026-10-07 09:30");
  assert.equal(trialTimeLabel("bad"), "bad");
  assert.equal(trialFeedbackSummary(null), "未记录反馈");
  assert.equal(trialFeedbackSummary("  "), "未记录反馈");
  assert.equal(trialFeedbackSummary("对白更克制了"), "对白更克制了");
  assert.equal(trialReplyTextOf({ status: "failed", reply_text: "" }), "（本轮失败，未保存回复全文）");
  assert.equal(trialReplyTextOf({ status: "success", reply_text: "全文" }), "全文");
  assert.match(trialSendErrorNotice("capacity_exceeded", "raw"), /同时上限/);
  assert.match(trialSendErrorNotice("conversation_busy", "raw"), /进行中/);
  assert.equal(trialSendErrorNotice("service", "后端文案"), "后端文案");
});

// ========== 接线夹具（happy-dom + 假后端 + 假事件总线） ==========

interface ParsedPage {
  window: Window;
  document: Document;
}

function parseMakingDocument(): ParsedPage {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(htmlSource, "text/html") as unknown as Document;
  return { window, document };
}

function installDocument(document: Document): () => void {
  const previous = globalThis.document;
  globalThis.document = document;
  return () => { globalThis.document = previous; };
}

async function flushPromises(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

/** 可编程的试问终态（控制 trial_send_message 的收束时机）。 */
class DeferredTrial {
  readonly promise: Promise<GenerateAiResult>;
  private resolve!: (result: GenerateAiResult) => void;
  private reject!: (error: unknown) => void;
  constructor() {
    this.promise = new Promise<GenerateAiResult>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  succeed(content: string): void {
    this.resolve({ ok: true, content });
  }
  fail(code: GenerateAiError["code"], message: string): void {
    this.resolve({ ok: false, error: { code, message } });
  }
  rejectWith(error: unknown): void {
    this.reject(error);
  }
}

const WORK_PATH = "D:/works/试作";

function workTree(): ContentTree {
  return {
    root_children: ["d1", "f1"],
    nodes: {
      d1: { id: "d1", name: "第一集", kind: "Document", children: [], ai_visible: true },
      d2: { id: "d2", name: "隐藏稿", kind: "Document", children: [], ai_visible: false },
      f1: { id: "f1", name: "第二集文件夹", kind: "Folder", children: ["d2", "d3"] },
      d3: { id: "d3", name: "第三集", kind: "Document", children: [] },
    },
    recycle_bin: [],
  };
}

/** 内存试问后端：链路库＋最近作品＋内容树＋试问证据＋可编程发送队列。 */
class FakeTrialBackend {
  library: ChainLibrary;
  readonly calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  readonly failures = new Map<string, string>();
  readonly sendQueue: Array<() => Promise<GenerateAiResult>> = [];
  readonly trials = new Map<string, TrialRecord>();
  recentWorks: RecentWorkEntry[];
  nextReply = "";

  constructor(library: ChainLibrary) {
    this.library = library;
    this.recentWorks = [{ name: "试作", path: WORK_PATH, last_opened_at: "2026-10-07T00:00:00Z" }];
  }

  invoke: InvokeFn = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    this.calls.push({ cmd, args });
    const failure = this.failures.get(cmd);
    if (failure !== undefined) throw new Error(failure);
    switch (cmd) {
      case "chain_library_load":
        return structuredClone(this.library) as T;
      case "making_conversation_list":
        return { conversations: [], skipped: [] } as T;
      case "making_start_session":
      case "making_end_session":
      case "making_cancel_message":
        return { ok: true, content: "" } as T;
      case "making_send_message":
        return { ok: true, content: this.nextReply, sent_confirmed: true } as T;
      case "chain_save_version": {
        const chain = this.library.chains.find((candidate) => candidate.id === args?.chainId);
        if (chain === undefined) throw new Error("链路不存在");
        const version: ChainVersion = {
          id: `chainver-saved-${chain.versions.length + 1}`,
          index: chain.versions.length + 1,
          created_at: "2026-10-07T00:00:00Z",
          cards: (args?.cards as { title: string; trigger_desc: string; body: string }[]).map((card, index) => ({
            id: `card-saved-${index}`,
            ...card,
          })),
          change_note: String(args?.changeNote ?? ""),
          trials: [],
        };
        chain.versions.push(version);
        return structuredClone(version) as T;
      }
      case "load_recent_works":
        return structuredClone(this.recentWorks) as T;
      case "open_content_tree":
        if (args?.projectPath !== WORK_PATH) throw new Error(`作品路径不符: ${String(args?.projectPath)}`);
        return structuredClone(workTree()) as T;
      case "trial_send_message": {
        const behavior = this.sendQueue.shift();
        if (behavior !== undefined) return behavior() as T;
        return { ok: true, content: this.nextReply } as T;
      }
      case "trial_cancel_message":
        return { ok: true, content: "" } as T;
      case "trial_authorization_respond":
        return null as T;
      case "trial_get": {
        const record = this.trials.get(String(args?.trialId));
        if (record === undefined) throw new Error(`试问证据不存在: ${String(args?.trialId)}`);
        return structuredClone(record) as T;
      }
      case "trial_list_for_version": {
        const trials = [...this.trials.values()]
          .filter((record) => record.chain_id === args?.chainId && record.version_id === args?.versionId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { trials } as T;
      }
      case "trial_set_feedback": {
        const record = this.trials.get(String(args?.trialId));
        if (record === undefined) throw new Error(`试问证据不存在: ${String(args?.trialId)}`);
        record.feedback = String(args?.feedback ?? "");
        return null as T;
      }
      default:
        throw new Error(`测试后端未实现的命令：${cmd}`);
    }
  };
}

/** 假事件总线：按事件名记录处理器，测试内主动 emit。 */
class FakeEventBus {
  private readonly handlers = new Map<string, Array<(event: { payload: unknown }) => void>>();
  listen: ListenFn = <T,>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void> => {
    const list = this.handlers.get(event) ?? [];
    const recorded = handler as unknown as (event: { payload: unknown }) => void;
    list.push(recorded);
    this.handlers.set(event, list);
    return Promise.resolve(() => {
      const current = this.handlers.get(event) ?? [];
      const index = current.indexOf(recorded);
      if (index >= 0) current.splice(index, 1);
    });
  };
  emit(event: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler({ payload });
  }
}

let idSeed = 0;
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}-${idSeed}`;
}

/** 已保存草稿内容的版本（与 DRAFTS 逐字一致，可直接试问）。 */
function savedDraftVersion(): ChainVersion {
  return {
    id: nextId("chainver"),
    index: 1,
    created_at: "2026-10-06T00:00:00Z",
    cards: DRAFTS.map((draft) => ({ id: nextId("card"), ...draftToCardInput(draft) })),
    change_note: "",
    trials: [],
  };
}

function chainOf(name: string, versions: ChainVersion[]): Chain {
  return { id: nextId("chain"), name, created_at: "2026-10-06T00:00:00Z", versions };
}

interface TrialFixture {
  controller: MakingController;
  backend: FakeTrialBackend;
  bus: FakeEventBus;
  page: ParsedPage;
  document: Document;
  restore: () => void;
}

async function trialFixture(library: ChainLibrary, options: { workTitle?: string } = {}): Promise<TrialFixture> {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  page.document.getElementById("current-project-name")!.textContent = options.workTitle ?? "试作";
  page.document.getElementById("current-document-name")!.textContent = "第一集";
  const backend = new FakeTrialBackend(library);
  const bus = new FakeEventBus();
  const fixture: TrialFixture = {
    controller: null as unknown as MakingController,
    backend,
    bus,
    page,
    document: page.document,
    restore,
  };
  fixture.controller = setupMaking(getAppDom().making, {
    call: backend.invoke,
    listen: bus.listen,
  });
  await flushPromises();
  return fixture;
}

function elementOf(fixture: TrialFixture, id: string): HTMLElement {
  const element = fixture.document.getElementById(id);
  assert.ok(element, `缺少 #${id}`);
  return element;
}

async function clickElement(fixture: TrialFixture, id: string): Promise<void> {
  (elementOf(fixture, id) as unknown as { click(): void }).click();
  await flushPromises();
}

/** 走完整草稿路径：浏览链路→开始制作→发送→拿到草稿面板→点「开始试问」。 */
async function reachTrialPanel(fixture: TrialFixture, chain: Chain): Promise<HTMLButtonElement> {
  fixture.backend.nextReply = DRAFT_REPLY;
  const row = fixture.document.querySelector<HTMLButtonElement>(`[data-chain-id="${chain.id}"]`);
  assert.ok(row, "链路行已渲染");
  row.click();
  await flushPromises();
  await clickElement(fixture, "making-conversation-start-btn");
  const input = elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement;
  input.value = "出一个草稿";
  const form = elementOf(fixture, "making-conversation-form");
  const event = new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event;
  form.dispatchEvent(event);
  await flushPromises();
  const trial = fixture.document.querySelector<HTMLButtonElement>(
    ".making-draft-panel .making-draft-actions .making-mini-btn:not(.primary)",
  );
  assert.ok(trial, "草稿面板与开始试问按钮已渲染");
  trial.click();
  await flushPromises();
  return trial;
}

function trialSendCall(fixture: TrialFixture, index = 0): { args?: Record<string, unknown> } {
  const calls = fixture.backend.calls.filter((call) => call.cmd === "trial_send_message");
  const call = calls[index];
  assert.ok(call, `第 ${index + 1} 次 trial_send_message 已调用`);
  return call;
}

// ========== 发起流守卫 ==========

test("launch guard: unsaved drafts prompt to save first and never send", async () => {
  // 链路只有一张内容不同的旧版卡：草稿未保存。
  const chain = chainOf("情节探索", [{
    id: nextId("chainver"),
    index: 1,
    created_at: "2026-10-06T00:00:00Z",
    cards: [{ id: nextId("card"), title: "旧卡", trigger_desc: "适用：x", body: "旧正文" }],
    change_note: "",
    trials: [],
  }]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  try {
    await reachTrialPanel(fixture, chain);
    assert.equal(elementOf(fixture, "making-trial-panel").classList.contains("hidden"), false);
    assert.equal(elementOf(fixture, "making-trial-form").classList.contains("hidden"), true, "设置面板不出现");
    const guard = elementOf(fixture, "making-trial-guard");
    assert.match(guard.textContent ?? "", /保存这版草稿/);
    assert.equal(fixture.backend.calls.some((call) => call.cmd === "trial_send_message"), false);
  } finally {
    fixture.restore();
  }
});

test("launch guard: no open work disables trial with an honest reason", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null }, { workTitle: "" });
  try {
    await reachTrialPanel(fixture, chain);
    const guard = elementOf(fixture, "making-trial-guard");
    assert.equal(guard.classList.contains("hidden"), false);
    assert.match(guard.textContent ?? "", /还没有打开的作品/);
    assert.equal(elementOf(fixture, "making-trial-form").classList.contains("hidden"), true);
    assert.equal(fixture.backend.calls.some((call) => call.cmd === "trial_send_message"), false);
  } finally {
    fixture.restore();
  }
});

test("default work source verifies the open work by name and refuses mismatches", async () => {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  try {
    page.document.getElementById("current-project-name")!.textContent = "试作";
    const mismatchBackend = new FakeTrialBackend({ format_version: 1, chains: [], active: null });
    mismatchBackend.recentWorks = [{ name: "另一个作品", path: "D:/works/另一个", last_opened_at: "2026-10-07T00:00:00Z" }];
    const source = createDefaultTrialWorkSource(mismatchBackend.invoke);
    const mismatched = await source.resolve();
    assert.equal(mismatched.status, "unavailable");
    assert.match((mismatched as { reason: string }).reason, /无法确定当前打开的作品/);

    const matchedBackend = new FakeTrialBackend({ format_version: 1, chains: [], active: null });
    const okSource = createDefaultTrialWorkSource(matchedBackend.invoke);
    const resolved = await okSource.resolve();
    assert.equal(resolved.status, "ok");
    assert.equal((resolved as { workPath: string }).workPath, WORK_PATH);

    // 文档列表：内容树文档按 AI 可见性过滤（隐藏稿不进关注文档候选），文件夹不列出。
    const documents = await okSource.listDocuments(WORK_PATH);
    assert.deepEqual(documents.map((doc) => doc.name), ["第一集", "第三集"]);
    page.document.getElementById("current-document-name")!.textContent = "第三集";
    assert.equal(okSource.defaultFocusDocumentId(documents), "d3", "默认关注文档＝当前编辑文档");
    page.document.getElementById("current-document-name")!.textContent = "不存在的文档";
    assert.equal(okSource.defaultFocusDocumentId(documents), null, "无法确定时默认不指定");
  } finally {
    restore();
  }
});

// ========== 设置面板与发起 ==========

test("settings panel shows environment, requires question, and sends with-card round", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    assert.equal(form.classList.contains("hidden"), false, "草稿已保存：设置面板出现");
    const meta = elementOf(fixture, "making-trial-meta");
    assert.match(meta.textContent ?? "", /「情节探索」·第1版（带卡试问）/);
    assert.match(meta.textContent ?? "", /试用作品：试作/);

    // 关注文档候选：可见文档＋「不指定」；默认＝当前编辑文档（第一集）。
    const focus = elementOf(fixture, "making-trial-focus") as HTMLSelectElement;
    const options = [...focus.querySelectorAll("option")].map((option) => ({ value: option.value, label: option.textContent ?? "" }));
    assert.deepEqual(options, [
      { value: "", label: "（不指定关注文档）" },
      { value: "d1", label: "第一集" },
      { value: "d3", label: "第三集" },
    ]);
    assert.equal(focus.value, "d1");

    // 问题必填：空问题时「开始试用」禁用。
    const question = elementOf(fixture, "making-trial-question") as HTMLTextAreaElement;
    const start = elementOf(fixture, "making-trial-start") as HTMLButtonElement;
    assert.equal(start.disabled, true);
    question.value = "  ";
    question.dispatchEvent(new fixture.page.window.Event("input", { bubbles: true }) as unknown as Event);
    await flushPromises();
    assert.equal(start.disabled, true, "空白问题不可开始");
    question.value = "帮我看看这场戏的对白是否过火";
    question.dispatchEvent(new fixture.page.window.Event("input", { bubbles: true }) as unknown as Event);
    await flushPromises();
    assert.equal(start.disabled, false);

    // 显式开始试用：trial_send_message 携带 trial- 前缀编号、所试版本、带卡与作品环境。
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const call = trialSendCall(fixture);
    assert.match(String(call.args?.trialId), /^trial-/);
    assert.equal(call.args?.chainId, chain.id);
    assert.equal(call.args?.versionId, chain.versions[0].id);
    assert.equal(call.args?.withCard, true, "默认单跑带卡一版");
    assert.equal(call.args?.question, "帮我看看这场戏的对白是否过火");
    assert.equal(call.args?.focusDocumentId, "d1");
    assert.equal(call.args?.workPath, WORK_PATH);

    // 运行区：环境行（所试版本｜作品｜关注文档）＋生成中状态。
    assert.equal(elementOf(fixture, "making-trial-run").classList.contains("hidden"), false);
    assert.match(elementOf(fixture, "making-trial-run-meta").textContent ?? "", /关注文档：第一集/);
    const statusLine = fixture.document.querySelector(".making-trial-block-status");
    assert.match(statusLine?.textContent ?? "", /生成中/);
  } finally {
    fixture.restore();
  }
});

// ========== 流式、授权应答与终态 ==========

test("streams deltas, surfaces authorization, and resolves on allow", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "帮我看看对白";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const trialId = String(trialSendCall(fixture).args?.trialId);

    // 流式增量：按试问编号路由；未知试问的增量不转发。
    fixture.bus.emit("trial-message-event", { trial_id: trialId, message_id: "trial-msg-1", seq: 1, text: "片段一" });
    fixture.bus.emit("trial-message-event", { trial_id: "trial-other", message_id: "m", seq: 2, text: "污染" });
    await flushPromises();
    const reply = fixture.document.querySelector<HTMLPreElement>(".making-trial-reply");
    assert.equal(reply?.textContent, "片段一", "增量追加渲染");

    // 等待补读授权：reason 呈现＋允许/本次不允许。
    fixture.bus.emit("trial-authorization-request", { trial_id: trialId, reason: "材料不足，需要确认时间线" });
    await flushPromises();
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /等待补读授权/);
    const authReason = fixture.document.querySelector(".making-trial-auth-reason");
    assert.equal(authReason?.textContent, "材料不足，需要确认时间线");
    const allow = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-trial-auth-actions .making-mini-btn")]
      .find((button) => button.textContent === "允许");
    assert.ok(allow, "允许入口已渲染");
    allow.click();
    await flushPromises();
    const respond = fixture.backend.calls.find((call) => call.cmd === "trial_authorization_respond");
    assert.deepEqual(
      { trialId: respond?.args?.trialId, grant: respond?.args?.grant },
      { trialId, grant: true },
    );
    assert.equal(fixture.document.querySelector(".making-trial-auth"), null, "应答后回到生成中");
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /生成中/);

    // 终态：命令返回的全文是最终事实。
    deferred.succeed("完整的试问回复。");
    await flushPromises();
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /已完成/);
    assert.equal(fixture.document.querySelector<HTMLPreElement>(".making-trial-reply")?.textContent, "完整的试问回复。");
    // 默认单跑：完成时只发起过一次。
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "trial_send_message").length, 1);
  } finally {
    fixture.restore();
  }
});

test("authorization deny responds with grant=false and keeps the round alive", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "问题";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const trialId = String(trialSendCall(fixture).args?.trialId);
    fixture.bus.emit("trial-authorization-request", { trial_id: trialId, reason: "想补读第三集" });
    await flushPromises();
    const deny = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-trial-auth-actions .making-mini-btn")]
      .find((button) => button.textContent === "本次不允许");
    assert.ok(deny);
    deny.click();
    await flushPromises();
    const respond = fixture.backend.calls.find((call) => call.cmd === "trial_authorization_respond");
    assert.equal(respond?.args?.grant, false);
    deferred.succeed("有限回答");
    await flushPromises();
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /已完成/);
  } finally {
    fixture.restore();
  }
});

test("stop cancels via trial_cancel_message and late results do not flip the state", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "问题";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const trialId = String(trialSendCall(fixture).args?.trialId);
    fixture.bus.emit("trial-message-event", { trial_id: trialId, message_id: "trial-msg-7", seq: 1, text: "已生成一半" });
    await flushPromises();

    const stop = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-trial-block-head .making-mini-btn")]
      .find((button) => button.textContent === "停止");
    assert.ok(stop, "停止入口已渲染");
    stop.click();
    await flushPromises();
    const cancel = fixture.backend.calls.find((call) => call.cmd === "trial_cancel_message");
    assert.deepEqual(
      { trialId: cancel?.args?.trialId, messageId: cancel?.args?.messageId },
      { trialId, messageId: "trial-msg-7" },
      "停止按试问编号与流式消息编号取消",
    );
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /已停止/);
    assert.equal(fixture.document.querySelector<HTMLPreElement>(".making-trial-reply")?.textContent, "已生成一半", "已流式内容保留");

    // 迟到的成功终态不覆盖已停止状态。
    deferred.succeed("迟到的全文");
    await flushPromises();
    assert.match(fixture.document.querySelector(".making-trial-block-status")?.textContent ?? "", /已停止/);
    assert.equal(fixture.document.querySelector<HTMLPreElement>(".making-trial-reply")?.textContent, "已生成一半");
  } finally {
    fixture.restore();
  }
});

test("failed rounds show a concrete Chinese notice in red status line", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "问题";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    deferred.fail("capacity_exceeded", "raw backend message");
    await flushPromises();
    const status = fixture.document.querySelector(".making-trial-block-status");
    assert.match(status?.textContent ?? "", /生成失败/);
    assert.match(status?.textContent ?? "", /同时上限/);
    assert.equal(status?.classList.contains("is-error"), true, "失败态红色标注");
  } finally {
    fixture.restore();
  }
});

test("a second launch while a round is in flight is honestly refused", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const deferred = new DeferredTrial();
  fixture.backend.sendQueue.push(() => deferred.promise);
  try {
    const trialButton = await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "问题";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "trial_send_message").length, 1);

    trialButton.click();
    await flushPromises();
    const guard = elementOf(fixture, "making-trial-guard");
    assert.match(guard.textContent ?? "", /还在进行/);
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "trial_send_message").length, 1, "不重复发起");
    deferred.succeed("ok");
    await flushPromises();
  } finally {
    fixture.restore();
  }
});

// ========== 对照（显式动作） ==========

test("comparison is explicit: only the with-card round runs by default", async () => {
  const chain = chainOf("情节探索", [savedDraftVersion()]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const first = new DeferredTrial();
  const second = new DeferredTrial();
  fixture.backend.sendQueue.push(() => first.promise);
  try {
    await reachTrialPanel(fixture, chain);
    const form = elementOf(fixture, "making-trial-form");
    (elementOf(fixture, "making-trial-question") as HTMLTextAreaElement).value = "同一问题";
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    first.succeed("带卡回复");
    await flushPromises();

    // 完成态：显式对照入口已出现，但默认只有一次发起。
    const compare = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-trial-block-actions .making-mini-btn")]
      .find((button) => button.textContent?.includes("跑不带卡对照"));
    assert.ok(compare, "对照入口已渲染");
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "trial_send_message").length, 1, "默认不自动跑对照");

    fixture.backend.sendQueue.push(() => second.promise);
    compare.click();
    await flushPromises();
    const secondCall = trialSendCall(fixture, 1);
    assert.equal(secondCall.args?.withCard, false, "对照轮不带卡");
    assert.equal(secondCall.args?.question, "同一问题", "同问题");
    assert.equal(secondCall.args?.versionId, chain.versions[0].id, "同版本");
    assert.equal(secondCall.args?.focusDocumentId, "d1", "同关注文档");
    assert.match(String(secondCall.args?.trialId), /^trial-/);

    // 两份证据并列展示：带卡/不带卡标注。
    second.succeed("对照回复");
    await flushPromises();
    const kinds = [...fixture.document.querySelectorAll(".making-trial-block-kind")].map((node) => node.textContent);
    assert.deepEqual(kinds, ["带卡试问", "对照试问（不带卡）"]);
    const replies = [...fixture.document.querySelectorAll<HTMLPreElement>(".making-trial-reply")].map((node) => node.textContent);
    assert.deepEqual(replies, ["带卡回复", "对照回复"]);
    // 对照已跑过：不再出现对照入口（一次对照）。
    assert.equal(fixture.document.querySelector(".making-trial-block-actions"), null);
  } finally {
    fixture.restore();
  }
});

// ========== 试问记录（只读查看与反馈） ==========

function storedTrial(chain: Chain, version: ChainVersion, overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    id: nextId("trial"),
    chain_id: chain.id,
    chain_name: chain.name,
    version_id: version.id,
    version_index: version.index,
    with_card: true,
    question: "这场戏的对白是否过火？",
    reply_text: "有两句偏口号，其余克制。",
    status: "success",
    created_at: "2026-10-07T09:30:00Z",
    work_title: "试作",
    focus_document_id: "d1",
    focus_document_title: "第一集",
    feedback: null,
    ...overrides,
  };
}

async function openCardPanelWithTrials(
  fixture: TrialFixture,
  chain: Chain,
): Promise<void> {
  const row = fixture.document.querySelector<HTMLButtonElement>(`[data-chain-id="${chain.id}"]`);
  assert.ok(row);
  row.click();
  await flushPromises();
  const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
  assert.ok(cardRow, "卡片行已渲染");
  cardRow.click();
  await flushPromises();
}

test("records section lists trials read-only with detail on demand and no follow-up input", async () => {
  const version = savedDraftVersion();
  const chain = chainOf("情节探索", [version]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const record = storedTrial(chain, version, { feedback: "对白更克制了" });
  fixture.backend.trials.set(record.id, record);
  const contrast = storedTrial(chain, version, {
    id: "trial-contrast-1",
    with_card: false,
    question: "对照问题",
    reply_text: "",
    status: "cancelled",
    created_at: "2026-10-06T08:00:00Z",
  });
  fixture.backend.trials.set(contrast.id, contrast);
  try {
    await openCardPanelWithTrials(fixture, chain);
    const panel = elementOf(fixture, "making-card-panel");
    assert.match(panel.textContent ?? "", /试问记录/);

    // 列表行：问题摘要、带卡/对照标注、时间、反馈摘要。
    const rows = [...panel.querySelectorAll<HTMLButtonElement>(".making-trial-record-row")];
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent ?? "", /【带卡】这场戏的对白是否过火？/);
    assert.match(rows[0].textContent ?? "", /2026-10-07 09:30/);
    assert.match(rows[0].textContent ?? "", /对白更克制了/);
    assert.match(rows[1].textContent ?? "", /【对照】对照问题/);
    assert.match(rows[1].textContent ?? "", /未记录反馈/);

    // 展开只读详情：trial_get 取全文；无任何追问输入（唯一输入＝记录反馈）。
    rows[0].click();
    await flushPromises();
    const detail = panel.querySelector(".making-trial-record-detail");
    assert.ok(detail, "详情已展开");
    assert.ok(fixture.backend.calls.some((call) => call.cmd === "trial_get" && call.args?.trialId === record.id));
    assert.match(detail.textContent ?? "", /带卡试问 · 情节探索·第1版/);
    assert.match(detail.textContent ?? "", /关注文档：第一集/);
    assert.match(detail.textContent ?? "", /问题全文/);
    assert.match(detail.textContent ?? "", /这场戏的对白是否过火？/);
    assert.match(detail.textContent ?? "", /有两句偏口号，其余克制。/);
    assert.match(detail.textContent ?? "", /不能在这里继续追问/, "只读说明在场");
    const textareas = detail.querySelectorAll("textarea");
    assert.equal(textareas.length, 1, "唯一输入是反馈框");
    assert.match(textareas[0].getAttribute("aria-label") ?? "", /记录.*反馈/);
    const inputs = detail.querySelectorAll("input");
    assert.equal(inputs.length, 0, "没有问题输入");

    // 非成功终态的回复口径如实呈现。
    rows[1].click();
    await flushPromises();
    const details = panel.querySelectorAll(".making-trial-record-detail");
    assert.equal(details.length, 2);
    assert.match(details[1].textContent ?? "", /（本轮已停止，未保存回复全文）/);
  } finally {
    fixture.restore();
  }
});

test("feedback is recorded via trial_set_feedback and empty submit clears it", async () => {
  const version = savedDraftVersion();
  const chain = chainOf("情节探索", [version]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  const record = storedTrial(chain, version);
  fixture.backend.trials.set(record.id, record);
  try {
    await openCardPanelWithTrials(fixture, chain);
    const panel = elementOf(fixture, "making-card-panel");
    const row = panel.querySelector<HTMLButtonElement>(".making-trial-record-row");
    assert.ok(row);
    row.click();
    await flushPromises();
    const feedbackInput = panel.querySelector<HTMLTextAreaElement>(".making-trial-feedback-input");
    assert.ok(feedbackInput);
    feedbackInput.value = "这版不错，但触发条件偏宽";
    const form = panel.querySelector<HTMLFormElement>(".making-trial-feedback-form");
    assert.ok(form);
    form.dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const setCall = fixture.backend.calls.find((call) => call.cmd === "trial_set_feedback");
    assert.deepEqual(
      { trialId: setCall?.args?.trialId, feedback: setCall?.args?.feedback },
      { trialId: record.id, feedback: "这版不错，但触发条件偏宽" },
    );
    // 保存后就地刷新：行摘要带新反馈，详情保持展开。
    const refreshedRow = panel.querySelector<HTMLButtonElement>(".making-trial-record-row");
    assert.match(refreshedRow?.textContent ?? "", /这版不错，但触发条件偏宽/);
    assert.ok(panel.querySelector(".making-trial-record-detail"), "详情保持展开");

    // 空白提交＝清除反馈。
    const clearedInput = panel.querySelector<HTMLTextAreaElement>(".making-trial-feedback-input");
    assert.ok(clearedInput);
    clearedInput.value = "";
    panel.querySelector<HTMLFormElement>(".making-trial-feedback-form")!
      .dispatchEvent(new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    await flushPromises();
    const calls = fixture.backend.calls.filter((call) => call.cmd === "trial_set_feedback");
    assert.equal(calls[calls.length - 1]?.args?.feedback, "", "空白提交＝清除");
  } finally {
    fixture.restore();
  }
});

test("record loading degrades honestly on backend failures", async () => {
  const version = savedDraftVersion();
  const chain = chainOf("情节探索", [version]);
  const fixture = await trialFixture({ format_version: 1, chains: [chain], active: null });
  fixture.backend.failures.set("trial_list_for_version", "磁盘错误");
  try {
    await openCardPanelWithTrials(fixture, chain);
    const panel = elementOf(fixture, "making-card-panel");
    const errorLine = panel.querySelector(".making-trial-record-error");
    assert.ok(errorLine, "读取失败如实呈现");
    assert.match(errorLine.textContent ?? "", /读取试问记录失败：磁盘错误/);
    // 面板其余四项不受影响。
    const headings = [...panel.querySelectorAll(".making-card-panel-heading")].map((node) => node.textContent);
    assert.deepEqual(headings, ["身份", "何时用", "怎么做", "本版变化", "试问记录"]);
  } finally {
    fixture.restore();
  }
});
