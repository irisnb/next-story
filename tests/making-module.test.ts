import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { getAppDom } from "../src/dom.ts";
import { buildMaterialView } from "../src/ai-panel-view-model.ts";
import {
  buildConversationRecord,
  conversationFromRecord,
  readonlyConversationView,
  type ReadonlyTemporaryConversation,
} from "../src/ai-panel-conversation.ts";
import {
  initialAiPanelCoreState,
  reduceAiPanelState,
} from "../src/ai-panel-reducer.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiRequestGateway } from "../src/ai-feature-request-gateway.ts";
import type { AiFeatureContext } from "../src/ai-feature-context.ts";
import type { ConversationRecord } from "../src/conversation-archive.ts";
import type { ChainRoundRef, GenerateAiResult } from "../src/types.ts";
import { setupMaking, type MakingController } from "../src/making/making-module.ts";
import {
  buildCardPanelView,
  buildChainLibraryRows,
  buildMakingInspectorView,
  buildMakingStatusView,
  cardSummary,
  describeChainDeletion,
  describeVersionChange,
  describeVersionTrials,
  MAKING_DISCLAIMER,
} from "../src/making/making-view-model.ts";
import type { Chain, ChainLibrary, ChainVersion, InvokeFn, MakingConversationRecord } from "../src/project-api.ts";

/**
 * 制作模块第四页面的分层测试（add-making-module-core 任务组 7）：
 * - 纯显示决策（view-model）：三态分离措辞、启用/回退承接文字、本版变化、试问记录；
 * - DOM 契约：真实 index.html 解析后 `getAppDom().making` 全量解析、缺失 id 明确报错；
 * - 控制器行为（happy-dom + 假 invoke/确认）：浏览不改变状态条、启用/回退/停用/删除
 *   全部经确认后调用后端命令、窄窗切换保留未发送输入。
 */

// ========== 数据夹具 ==========

