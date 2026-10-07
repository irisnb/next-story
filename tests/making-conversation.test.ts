import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { getAppDom } from "../src/dom.ts";
import { setupMaking, type MakingController } from "../src/making/making-module.ts";
import type { MakingTrialLauncher } from "../src/making/making-session-controller.ts";
import {
  buildChainStatusMessage,
  deriveMakingTitle,
  draftToCardInput,
  draftTriggerDesc,
  makingSendErrorNotice,
  parseCardDrafts,
  buildCardDraftPanelView,
  bodyPreview,
} from "../src/making/making-conversation.ts";
import type { GenerateAiError, GenerateAiResult } from "../src/types.ts";
import type {
  Chain,
  ChainLibrary,
  ChainVersion,
  InvokeFn,
  ListenFn,
  MakingConversationRecord,
} from "../src/project-api.ts";

/**
 * 制作对话车道 F2a 的行为测试（add-making-module-core 任务 7.5/7.6）：
 * - 纯解析：卡草稿标记块（全/半角冒号、多块、多行正文、残块丢弃）与映射；
 * - 会话接线（happy-dom + 假后端 + 假事件总线）：发送流保存节奏、流式渲染、
 *   停止、失败可见、保存失败可见、崩溃复位、重开继续、禁发、试问钩子；
 * - 保存经用户确认：助手输出不自动写入链路库，点保存才 chain_save_version。
 */

// ========== 纯解析 ==========

const DRAFT_REPLY = [
  "好的，先出一版草稿。",
  "【卡草稿开始】",
  "卡名：语气克制",
  "何时用：打磨对白时",
  "何时不用：讨论故事结构时",
  "正文：指出过火的台词，说明问题，再给两种更克制的写法候选，由你决定用哪种。",
  "【卡草稿结束】",
].join("\n");

test("parseCardDrafts reads one-line fields with full or half-width colons", () => {
  const drafts = parseCardDrafts(DRAFT_REPLY);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, "语气克制");
  assert.equal(drafts[0].whenToUse, "打磨对白时");
  assert.equal(drafts[0].whenNotToUse, "讨论故事结构时");
  assert.match(drafts[0].body, /^指出过火的台词/);

  // 半角冒号同样识别。
  const halfWidth = parseCardDrafts("【卡草稿开始】\n卡名: 反差\n何时用: a\n何时不用: b\n正文: c\n【卡草稿结束】");
  assert.equal(halfWidth[0]?.title, "反差");
  assert.equal(halfWidth[0]?.whenToUse, "a");
});

test("parseCardDrafts keeps multiple blocks and drops incomplete ones", () => {
  const two = parseCardDrafts(
    "【卡草稿开始】\n卡名：甲\n何时用：a\n正文：x\n【卡草稿结束】\n中间说明\n【卡草稿开始】\n卡名：乙\n何时用：b\n正文：y\n【卡草稿结束】",
  );
  assert.deepEqual(two.map((draft) => draft.title), ["甲", "乙"]);

  // 未闭合的块（中途停止）：不冒充完整草稿。
  const unclosed = parseCardDrafts("【卡草稿开始】\n卡名：丙\n何时用：c\n正文：z");
  assert.equal(unclosed.length, 0);

  // 缺正文（关键字段）同样不产出草稿。
  const missingBody = parseCardDrafts("【卡草稿开始】\n卡名：丁\n何时用：d\n【卡草稿结束】");
  assert.equal(missingBody.length, 0);

  assert.equal(parseCardDrafts("没有任何标记的普通回复").length, 0);
});

test("parseCardDrafts appends unrecognized lines to the current field (multi-line body)", () => {
  const drafts = parseCardDrafts(
    "【卡草稿开始】\n卡名：多行\n何时用：a\n正文：第一行\n第二行\n【卡草稿结束】",
  );
  assert.equal(drafts[0]?.body, "第一行\n第二行");
});

test("draft mapping builds trigger description from use and non-use lines", () => {
  const drafts = parseCardDrafts(DRAFT_REPLY);
  const input = draftToCardInput(drafts[0]);
  assert.equal(input.title, "语气克制");
  assert.equal(input.trigger_desc, "适用：打磨对白时\n不适用：讨论故事结构时");
  assert.equal(input.body, drafts[0].body);
  assert.equal(input.slot_type, "requirement", "无类型行的旧会话标记块＝要求卡");

  // 无负例：只保留适用行，不虚构负例。
  const noNegative = draftTriggerDesc({ title: "t", whenToUse: "只此", whenNotToUse: "", body: "b", slotType: "requirement" });
  assert.equal(noNegative, "适用：只此");
});