let idSeed = 0;
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}-${idSeed}`;
}

function version(
  index: number,
  cards: { title: string; trigger: string; body?: string }[],
  options: { changeNote?: string; trials?: number; trialsWithCard?: number } = {},
): ChainVersion {
  return {
    id: nextId("chainver"),
    index,
    created_at: `2026-10-06T00:00:0${index}Z`,
    cards: cards.map((card) => ({
      id: nextId("card"),
      title: card.title,
      trigger_desc: card.trigger,
      body: card.body ?? "",
    })),
    change_note: options.changeNote ?? "",
    trials: Array.from({ length: options.trials ?? 0 }, (_, i) => ({
      trial_id: nextId("trial"),
      created_at: "2026-10-06T00:00:00Z",
      with_card: i < (options.trialsWithCard ?? options.trials ?? 0),
    })),
  };
}

function chain(name: string, versions: ChainVersion[]): Chain {
  return { id: nextId("chain"), name, created_at: "2026-10-06T00:00:00Z", versions };
}

function library(chains: Chain[], active?: { chainId: string; versionId: string }): ChainLibrary {
  return {
    format_version: 1,
    chains,
    active: active ? { chain_id: active.chainId, version_id: active.versionId } : null,
  };
}

// ========== 纯显示决策 ==========

test("status view reflects the global active pointer and degrades honestly", () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }]), version(3, [{ title: "卡", trigger: "适用：x" }])]);
  const active = buildMakingStatusView(
    library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id }),
    null,
  );
  assert.equal(active.kind, "active");
  assert.match((active as { label: string }).label, /^当前链路：情节探索·第3版$/);

  const idle = buildMakingStatusView(library([chainA]), null);
  assert.equal(idle.kind, "idle");
  assert.equal((idle as { label: string }).label, "当前未启用链路，使用日常陪想");

  const failed = buildMakingStatusView(null, "chains.json 损坏");
  assert.equal(failed.kind, "error");
  assert.match((failed as { label: string }).label, /读取失败/);
});

test("library rows mark newer drafts only for the active chain", () => {
  const chainA = chain("情节探索", [
    version(3, [{ title: "卡", trigger: "适用：x" }]),
    version(4, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const rows = buildChainLibraryRows(
    library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[0].id }),
  );
  assert.equal(rows[0].statusLabel, "当前启用 第3版");
  assert.equal(rows[0].hasNewerDraft, true);
  assert.equal(rows[0].newerDraftIndex, 4);
  assert.equal(rows[1].isActiveChain, false);
  assert.equal(rows[1].statusLabel, "未启用");
  assert.equal(rows[1].hasNewerDraft, false, "未启用链路的新版本不算「新草稿」提示");
});

test("inspector view separates draft viewing from the active version with concrete wording", () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时" }]),
    version(3, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
    version(4, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const data = library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id });

  // 查看启用版本：无启用入口，状态标注「当前启用版本」，标题无版本后缀。
  const activeView = buildMakingInspectorView(data, chainA.id, chainA.versions[1].id)!;
  assert.equal(activeView.title, "正在查看：情节探索·第3版");
  assert.equal(activeView.stateLabel, "当前启用版本");
  assert.equal(activeView.enableLabel, null);
  assert.equal(activeView.isActiveVersion, true);

  // 查看更新的草稿（第4版）：标题标注草稿，明示「尚未启用」，启用文字写明替换对象与生效范围。
  const draftView = buildMakingInspectorView(data, chainA.id, chainA.versions[2].id)!;
  assert.equal(draftView.title, "正在查看：情节探索·第4版（草稿）");
  assert.equal(draftView.stateLabel, "尚未启用");
  assert.equal(draftView.enableLabel, "启用「情节探索·第4版」");
  assert.equal(
    draftView.enableConfirm,
    "启用「情节探索·第4版」，替换当前「情节探索·第3版」；所有作品的下一轮提问开始使用。",
  );
  assert.equal(draftView.isRollback, false);

  // 查看更早版本（第1版，启用第3版）：标题标注历史版本；回退场景，确认文字呈现保留承诺。
  const rollbackView = buildMakingInspectorView(data, chainA.id, chainA.versions[0].id)!;
  assert.equal(rollbackView.title, "正在查看：情节探索·第1版（历史版本）");
  assert.equal(rollbackView.isRollback, true);
  assert.equal(rollbackView.enableLabel, "回退到「情节探索·第1版」");
  assert.match(rollbackView.rollbackConfirm!, /较新版本及试问证据保留/);
  assert.match(rollbackView.rollbackConfirm!, /回退到「情节探索·第1版」，替换当前第3版/);

  // 版本记录倒序（最新在前），卡片摘要来自触发描述首行。
  assert.deepEqual(
    activeView.versionOptions.map((option) => option.label),
    ["第4版（最新）", "第3版", "第1版"],
  );
  assert.equal(activeView.cards[0].summary, "适用：探索情节可能性时");
  assert.equal(activeView.disclaimer, MAKING_DISCLAIMER);
});

test("enable wording states first-time activation without a replacement target", () => {
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const view = buildMakingInspectorView(library([chainB]), chainB.id, chainB.versions[0].id)!;
  assert.equal(view.enableLabel, "启用「对话打磨·第1版」");
  assert.equal(
    view.enableConfirm,
    "启用「对话打磨·第1版」；所有作品的下一轮提问开始使用。",
  );
});

test("card summary truncates the first line of the trigger description only", () => {
  assert.equal(cardSummary("适用：探索情节可能性时\n不适用：只讨论台词情绪时"), "适用：探索情节可能性时");
  const long = `适用：${"长".repeat(50)}`;
  const summary = cardSummary(long);
  assert.equal(summary.length, 41, "40 字＋省略号");
  assert.ok(summary.endsWith("…"), "截断加省略号");
  assert.ok(summary.startsWith("适用："), "截断保留开头");
  assert.equal(cardSummary(""), "");
  assert.equal(cardSummary("\n\n适用：换行后首行\n不适用：x"), "适用：换行后首行", "跳过空行取首个非空行");
});

test("version change and trial descriptions stay honest and complete", () => {
  const first = version(1, [{ title: "旧思路", trigger: "适用：x" }], { changeNote: "初稿" });
  const second = version(
    2,
    [{ title: "反差与反转", trigger: "适用：x" }, { title: "保留卡", trigger: "适用：y" }],
    { changeNote: "换思路" },
  );
  assert.equal(describeVersionChange(first, null), "本版是第 1 个版本；变更说明：初稿。");
  assert.equal(
    describeVersionChange(second, first),
    "相对上一版：新增「反差与反转」「保留卡」；移除「旧思路」；变更说明：换思路。",
  );
  const untouched = version(3, [
    { title: "反差与反转", trigger: "适用：x" },
    { title: "保留卡", trigger: "适用：y" },
  ]);
  assert.equal(describeVersionChange(untouched, second), "相对上一版：卡片组成无增删。");

  assert.equal(describeVersionTrials(first), "尚无试问记录");
  const trialed = version(4, [{ title: "保留卡", trigger: "适用：y" }], { trials: 3, trialsWithCard: 2 });
  assert.equal(describeVersionTrials(trialed), "本版共有 3 次试问记录（带卡 2 次、对照 1 次）。");
});

test("card panel carries the full body and the five required items", () => {
  const body = "先指出当前场景的人物动机，再给出两种可能走向，由用户决定。".repeat(3);
  const v1 = version(1, [{ title: "反差与反转", trigger: "适用：a\n不适用：b", body }]);
  const chainA = chain("情节探索", [v1]);
  const panel = buildCardPanelView(library([chainA]), chainA.id, v1.id, v1.cards[0])!;
  assert.match(panel.identity, /卡名「反差与反转」/);
  assert.match(panel.identity, /插槽：要求类/);
  assert.match(panel.identity, /情节探索·第1版/);
  assert.equal(panel.whenToUse, "适用：a\n不适用：b");
  assert.equal(panel.howTo, body, "正文全文透传，不做概括");
  assert.equal(panel.trialsLabel, "尚无试问记录");

  const empty = version(2, [{ title: "无正文卡", trigger: "适用：a", body: "" }]);
  const chainB = chain("乙", [empty]);
  const emptyPanel = buildCardPanelView(library([chainB]), chainB.id, empty.id, empty.cards[0])!;
  assert.equal(emptyPanel.howTo, "（无正文）");
});

test("chain deletion wording states scope and irreversibility", () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const message = describeChainDeletion(chainA);
  assert.match(message, /删除链路「情节探索」\？/);
  assert.match(message, /1 个版本与全部试问证据将被删除，不可恢复/);
  assert.match(message, /作品正文与日常讨论不受影响/);
});

// ========== 「本次参考了什么」的本轮链路行（任务 7.7） ==========

function conversationWithChainRounds(
  chainRounds?: readonly ChainRoundRef[],
  provenanceDefined = true,
): ReadonlyTemporaryConversation {
  return {
    id: "c-1",
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "问", selection_text: null },
    firstResponse: "答",
    firstRoundInterrupted: false,
    turns: [],
    pending: null,
    ...(provenanceDefined
      ? {
          provenance: [
            { document_id: "doc-1", material_type: "focus_document", document_version: "v1", turn_index: 0, entered_model_context: true },
            { document_id: "doc-1", material_type: "focus_document", document_version: "v2", turn_index: 1, entered_model_context: true },
          ],
        }
      : {}),
    ...(chainRounds !== undefined ? { chain_rounds: chainRounds } : {}),
  } as unknown as ReadonlyTemporaryConversation;
}

test("material view maps chain rounds by turn index with the locked field shape", () => {
  const view = buildMaterialView(conversationWithChainRounds([
    { turn_index: 0, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 },
    { turn_index: 1, chain_id: "chain-1", chain_name: "情节探索", version_index: 4 },
  ]))!;
  assert.equal(view.unavailable, false);
  assert.equal(view.rounds.length, 2);
  assert.equal(view.rounds[0].chainLabel, "本轮链路：情节探索·第3版");
  assert.equal(view.rounds[1].chainLabel, "本轮链路：情节探索·第4版");
  // 材料出处行不受链路行影响（同构并存）。
  assert.equal(view.rounds[0].sources.length, 1);
});

test("material view degrades chain line to hidden when the record lacks chain rounds", () => {
  const view = buildMaterialView(conversationWithChainRounds(undefined))!;
  assert.equal(view.rounds.length, 2);
  assert.ok(view.rounds.every((round) => round.chainLabel === null), "缺失降级不显示");

  const empty = buildMaterialView(conversationWithChainRounds([]))!;
  assert.ok(empty.rounds.every((round) => round.chainLabel === null), "空数组同样不显示");

  // 旧档案缺材料出处（unavailable）：链路行一并降级，不虚构轮次。
  const legacy = buildMaterialView(conversationWithChainRounds(
    [{ turn_index: 0, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 }],
    false,
  ))!;
  assert.equal(legacy.unavailable, true);
  assert.deepEqual(legacy.rounds, []);
});

test("material view keeps a chain-only round visible without inventing sources", () => {
  const view = buildMaterialView(conversationWithChainRounds([
    { turn_index: 2, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 },
  ]))!;
  const labels = view.rounds.map((round) => round.roundLabel);
  assert.deepEqual(labels, ["首轮", "第 1 轮", "第 2 轮"], "纯链路轮次也进入分轮视图");
  const chainOnly = view.rounds[2];
  assert.equal(chainOnly.chainLabel, "本轮链路：情节探索·第3版");
  assert.equal(chainOnly.sources.length, 0, "不虚构材料出处");
});

// ========== DOM 契约（真实 index.html） ==========

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

interface ParsedMakingPage {
  window: Window;
  document: Document;
}

function parseMakingDocument(): ParsedMakingPage {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(htmlSource, "text/html") as unknown as Document;
  return { window, document };
}

function installDocument(document: Document): () => void {
  const previous = globalThis.document;
  globalThis.document = document;
  return () => { globalThis.document = previous; };
}

function dispatchEvent(page: ParsedMakingPage, element: Element, type: string): void {
  const event = new page.window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event;
  element.dispatchEvent(event);
}

test("real index.html resolves the complete making DOM contract", () => {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  try {
    const making = getAppDom().making;
    assert.ok(making.moduleRoot);
    assert.ok(making.statusBar);
    assert.ok(making.statusText);
    assert.ok(making.deactivateBtn);
    assert.ok(making.chainLibrary);
    assert.ok(making.newChainBtn);
    assert.ok(making.chainList);
    assert.ok(making.inspectorTitle);
    assert.ok(making.versionSelect);
    assert.ok(making.enableBtn);
    assert.ok(making.cardList);
    assert.ok(making.cardPanel);
    assert.ok(making.conversationBody);
    assert.ok(making.conversationStartBtn);
    assert.ok(making.conversationInput);
    assert.ok(making.viewInspectBtn);
    assert.ok(making.viewChatBtn);
    assert.ok(making.libraryToggle);
  } finally {
    restore();
  }
});

test("missing making node fails assembly with its identifier", () => {
  const page = parseMakingDocument();
  page.document.getElementById("making-status-text")?.remove();
  const restore = installDocument(page.document);
  try {
    assert.throws(() => getAppDom(), /#making-status-text/);
  } finally {
    restore();
  }
});

// ========== 控制器行为（happy-dom + 假 invoke / 假确认） ==========

/** 内存链路库：按后端语义响应命令（追加版本、只动指针、删除保留其他链路）。 */
class FakeChainStore {
  data: ChainLibrary;
  /** 内存制作会话档案（making_conversation_list 的数据源）。 */
  makingConversations: MakingConversationRecord[] = [];
  readonly calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  /** 需要模拟失败的命令名→错误信息（注入后下次调用即抛错）。 */
  readonly failures = new Map<string, string>();
  invoke: InvokeFn;

  constructor(data: ChainLibrary) {
    this.data = data;
    this.invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      this.calls.push({ cmd, args });
      const failure = this.failures.get(cmd);
      if (failure !== undefined) throw new Error(failure);
      switch (cmd) {
        case "chain_library_load":
          return structuredClone(this.data) as T;
        case "making_conversation_list": {
          const ofChain = this.makingConversations
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
        case "chain_create": {
          const created: Chain = {
            id: nextId("chain"),
            name: String(args?.name ?? "").trim(),
            created_at: "2026-10-06T00:00:00Z",
            versions: [],
          };
          this.data.chains.push(created);
          return structuredClone(created) as T;
        }
        case "chain_set_active":
        case "chain_rollback": {
          this.data.active = {
            chain_id: String(args?.chainId),
            version_id: String(args?.versionId),
          };
          return undefined as T;
        }
        case "chain_deactivate":
          this.data.active = null;
          return undefined as T;
        case "trial_list_for_version":
          // 车道 F2b 起检视面板的「试问记录」栏按版本读证据列表；本夹具无证据。
          return { trials: [] } as T;
        case "chain_delete": {
          this.data.chains = this.data.chains.filter((chain) => chain.id !== args?.chainId);
          if (this.data.active?.chain_id === args?.chainId) this.data.active = null;
          return undefined as T;
        }
        default:
          throw new Error(`测试存储未实现的命令：${cmd}`);
      }
    };
  }
}

interface MakingFixture {
  controller: MakingController;
  store: FakeChainStore;
  confirms: string[];
  confirmResult: boolean;
  page: ParsedMakingPage;
  document: Document;
  restore: () => void;
}

async function makingFixture(data: ChainLibrary): Promise<MakingFixture> {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  const store = new FakeChainStore(data);
  const confirms: string[] = [];
  const fixture: MakingFixture = {
    store,
    confirms,
    confirmResult: true,
    page,
    document: page.document,
    restore,
    controller: null as unknown as MakingController,
  };
  fixture.controller = setupMaking(getAppDom().making, {
    call: store.invoke,
    confirm: async (message) => {
      confirms.push(message);
      return fixture.confirmResult;
    },
  });
  await flushPromises();
  return fixture;
}

async function flushPromises(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

function makingElement(fixture: MakingFixture, id: string): HTMLElement {
  const element = fixture.document.getElementById(id);
  assert.ok(element, `缺少 #${id}`);
  return element;
}

function click(fixture: MakingFixture, id: string): void {
  (makingElement(fixture, id) as unknown as { click(): void }).click();
  void flushPromises();
}

test("status bar tracks the global active chain and ignores browsing", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时" }]),
    version(3, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const chainB = chain("对话打磨", [version(1, [{ title: "语气克制", trigger: "适用：对白打磨" }])]);
  const fixture = await makingFixture(library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[1].id }));
  try {
    const active = makingElement(fixture, "making-status-active");
    const idle = makingElement(fixture, "making-status-idle");
    assert.equal(active.classList.contains("hidden"), false);
    assert.equal(idle.classList.contains("hidden"), true);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第3版/);

    // 浏览另一条链路：检视标题变化，状态条不变（三态分离）。
    const rowB = fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainB.id + '"]');
    assert.ok(rowB, "链路 B 行已渲染");
    rowB.click();
    await flushPromises();
    assert.match(makingElement(fixture, "making-inspector-title").textContent ?? "", /正在查看：对话打磨·第1版/);
    assert.equal(makingElement(fixture, "making-inspector-state").textContent, "尚未启用");
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第3版/);
  } finally {
    fixture.restore();
  }
});

test("empty library guides the user to describe needs and stays idle", async () => {
  const fixture = await makingFixture(library([]));
  try {
    assert.equal(makingElement(fixture, "making-chain-empty").classList.contains("hidden"), false);
    assert.match(makingElement(fixture, "making-status-idle").textContent ?? "", /当前未启用链路，使用日常陪想/);
    assert.equal(makingElement(fixture, "making-status-active").classList.contains("hidden"), true);
  } finally {
    fixture.restore();
  }
});