test("parseCardDrafts reads the posture type field and carries it into CardInput", () => {
  // 姿态草稿：类型行是块内首字段行（与 Rust 模板侧钉死同步）。
  const postureReply = [
    "好的，出一版姿态草稿。",
    "【卡草稿开始】",
    "类型：姿态卡",
    "卡名：傲娇搭档",
    "何时用：日常陪想全程",
    "何时不用：无",
    "正文：你的出场姿态：嘴硬心软……底线不换皮。",
    "【卡草稿结束】",
  ].join("\n");
  const drafts = parseCardDrafts(postureReply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].slotType, "posture");
  assert.equal(drafts[0].title, "傲娇搭档");
  const input = draftToCardInput(drafts[0]);
  assert.equal(input.slot_type, "posture", "draftToCardInput 携带 slot_type");

  // 显式「类型：要求卡」同样识别（半角冒号容忍）。
  const explicit = parseCardDrafts("【卡草稿开始】\n类型: 要求卡\n卡名：甲\n何时用：a\n正文：x\n【卡草稿结束】");
  assert.equal(explicit[0]?.slotType, "requirement");
  assert.equal(draftToCardInput(explicit[0]!).slot_type, "requirement");

  // 无法识别的取值防御性视为要求卡：不因类型行残缺丢弃整张草稿。
  const unknown = parseCardDrafts("【卡草稿开始】\n类型：别的什么\n卡名：乙\n何时用：a\n正文：x\n【卡草稿结束】");
  assert.equal(unknown[0]?.slotType, "requirement");

  // 多块并存：类型按块各自解析，不串块。
  const mixed = parseCardDrafts(
    "【卡草稿开始】\n类型：姿态卡\n卡名：姿态\n何时用：a\n正文：x\n【卡草稿结束】\n" +
    "【卡草稿开始】\n卡名：要求\n何时用：b\n正文：y\n【卡草稿结束】",
  );
  assert.deepEqual(mixed.map((draft) => draft.slotType), ["posture", "requirement"]);

  // 确认预览与徽标文案共用类型标注。
  const view = buildCardDraftPanelView(drafts, "情节探索");
  assert.match(view!.saveConfirm, /卡名「傲娇搭档」（姿态卡）/);
});

test("title derivation truncates and falls back honestly", () => {
  assert.equal(deriveMakingTitle("短问题"), "短问题");
  const long = deriveMakingTitle("这是一条非常长的第一条制作消息需要被截断处理掉");
  assert.equal(long.length, 21);
  assert.ok(long.endsWith("…"));
  assert.equal(deriveMakingTitle("   "), "制作会话");
});

test("chain status preamble lists the latest version in full and degrades honestly", () => {
  // 无版本：如实注明，不虚构任何卡。
  const empty: Chain = { id: "c1", name: "空链路", created_at: "t", versions: [] };
  assert.equal(buildChainStatusMessage(empty), "【链路现状】当前链路「空链路」还没有版本。");

  // 多版本：只取最新（末位）版本；逐卡列类型、卡名、触发描述与正文全文。
  const chain: Chain = {
    id: "c2",
    name: "情节探索",
    created_at: "t",
    versions: [
      {
        id: "v1",
        index: 1,
        created_at: "t",
        cards: [{ id: "k1", title: "旧卡", trigger_desc: "适用：旧", body: "旧正文" }],
        change_note: "",
        trials: [],
      },
      {
        id: "v2",
        index: 2,
        created_at: "t",
        cards: [
          { id: "k2", title: "反差", trigger_desc: "适用：a\n不适用：b", body: "正文一" },
          { id: "k3", title: "傲娇", trigger_desc: "适用：全程", body: "正文二", slot_type: "posture" },
        ],
        change_note: "",
        trials: [],
      },
    ],
  };
  const text = buildChainStatusMessage(chain);
  assert.match(text, /^【链路现状】/);
  assert.match(text, /最新版本是第 2 版，共 2 张卡/);
  assert.match(text, /要求卡「反差」/);
  assert.ok(text.includes("适用：a\n不适用：b"), "触发描述全文（含负例行）");
  assert.ok(text.includes("正文一"), "正文全文");
  assert.match(text, /姿态卡「傲娇」/, "缺省 slot_type＝要求卡，posture＝姿态卡");
  assert.ok(!text.includes("旧卡"), "旧版本卡片不进附言");
  assert.match(text, /用途说明：此清单供起草参考——并存或修改时草稿须完整重述全部卡。/);
});

test("draft save confirm previews cards and states no auto activation", () => {
  const drafts = parseCardDrafts(DRAFT_REPLY);
  const view = buildCardDraftPanelView(drafts, "情节探索");
  assert.ok(view);
  assert.match(view!.saveConfirm, /「情节探索」的新版本/);
  assert.match(view!.saveConfirm, /卡名「语气克制」/);
  assert.match(view!.saveConfirm, /不会自动启用/);
  assert.match(view!.boundaryNote, /临时材料/);
  assert.match(view!.saveConfirm, new RegExp(bodyPreview(drafts[0].body).slice(0, 10)));
  assert.equal(buildCardDraftPanelView([], "x"), null);
});

test("send error notices map queue-semantic codes to concrete Chinese hints", () => {
  assert.match(makingSendErrorNotice("conversation_busy", "raw"), /正在生成/);
  assert.match(makingSendErrorNotice("capacity_exceeded", "raw"), /同时上限/);
  assert.match(makingSendErrorNotice("configuration_required", "raw"), /LLM 配置/);
  assert.equal(makingSendErrorNotice("service", "后端中文错误"), "后端中文错误");
  assert.match(makingSendErrorNotice("service", ""), /未能完成/);
});

// ========== 会话接线夹具（happy-dom + 假后端 + 假事件总线） ==========

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

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

async function flushPromises(ticks = 16): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

/** 可编程的延迟发送行为（流式与停止测试需要控制终态到达时机）。 */
class DeferredSend {
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
    this.resolve({ ok: true, content, sent_confirmed: true });
  }
  fail(code: GenerateAiError["code"], message: string): void {
    this.resolve({ ok: false, error: { code, message } });
  }
  rejectWith(error: unknown): void {
    this.reject(error);
  }
}

/** 内存制作后端：链路库＋制作会话档案＋可编程发送队列。 */
class FakeMakingBackend {
  library: ChainLibrary;
  readonly conversations = new Map<string, MakingConversationRecord>();
  readonly calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  readonly failures = new Map<string, string>();
  /** making_send_message 行为队列（空则用默认：成功返回 nextReply）。 */
  readonly sendQueue: Array<() => Promise<GenerateAiResult>> = [];
  nextReply = "";
  private versionSeed = 0;