test("load failure surfaces an explicit error instead of a fake state", async () => {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  const failing: InvokeFn = async <T,>(cmd: string): Promise<T> => {
    if (cmd === "chain_library_load") throw new Error("chains.json 损坏");
    throw new Error(`不应调用 ${cmd}`);
  };
  setupMaking(getAppDom().making, { call: failing });
  await flushPromises();
  try {
    const error = page.document.getElementById("making-status-error");
    assert.ok(error);
    assert.equal(error.classList.contains("hidden"), false);
    assert.match(error.textContent ?? "", /损坏/);
    const active = page.document.getElementById("making-status-active");
    const idle = page.document.getElementById("making-status-idle");
    assert.equal(active?.classList.contains("hidden"), true);
    assert.equal(idle?.classList.contains("hidden"), true);
  } finally {
    restore();
  }
});

test("clicking a card expands the five-item inspection panel below", async () => {
  const body = "先指出人物动机，再给两种走向，由用户决定。";
  const chainA = chain("情节探索", [
    version(2, [{ title: "反差与反转", trigger: "适用：探索情节可能性时", body }], { trials: 1 }),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    const row = fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]');
    row!.click();
    await flushPromises();

    const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
    assert.ok(cardRow, "卡片行已渲染");
    cardRow.click();
    await flushPromises();

    const panel = makingElement(fixture, "making-card-panel");
    assert.equal(panel.classList.contains("hidden"), false);
    const headings = [...panel.querySelectorAll(".making-card-panel-heading")].map((node) => node.textContent);
    assert.deepEqual(headings, ["身份", "何时用", "怎么做", "本版变化", "试问记录"]);
    const bodies = [...panel.querySelectorAll(".making-card-panel-body")].map((node) => node.textContent);
    assert.match(bodies[0]!, /卡名「反差与反转」/);
    assert.equal(bodies[1], "适用：探索情节可能性时");
    assert.equal(bodies[2], body, "完整正文");
    assert.match(bodies[3]!, /本版是第 1 个版本/);
    assert.match(bodies[4]!, /1 次试问记录/);
    // 卡片上没有独立启用开关：启用入口只出现在检视头部（链路版本层级）。
    assert.equal(panel.querySelector("button"), null, "卡片检视面板内无任何按钮");
  } finally {
    fixture.restore();
  }
});

test("enabling a draft version requires confirmation with concrete wording", async () => {
  const chainA = chain("情节探索", [
    version(3, [{ title: "卡", trigger: "适用：x" }]),
    version(4, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    // 先查看该链路，再通过版本下拉切到第 4 版草稿。
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[1].id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();
    assert.equal(makingElement(fixture, "making-inspector-title").textContent, "正在查看：情节探索·第4版（草稿）");
    assert.equal(makingElement(fixture, "making-inspector-state").textContent, "尚未启用");

    const enable = makingElement(fixture, "making-enable-btn") as HTMLButtonElement;
    assert.equal((enable as HTMLElement).hidden, false);
    assert.match(enable.textContent ?? "", /启用「情节探索·第4版」/);

    // 拒绝确认：不调用命令，状态条不变。
    fixture.confirmResult = false;
    enable.click();
    await flushPromises();
    assert.equal(fixture.store.calls.filter((call) => call.cmd === "chain_set_active").length, 0);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /第3版/);

    // 同意确认：命令携带链路与版本，状态条更新为第 4 版。
    fixture.confirmResult = true;
    enable.click();
    await flushPromises();
    const setActive = fixture.store.calls.find((call) => call.cmd === "chain_set_active");
    assert.ok(setActive, "chain_set_active 已调用");
    assert.equal(setActive!.args?.chainId, chainA.id);
    assert.equal(setActive!.args?.versionId, chainA.versions[1].id);
    assert.match(fixture.confirms[0]!, /替换当前「情节探索·第3版」/);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第4版/);
  } finally {
    fixture.restore();
  }
});