  constructor(library: ChainLibrary) {
    this.library = library;
  }

  invoke: InvokeFn = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    this.calls.push({ cmd, args });
    const failure = this.failures.get(cmd);
    if (failure !== undefined) throw new Error(failure);
    switch (cmd) {
      case "chain_library_load":
        return structuredClone(this.library) as T;
      case "making_conversation_list": {
        const ofChain = [...this.conversations.values()]
          .filter((record) => record.chain_id === args?.chainId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return {
          conversations: ofChain.map((record) => ({
            id: record.id,
            chain_id: record.chain_id,
            title: record.title,
            created_at: record.created_at,
            updated_at: record.updated_at,
            turn_count: record.turns.length,
          })),
          skipped: [],
        } as T;
      }
      case "making_conversation_load": {
        const record = this.conversations.get(String(args?.conversationId));
        if (record === undefined) throw new Error(`制作会话不存在: ${args?.conversationId}`);
        return structuredClone(record) as T;
      }
      case "making_conversation_save":
        this.conversations.set(
          (args?.record as MakingConversationRecord).id,
          structuredClone(args?.record as MakingConversationRecord),
        );
        return null as T;
      case "making_conversation_delete":
        this.conversations.delete(String(args?.conversationId));
        return null as T;
      case "making_start_session":
      case "making_end_session":
      case "making_cancel_message":
        return { ok: true, content: "" } as T;
      case "making_send_message": {
        const behavior = this.sendQueue.shift();
        if (behavior !== undefined) return behavior() as T;
        return { ok: true, content: this.nextReply, sent_confirmed: true } as T;
      }
      case "chain_save_version": {
        const chain = this.library.chains.find((candidate) => candidate.id === args?.chainId);
        if (chain === undefined) throw new Error("链路不存在");
        this.versionSeed += 1;
        const version: ChainVersion = {
          id: `chainver-new-${this.versionSeed}`,
          index: chain.versions.length + 1,
          created_at: "2026-10-06T00:00:00Z",
          cards: (args?.cards as { title: string; trigger_desc: string; body: string }[]).map((card, index) => ({
            id: `card-new-${this.versionSeed}-${index}`,
            ...card,
          })),
          change_note: String(args?.changeNote ?? ""),
          trials: [],
        };
        chain.versions.push(version);
        return structuredClone(version) as T;
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

interface ConversationFixture {
  controller: MakingController;
  backend: FakeMakingBackend;
  bus: FakeEventBus;
  confirms: string[];
  confirmResult: boolean;
  trials: { chainId: string; chainName: string; drafts: readonly { title: string }[] }[];
  page: ParsedPage;
  document: Document;
  restore: () => void;
}

async function conversationFixture(
  library: ChainLibrary,
  options: { withTrialHook?: boolean } = {},
): Promise<ConversationFixture> {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  const backend = new FakeMakingBackend(library);
  const bus = new FakeEventBus();
  const fixture: ConversationFixture = {
    controller: null as unknown as MakingController,
    backend,
    bus,
    confirms: [],
    confirmResult: true,
    trials: [],
    page,
    document: page.document,
    restore,
  };
  const startTrial: MakingTrialLauncher = (request) => {
    fixture.trials.push({
      chainId: request.chainId,
      chainName: request.chainName,
      drafts: request.drafts.map((draft) => ({ title: draft.title })),
    });
  };
  fixture.controller = setupMaking(getAppDom().making, {
    call: backend.invoke,
    listen: bus.listen,
    confirm: async (message) => {
      fixture.confirms.push(message);
      return fixture.confirmResult;
    },
    ...(options.withTrialHook ? { startTrial } : {}),
  });
  await flushPromises();
  return fixture;
}

function elementOf(fixture: ConversationFixture, id: string): HTMLElement {
  const element = fixture.document.getElementById(id);
  assert.ok(element, `缺少 #${id}`);
  return element;
}

async function clickElement(fixture: ConversationFixture, id: string): Promise<void> {
  (elementOf(fixture, id) as unknown as { click(): void }).click();
  await flushPromises();
}

async function browseChain(fixture: ConversationFixture, chainId: string): Promise<void> {
  const row = fixture.document.querySelector<HTMLButtonElement>(`[data-chain-id="${chainId}"]`);
  assert.ok(row, "链路行已渲染");
  row.click();
  await flushPromises();
}

async function startMaking(fixture: ConversationFixture): Promise<void> {
  await clickElement(fixture, "making-conversation-start-btn");
  // 「开始新制作」会自动发出「链路现状」附言轮（保存→启动→发送→终态→再保存），
  // 多等一轮微任务让附言落地，后续断言面对的是稳定状态（任务 7.6）。
  await flushPromises(16);
}

async function typeAndSend(fixture: ConversationFixture, text: string): Promise<void> {
  const input = elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement;
  input.value = text;
  const form = elementOf(fixture, "making-conversation-form");
  const event = new fixture.page.window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event;
  form.dispatchEvent(event);
  await flushPromises();
}

function messageTexts(fixture: ConversationFixture): string[] {
  return [...fixture.document.querySelectorAll<HTMLParagraphElement>("#making-session-messages .making-msg-text")]
    .map((node) => node.textContent ?? "");
}

function savedRecordOf(fixture: ConversationFixture, id: string): MakingConversationRecord | undefined {
  return fixture.backend.conversations.get(id);
}

function currentConversationId(fixture: ConversationFixture): string {
  const id = fixture.controller.conversation.currentConversationId;
  assert.ok(id, "当前应打开一个制作会话");
  return id;
}

// ========== 夹具数据 ==========

let idSeed = 0;
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}-${idSeed}`;
}

function versionWith(index: number, title: string): ChainVersion {
  return {
    id: nextId("chainver"),
    index,
    created_at: "2026-10-06T00:00:00Z",
    cards: [{
      id: nextId("card"),
      title,
      trigger_desc: "适用：x",
      body: "正文",
    }],
    change_note: "",
    trials: [],
  };
}

function chainOf(name: string): Chain {
  return { id: nextId("chain"), name, created_at: "2026-10-06T00:00:00Z", versions: [versionWith(1, "卡")] };
}

function libraryOf(chains: Chain[]): ChainLibrary {
  return { format_version: 1, chains, active: null };
}

// ========== 空态与制作对象 ==========

test("empty state guides start and hides recent list when no sessions exist", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    assert.equal(elementOf(fixture, "making-conversation-empty").classList.contains("hidden"), false);
    assert.equal(elementOf(fixture, "making-conversation-recent").classList.contains("hidden"), true, "无会话不呈现空列表区");
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, true);

    await startMaking(fixture);
    assert.equal(fixture.controller.makingChainId, chain.id);
    assert.equal(elementOf(fixture, "making-conversation-empty").classList.contains("hidden"), true);
    assert.equal(elementOf(fixture, "making-conversation-active").classList.contains("hidden"), false);
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, false);
  } finally {
    fixture.restore();
  }
});

test("empty state offers continue entry and history for a chain with sessions", async () => {
  const chain = chainOf("情节探索");
  const library = libraryOf([chain]);
  const fixture = await conversationFixture(library);
  try {
    fixture.backend.conversations.set("mc-old", {
      id: "mc-old",
      chain_id: chain.id,
      title: "克制对白",
      created_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
      turns: [
        { role: "user", text: "帮我把对白改克制", status: "success" },
        { role: "assistant", text: "好的，先聊聊哪几句过火。", status: "success" },
      ],
    });
    await browseChain(fixture, chain.id);
    const recent = elementOf(fixture, "making-conversation-recent");
    assert.equal(recent.classList.contains("hidden"), false);
    assert.match(recent.textContent ?? "", /继续上次制作：克制对白/);
    assert.match(recent.textContent ?? "", /2026-10-05/);
  } finally {
    fixture.restore();
  }
});

// ========== 发送流 ==========

test("send flow saves pending round, lazily starts session, streams, and saves terminal state", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    // 新会话附言轮先落地（默认回复为空串），再布置本用例要控制的发送行为。
    await startMaking(fixture);
    fixture.backend.nextReply = DRAFT_REPLY;
    const deferred = new DeferredSend();
    fixture.backend.sendQueue.push(() => deferred.promise);
    await typeAndSend(fixture, "帮我把对话写得更克制");

    const id = currentConversationId(fixture);
    assert.match(id, /^mc-/);

    // 用户轮的 pending 档案（附言轮已在此前落地）：user 轮已定、assistant 轮 pending，标题已派生。
    await flushPromises();
    const pendingSave = fixture.backend.calls
      .filter((call) => call.cmd === "making_conversation_save")
      .map((call) => call.args?.record as MakingConversationRecord)
      .find((record) => record.turns.some((turn) => turn.text === "帮我把对话写得更克制"));
    assert.ok(pendingSave, "发送前先落一版 pending 档案");
    assert.equal(pendingSave.chain_id, chain.id);
    assert.equal(pendingSave.title, "帮我把对话写得更克制");
    assert.deepEqual(
      pendingSave.turns.map((turn) => `${turn.role}:${turn.status}`).slice(-2),
      ["user:success", "assistant:pending"],
    );

    const start = fixture.backend.calls.find((call) => call.cmd === "making_start_session");
    assert.equal(start?.args?.conversationId, id, "懒启动会话携带制作会话 id");
    const send = fixture.backend.calls.find(
      (call) => call.cmd === "making_send_message" && call.args?.text === "帮我把对话写得更克制",
    );
    assert.equal(send?.args?.conversationId, id);
    const messageId = String(send?.args?.messageId);
    assert.ok(messageId.length > 0);

    // 生成中：输入禁发、停止可见。
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, true);
    assert.equal((elementOf(fixture, "making-conversation-send") as HTMLButtonElement).disabled, true);
    assert.equal((elementOf(fixture, "making-conversation-stop") as HTMLButtonElement).hidden, false);

    // 流式增量：按（会话 id, 消息 id）路由；错会话的增量被忽略。
    fixture.bus.emit("making-message-event", { session_id: id, message_id: messageId, seq: 1, text: "片段一" });
    fixture.bus.emit("making-message-event", { session_id: "mc-other", message_id: messageId, seq: 2, text: "污染" });
    fixture.bus.emit("making-message-event", { session_id: id, message_id: messageId, seq: 3, text: "片段二" });
    await flushPromises();
    assert.deepEqual(messageTexts(fixture).slice(-1), ["片段一片段二"], "增量追加渲染");

    // 终态：命令返回的全文是最终事实。
    deferred.succeed(DRAFT_REPLY);
    await flushPromises();
    const finalSave = savedRecordOf(fixture, id);
    assert.ok(finalSave);
    assert.equal(finalSave.turns[finalSave.turns.length - 1].status, "success");
    assert.equal(finalSave.turns[finalSave.turns.length - 1].text, DRAFT_REPLY);
    assert.deepEqual(messageTexts(fixture).slice(-1), [DRAFT_REPLY]);

    // 卡草稿面板：临时材料说明＋保存动作；未保存前链路库无写入。
    const panel = fixture.document.querySelector(".making-draft-panel");
    assert.ok(panel, "草稿面板已渲染");
    assert.match(panel.textContent ?? "", /卡名：语气克制/);
    assert.match(panel.textContent ?? "", /临时材料/);
    assert.equal(fixture.backend.calls.some((call) => call.cmd === "chain_save_version"), false, "助手输出不自动写入链路库");

    // 生成结束：输入恢复。
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, false);
    assert.equal((elementOf(fixture, "making-conversation-stop") as HTMLButtonElement).hidden, true);
  } finally {
    fixture.restore();
  }
});

test("saving a draft requires confirmation and writes a new version without activation", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    fixture.backend.nextReply = DRAFT_REPLY;
    await typeAndSend(fixture, "帮我把对话写得更克制");
    await flushPromises();
    const saveDraft = fixture.document.querySelector<HTMLButtonElement>(".making-draft-panel .making-draft-actions .making-mini-btn.primary");
    assert.ok(saveDraft, "保存草稿按钮已渲染");
    assert.match(saveDraft.textContent ?? "", /保存这版草稿/);

    // 拒绝确认：不调用 chain_save_version。
    fixture.confirmResult = false;
    saveDraft.click();
    await flushPromises();
    assert.equal(fixture.backend.calls.some((call) => call.cmd === "chain_save_version"), false);

    // 同意确认：携带映射后的 CardInput（含卡类型，缺省＝要求卡）与变更说明，刷新链路库。
    fixture.confirmResult = true;
    saveDraft.click();
    await flushPromises();
    const versionCall = fixture.backend.calls.find((call) => call.cmd === "chain_save_version");
    assert.ok(versionCall, "chain_save_version 已调用");
    assert.equal(versionCall.args?.chainId, chain.id);
    assert.deepEqual(versionCall.args?.cards, [{
      title: "语气克制",
      trigger_desc: "适用：打磨对白时\n不适用：讨论故事结构时",
      body: "指出过火的台词，说明问题，再给两种更克制的写法候选，由你决定用哪种。",
      slot_type: "requirement",
    }]);
    assert.equal(versionCall.args?.changeNote, "制作会话保存");
    assert.ok(fixture.backend.calls.filter((call) => call.cmd === "chain_library_load").length >= 2, "保存后重读链路库");
    const notice = elementOf(fixture, "making-session-notice");
    assert.match(notice.textContent ?? "", /已保存为「情节探索·第2版」草稿/, "链路已有第1版，草稿追加为第2版");
    assert.match(notice.textContent ?? "", /尚未启用/);
    assert.match(fixture.confirms[0], /不会自动启用/);
  } finally {
    fixture.restore();
  }
});

test("the draft panel badges each card with its type and saves posture slot_type", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    fixture.backend.nextReply = [
      "好的，出一版姿态草稿。",
      "【卡草稿开始】",
      "类型：姿态卡",
      "卡名：傲娇搭档",
      "何时用：日常陪想全程",
      "何时不用：无",
      "正文：你的出场姿态：嘴硬心软；底线不换皮。",
      "【卡草稿结束】",
    ].join("\n");
    await typeAndSend(fixture, "想要一个傲娇姿态");
    await flushPromises();

    // 草稿面板逐卡类型徽标：姿态卡明确标注（不与要求卡混淆）。
    const panel = fixture.document.querySelector(".making-draft-panel");
    assert.ok(panel, "草稿面板已渲染");
    const badge = panel.querySelector(".making-draft-type");
    assert.ok(badge, "类型徽标已渲染");
    assert.equal(badge.textContent, "姿态卡");
    assert.equal(badge.classList.contains("is-posture"), true);
    assert.match(panel.textContent ?? "", /卡名：傲娇搭档/);

    // 保存确认后：链路库收到 slot_type=posture（纯姿态版本允许）。
    const saveDraft = panel.querySelector<HTMLButtonElement>(".making-draft-actions .making-mini-btn.primary");
    assert.ok(saveDraft);
    saveDraft.click();
    await flushPromises();
    const versionCall = fixture.backend.calls.find((call) => call.cmd === "chain_save_version");
    assert.ok(versionCall);
    assert.deepEqual(versionCall.args?.cards, [{
      title: "傲娇搭档",
      trigger_desc: "适用：日常陪想全程\n不适用：无",
      body: "你的出场姿态：嘴硬心软；底线不换皮。",
      slot_type: "posture",
    }]);
  } finally {
    fixture.restore();
  }
});

test("stop cancels the in-flight turn and ignores the late terminal result", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    const deferred = new DeferredSend();
    fixture.backend.sendQueue.push(() => deferred.promise);
    await typeAndSend(fixture, "出一个草稿");
    const id = currentConversationId(fixture);
    const send = fixture.backend.calls.find(
      (call) => call.cmd === "making_send_message" && call.args?.text === "出一个草稿",
    );
    const messageId = String(send?.args?.messageId);

    fixture.bus.emit("making-message-event", { session_id: id, message_id: messageId, seq: 1, text: "已生成一半" });
    await flushPromises();
    await clickElement(fixture, "making-conversation-stop");
    await flushPromises();

    assert.ok(
      fixture.backend.calls.some((call) => call.cmd === "making_cancel_message" && call.args?.conversationId === id),
      "停止调用 making_cancel_message",
    );
    const record = savedRecordOf(fixture, id);
    assert.equal(record?.turns[record.turns.length - 1].status, "cancelled", "轮次标记为已停止");
    assert.equal(record?.turns[record.turns.length - 1].text, "已生成一半", "已流式内容保留");
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, false, "停止后可继续输入");

    // 迟到的成功结果不覆盖已停止状态。
    deferred.succeed("迟到的完整回复");
    await flushPromises();
    const afterLate = savedRecordOf(fixture, id);
    assert.equal(afterLate?.turns[afterLate.turns.length - 1].status, "cancelled");
    assert.equal(afterLate?.turns[afterLate.turns.length - 1].text, "已生成一半");
  } finally {
    fixture.restore();
  }
});

test("failed sends mark the turn failed with a concrete Chinese notice", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    const deferred = new DeferredSend();
    fixture.backend.sendQueue.push(() => deferred.promise);
    await typeAndSend(fixture, "出一个草稿");
    const id = currentConversationId(fixture);
    deferred.fail("capacity_exceeded", "raw backend message");
    await flushPromises();
    const record = savedRecordOf(fixture, id);
    assert.equal(record?.turns[record.turns.length - 1].status, "failed");
    const statusLine = fixture.document.querySelector("#making-session-messages .making-msg-status.is-error");
    assert.ok(statusLine, "失败状态行已渲染");
    assert.match(statusLine.textContent ?? "", /同时上限/);
  } finally {
    fixture.restore();
  }
});

test("archive save failures stay visible and never claim saved", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  fixture.backend.failures.set("making_conversation_save", "磁盘已满");
  fixture.backend.nextReply = "好的。";
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    await typeAndSend(fixture, "帮我把对话写得更克制");
    await flushPromises();
    const notice = elementOf(fixture, "making-session-notice");
    assert.equal(notice.classList.contains("hidden"), false);
    assert.match(notice.textContent ?? "", /保存失败/);
    assert.match(notice.textContent ?? "", /磁盘已满/);
    assert.doesNotMatch(notice.textContent ?? "", /已保存/);
    // 对话继续可用（轮次终态照常更新）。
    const id = currentConversationId(fixture);
    assert.equal(fixture.controller.conversation.currentConversationId, id);
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, false);
  } finally {
    fixture.restore();
  }
});

test("driver loss ends open making sessions and recovery notice shows", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  fixture.backend.nextReply = "好的。";
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    await typeAndSend(fixture, "帮我把对话写得更克制");
    await flushPromises();
    const id = currentConversationId(fixture);
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "making_start_session").length, 1);

    fixture.bus.emit("ai-driver-lost", null);
    await flushPromises();
    assert.ok(
      fixture.backend.calls.some((call) => call.cmd === "making_end_session" && call.args?.conversationId === id),
      "驱动丢失后复位制作会话",
    );
    const notice = elementOf(fixture, "making-session-notice");
    assert.match(notice.textContent ?? "", /连接已恢复，可继续/);

    // 复位后再次发送：重新走 start（恢复路径由后端自动重放）。
    await typeAndSend(fixture, "继续刚才的话题");
    await flushPromises();
    assert.equal(fixture.backend.calls.filter((call) => call.cmd === "making_start_session").length, 2);
  } finally {
    fixture.restore();
  }
});

// ========== 新会话链路现状附言（add-posture-slot 任务 7.6） ==========

test("a new session auto-sends the chain status preamble with full card texts", async () => {
  const chain = chainOf("情节探索");
  // 第 2 版（最新）：要求卡（多行触发描述）＋姿态卡；第 1 版的旧卡不进附言。
  chain.versions.push({
    id: nextId("chainver"),
    index: 2,
    created_at: "2026-10-06T00:00:00Z",
    cards: [
      {
        id: nextId("card"),
        title: "反差与反转",
        trigger_desc: "适用：探索情节可能性时\n不适用：只讨论台词情绪时",
        body: "先指出当前场景的人物动机，再给两种可能走向，由用户决定。",
      },
      {
        id: nextId("card"),
        title: "傲娇搭档",
        trigger_desc: "适用：日常陪想全程",
        body: "你的出场姿态：嘴硬心软；底线不换皮。",
        slot_type: "posture",
      },
    ],
    change_note: "",
    trials: [],
  });
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    const id = currentConversationId(fixture);

    // 首条发送即附言，经既有发送通道（making_send_message）发出。
    const send = fixture.backend.calls.find((call) => call.cmd === "making_send_message");
    assert.ok(send, "附言已发出");
    assert.equal(send.args?.conversationId, id);
    const text = String(send.args?.text);
    assert.match(text, /^【链路现状】/);
    assert.match(text, /第 2 版/, "取最新版本（末位）");
    assert.match(text, /要求卡「反差与反转」/);
    assert.ok(
      text.includes("适用：探索情节可能性时\n不适用：只讨论台词情绪时"),
      "触发描述全文（含负例行）",
    );
    assert.ok(text.includes("先指出当前场景的人物动机，再给两种可能走向，由用户决定。"), "正文全文");
    assert.match(text, /姿态卡「傲娇搭档」/, "类型按 slot_type 标注（缺省＝要求卡）");
    assert.ok(text.includes("你的出场姿态：嘴硬心软；底线不换皮。"));
    assert.doesNotMatch(text, /「卡」/, "第 1 版旧卡不进附言");
    assert.match(text, /供起草参考/, "用途说明在场");
    assert.match(text, /完整重述全部卡/);
    assert.equal(
      fixture.backend.calls.filter((call) => call.cmd === "making_send_message").length,
      1,
      "附言是唯一自动发送",
    );

    // 档案：首条 user 轮即附言（对用户可见），助手轮正常终态；附言不派生标题。
    const record = savedRecordOf(fixture, id);
    assert.equal(record?.turns[0]?.role, "user");
    assert.match(record?.turns[0]?.text ?? "", /^【链路现状】/);
    assert.equal(record?.turns[1]?.status, "success", "助手自然回应");
    assert.equal(record?.title, "", "附言不占用标题，标题留给用户首条口述");
  } finally {
    fixture.restore();
  }
});

test("a new session on a versionless chain notes the honest status and stays usable", async () => {
  const chain: Chain = { id: nextId("chain"), name: "空链路", created_at: "2026-10-06T00:00:00Z", versions: [] };
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    const send = fixture.backend.calls.find((call) => call.cmd === "making_send_message");
    assert.ok(send, "无版本链路同样发附言（如实注明）");
    const text = String(send.args?.text);
    assert.match(text, /^【链路现状】/);
    assert.match(text, /当前链路「空链路」还没有版本/);

    // 会话照常可用：用户可直接口述，第二轮正常发送。
    assert.equal((elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement).disabled, false);
    fixture.backend.nextReply = "好的，说说你想加什么。";
    await typeAndSend(fixture, "我想要一张要求卡");
    const sends = fixture.backend.calls.filter((call) => call.cmd === "making_send_message");
    assert.equal(sends.length, 2);
    assert.equal(sends[1]?.args?.text, "我想要一张要求卡");
  } finally {
    fixture.restore();
  }
});

test("continuing an existing session never repeats the status preamble", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  fixture.backend.nextReply = "好的。";
  try {
    fixture.backend.conversations.set("mc-old", {
      id: "mc-old",
      chain_id: chain.id,
      title: "克制对白",
      created_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
      turns: [
        { role: "user", text: "帮我把对白改克制", status: "success" },
        { role: "assistant", text: "好的，先聊聊哪几句过火。", status: "success" },
      ],
    });
    await browseChain(fixture, chain.id);
    const continueButton = fixture.document.querySelector<HTMLButtonElement>(".making-recent-continue");
    assert.ok(continueButton, "继续入口已渲染");
    continueButton.click();
    await flushPromises();
    await typeAndSend(fixture, "再出一版");
    await flushPromises();

    // 打开与继续发送都不产生附言轮：唯一发送就是用户口述这条。
    const sends = fixture.backend.calls.filter((call) => call.cmd === "making_send_message");
    assert.equal(sends.length, 1);
    assert.equal(sends[0]?.args?.text, "再出一版");
    assert.ok(sends.every((call) => !String(call.args?.text).startsWith("【链路现状】")));
    const record = savedRecordOf(fixture, "mc-old");
    assert.equal(record?.turns.length, 4, "不新增附言轮");
  } finally {
    fixture.restore();
  }
});

test("a failed preamble surfaces an honest error and the session stays usable", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    const deferred = new DeferredSend();
    fixture.backend.sendQueue.push(() => deferred.promise);
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    const id = currentConversationId(fixture);

    // 附言进行中：沿用「同会话单轮进行中禁发」约束。
    const input = elementOf(fixture, "making-conversation-input") as HTMLTextAreaElement;
    assert.equal(input.disabled, true, "附言发送期间禁发");

    // 失败：如实提示（正常失败轮），不阻断会话。
    deferred.fail("capacity_exceeded", "raw backend message");
    await flushPromises();
    const record = savedRecordOf(fixture, id);
    assert.equal(record?.turns[record.turns.length - 1].status, "failed", "附言轮如实失败");
    const statusLine = fixture.document.querySelector("#making-session-messages .making-msg-status.is-error");
    assert.ok(statusLine, "失败状态行已渲染");
    assert.match(statusLine.textContent ?? "", /同时上限/);
    assert.equal(input.disabled, false, "失败后恢复输入，会话可用");

    // 用户仍可口述：下一条正常发送成功。
    fixture.backend.nextReply = "好的。";
    await typeAndSend(fixture, "我自己说明要求");
    const sends = fixture.backend.calls.filter((call) => call.cmd === "making_send_message");
    assert.equal(sends.length, 2);
    assert.equal(sends[1]?.args?.text, "我自己说明要求");
    const after = savedRecordOf(fixture, id);
    assert.equal(after?.turns[after.turns.length - 1].status, "success");
  } finally {
    fixture.restore();
  }
});

// ========== 重开继续 ==========

test("reopening a stored session renders history and continues sending", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  fixture.backend.nextReply = "第二轮回复。";
  try {
    fixture.backend.conversations.set("mc-old", {
      id: "mc-old",
      chain_id: chain.id,
      title: "克制对白",
      created_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
      turns: [
        { role: "user", text: "帮我把对白改克制", status: "success" },
        { role: "assistant", text: "好的，先聊聊哪几句过火。", status: "success" },
      ],
    });
    await browseChain(fixture, chain.id);
    const continueButton = fixture.document.querySelector<HTMLButtonElement>(".making-recent-continue");
    assert.ok(continueButton, "继续入口已渲染");
    continueButton.click();
    await flushPromises();

    assert.ok(fixture.backend.calls.some((call) => call.cmd === "making_conversation_load" && call.args?.conversationId === "mc-old"));
    assert.equal(fixture.controller.conversation.currentConversationId, "mc-old");
    assert.equal(fixture.controller.makingChainId, chain.id, "继续＝显式进入制作对象");
    assert.deepEqual(messageTexts(fixture), ["帮我把对白改克制", "好的，先聊聊哪几句过火。"]);

    // 继续发送：正常走 start（后端自动恢复会话并重放历史，前端不传历史）。
    await typeAndSend(fixture, "再出一版");
    await flushPromises();
    assert.ok(fixture.backend.calls.some((call) => call.cmd === "making_start_session" && call.args?.conversationId === "mc-old"));
    const record = savedRecordOf(fixture, "mc-old");
    assert.equal(record?.turns.length, 4);
    assert.equal(record?.turns[3].text, "第二轮回复。");
    assert.equal(record?.title, "克制对白", "重开后不重派生标题");
  } finally {
    fixture.restore();
  }
});

test("history list opens sessions and deletion is an explicit confirmed action", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    const older: MakingConversationRecord = {
      id: "mc-old",
      chain_id: chain.id,
      title: "旧会话",
      created_at: "2026-10-04T00:00:00Z",
      updated_at: "2026-10-04T00:00:00Z",
      turns: [
        { role: "user", text: "旧的", status: "success" },
        { role: "assistant", text: "旧回复", status: "success" },
      ],
    };
    fixture.backend.conversations.set("mc-old", older);
    await browseChain(fixture, chain.id);
    const continueButton = fixture.document.querySelector<HTMLButtonElement>(".making-recent-continue");
    continueButton!.click();
    await flushPromises();

    await clickElement(fixture, "making-session-history-btn");
    await flushPromises();
    const history = elementOf(fixture, "making-session-history-list");
    assert.equal(history.classList.contains("hidden"), false);
    assert.match(history.textContent ?? "", /旧会话/);

    const deleteButton = history.querySelector<HTMLButtonElement>(".making-session-list-delete");
    assert.ok(deleteButton, "删除入口已渲染");
    fixture.confirmResult = false;
    deleteButton.click();
    await flushPromises();
    assert.equal(fixture.backend.calls.some((call) => call.cmd === "making_conversation_delete"), false, "未确认不删除");

    fixture.confirmResult = true;
    deleteButton.click();
    await flushPromises();
    assert.ok(fixture.backend.calls.some((call) => call.cmd === "making_conversation_delete" && call.args?.conversationId === "mc-old"));
    assert.equal(fixture.backend.conversations.has("mc-old"), false);
    assert.match(fixture.confirms[0], /不可恢复/);
    // 删除后的兜底新会话会自动发「链路现状」附言轮：等完该异步再结束用例，
    // 避免续段在夹具销毁、全局 document 复位后才执行（任务 7.6）。
    await flushPromises(24);
  } finally {
    fixture.restore();
  }
});

// ========== 试问钩子（F2a 挂点 × F2b 接线） ==========

test("trial button is wired by default and guards unsaved drafts with a save-first hint", async () => {
  const chain = chainOf("情节探索");
  const fixture = await conversationFixture(libraryOf([chain]));
  try {
    await browseChain(fixture, chain.id);
    await startMaking(fixture);
    fixture.backend.nextReply = DRAFT_REPLY;
    await typeAndSend(fixture, "出一个草稿");
    await flushPromises();
    const trial = fixture.document.querySelector<HTMLButtonElement>(".making-draft-panel .making-draft-actions .making-mini-btn:not(.primary)");
    assert.ok(trial, "开始试问按钮已渲染");
    // F2b 起默认接线试问控制器：按钮可用（守卫在点击后判定，不预判草稿状态）。
    assert.equal(trial.disabled, false);

    // 草稿与已保存的第 1 版内容不一致（未保存）：如实提示先保存，不发起试问。
    trial.click();
    await flushPromises();
    const panel = elementOf(fixture, "making-trial-panel");
    assert.equal(panel.classList.contains("hidden"), false, "试问区已展开");
    assert.equal(elementOf(fixture, "making-trial-form").classList.contains("hidden"), true, "设置面板不出现");
    const guard = elementOf(fixture, "making-trial-guard");
    assert.equal(guard.classList.contains("hidden"), false);
    assert.match(guard.textContent ?? "", /保存这版草稿/);
    assert.equal(
      fixture.backend.calls.some((call) => call.cmd === "trial_send_message"),
      false,
      "未保存草稿不发起试问",
    );
  } finally {
    fixture.restore();
  }
});

test("explicit trial hook override still takes precedence over the wired controller", async () => {
  const chain = chainOf("情节探索");
  const wired = await conversationFixture(libraryOf([chain]), { withTrialHook: true });
  try {
    await browseChain(wired, chain.id);
    await startMaking(wired);
    wired.backend.nextReply = DRAFT_REPLY;
    await typeAndSend(wired, "出一个草稿");
    await flushPromises();
    const trial = wired.document.querySelector<HTMLButtonElement>(".making-draft-panel .making-draft-actions .making-mini-btn:not(.primary)");
    assert.equal(trial?.disabled, false);
    trial!.click();
    await flushPromises();
    assert.equal(wired.trials.length, 1);
    assert.equal(wired.trials[0].chainId, chain.id);
    assert.equal(wired.trials[0].chainName, "情节探索");
    assert.equal(wired.trials[0].drafts[0].title, "语气克制");
    // 覆盖钩子时试问控制器不接管：试问区保持收起。
    assert.equal(elementOf(wired, "making-trial-panel").classList.contains("hidden"), true);
  } finally {
    wired.restore();
  }
});