test("rolling back to an older version calls chain_rollback after confirmation", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "卡", trigger: "适用：x" }]),
    version(3, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id }));
  try {
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[0].id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();

    const enable = makingElement(fixture, "making-enable-btn") as HTMLButtonElement;
    assert.match(enable.textContent ?? "", /回退到「情节探索·第1版」/);
    enable.click();
    await flushPromises();
    const rollback = fixture.store.calls.find((call) => call.cmd === "chain_rollback");
    assert.ok(rollback, "chain_rollback 已调用");
    assert.equal(rollback!.args?.versionId, chainA.versions[0].id);
    assert.match(fixture.confirms[0]!, /较新版本及试问证据保留/);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第1版/);
  } finally {
    fixture.restore();
  }
});

test("deactivating returns to the daily companion and keeps archives", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    click(fixture, "making-deactivate-btn");
    await flushPromises();
    assert.ok(fixture.store.calls.some((call) => call.cmd === "chain_deactivate"));
    assert.equal(makingElement(fixture, "making-status-idle").classList.contains("hidden"), false);
    assert.equal(makingElement(fixture, "making-status-active").classList.contains("hidden"), true);
    assert.equal(fixture.store.data.chains.length, 1, "链路保留");
  } finally {
    fixture.restore();
  }
});

test("deleting a chain requires confirmation and clears dangling references", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    // 浏览 A 并把 A 设为制作对象，再删除 A。
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    click(fixture, "making-conversation-start-btn");
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /情节探索/);

    fixture.confirmResult = false;
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    assert.equal(fixture.store.calls.filter((call) => call.cmd === "chain_delete").length, 0, "未确认不删除");

    fixture.confirmResult = true;
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    assert.ok(fixture.store.calls.some((call) => call.cmd === "chain_delete" && call.args?.chainId === chainA.id));
    assert.match(fixture.confirms[0]!, /不可恢复/);
    assert.equal(fixture.controller.makingChainId, null, "制作对象悬空已清理");
    assert.equal(fixture.controller.view.chainId, null, "浏览对象悬空已清理");
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /未选择/);
    assert.equal(fixture.store.data.chains.length, 1, "其他链路不受影响");
  } finally {
    fixture.restore();
  }
});

test("starting a new making session switches the object only by explicit action", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA, chainB]));
  try {
    // 浏览 A 后再浏览 B：制作对象保持「未选择」（浏览不切换制作对象）。
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainB.id + '"]')!.click();
    await flushPromises();
    assert.equal(fixture.controller.makingChainId, null);
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /未选择/);

    // 「开始新制作」是显式动作：以当前浏览对象为制作对象。
    click(fixture, "making-conversation-start-btn");
    assert.equal(fixture.controller.makingChainId, chainB.id);
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /对话打磨/);
  } finally {
    fixture.restore();
  }
});

test("creating a chain calls the backend with the trimmed name and views it", async () => {
  const fixture = await makingFixture(library([]));
  try {
    click(fixture, "making-new-chain-btn");
    const input = makingElement(fixture, "making-new-chain-name") as HTMLInputElement;
    input.value = "  情节探索  ";
    const form = makingElement(fixture, "making-new-chain-form");
    dispatchEvent(fixture.page, form, "submit");
    await flushPromises();
    const created = fixture.store.calls.find((call) => call.cmd === "chain_create");
    assert.ok(created, "chain_create 已调用");
    assert.equal(created!.args?.name, "情节探索");
    assert.equal(fixture.controller.view.chainId, fixture.store.data.chains[0].id, "新建后直接查看");
    assert.match(makingElement(fixture, "making-inspector-empty").textContent ?? "", /还没有版本/);
    assert.equal(fixture.controller.makingChainId, null, "新建是查看动作，不切换制作对象");
  } finally {
    fixture.restore();
  }
});

test("narrow view switch keeps unsent input and browsing position", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  try {
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    const inspector = makingElement(fixture, "making-inspector");
    inspector.scrollTop = 42;
    const input = makingElement(fixture, "making-conversation-input") as HTMLTextAreaElement;
    input.value = "未发送的草稿";

    fixture.controller.setNarrowView("chat");
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "chat");
    assert.equal(input.value, "未发送的草稿", "未发送输入保留");

    fixture.controller.setNarrowView("inspect");
    assert.equal(inspector.scrollTop, 42, "浏览位置保留");
    assert.equal(input.value, "未发送的草稿");
  } finally {
    fixture.restore();
  }
});

test("command failures surface as honest errors without success states", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  fixture.store.failures.set("chain_delete", "链路库写入失败: 磁盘满");
  try {
    fixture.document.querySelector<HTMLButtonElement>('[data-chain-id="' + chainA.id + '"]')!.click();
    await flushPromises();
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    const error = makingElement(fixture, "making-status-error");
    assert.equal(error.classList.contains("hidden"), false);
    assert.match(error.textContent ?? "", /链路库写入失败/);
    assert.equal(fixture.store.data.chains.length, 1, "链路仍在（未谎报成功）");
  } finally {
    fixture.restore();
  }
});

// ========== 7.7 链路行携带：类型携带、映射、降级与保存不携带 ==========

function chainRoundOf(turn: number, version: number): ChainRoundRef {
  return { turn_index: turn, chain_id: "chain-1", chain_name: "情节探索", version_index: version };
}

function recordWithChainRounds(chainRounds?: readonly ChainRoundRef[] | null): ConversationRecord {
  return {
    version: 1,
    conversation_id: "c-1",
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问", selection_text: null },
    turns: [
      { role: "user", text: "问", status: "done" },
      { role: "assistant", text: "答", status: "done" },
    ],
    provenance: [],
    ...(chainRounds !== undefined ? { chain_rounds: chainRounds } : {}),
  };
}

test("conversationFromRecord carries archive chain rounds and degrades when missing", () => {
  const carried = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3)]));
  assert.deepEqual(carried.chain_rounds, [chainRoundOf(0, 3)]);

  // 旧档案缺失字段（undefined）与显式 null：都降级为无记录，显示层不显示。
  assert.equal(conversationFromRecord(recordWithChainRounds(undefined)).chain_rounds, undefined);
  assert.equal(conversationFromRecord(recordWithChainRounds(null)).chain_rounds, undefined);
});

test("buildConversationRecord never carries chain rounds (backend narrow update owns them)", () => {
  const conversation = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3)]));
  const record = buildConversationRecord(conversation, null, null);
  assert.equal("chain_rounds" in record, false, "普通整档保存不携带链路轮次记录");
});

test("readonlyConversationView freezes carried chain rounds", () => {
  const conversation = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3), chainRoundOf(1, 4)]));
  const view = readonlyConversationView(conversation)!;
  assert.deepEqual(view.chain_rounds, [chainRoundOf(0, 3), chainRoundOf(1, 4)]);
  assert.ok(Object.isFrozen(view.chain_rounds));
  assert.ok(Object.isFrozen(view.chain_rounds![0]));
});

test("record_round_chain merges by turn, replaces same turn, and dedupes identical entries", () => {
  const base = initialAiPanelCoreState();
  const withDiscussion = reduceAiPanelState(base, {
    type: "begin_direct_question",
    question: "问",
    selection: null,
    conversationId: "c-1",
    createdAt: "t0",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  const loading = reduceAiPanelState(withDiscussion, {
    type: "succeed_direct_question",
    response: "答",
    conversationId: "c-1",
  });
  const discussionBefore = loading.discussions.get("c-1")!;
  assert.ok(discussionBefore.conversation, "前置：直接提问成功后已建立对话");

  const first = reduceAiPanelState(loading, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 3),
  });
  assert.deepEqual(first.discussions.get("c-1")!.conversation!.chain_rounds, [chainRoundOf(0, 3)]);

  // 同轮新版本：覆盖同轮旧记录；同轮排序稳定。
  const replaced = reduceAiPanelState(first, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 4),
  });
  assert.deepEqual(replaced.discussions.get("c-1")!.conversation!.chain_rounds, [chainRoundOf(0, 4)]);

  // 完全相同的记录：不产生新状态（引用不变）。
  const identical = reduceAiPanelState(replaced, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 4),
  });
  assert.equal(identical, replaced, "重复记录不产生新状态");

  // 不同轮：按 turn_index 排序追加。
  const secondTurn = reduceAiPanelState(replaced, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(1, 5),
  });
  assert.deepEqual(
    secondTurn.discussions.get("c-1")!.conversation!.chain_rounds,
    [chainRoundOf(0, 4), chainRoundOf(1, 5)],
  );

  // 不存在的讨论：原样返回。
  const missing = reduceAiPanelState(secondTurn, {
    type: "record_round_chain",
    conversationId: "c-none",
    entry: chainRoundOf(0, 3),
  });
  assert.equal(missing, secondTurn);
});

/** 网关测试用的最小上下文桩：只实现直接提问路径实际触及的访问器。 */
function stubGatewayContext(state: AiPanelState, result: GenerateAiResult): AiFeatureContext {
  const transport = {
    sendViaResidentSession: async (): Promise<GenerateAiResult> => result,
  };
  return {
    state,
    getProjectToken: () => 1,
    advanceProjectToken: () => {},
    isDestroyed: () => false,
    markDestroyed: () => {},
    getTransport: () => transport,
    getScheduler: () => null,
    getCoordinator: () => null,
    getSelectionEntry: () => null,
    getAiDock: () => null,
    loadConfig: null,
    getCurrentProjectPath: () => null,
    getCurrentDocumentTitle: () => null,
    getCurrentTree: () => null,
    getCurrentDocumentVersion: () => null,
    getCurrentDocumentId: () => null,
    getCurrentEditor: () => null,
    hiddenDocumentIds: () => new Set<string>(),
  } as unknown as AiFeatureContext;
}

test("gateway merges result chain_round into the live discussion and the material view shows it", async () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问", null, null, null);
  const conversationId = state.activeConversationId;
  assert.ok(conversationId);

  const result: GenerateAiResult = {
    ok: true,
    content: "答",
    provenance: [{ document_id: "doc-1", material_type: "focus_document", version: "v1" }],
    sent_confirmed: true,
    chain_round: chainRoundOf(0, 3),
  };
  const persisted: string[] = [];
  const gateway = setupAiRequestGateway({
    context: stubGatewayContext(state, result),
    persistDiscussion: (id) => persisted.push(id),
    refreshOnDemandState: () => {},
  });

  const accepted = gateway.requestDirectQuestion(conversationId!, { kind: "direct_question", question: "问" });
  assert.ok(accepted, "请求已受理");
  await accepted;

  const conversation = state.getDiscussion(conversationId!)?.conversation;
  assert.ok(conversation, "成功后已建立对话");
  assert.deepEqual(conversation!.chain_rounds, [chainRoundOf(0, 3)], "结果携带的链路引用并入讨论对象");
  assert.deepEqual(persisted, [conversationId!], "终态编排照常触发档案保存");

  // 显示层（fix-4 已接好）经并入的记录自动出「本轮链路」行。
  const view = buildMaterialView(readonlyConversationView(conversation!) as ReadonlyTemporaryConversation);
  assert.equal(view!.rounds.length, 1);
  assert.equal(view!.rounds[0].chainLabel, "本轮链路：情节探索·第3版");
});
